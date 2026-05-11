-- Boast — Supabase schema
-- Run this once in your Supabase project SQL editor.
-- Idempotent: safe to re-run after upgrades.

-- ===========================================================================
-- profiles: one row per authenticated user
-- ===========================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  username text unique not null,
  email text not null,
  phone text,
  country text,
  city text,
  club text,
  avatar_url text,
  birth_year smallint,
  gender text,
  dominant_hand text,
  starting_level numeric not null default 1000,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists club text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists birth_year smallint;
alter table public.profiles add column if not exists gender text;
alter table public.profiles add column if not exists dominant_hand text;

create index if not exists profiles_username_idx on public.profiles (username);
create index if not exists profiles_email_idx on public.profiles (email);
-- Trigram indexes back the case-insensitive substring search powering the
-- admin "Search by name, email, club..." typeahead. Cheap at 10K+ rows
-- because the query stays server-side (search_profiles_for_admin RPC) and
-- never ships the full profile table to the client.
create index if not exists profiles_full_name_trgm_idx on public.profiles using gin (full_name gin_trgm_ops);
create index if not exists profiles_email_trgm_idx on public.profiles using gin (email gin_trgm_ops);

-- ===========================================================================
-- players: ranked entities. Linked to a user when claimed.
-- Legacy un-claimed players (created before auth) keep user_id null.
-- ===========================================================================
create table if not exists public.players (
  id uuid primary key,
  name text not null,
  starting_level numeric not null,
  notes text,
  email text,
  user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table public.players add column if not exists email text;
alter table public.players add column if not exists user_id uuid unique references auth.users(id) on delete set null;

-- Rich identity fields (mirrored from profiles for claimed players, set
-- directly by admins for unclaimed ones). Lets the picker show a player's
-- club / country / age / photo so admins can disambiguate same-named players.
alter table public.players add column if not exists phone text;
alter table public.players add column if not exists country text;
alter table public.players add column if not exists city text;
alter table public.players add column if not exists club text;
alter table public.players add column if not exists avatar_url text;
alter table public.players add column if not exists birth_year smallint;
alter table public.players add column if not exists gender text;
alter table public.players add column if not exists dominant_hand text;

-- Server-truth current rating + match count, maintained by the matches trigger.
-- NULL current_level means "use starting_level" (untouched player).
alter table public.players add column if not exists current_level numeric;
alter table public.players add column if not exists matches_played integer not null default 0;

-- Trigram index for fast ilike search at scale (tens of thousands of players).
create extension if not exists pg_trgm;
create index if not exists players_name_trgm_idx on public.players using gin (name gin_trgm_ops);

create table if not exists public.matches (
  id uuid primary key,
  date date not null,
  player_a_id uuid not null references public.players(id) on delete cascade,
  player_b_id uuid not null references public.players(id) on delete cascade,
  games jsonb not null,
  type text not null check (type in ('friendly', 'box', 'league', 'tournament')),
  notes text,
  status text not null default 'pending',
  confirmed_at timestamptz,
  disputed_at timestamptz,
  auto_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

-- Add confirmation columns to upgrades from older schema versions.
alter table public.matches add column if not exists status text;
alter table public.matches add column if not exists confirmed_at timestamptz;
alter table public.matches add column if not exists disputed_at timestamptz;
alter table public.matches add column if not exists auto_confirmed boolean not null default false;
alter table public.matches add column if not exists venue text;
-- When true, the match is recorded for posterity but excluded from rating
-- calculations (e.g. friendly knockabouts both players agreed not to count).
alter table public.matches add column if not exists unranked boolean not null default false;

-- Server-truth level snapshots. The client computes these via updateLevels()
-- before insert (so we don't have to port the rating math to plpgsql); the
-- AFTER trigger below pushes the *_after values to players.current_level when
-- the match becomes part of the rated set. The "Rebuild levels" admin action
-- corrects drift after edits/deletes.
alter table public.matches add column if not exists level_a_before numeric;
alter table public.matches add column if not exists level_a_after  numeric;
alter table public.matches add column if not exists level_b_before numeric;
alter table public.matches add column if not exists level_b_after  numeric;
alter table public.matches add column if not exists delta_a        numeric;
alter table public.matches add column if not exists delta_b        numeric;
alter table public.matches add column if not exists provisional_a  boolean;
alter table public.matches add column if not exists provisional_b  boolean;

-- Backfill existing matches as already confirmed (preserves leaderboard).
update public.matches set status = 'confirmed', confirmed_at = coalesce(confirmed_at, created_at)
  where status is null;

alter table public.matches alter column status set default 'pending';
alter table public.matches alter column status set not null;
do $$
begin
  alter table public.matches add constraint matches_status_check
    check (status in ('pending', 'confirmed', 'disputed'));
exception when duplicate_object then null;
end $$;

create index if not exists matches_status_idx on public.matches (status);
create index if not exists matches_pending_created_idx on public.matches (created_at) where status = 'pending';

create table if not exists public.settings (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists matches_date_idx on public.matches (date);
create index if not exists matches_player_a_idx on public.matches (player_a_id);
create index if not exists matches_player_b_idx on public.matches (player_b_id);

-- ===========================================================================
-- Helpers
-- ===========================================================================

-- is_admin(uid): true if the given user has the admin flag.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = uid), false);
$$;

-- Auto-promote the original owner the first time they appear in profiles.
create or replace function public.bootstrap_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email = 'amit.gangrade@gmail.com' then
    new.is_admin := true;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_bootstrap_admin on public.profiles;
create trigger profiles_bootstrap_admin
before insert on public.profiles
for each row execute function public.bootstrap_admin();

-- norm_email(e): normalize an email for matching purposes.
--   - lowercases everything
--   - for gmail.com / googlemail.com addresses: strips dots from the local part
--     and drops anything after a "+" (Gmail treats "j.doe+x@gmail.com" and
--     "jdoe@googlemail.com" as the same mailbox).
-- Returns null for empty/malformed input so it can't false-match.
create or replace function public.norm_email(e text)
returns text
language sql
immutable
as $$
  with parts as (
    select
      lower(split_part(coalesce(e, ''), '@', 1)) as local,
      lower(split_part(coalesce(e, ''), '@', 2)) as domain
  )
  select case
    when local = '' or domain = '' then null
    when domain in ('gmail.com', 'googlemail.com') then
      replace(split_part(local, '+', 1), '.', '') || '@gmail.com'
    else local || '@' || domain
  end
  from parts;
$$;

-- claim_player_for_me():
-- If an admin pre-created a player row with this user's email (normalized
-- per norm_email) and it's still unclaimed (user_id is null), atomically
-- claim it for the current user and return it. If the user already owns a
-- player, return that. Returns null when there is nothing to claim — caller
-- falls back to creating a fresh player. SECURITY DEFINER bypasses RLS so
-- the claim is gated entirely by the email-match check inside the function.
create or replace function public.claim_player_for_me()
returns public.players
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  uemail text := public.norm_email(coalesce(auth.jwt() ->> 'email', ''));
  found public.players;
begin
  if uid is null or uemail is null then
    return null;
  end if;

  -- If this user already owns a player, return it (idempotent).
  select * into found from public.players where user_id = uid limit 1;
  if found.id is not null then
    return found;
  end if;

  -- Find the oldest unclaimed player whose email normalizes to the same
  -- mailbox as the signed-in user.
  select * into found
  from public.players
  where user_id is null
    and email is not null
    and public.norm_email(email) = uemail
  order by created_at asc
  limit 1;

  if found.id is null then
    return null;
  end if;

  update public.players
     set user_id = uid
   where id = found.id
   returning * into found;

  return found;
end;
$$;

grant execute on function public.claim_player_for_me() to authenticated;

-- ensure_player_for_profile():
-- Trigger function that guarantees every profile has a corresponding player
-- row, with all the rich identity fields copied across. Runs AFTER INSERT on
-- profiles. If a pre-existing player matches by email (admin pre-create flow),
-- claim it AND refresh its rich fields from the profile. Otherwise create a
-- fresh player. SECURITY DEFINER so it can write to players regardless of the
-- inserting user's RLS context.
create or replace function public.ensure_player_for_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uemail text := public.norm_email(new.email);
  claimed_id uuid;
begin
  if exists (select 1 from public.players where user_id = new.id) then
    return new;
  end if;

  if uemail is not null then
    update public.players
       set user_id = new.id,
           name = new.full_name,
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
    if claimed_id is not null then
      return new;
    end if;
  end if;

  insert into public.players (
    id, name, starting_level, email, user_id, created_at,
    phone, country, city, club, avatar_url, birth_year, gender, dominant_hand
  )
  values (
    new.id, new.full_name, new.starting_level, new.email, new.id, new.created_at,
    new.phone, new.country, new.city, new.club, new.avatar_url, new.birth_year, new.gender, new.dominant_hand
  );

  return new;
end;
$$;

drop trigger if exists profiles_ensure_player on public.profiles;
create trigger profiles_ensure_player
  after insert on public.profiles
  for each row execute function public.ensure_player_for_profile();

-- sync_player_from_profile():
-- AFTER UPDATE trigger that mirrors profile edits to the linked player row,
-- so an admin or the user themselves only have to edit one place to update
-- their public-facing identity fields.
create or replace function public.sync_player_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.players
     set name = new.full_name,
         email = new.email,
         starting_level = new.starting_level,
         phone = new.phone,
         country = new.country,
         city = new.city,
         club = new.club,
         avatar_url = new.avatar_url,
         birth_year = new.birth_year,
         gender = new.gender,
         dominant_hand = new.dominant_hand
   where user_id = new.id;
  return new;
end;
$$;

drop trigger if exists profiles_sync_player on public.profiles;
create trigger profiles_sync_player
  after update on public.profiles
  for each row execute function public.sync_player_from_profile();

-- set_admin(target_id, value): admin-only RPC to promote / demote another
-- profile. Throws if caller isn't admin or target doesn't exist. Allows an
-- admin to demote themselves but not the last admin (safety guard).
create or replace function public.set_admin(target_id uuid, value boolean)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target public.profiles;
  remaining_admins int;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_admin(caller) then
    raise exception 'admin only';
  end if;

  select * into target from public.profiles where id = target_id;
  if target.id is null then
    raise exception 'profile not found';
  end if;

  if target.is_admin and not value then
    select count(*) into remaining_admins from public.profiles where is_admin = true and id <> target_id;
    if remaining_admins = 0 then
      raise exception 'cannot demote the last admin';
    end if;
  end if;

  update public.profiles set is_admin = value where id = target_id returning * into target;
  return target;
end;
$$;

grant execute on function public.set_admin(uuid, boolean) to authenticated;

-- list_profiles_for_admin(): admin-only listing of every profile, used by the
-- admin-management UI. Plain table SELECT also works (RLS allows public read)
-- but this endpoint exists so the client can fail fast for non-admins and
-- so we can attach derived counts later if useful.
create or replace function public.list_profiles_for_admin()
returns setof public.profiles
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  return query select * from public.profiles order by full_name;
end;
$$;

grant execute on function public.list_profiles_for_admin() to authenticated;

-- search_profiles_for_admin: scalable replacement for list_profiles_for_admin.
-- Returns up to p_limit rows matching the (whitespace-tokenised, case-
-- insensitive) query against full_name + email + username + club. Empty
-- query returns the first p_limit profiles by full_name so the UI isn't
-- blank on first paint.
--
-- The old list_profiles_for_admin RPC is kept for now (some places still
-- need a small full snapshot — e.g. ClubAdminManager's "current admins for
-- this club" join). New code should prefer this one.
create or replace function public.search_profiles_for_admin(
  p_query text default null,
  p_limit int default 25
)
returns setof public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  capped_limit int := greatest(1, least(coalesce(p_limit, 25), 100));
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  if p_query is null or btrim(p_query) = '' then
    return query
      select * from public.profiles
      order by full_name
      limit capped_limit;
    return;
  end if;
  -- Every whitespace-separated token must appear (case-insensitively) in the
  -- combined haystack: full_name + email + username + club. NOT EXISTS over
  -- the failing-token set is the cleanest token-AND in plain SQL.
  return query
    select p.*
    from public.profiles p
    where not exists (
      select 1
      from unnest(regexp_split_to_array(btrim(p_query), '\s+')) tok
      where (
        coalesce(p.full_name, '') || ' ' ||
        coalesce(p.email, '')     || ' ' ||
        coalesce(p.username, '')  || ' ' ||
        coalesce(p.club, '')
      ) !~* tok
    )
    order by p.full_name
    limit capped_limit;
end;
$$;

grant execute on function public.search_profiles_for_admin(text, int) to authenticated;

-- ===========================================================================
-- Match confirmation
-- ===========================================================================

-- BEFORE INSERT trigger that:
--   1. Auto-fills created_by from auth.uid() if the client didn't.
--   2. Auto-confirms when the recorder is admin (their authority is implicit).
--   3. Auto-confirms when the recorder reported a self-loss (no incentive
--      to fake your own loss, so opponent confirmation is unnecessary).
create or replace function public.matches_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recorder_player_id uuid;
  is_recorder_admin boolean;
  a_games int := 0;
  b_games int := 0;
  g jsonb;
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  if new.created_by is null then
    return new; -- no auth context (e.g. service-role insert) — leave pending
  end if;

  is_recorder_admin := public.is_admin(new.created_by);
  if is_recorder_admin then
    new.status := 'confirmed';
    new.confirmed_at := now();
    new.auto_confirmed := true;
    return new;
  end if;

  -- Find the player row owned by the recorder.
  select id into recorder_player_id from public.players where user_id = new.created_by limit 1;
  if recorder_player_id is null then
    return new;
  end if;

  -- Tally games won by each side.
  for g in select * from jsonb_array_elements(new.games)
  loop
    if (g->>'a')::int > (g->>'b')::int then
      a_games := a_games + 1;
    elsif (g->>'b')::int > (g->>'a')::int then
      b_games := b_games + 1;
    end if;
  end loop;

  if (new.player_a_id = recorder_player_id and a_games < b_games)
     or (new.player_b_id = recorder_player_id and b_games < a_games) then
    new.status := 'confirmed';
    new.confirmed_at := now();
    new.auto_confirmed := true;
  end if;

  return new;
end;
$$;

drop trigger if exists matches_before_insert on public.matches;
create trigger matches_before_insert
  before insert on public.matches
  for each row execute function public.matches_before_insert();

-- ---------------------------------------------------------------------------
-- matches_after_levels: maintain players.current_level + matches_played from
-- the *_after fields stored on each match. Math runs on the client; this
-- trigger only does simple bookkeeping.
--
-- INSERT path:
--   When a match arrives confirmed and ranked, push level_a_after/level_b_after
--   to players.current_level and bump matches_played.
--
-- UPDATE path (status flips):
--   pending  -> confirmed: same as insert (apply deltas).
--   confirmed -> disputed: revert (subtract deltas, decrement count).
--   disputed -> confirmed: re-apply.
-- These reverts are accurate only when nothing newer has been rated for the
-- same players. After edits/deletes that violate that, run the admin
-- "Rebuild levels" action to recompute from scratch.
--
-- DELETE path:
--   Revert if the match was rated. Same caveat about subsequent matches.
--
-- Unranked matches: never affect current_level or matches_played.
-- ---------------------------------------------------------------------------
create or replace function public.matches_after_levels()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was_rated boolean;
  is_rated  boolean;
begin
  if tg_op = 'INSERT' then
    is_rated := (new.status = 'confirmed') and not coalesce(new.unranked, false);
    if is_rated and new.level_a_after is not null then
      update public.players
         set current_level = new.level_a_after,
             matches_played = matches_played + 1
       where id = new.player_a_id;
    end if;
    if is_rated and new.level_b_after is not null then
      update public.players
         set current_level = new.level_b_after,
             matches_played = matches_played + 1
       where id = new.player_b_id;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    was_rated := (old.status = 'confirmed') and not coalesce(old.unranked, false);
    is_rated  := (new.status = 'confirmed') and not coalesce(new.unranked, false);

    -- Becoming rated: apply.
    if not was_rated and is_rated then
      if new.level_a_after is not null then
        update public.players
           set current_level = new.level_a_after,
               matches_played = matches_played + 1
         where id = new.player_a_id;
      end if;
      if new.level_b_after is not null then
        update public.players
           set current_level = new.level_b_after,
               matches_played = matches_played + 1
         where id = new.player_b_id;
      end if;
    -- Becoming unrated: revert.
    elsif was_rated and not is_rated then
      if old.level_a_after is not null and old.level_a_before is not null then
        update public.players
           set current_level = old.level_a_before,
               matches_played = greatest(matches_played - 1, 0)
         where id = old.player_a_id;
      end if;
      if old.level_b_after is not null and old.level_b_before is not null then
        update public.players
           set current_level = old.level_b_before,
               matches_played = greatest(matches_played - 1, 0)
         where id = old.player_b_id;
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    was_rated := (old.status = 'confirmed') and not coalesce(old.unranked, false);
    if was_rated then
      if old.level_a_after is not null and old.level_a_before is not null then
        update public.players
           set current_level = old.level_a_before,
               matches_played = greatest(matches_played - 1, 0)
         where id = old.player_a_id;
      end if;
      if old.level_b_after is not null and old.level_b_before is not null then
        update public.players
           set current_level = old.level_b_before,
               matches_played = greatest(matches_played - 1, 0)
         where id = old.player_b_id;
      end if;
    end if;
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists matches_after_levels on public.matches;
create trigger matches_after_levels
  after insert or update or delete on public.matches
  for each row execute function public.matches_after_levels();

-- Backfill on first migration: any existing rows where players.current_level
-- is still NULL should fall back to starting_level on read. Frontend handles
-- the fallback, so nothing to do here; run the admin "Rebuild levels" action
-- once after deploying this migration to seed accurate values.

-- confirm_match: the opponent (NOT the recorder) marks a pending match as
-- confirmed or disputed. Throws on misuse so the client surfaces clear errors.
create or replace function public.confirm_match(target_id uuid, dispute boolean default false)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  is_participant boolean;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select * into m from public.matches where id = target_id;
  if m.id is null then
    raise exception 'match not found';
  end if;
  if m.status <> 'pending' then
    raise exception 'match is already %', m.status using errcode = '22000';
  end if;
  -- Global admins can confirm any pending match (including the recorder's
  -- own — useful for stepping in when the opponent is unclaimed and can't
  -- act). For everyone else the original rules apply: you can't confirm
  -- your own match, and you must be a participant.
  if not public.is_admin(uid) then
    if m.created_by = uid then
      raise exception 'you cannot confirm a match you recorded';
    end if;
    select exists(
      select 1 from public.players
      where id in (m.player_a_id, m.player_b_id)
        and user_id = uid
    ) into is_participant;
    if not is_participant then
      raise exception 'only a participant can confirm or dispute';
    end if;
  end if;

  if dispute then
    update public.matches
       set status = 'disputed', disputed_at = now()
     where id = target_id
     returning * into m;
  else
    update public.matches
       set status = 'confirmed', confirmed_at = now()
     where id = target_id
     returning * into m;
  end if;

  return m;
end;
$$;

grant execute on function public.confirm_match(uuid, boolean) to authenticated;

-- auto_confirm_aged_matches: confirm any pending match older than 3 days.
-- Idempotent — safe to call repeatedly. Runs as security definer so even
-- non-admin clients can trigger it from the dashboard as a safety net when
-- pg_cron isn't available.
create or replace function public.auto_confirm_aged_matches()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  -- Skip when either participant is unclaimed (user_id IS NULL). Those
  -- matches can't be confirmed by their opponent (there is no opponent
  -- account), so a 3-day timer would let a non-admin recorder push fake
  -- self-wins into the rating system. They go through a global admin
  -- via confirm_match instead.
  update public.matches m
     set status = 'confirmed', confirmed_at = now(), auto_confirmed = true
   where m.status = 'pending'
     and m.created_at < now() - interval '3 days'
     and exists (select 1 from public.players where id = m.player_a_id and user_id is not null)
     and exists (select 1 from public.players where id = m.player_b_id and user_id is not null);
  get diagnostics affected = row_count;
  return affected;
end;
$$;

grant execute on function public.auto_confirm_aged_matches() to authenticated;

-- list_pending_unclaimed_matches_for_admin: admin-only listing of pending
-- matches where at least one participant is an unclaimed player. The
-- 3-day auto-confirm intentionally skips these, so they accumulate until a
-- global admin acts. The Activity page calls this to render an admin-only
-- "needs your confirmation" section.
create or replace function public.list_pending_unclaimed_matches_for_admin()
returns setof public.matches
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  return query
    select m.*
    from public.matches m
    where m.status = 'pending'
      and (
        exists (select 1 from public.players where id = m.player_a_id and user_id is null)
        or exists (select 1 from public.players where id = m.player_b_id and user_id is null)
      )
    order by m.created_at asc;
end;
$$;

grant execute on function public.list_pending_unclaimed_matches_for_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Server-side level rebuild.
--
-- Original design did the math in TS and shipped per-batch UPDATE payloads
-- via apply_match_level_updates / apply_player_level_updates. That
-- architecture hit timeouts at >100K matches: 300+ HTTP round-trips, edge
-- proxy idle limits, browser throttling, etc. Replaced by a single
-- rebuild_all_levels() RPC that does everything server-side in one
-- transaction. Math is ported from src/lib/rating/update.ts — keep these
-- two implementations in sync.
-- ---------------------------------------------------------------------------

-- Drop the legacy per-batch helpers since rebuildLevels() no longer uses
-- them. Safe to remove unconditionally; they had no other callers.
drop function if exists public.apply_match_level_updates(jsonb);
drop function if exists public.apply_player_level_updates(jsonb);

-- compute_level_update: plpgsql port of updateLevels() from
-- src/lib/rating/update.ts. Uses double precision throughout to match JS's
-- Number behaviour (Postgres numeric is arbitrary precision and would diverge
-- from the TS implementation on the same inputs).
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
  -- expectedPerformance: weighted blend of two sigmoids of the level ratio.
  e_p := power(ratio, points_exponent::double precision);
  e_p := e_p / (e_p + 1);
  e_g := power(ratio, games_exponent::double precision);
  e_g := e_g / (e_g + 1);
  expected := pw * e_p + (1 - pw) * e_g;

  -- actualPerformance: tally points + games won, blend by points_weight.
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

  -- Provisional handling: when only one side is provisional, the
  -- non-provisional side's level is unchanged.
  if provisional_a and not provisional_b then
    lba := lb;
  elsif provisional_b and not provisional_a then
    laa := la;
  end if;

  -- Floor at 1 so divisions stay safe and levels can't go negative.
  laa := greatest(1::double precision, laa);
  lba := greatest(1::double precision, lba);

  return query select
    laa::numeric,
    lba::numeric,
    (laa - la)::numeric,
    (lba - lb)::numeric;
end;
$$;

-- Chunked rebuild. The original "do everything in one RPC" design hit
-- Cloudflare/edge proxy timeouts (~100s) on large datasets. The chunked
-- variant keeps each call short and stateless across HTTP boundaries by
-- holding in-progress player state in a persistent table.
--
-- Flow from the client:
--   1. rebuild_levels_start()      -- clears state, seeds from starting_level
--   2. rebuild_levels_chunk(...)   -- repeatedly until done=true
--   3. rebuild_levels_finalize()   -- copies state to players, clears table

drop function if exists public.rebuild_all_levels();

create table if not exists public.level_rebuild_state (
  player_id      uuid primary key references public.players(id) on delete cascade,
  current_level  numeric not null,
  matches_played int not null
);

-- Admin-only. Anyone else trying to read/write this table goes through RLS.
alter table public.level_rebuild_state enable row level security;
drop policy if exists "admin all level_rebuild_state" on public.level_rebuild_state;
create policy "admin all level_rebuild_state" on public.level_rebuild_state
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

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
-- Each chunk should comfortably finish in well under a minute. 60s gives
-- some headroom on a busy DB.
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

  -- Load settings. Defaults mirror DEFAULT_SETTINGS in src/types.ts.
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

    -- Skip orphaned matches whose player rows are missing from the state
    -- table (e.g., player created after rebuild_levels_start ran). The
    -- foreign-key on matches would normally prevent the deeper case.
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

  -- Are there more rated matches after the last one we touched?
  if last_date is null then
    -- We didn't process anything — either the table is empty or our cursor
    -- already pointed past the end. Either way we're done.
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

-- Optional: schedule the aging job daily via pg_cron (Supabase Pro+).
-- If pg_cron isn't available, the dashboard calls auto_confirm_aged_matches()
-- on load as a fallback — comment the lines below out if you don't want it.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('boast-auto-confirm') where exists (
      select 1 from cron.job where jobname = 'boast-auto-confirm'
    );
    perform cron.schedule('boast-auto-confirm', '0 3 * * *',
      $cron$select public.auto_confirm_aged_matches()$cron$);
  end if;
