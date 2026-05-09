-- Chunked level rebuild migration.
--
-- Reason for this file: applying the full schema.sql in the Supabase SQL
-- editor hits the ~60s edge proxy upstream timeout. This file contains only
-- the DDL that's new since the previous schema apply, so it lands fast.
--
-- Safe to run multiple times — every statement is idempotent.

-- ---------------------------------------------------------------------------
-- 1. Drop legacy helpers and the all-in-one rebuild RPC.
-- ---------------------------------------------------------------------------
drop function if exists public.apply_match_level_updates(jsonb);
drop function if exists public.apply_player_level_updates(jsonb);
drop function if exists public.rebuild_all_levels();

-- ---------------------------------------------------------------------------
-- 2. compute_level_update — plpgsql port of updateLevels() in
--    src/lib/rating/update.ts. Keep the two implementations in sync.
-- ---------------------------------------------------------------------------
create or replace function public.compute_level_update(
  level_a          numeric,
  level_b          numeric,
  games            jsonb,
  match_type       text,
  provisional_a    boolean,
  provisional_b    boolean,
  damping_k        numeric,
  points_weight    numeric,
  points_exponent  numeric,
  games_exponent   numeric
)
returns table(
  level_a_after numeric,
  level_b_after numeric,
  delta_a       numeric,
  delta_b       numeric
)
language plpgsql
immutable
as $$
declare
  la       double precision := level_a::double precision;
  lb       double precision := level_b::double precision;
  ratio    double precision := la / nullif(lb, 0);
  e_p      double precision;
  e_g      double precision;
  expected double precision;
  total_a  int := 0;
  total_b  int := 0;
  games_a  int := 0;
  played   int := 0;
  p_ratio  double precision;
  g_ratio  double precision;
  actual   double precision;
  d        double precision;
  weight   double precision;
  change   double precision;
  laa      double precision;
  lba      double precision;
  g        jsonb;
  ga       int;
  gb       int;
  pw       double precision := points_weight::double precision;
begin
  e_p := power(ratio, points_exponent::double precision);
  e_p := e_p / (e_p + 1);
  e_g := power(ratio, games_exponent::double precision);
  e_g := e_g / (e_g + 1);
  expected := pw * e_p + (1 - pw) * e_g;

  for g in select * from jsonb_array_elements(games) loop
    ga := (g->>'a')::int;
    gb := (g->>'b')::int;
    total_a := total_a + ga;
    total_b := total_b + gb;
    if ga > gb then
      games_a := games_a + 1;
      played  := played + 1;
    elsif gb > ga then
      played  := played + 1;
    end if;
  end loop;

  if total_a + total_b = 0 then
    p_ratio := 0.5;
  else
    p_ratio := total_a::double precision / (total_a + total_b);
  end if;
  if played = 0 then
    g_ratio := 0.5;
  else
    g_ratio := games_a::double precision / played;
  end if;
  actual := pw * p_ratio + (1 - pw) * g_ratio;

  d := actual - expected;
  weight := case match_type
    when 'friendly'   then 0.7
    when 'box'        then 1.0
    when 'league'     then 1.3
    when 'tournament' then 1.6
    else 1.0
  end;
  change := damping_k::double precision * weight * d;

  laa := la * (1 + change);
  lba := lb * (1 - change);

  if provisional_a and not provisional_b then
    lba := lb;
  elsif provisional_b and not provisional_a then
    laa := la;
  end if;

  laa := greatest(1::double precision, laa);
  lba := greatest(1::double precision, lba);

  return query select
    laa::numeric,
    lba::numeric,
    (laa - la)::numeric,
    (lba - lb)::numeric;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. level_rebuild_state table holds in-progress player state across the
--    chunked rebuild's HTTP boundaries.
-- ---------------------------------------------------------------------------
create table if not exists public.level_rebuild_state (
  player_id      uuid primary key references public.players(id) on delete cascade,
  current_level  numeric not null,
  matches_played int not null
);

alter table public.level_rebuild_state enable row level security;
drop policy if exists "admin all level_rebuild_state" on public.level_rebuild_state;
create policy "admin all level_rebuild_state" on public.level_rebuild_state
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. rebuild_levels_start — clears state, seeds from starting_level.
-- ---------------------------------------------------------------------------
create or replace function public.rebuild_levels_start()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  truncate public.level_rebuild_state;
  insert into public.level_rebuild_state (player_id, current_level, matches_played)
    select id, starting_level, 0 from public.players;
