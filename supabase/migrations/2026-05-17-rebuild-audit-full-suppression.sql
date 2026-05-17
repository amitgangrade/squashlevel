-- 2026-05-17: full audit suppression during rebuild + richer summary
--
-- Previous migration (2026-05-17-rebuild-audit-summary) suppressed the
-- per-player audit rows emitted by `rebuild_levels_finalize`, but
-- `rebuild_levels_chunk` still triggered one audit row per match it
-- recomputed (`level_*_before/after`, `delta_*`, `provisional_*` are
-- written by chunks). At scale (10k players × 30k matches) that's 30k
-- audit rows per rebuild — fold-and-expand UI would only hide the
-- problem, not solve it. The audit log should record WHO did WHAT
-- WHEN, not be a recording of every derived column flip.
--
-- This migration:
--   1. Adds a singleton `level_rebuild_run` table to track stats
--      (started_at, matches_processed) across the chunked rebuild
--      lifecycle.
--   2. Suppresses audit in `rebuild_levels_chunk` (matches no longer
--      fire per-row audit during rebuild).
--   3. `rebuild_levels_finalize` writes ONE summary audit row with
--      enriched `changed` jsonb: players_affected, matches_processed,
--      started_at, finished_at, duration_seconds. Net result: a rebuild
--      at any scale produces exactly one audit row.

create table if not exists public.level_rebuild_run (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null default now(),
  started_by uuid references auth.users(id) on delete set null,
  matches_processed int not null default 0
);
alter table public.level_rebuild_run enable row level security;
-- No policies → only SECURITY DEFINER functions touch this table.

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
  truncate public.level_rebuild_run;
  insert into public.level_rebuild_run (singleton, started_at, started_by)
    values (true, now(), auth.uid());
  insert into public.level_rebuild_state (player_id, current_level, matches_played, seeded_rating)
    select id, starting_level, 0, seeded_rating from public.players;
end;
$$;

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
  s          public.settings;
  damping_k  numeric;
  pw         numeric;
  pe         numeric;
  ge         numeric;
  pt         int;
  m          record;
  la         numeric;
  lb         numeric;
  ma_played  int;
  mb_played  int;
  seeded_a   boolean;
  seeded_b   boolean;
  pa         boolean;
  pb         boolean;
  upd        record;
  proc       int := 0;
  last_date  date;
  last_id    uuid;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  -- Suppress per-row audit for every match update done in this chunk.
  -- Rebuild is a deterministic recompute of derived columns
  -- (level_*_before/after, delta_*, provisional_*) — auditing each row
  -- is double-bookkeeping. One summary row is emitted by finalize().
  perform set_config('boast.audit_skip', 'true', true);

  select * into s from public.settings where id = 'app';
  damping_k := coalesce((s.data->>'dampingK')::numeric, 0.12);
  pw        := coalesce((s.data->>'pointsWeight')::numeric, 0.5);
  pe        := coalesce((s.data->>'pointsExponent')::numeric, 2);
  ge        := coalesce((s.data->>'gamesExponent')::numeric, 5);
  pt        := coalesce((s.data->>'provisionalThreshold')::int, 5);

  for m in
    select * from public.matches
     where (status = 'confirmed' or status is null)
       and (
         p_after_date is null
         or date > p_after_date
         or (date = p_after_date and id > p_after_id)
       )
     order by date asc, id asc
     limit p_limit
  loop
    select current_level, matches_played, seeded_rating
      into la, ma_played, seeded_a
      from public.level_rebuild_state where player_id = m.player_a_id;
    select current_level, matches_played, seeded_rating
      into lb, mb_played, seeded_b
      from public.level_rebuild_state where player_id = m.player_b_id;

    if la is null or lb is null then
      last_date := m.date;
      last_id   := m.id;
      proc := proc + 1;
      continue;
    end if;

    pa := (ma_played < pt) and not coalesce(seeded_a, false);
    pb := (mb_played < pt) and not coalesce(seeded_b, false);

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

  -- Bump the run-scoped matches_processed counter so finalize can report
  -- the total. If the run row doesn't exist yet (caller skipped start, or
  -- the row was truncated between chunks) we silently do nothing — the
  -- summary will simply omit matches_processed.
  update public.level_rebuild_run set matches_processed = matches_processed + proc where singleton = true;

  return query select
    proc,
    last_date,
    last_id,
    (proc = 0);
end;
$$;

create or replace function public.rebuild_levels_finalize()
returns int
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
declare
  affected         int;
  uid              uuid := auth.uid();
  actor_lbl        text;
  run_started_at   timestamptz;
  run_matches      int;
  finished_at      timestamptz := now();
  duration_seconds numeric;
begin
  if not public.is_admin(uid) then
    raise exception 'admin only';
  end if;

  -- Snapshot run stats before any state mutation so the summary stays
  -- consistent even if a concurrent caller does anything unexpected.
  select started_at, matches_processed
    into run_started_at, run_matches
    from public.level_rebuild_run where singleton = true;

  perform set_config('boast.audit_skip', 'true', true);
  update public.players p
     set current_level  = ps.current_level,
         matches_played = ps.matches_played,
         levels_stale   = false
    from public.level_rebuild_state ps
   where p.id = ps.player_id;
  get diagnostics affected = row_count;
  truncate public.level_rebuild_state;
  truncate public.level_rebuild_run;
  perform set_config('boast.audit_skip', 'false', true);

  duration_seconds := case
    when run_started_at is null then null
    else extract(epoch from (finished_at - run_started_at))
  end;

  select coalesce(full_name, '') || ' <' || coalesce(email, '') || '>'
    into actor_lbl from public.profiles where id = uid;
  insert into public.audit_events (
    actor_user_id, actor_label, entity_type, op, summary, changed, privileged
  ) values (
    uid, actor_lbl, 'settings', 'update',
    format(
      'Rebuilt levels for %s players%s',
      affected,
      case
        when run_matches is null then ''
        else format(' (%s matches reprocessed)', run_matches)
      end
    ),
    jsonb_strip_nulls(jsonb_build_object(
      'kind', 'rebuild_levels',
      'players_affected', affected,
      'matches_processed', run_matches,
      'started_at', run_started_at,
      'finished_at', finished_at,
      'duration_seconds', duration_seconds
    )),
    true
  );

  return affected;
end;
$$;

grant execute on function public.rebuild_levels_start() to authenticated;
grant execute on function public.rebuild_levels_chunk(date, uuid, int) to authenticated;
grant execute on function public.rebuild_levels_finalize() to authenticated;