exception
  when undefined_table or undefined_function then null;
end $$;

-- ===========================================================================
-- Row level security
-- ===========================================================================
alter table public.profiles enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.settings enable row level security;

-- profiles: anyone can read (so leaderboards/profile pages work),
-- a user can only insert/update their own row, admins can do anything.
drop policy if exists "public read profiles" on public.profiles;
create policy "public read profiles" on public.profiles
  for select using (true);

drop policy if exists "self insert profile" on public.profiles;
create policy "self insert profile" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists "self update profile" on public.profiles;
create policy "self update profile" on public.profiles
  for update to authenticated
  using (auth.uid() = id or public.is_admin(auth.uid()))
  with check (auth.uid() = id or public.is_admin(auth.uid()));

drop policy if exists "admin delete profile" on public.profiles;
create policy "admin delete profile" on public.profiles
  for delete to authenticated
  using (public.is_admin(auth.uid()));

-- players: public read; signed-in users can insert/update their own claimed player;
-- admins can do anything.
drop policy if exists "public read players" on public.players;
create policy "public read players" on public.players
  for select using (true);

drop policy if exists "owner write players" on public.players;          -- legacy
drop policy if exists "auth all players" on public.players;             -- legacy
drop policy if exists "self insert player" on public.players;
create policy "self insert player" on public.players
  for insert to authenticated
  with check (
    public.is_admin(auth.uid())
    or (user_id is not null and user_id = auth.uid())
  );