end;
$$;

grant execute on function public.rebuild_levels_start() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. rebuild_levels_chunk — processes up to p_limit matches starting after
--    the (date, id) cursor.
-- ---------------------------------------------------------------------------
create or replace function public.rebuild_levels_chunk(
  p_after_date date,
  p_after_id   uuid,
  p_limit      int default 10000
)
returns table(
  processed       int,
  next_after_date date,
  next_after_id   uuid,
  done            boolean
)
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
declare
  s          jsonb;
  damping_k  numeric;
  pw         numeric;
  pe         numeric;
  ge         numeric;
  pt         int;
  m          record;
  upd        record;
  proc       int := 0;
  la         numeric;
  lb         numeric;
  ma_played  int;
  mb_played  int;
  pa         boolean;
  pb         boolean;
  last_date  date := p_after_date;
  last_id    uuid := p_after_id;
  more       boolean := false;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  select data into s from public.settings where id = 'app';
  damping_k := coalesce((s->>'dampingK')::numeric, 0.12);
  pw        := coalesce((s->>'pointsWeight')::numeric, 0.5);
  pe        := coalesce((s->>'pointsExponent')::numeric, 2);
  ge        := coalesce((s->>'gamesExponent')::numeric, 5);
  pt        := coalesce((s->>'provisionalThreshold')::int, 5);

  for m in
    select id, date, player_a_id, player_b_id, games, type, unranked
      from public.matches
     where (status is null or status = 'confirmed')
       and (
         p_after_date is null
         or date > p_after_date
         or (date = p_after_date and id > p_after_id)
       )
     order by date asc, id asc
     limit p_limit
  loop
    select current_level, matches_played into la, ma_played
      from public.level_rebuild_state where player_id = m.player_a_id;
    select current_level, matches_played into lb, mb_played
      from public.level_rebuild_state where player_id = m.player_b_id;

    if la is null or lb is null then
      last_date := m.date;
      last_id   := m.id;
      proc := proc + 1;
      continue;
    end if;

    pa := ma_played < pt;
    pb := mb_played < pt;

    if m.unranked then
      update public.matches set
        level_a_before = la,  level_b_before = lb,
        level_a_after  = la,  level_b_after  = lb,
        delta_a        = 0,   delta_b        = 0,
        provisional_a  = pa,  provisional_b  = pb
      where id = m.id;
    else
      select * into upd from public.compute_level_update(
        la, lb, m.games, m.type, pa, pb,
        damping_k, pw, pe, ge
      );

      update public.matches set
        level_a_before = la,  level_b_before = lb,
        level_a_after  = upd.level_a_after,
        level_b_after  = upd.level_b_after,
        delta_a        = upd.delta_a,
        delta_b        = upd.delta_b,
        provisional_a  = pa,  provisional_b  = pb
      where id = m.id;

      update public.level_rebuild_state
         set current_level = upd.level_a_after,
             matches_played = matches_played + 1
       where player_id = m.player_a_id;
      update public.level_rebuild_state
         set current_level = upd.level_b_after,
             matches_played = matches_played + 1
       where player_id = m.player_b_id;
    end if;

    last_date := m.date;
    last_id   := m.id;
    proc := proc + 1;
  end loop;

  if last_date is null then
    return query select proc, p_after_date, p_after_id, true;
    return;
  end if;

  select exists (
    select 1 from public.matches
     where (status is null or status = 'confirmed')
       and (date > last_date or (date = last_date and id > last_id))
  ) into more;

  return query select proc, last_date, last_id, not more;
end;
$$;

grant execute on function public.rebuild_levels_chunk(date, uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. rebuild_levels_finalize — copy state into players, truncate state.
-- ---------------------------------------------------------------------------
create or replace function public.rebuild_levels_finalize()
returns int
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
declare
  affected int;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  update public.players p
     set current_level  = ps.current_level,
         matches_played = ps.matches_played
    from public.level_rebuild_state ps
   where p.id = ps.player_id;
  get diagnostics affected = row_count;
  truncate public.level_rebuild_state;
  return affected;
end;
$$;

grant execute on function public.rebuild_levels_finalize() to authenticated;
