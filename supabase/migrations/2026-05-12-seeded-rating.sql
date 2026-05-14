-- Seeded-rating exemption from provisional (2026-05-12).
--
-- New rule (see openspec/specs/rating/spec.md §Provisional rule):
--   A player is provisional when matches_played < provisionalThreshold AND
--   NOT seeded_rating. Players who registered with an explicit
--   SquashLevels.com / LevelTech rating ("I have a rating" branch of
--   onboarding) get seeded_rating = TRUE and bypass the provisional
--   protection from match 1.
--
-- Backfill: existing rows default to FALSE. Anyone with ≥ 5 confirmed
-- matches is already non-provisional today and is unaffected. Anyone
-- with < 5 matches stays provisional under the new rule too — they get
-- the same experience they have today.
--
-- Idempotent (add column if not exists, create or replace function).

-- ---------- columns ----------------------------------------------------
alter table public.profiles
  add column if not exists seeded_rating boolean not null default false;
alter table public.players
  add column if not exists seeded_rating boolean not null default false;
alter table public.level_rebuild_state
  add column if not exists seeded_rating boolean not null default false;

-- ---------- trigger updates --------------------------------------------
-- Carry seeded_rating from profile → players on profile insert (signup)
-- and on every profile update. The cascade-skip flag (introduced by the
-- audit-log migration) still wraps these writes so they don't double up
-- in audit_events.

create or replace function public.sync_player_from_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('boast.audit_skip', 'true', true);
  update public.players
     set name = new.full_name,
         email = new.email,
         starting_level = new.starting_level,
         seeded_rating = new.seeded_rating,
         phone = new.phone,
         country = new.country,
         city = new.city,
         club = new.club,
         avatar_url = new.avatar_url,
         birth_year = new.birth_year,
         gender = new.gender,
         dominant_hand = new.dominant_hand
   where user_id = new.id;
  perform set_config('boast.audit_skip', 'false', true);
  return new;
end;
$$;

create or replace function public.ensure_player_for_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uemail text := public.norm_email(new.email);
  claimed_id uuid;
begin
  if exists (select 1 from public.players where user_id = new.id) then
    return new;
  end if;

  perform set_config('boast.audit_skip', 'true', true);

  if uemail is not null then
    -- Claim path. The profile's seeded_rating is authoritative — it
    -- reflects the user's explicit "I have a rating" choice at signup
    -- and overrides whatever the stub was created with.
    update public.players
       set user_id = new.id,
           name = new.full_name,
           seeded_rating = new.seeded_rating,
           phone = coalesce(public.players.phone, new.phone),
           country = coalesce(public.players.country, new.country),
           city = coalesce(public.players.city, new.city),
           club = coalesce(public.players.club, new.club),
           avatar_url = coalesce(public.players.avatar_url, new.avatar_url),
           birth_year = coalesce(public.players.birth_year, new.birth_year),
           gender = coalesce(public.players.gender, new.gender),
           dominant_hand = coalesce(public.players.dominant_hand, new.dominant_hand)
     where id = (
       select id from public.players
       where user_id is null
         and email is not null
         and public.norm_email(email) = uemail
       order by created_at asc
       limit 1
     )
     returning id into claimed_id;
  end if;

  if claimed_id is null then
    insert into public.players (
      id, name, starting_level, seeded_rating, email, user_id, created_at, created_by,
      phone, country, city, club, avatar_url, birth_year, gender, dominant_hand
    ) values (
      gen_random_uuid(), new.full_name, new.starting_level, new.seeded_rating,
      new.email, new.id, now(), new.id,
      new.phone, new.country, new.city, new.club, new.avatar_url,
      new.birth_year, new.gender, new.dominant_hand
    );
  end if;

  perform set_config('boast.audit_skip', 'false', true);
  return new;
end;
$$;

-- ---------- rebuild_levels: include seeded_rating --------------------
-- Seed it into level_rebuild_state and use it when computing per-match
-- provisional flags. Without this, a Rebuild Levels would re-mark every
-- seeded player as provisional for their first 5 matches, undoing the
-- exemption.

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
  insert into public.level_rebuild_state (player_id, current_level, matches_played, seeded_rating)
    select id, starting_level, 0, seeded_rating from public.players;
end;
$$;

-- The chunk function. Only the `pa`/`pb` computation changes; everything
-- else is identical to the audit-log migration's version. Kept inline so
-- the migration is self-contained and re-runnable.
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

    -- NEW: seeded players bypass provisional from match 1.
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

  return query select
    proc,
    last_date,
    last_id,
    (proc = 0);
end;
$$;