drop policy if exists "self update player" on public.players;
create policy "self update player" on public.players
  for update to authenticated
  using (public.is_admin(auth.uid()) or user_id = auth.uid())
  with check (public.is_admin(auth.uid()) or user_id = auth.uid());

drop policy if exists "admin delete player" on public.players;
create policy "admin delete player" on public.players
  for delete to authenticated
  using (public.is_admin(auth.uid()));

-- matches: public read; a signed-in user can log a match they participated in,
-- admins can edit/delete anything. Updates by participants are NOT allowed
-- (so opponents can't silently rewrite history) — admin only.
drop policy if exists "public read matches" on public.matches;
create policy "public read matches" on public.matches
  for select using (true);

drop policy if exists "owner write matches" on public.matches;          -- legacy
drop policy if exists "auth all matches" on public.matches;             -- legacy

drop policy if exists "participant insert match" on public.matches;
create policy "participant insert match" on public.matches
  for insert to authenticated
  with check (
    public.is_admin(auth.uid())
    or auth.uid() in (
      select user_id from public.players where id = player_a_id
      union
      select user_id from public.players where id = player_b_id
    )
  );

drop policy if exists "admin update match" on public.matches;
create policy "admin update match" on public.matches
  for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "admin delete match" on public.matches;
create policy "admin delete match" on public.matches
  for delete to authenticated
  using (public.is_admin(auth.uid()));

-- settings: public read, admin write.
drop policy if exists "public read settings" on public.settings;
create policy "public read settings" on public.settings
  for select using (true);

drop policy if exists "owner write settings" on public.settings;        -- legacy
drop policy if exists "auth all settings" on public.settings;           -- legacy
drop policy if exists "admin write settings" on public.settings;
create policy "admin write settings" on public.settings
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- Avatars storage
-- Public bucket; each user can read everyone's avatars but write only into a
-- folder named by their own auth uid (path: "<uid>/<filename>").
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars self insert" on storage.objects;
create policy "avatars self insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars self update" on storage.objects;
create policy "avatars self update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars self delete" on storage.objects;
create policy "avatars self delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ===========================================================================
-- Realtime
-- ===========================================================================
do $$
begin
  begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.players;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.matches;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.settings; exception when duplicate_object then null; end;
end $$;

-- ===========================================================================
-- Backfill: any profile that lacks a player row gets one. Idempotent — the
-- WHERE clause matches nothing once every profile has a player.
-- ===========================================================================
do $$
declare
  p record;
  uemail text;
  claimed_id uuid;
begin
  for p in
    select pr.* from public.profiles pr
    where not exists (select 1 from public.players pl where pl.user_id = pr.id)
  loop
    uemail := public.norm_email(p.email);
    claimed_id := null;

    if uemail is not null then
      update public.players
         set user_id = p.id,
             phone = coalesce(public.players.phone, p.phone),
             country = coalesce(public.players.country, p.country),
             city = coalesce(public.players.city, p.city),
             club = coalesce(public.players.club, p.club),
             avatar_url = coalesce(public.players.avatar_url, p.avatar_url),
             birth_year = coalesce(public.players.birth_year, p.birth_year),
             gender = coalesce(public.players.gender, p.gender),
             dominant_hand = coalesce(public.players.dominant_hand, p.dominant_hand)
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
        id, name, starting_level, email, user_id, created_at,
        phone, country, city, club, avatar_url, birth_year, gender, dominant_hand
      ) values (
        p.id, p.full_name, p.starting_level, p.email, p.id, p.created_at,
        p.phone, p.country, p.city, p.club, p.avatar_url, p.birth_year, p.gender, p.dominant_hand
      );
    end if;
  end loop;
