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
  update public.matches
     set status = 'confirmed', confirmed_at = now(), auto_confirmed = true
   where status = 'pending'
     and created_at < now() - interval '3 days';
  get diagnostics affected = row_count;
  return affected;
end;
$$;

grant execute on function public.auto_confirm_aged_matches() to authenticated;

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