end $$;

-- Backfill rich fields for already-linked players whose row predates the new
-- columns. Only overwrites a player field when it is null AND the linked
-- profile has a value, so admin overrides on player rows are preserved.
update public.players pl
set phone = coalesce(pl.phone, pr.phone),
    country = coalesce(pl.country, pr.country),
    city = coalesce(pl.city, pr.city),
    club = coalesce(pl.club, pr.club),
    avatar_url = coalesce(pl.avatar_url, pr.avatar_url),
    birth_year = coalesce(pl.birth_year, pr.birth_year),
    gender = coalesce(pl.gender, pr.gender),
    dominant_hand = coalesce(pl.dominant_hand, pr.dominant_hand)
from public.profiles pr
where pl.user_id = pr.id
  and (
    pl.phone is null or pl.country is null or pl.city is null or pl.club is null
    or pl.avatar_url is null or pl.birth_year is null or pl.gender is null or pl.dominant_hand is null
  );

-- ===========================================================================
-- Clubs: shared groups keyed by a slugged form of `players.club`. We don't
-- materialize a clubs table — the canonical name lives on the player row and
-- a club is "discoverable" by virtue of having members. Admins and club
-- admins can write players/matches scoped to their club.
-- ===========================================================================

-- Slugify a club name to a stable URL-safe key. Returns null/empty for
-- empty input. Idempotent so the slug stays the same as casing/spacing
-- drifts across player rows.
create or replace function public.club_slug(name text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(trim(name), '') = '' then null
    else regexp_replace(
           regexp_replace(lower(trim(name)), '[^a-z0-9]+', '-', 'g'),
           '(^-+|-+$)', '', 'g'
         )
  end;
$$;

-- Optional materialized index on the slugged club name for cheap membership
-- queries. We use a generated column so it stays in sync with `club`.
do $$
begin
  alter table public.players
    add column if not exists club_slug text generated always as (public.club_slug(club)) stored;
exception
  when duplicate_column then null;
  when feature_not_supported then
    -- Fallback for older Postgres without GENERATED: keep as an index target.
    null;
end $$;

create index if not exists players_club_slug_idx on public.players (club_slug);

create table if not exists public.club_admins (
  user_id uuid not null references auth.users(id) on delete cascade,
  club_slug text not null,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, club_slug)
);

create index if not exists club_admins_slug_idx on public.club_admins (club_slug);

alter table public.club_admins enable row level security;

drop policy if exists "public read club_admins" on public.club_admins;
create policy "public read club_admins" on public.club_admins for select using (true);

drop policy if exists "global admin write club_admins" on public.club_admins;
create policy "global admin write club_admins" on public.club_admins
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- is_club_admin(uid, slug): true when the given user is an admin of the
-- given club slug. Cheap; index-backed.
create or replace function public.is_club_admin(uid uuid, slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.club_admins
    where user_id = uid and club_slug = slug
  );
$$;

-- can_write_player(uid, player_id): the user can edit the given player when
-- they're a global admin, or they own the player, or they're a club admin
-- for the player's current club.
create or replace function public.can_write_player(uid uuid, target_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin(uid)
    or exists (select 1 from public.players where id = target_player_id and user_id = uid)
    or exists (
      select 1
      from public.players p
      join public.club_admins ca
        on ca.club_slug = public.club_slug(p.club)
      where p.id = target_player_id
        and ca.user_id = uid
    );
$$;

-- can_write_match(uid, a, b): same idea for matches — true if the user is
-- a global admin, OR a club admin for at least one player's club.
create or replace function public.can_write_match(uid uuid, a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin(uid)
    or exists (
      select 1
      from public.players p
      join public.club_admins ca on ca.club_slug = public.club_slug(p.club)
      where p.id in (a, b) and ca.user_id = uid
    );
$$;

-- list_club_admins_for_admin(): listing view for the global-admin UI.
create or replace function public.list_club_admins_for_admin()
returns table(user_id uuid, club_slug text, full_name text, email text, granted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  return query
    select ca.user_id, ca.club_slug, p.full_name, p.email, ca.granted_at
    from public.club_admins ca
    join public.profiles p on p.id = ca.user_id
    order by ca.club_slug, p.full_name;
end;
$$;
grant execute on function public.list_club_admins_for_admin() to authenticated;

-- set_club_admin(target_user, slug, value): global-admin RPC to grant or
-- revoke club-admin status.
create or replace function public.set_club_admin(target_user uuid, slug text, value boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  if slug is null or slug = '' then
    raise exception 'club slug required';
  end if;
  if value then
    insert into public.club_admins (user_id, club_slug, granted_by)
    values (target_user, slug, auth.uid())
    on conflict do nothing;
  else
    delete from public.club_admins
    where user_id = target_user and club_slug = slug;
  end if;
  return value;
end;
$$;
grant execute on function public.set_club_admin(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Players: grant club admins write access to players in their club. The
-- policy refers to the row's `club` column directly (NEW row at INSERT;
-- OLD/NEW row at UPDATE) — we don't need `new_…` qualifiers in PG RLS.
-- ---------------------------------------------------------------------------
drop policy if exists "self insert player" on public.players;
create policy "self insert player" on public.players
  for insert to authenticated
  with check (
    public.is_admin(auth.uid())
    or (user_id is not null and user_id = auth.uid())
    or (
      user_id is null
      and public.is_club_admin(auth.uid(), public.club_slug(club))
    )
  );

drop policy if exists "self update player" on public.players;
create policy "self update player" on public.players
  for update to authenticated
  using (
    public.is_admin(auth.uid())
    or user_id = auth.uid()
    or public.is_club_admin(auth.uid(), public.club_slug(club))
  )
  with check (
    public.is_admin(auth.uid())
    or user_id = auth.uid()
    or public.is_club_admin(auth.uid(), public.club_slug(club))
  );

-- Global-admin only. Club admins were previously allowed to delete players in
-- their club but the cascade is too wide (matches against players outside
-- the club, group memberships, challenges all disappear) and the spec was
-- updated 2026-05-11 to reserve the blast radius for global admins.
drop policy if exists "admin delete player" on public.players;
create policy "admin delete player" on public.players
  for delete to authenticated
  using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Matches: club admins can insert/update/delete matches that involve at
-- least one player from their club.
-- ---------------------------------------------------------------------------
drop policy if exists "participant insert match" on public.matches;
create policy "participant insert match" on public.matches
  for insert to authenticated
  with check (
    public.is_admin(auth.uid())
    or auth.uid() in (
      select user_id from public.players where id = player_a_id
      union
      select user_id from public.players where id = player_b_id
    )
    or public.can_write_match(auth.uid(), player_a_id, player_b_id)
  );

drop policy if exists "admin update match" on public.matches;
create policy "admin update match" on public.matches
  for update to authenticated
  using (
    public.is_admin(auth.uid())
    or public.can_write_match(auth.uid(), player_a_id, player_b_id)
  )
  with check (
    public.is_admin(auth.uid())
    or public.can_write_match(auth.uid(), player_a_id, player_b_id)
  );

drop policy if exists "admin delete match" on public.matches;
create policy "admin delete match" on public.matches
  for delete to authenticated
  using (
    public.is_admin(auth.uid())
    or public.can_write_match(auth.uid(), player_a_id, player_b_id)
  );

-- ===========================================================================
-- Unclaimed-player stub creation: any signed-in user can create an unclaimed
-- player by name (when logging a match against someone not yet on Boast).
-- The recorder is captured so we can rate-limit / audit later if abused.
-- The trigger fills in user_id=null and created_by=auth.uid().
-- ===========================================================================
-- Drop the previous 6-arg signature so `create or replace` below doesn't
-- create a second overload that PostgREST might pick ambiguously.
drop function if exists public.create_unclaimed_player(text, text, numeric, text, text, text);

-- create_unclaimed_player: lets a signed-in user mint a stub player for
-- someone not yet on Boast. Email is REQUIRED so that:
--   (a) the future auto-claim flow can match them (ensure_player_for_profile
--       claims by normalized email when the real user signs up),
--   (b) duplicate stubs get deduped here at creation time,
--   (c) we have a way to recognise abuse / contact the recorder if needed.
-- Admins create players via direct INSERT (bypass this RPC) so this gate
-- only affects the non-admin "log match against someone not on Boast" flow.
create or replace function public.create_unclaimed_player(
  p_name text,
  p_email text default null,
  p_starting_level numeric default 1000,
  p_club text default null,
  p_city text default null,
  p_country text default null,
  p_phone text default null,
  p_birth_year smallint default null,
  p_gender text default null,
  p_dominant_hand text default null
) returns public.players
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_id uuid := gen_random_uuid();
  normalized_email text := nullif(trim(coalesce(p_email, '')), '');
  pl public.players;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'name required';
  end if;
  if normalized_email is null then
    raise exception 'email required';
  end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'email looks invalid';
  end if;
  if p_gender is not null and p_gender not in ('male','female') then
    raise exception 'gender must be male or female';
  end if;
  if p_dominant_hand is not null and p_dominant_hand not in ('right','left','ambi') then
    raise exception 'dominant_hand must be right, left or ambi';
  end if;
  if p_birth_year is not null and (p_birth_year < 1900 or p_birth_year > extract(year from now())) then
    raise exception 'birth_year out of range';
  end if;

  -- Dedup by email (case-insensitive). Returns the existing row so the
  -- recorder doesn't accidentally create a parallel stub for the same person.
  select * into pl from public.players
   where email is not null and lower(email) = lower(normalized_email)
   order by created_at asc
   limit 1;
  if pl.id is not null then
    return pl;
  end if;

  insert into public.players (
    id, name, starting_level, email, user_id, created_at, created_by,
    club, city, country, phone, birth_year, gender, dominant_hand
  ) values (
    new_id,
    trim(p_name),
    coalesce(p_starting_level, 1000),
    normalized_email,
    null,
    now(),
    uid,
    nullif(trim(coalesce(p_club, '')), ''),
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_country, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    p_birth_year,
    p_gender,
    p_dominant_hand
  ) returning * into pl;

  return pl;
end;
$$;
grant execute on function public.create_unclaimed_player(text, text, numeric, text, text, text, text, smallint, text, text) to authenticated;

-- claim_player_by_id: explicit name-based claim during onboarding. The user
-- (already authenticated) takes over an unclaimed player row whose name
-- matched their own at signup. Refuses if the row is already claimed by
-- someone else, or if the caller already owns a different player.
create or replace function public.claim_player_by_id(target uuid)
returns public.players
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pl public.players;
  mine public.players;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select * into pl from public.players where id = target;
  if pl.id is null then
    raise exception 'player not found';
  end if;
  if pl.user_id is not null then
    if pl.user_id = uid then
      return pl; -- idempotent
    end if;
    raise exception 'player already claimed by someone else';
  end if;

  -- If the user already has a different player, we move their match history
  -- onto the unclaimed row by deleting the auto-created stub and pointing
  -- the unclaimed row at them. This is rare (happens when onboarding created
  -- a fresh row before the user noticed the unclaimed-match suggestion) so
  -- we err on the side of preserving the older row's history.
  select * into mine from public.players where user_id = uid limit 1;
  if mine.id is not null and mine.id <> pl.id then
    -- Repoint matches and delete the empty stub.
    update public.matches set player_a_id = pl.id where player_a_id = mine.id;
    update public.matches set player_b_id = pl.id where player_b_id = mine.id;
    -- Move profile-driven identity onto the claimed row.
    update public.players
       set user_id = uid,
           name = mine.name,
           email = mine.email,
           starting_level = mine.starting_level,
           phone = coalesce(mine.phone, pl.phone),
           country = coalesce(mine.country, pl.country),
           city = coalesce(mine.city, pl.city),
           club = coalesce(mine.club, pl.club),
           avatar_url = coalesce(mine.avatar_url, pl.avatar_url),
           birth_year = coalesce(mine.birth_year, pl.birth_year),
           gender = coalesce(mine.gender, pl.gender),
           dominant_hand = coalesce(mine.dominant_hand, pl.dominant_hand)
     where id = pl.id
     returning * into pl;
    delete from public.players where id = mine.id;
  else
    update public.players
       set user_id = uid
     where id = pl.id
     returning * into pl;
  end if;

  return pl;
end;
$$;
grant execute on function public.claim_player_by_id(uuid) to authenticated;

-- ===========================================================================
-- Challenges: "I want to play X". A signed-in player issues a challenge to
-- another player; the recipient accepts or declines. Accepting marks it
-- accepted (UI then takes them to log the match); declining is final.
-- ===========================================================================
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  from_player_id uuid not null references public.players(id) on delete cascade,
  to_player_id uuid not null references public.players(id) on delete cascade,
  message text,
  proposed_date date,
  venue text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists challenges_to_idx on public.challenges (to_player_id, status);
create index if not exists challenges_from_idx on public.challenges (from_player_id, status);

alter table public.challenges enable row level security;

-- Public read so profile pages can show "X has Y open challenges" if we
-- want to surface that later. Tighten if it becomes a privacy concern.
drop policy if exists "public read challenges" on public.challenges;
create policy "public read challenges" on public.challenges for select using (true);

-- Inserts go via RPC `create_challenge` so we can validate ownership and
-- rate-limit consistently. No direct insert policy.

drop policy if exists "owner cancel challenge" on public.challenges;
create policy "owner cancel challenge" on public.challenges
  for update to authenticated
  using (
    -- Sender can cancel; recipient (or RPC) handles accept/decline.
    public.is_admin(auth.uid())
    or created_by = auth.uid()
    or auth.uid() in (
      select user_id from public.players where id = to_player_id
    )
  )
  with check (true);

drop policy if exists "admin delete challenge" on public.challenges;
create policy "admin delete challenge" on public.challenges
  for delete to authenticated
  using (public.is_admin(auth.uid()));

-- create_challenge: validate that the sender owns the from-player, that
-- from != to, and that there isn't already a live challenge between them.
create or replace function public.create_challenge(
  to_player uuid,
  msg text default null,
  proposed date default null,
  venue_name text default null,
  from_player uuid default null
) returns public.challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  fp uuid := from_player;
  ch public.challenges;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  if fp is null then
    select id into fp from public.players where user_id = uid limit 1;
  else
    -- Verify the caller owns this player (or is an admin).
    if not exists (
      select 1 from public.players where id = fp and (user_id = uid or public.is_admin(uid))
    ) then
      raise exception 'cannot challenge as someone else';
    end if;
  end if;
  if fp is null then
    raise exception 'no player linked to your account';
  end if;
  if fp = to_player then
    raise exception 'cannot challenge yourself';
  end if;
  if not exists (select 1 from public.players where id = to_player) then
    raise exception 'opponent not found';
  end if;

  -- Block duplicates: existing pending challenge in either direction.
  if exists (
    select 1 from public.challenges
    where status = 'pending'
      and ((from_player_id = fp and to_player_id = to_player)
        or (from_player_id = to_player and to_player_id = fp))
  ) then
    raise exception 'a pending challenge between these players already exists';
  end if;

  insert into public.challenges (
    from_player_id, to_player_id, message, proposed_date, venue, created_by
  ) values (
    fp, to_player, nullif(trim(coalesce(msg, '')), ''), proposed,
    nullif(trim(coalesce(venue_name, '')), ''), uid
  ) returning * into ch;

  return ch;
end;
$$;
grant execute on function public.create_challenge(uuid, text, date, text, uuid) to authenticated;

-- respond_to_challenge: the recipient (or admin) sets accepted/declined.
-- Sender can also cancel. Idempotent for terminal statuses.
create or replace function public.respond_to_challenge(
  challenge_id uuid,
  response text  -- 'accepted' | 'declined' | 'cancelled'
) returns public.challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ch public.challenges;
  is_recipient boolean;
  is_sender boolean;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if response not in ('accepted', 'declined', 'cancelled') then
    raise exception 'invalid response';
  end if;

  select * into ch from public.challenges where id = challenge_id;
  if ch.id is null then
    raise exception 'challenge not found';
  end if;
  if ch.status <> 'pending' then
    raise exception 'challenge already %', ch.status using errcode = '22000';
  end if;

  select exists(select 1 from public.players where id = ch.to_player_id and user_id = uid) into is_recipient;
  select exists(select 1 from public.players where id = ch.from_player_id and user_id = uid) into is_sender;

  if not (is_recipient or is_sender or public.is_admin(uid)) then
    raise exception 'not allowed';
  end if;
  if response = 'cancelled' and not (is_sender or public.is_admin(uid)) then
    raise exception 'only the sender can cancel';
  end if;
  if response in ('accepted', 'declined') and not (is_recipient or public.is_admin(uid)) then
    raise exception 'only the recipient can accept or decline';
  end if;

  update public.challenges
     set status = response, responded_at = now()
   where id = challenge_id
   returning * into ch;

  return ch;
end;
$$;
grant execute on function public.respond_to_challenge(uuid, text) to authenticated;

do $$
begin
  begin alter publication supabase_realtime add table public.challenges; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.club_admins; exception when duplicate_object then null; end;
end $$;

-- ===========================================================================
-- Clubs registry: a curated table of clubs that exists independently of
-- players. Lets the global admin add a club page (with city/country) before
-- any members join, and remove stale entries from the index. The actual
-- club membership for a player still lives on `players.club` as a string —
-- removing a row here does NOT touch player records.
-- ===========================================================================
create table if not exists public.clubs (
  slug text primary key,
  name text not null,
  city text,
  country text,
  description text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.clubs enable row level security;

drop policy if exists "public read clubs" on public.clubs;
create policy "public read clubs" on public.clubs for select using (true);

drop policy if exists "global admin write clubs" on public.clubs;
create policy "global admin write clubs" on public.clubs
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- create_club: admin-only. Slug derived from name; idempotent on conflict.
create or replace function public.create_club(
  p_name text,
  p_city text default null,
  p_country text default null,
  p_description text default null
) returns public.clubs
language plpgsql
security definer
set search_path = public
as $$
declare
  s text := public.club_slug(p_name);
  c public.clubs;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  if s is null or s = '' then
    raise exception 'club name required';
  end if;
  insert into public.clubs (slug, name, city, country, description, created_by)
  values (s, trim(p_name),
          nullif(trim(coalesce(p_city, '')), ''),
          nullif(trim(coalesce(p_country, '')), ''),
          nullif(trim(coalesce(p_description, '')), ''),
          auth.uid())
  on conflict (slug) do update
    set name = excluded.name,
        city = coalesce(excluded.city, public.clubs.city),
        country = coalesce(excluded.country, public.clubs.country),
        description = coalesce(excluded.description, public.clubs.description)
  returning * into c;
  return c;
end;
$$;
grant execute on function public.create_club(text, text, text, text) to authenticated;

-- delete_club: admin-only. Removes the registry row only — does not touch
-- player records. The club page will still load if any players still claim
-- the same name (slug match), it just disappears from the directory.
create or replace function public.delete_club(p_slug text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  delete from public.clubs where slug = p_slug;
  return true;
end;
$$;
grant execute on function public.delete_club(text) to authenticated;

do $$
begin
  begin alter publication supabase_realtime add table public.clubs; exception when duplicate_object then null; end;
end $$;

-- ===========================================================================
-- Groups: ad-hoc rosters of players (think WhatsApp/Telegram playing groups).
-- A player can be in many groups but only one club. Anyone signed in can
-- create a group (becomes its admin); admins add members and other admins.
-- Public groups are visible to anyone; private groups only to members.
-- ===========================================================================
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text generated always as (public.club_slug(name)) stored,
  description text,
  is_private boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists groups_slug_unique on public.groups (slug);
create index if not exists groups_created_by_idx on public.groups (created_by);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  is_admin boolean not null default false,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (group_id, player_id)
);

create index if not exists group_members_player_idx on public.group_members (player_id);
create index if not exists group_members_group_idx on public.group_members (group_id);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

-- is_group_admin(uid, group_id): true when the user owns a player who is an
-- admin of the group, OR is the global admin.
create or replace function public.is_group_admin(uid uuid, gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin(uid)
    or exists (
      select 1
      from public.group_members gm
      join public.players p on p.id = gm.player_id
      where gm.group_id = gid and gm.is_admin and p.user_id = uid
    );
$$;

-- is_group_member(uid, group_id): true when the user owns a player in the group.
create or replace function public.is_group_member(uid uuid, gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    join public.players p on p.id = gm.player_id
    where gm.group_id = gid and p.user_id = uid
  );
$$;

-- groups RLS: public groups visible to anyone; private groups only to members
-- and admins. Inserts go via RPC (create_group) so we can validate auth.
drop policy if exists "read groups" on public.groups;
create policy "read groups" on public.groups
  for select using (
    not is_private
    or public.is_admin(auth.uid())
    or public.is_group_member(auth.uid(), id)
  );

drop policy if exists "group admin write groups" on public.groups;
create policy "group admin write groups" on public.groups
  for update to authenticated
  using (public.is_group_admin(auth.uid(), id))
  with check (public.is_group_admin(auth.uid(), id));

drop policy if exists "group admin delete groups" on public.groups;
create policy "group admin delete groups" on public.groups
  for delete to authenticated
  using (public.is_group_admin(auth.uid(), id));

-- group_members RLS: same visibility as parent group; only group admins
-- can add/remove. Inserts also go via RPC so we can guarantee invariants.
drop policy if exists "read group_members" on public.group_members;
create policy "read group_members" on public.group_members
  for select using (
    exists (
      select 1 from public.groups g
      where g.id = group_members.group_id
        and (
          not g.is_private
          or public.is_admin(auth.uid())
          or public.is_group_member(auth.uid(), g.id)
        )
    )
  );

drop policy if exists "group admin write members" on public.group_members;
create policy "group admin write members" on public.group_members
  for all to authenticated
  using (public.is_group_admin(auth.uid(), group_id))
  with check (public.is_group_admin(auth.uid(), group_id));

-- create_group: any signed-in user with a linked player can start one. They
-- become its admin automatically. Slug uniqueness enforced by index.
create or replace function public.create_group(
  p_name text,
  p_description text default null,
  p_is_private boolean default false
) returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  pl_id uuid;
  g public.groups;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'group name required';
  end if;
  select id into pl_id from public.players where user_id = uid limit 1;
  if pl_id is null then
    raise exception 'no player linked to your account';
  end if;

  insert into public.groups (name, description, is_private, created_by)
  values (trim(p_name),
          nullif(trim(coalesce(p_description, '')), ''),
          coalesce(p_is_private, false),
          uid)
  returning * into g;

  insert into public.group_members (group_id, player_id, is_admin, added_by)
  values (g.id, pl_id, true, uid);

  return g;
end;
$$;
grant execute on function public.create_group(text, text, boolean) to authenticated;

-- update_group: admins edit name/description/visibility.
create or replace function public.update_group(
  p_id uuid,
  p_name text,
  p_description text,
  p_is_private boolean
) returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups;
begin
  if not public.is_group_admin(auth.uid(), p_id) then
    raise exception 'group admin only';
  end if;
  update public.groups
     set name = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
         description = nullif(trim(coalesce(p_description, '')), ''),
         is_private = coalesce(p_is_private, is_private)
   where id = p_id
   returning * into g;
  return g;
end;
$$;
grant execute on function public.update_group(uuid, text, text, boolean) to authenticated;

-- delete_group: admins can dissolve. Cascade removes members.
create or replace function public.delete_group(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_group_admin(auth.uid(), p_id) then
    raise exception 'group admin only';
  end if;
  delete from public.groups where id = p_id;
  return true;
end;
$$;
grant execute on function public.delete_group(uuid) to authenticated;

-- add_group_member: admins add a player. Idempotent — re-adding a member
-- promotes/demotes their is_admin flag.
create or replace function public.add_group_member(
  p_group uuid,
  p_player uuid,
  p_is_admin boolean default false
) returns public.group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  gm public.group_members;
begin
  if not public.is_group_admin(auth.uid(), p_group) then
    raise exception 'group admin only';
  end if;
  if not exists (select 1 from public.players where id = p_player) then
    raise exception 'player not found';
  end if;
  insert into public.group_members (group_id, player_id, is_admin, added_by)
  values (p_group, p_player, coalesce(p_is_admin, false), auth.uid())
  on conflict (group_id, player_id) do update
    set is_admin = excluded.is_admin
  returning * into gm;
  return gm;
end;
$$;
grant execute on function public.add_group_member(uuid, uuid, boolean) to authenticated;

-- remove_group_member: admins remove a player. Refuses to remove the last
-- admin so a group always has at least one steward.
create or replace function public.remove_group_member(p_group uuid, p_player uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining_admins int;
  was_admin boolean;
begin
  if not public.is_group_admin(auth.uid(), p_group) then
    raise exception 'group admin only';
  end if;
  select is_admin into was_admin from public.group_members
   where group_id = p_group and player_id = p_player;
  if was_admin then
    select count(*) into remaining_admins
      from public.group_members
     where group_id = p_group and is_admin and player_id <> p_player;
    if remaining_admins = 0 then
      raise exception 'cannot remove the last admin';
    end if;
  end if;
  delete from public.group_members
   where group_id = p_group and player_id = p_player;
  return true;
end;
$$;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

do $$
begin
  begin alter publication supabase_realtime add table public.groups; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.group_members; exception when duplicate_object then null; end;
end $$;
