-- Audit log (2026-05-11).
--
-- Captures one row per state change across the load-bearing tables, with
-- snapshotted actor identity and denormalised subject arrays for cheap
-- scoped reads (club/group admins see events involving their players;
-- global admins see everything).
--
-- Design notes:
--   • Reads via `list_audit_events` RPC only — no SELECT policy on the
--     table. Writes are append-only via SECURITY DEFINER trigger. No
--     UPDATE/DELETE policies → rows are immutable from the client.
--   • The cascade triggers (ensure_player_for_profile,
--     sync_player_from_profile) wrap their player-table writes in a
--     `boast.audit_skip = true` session flag so the audit trigger emits
--     ONE row per logical user action, not the profile + player pair.
--   • An is_admin-only profile update is flagged `privileged = true` so
--     non-global admins don't see promotion / demotion events even when
--     the target is in their club.
--   • Retention: forever, per spec. A `purge_audit_before(timestamptz)`
--     RPC can be added later for GDPR-style requests.
--
-- Safe to re-run.

create extension if not exists pg_trgm;  -- already present, but defensive

-- ---------- table -------------------------------------------------------
create table if not exists public.audit_events (
  id                  bigserial primary key,
  at                  timestamptz not null default now(),
  actor_user_id       uuid references auth.users(id) on delete set null,
  actor_label         text,
  entity_type         text not null,
  entity_id           text,
  op                  text not null,
  summary             text,
  changed             jsonb,
  subject_player_ids  uuid[] not null default '{}',
  subject_club_slugs  text[] not null default '{}',
  subject_group_ids   uuid[] not null default '{}',
  privileged          boolean not null default false
);

create index if not exists audit_events_at_idx     on public.audit_events (at desc);
create index if not exists audit_events_actor_idx  on public.audit_events (actor_user_id, at desc);
create index if not exists audit_events_entity_idx on public.audit_events (entity_type, entity_id, at desc);
create index if not exists audit_events_player_gin on public.audit_events using gin (subject_player_ids);
create index if not exists audit_events_club_gin   on public.audit_events using gin (subject_club_slugs);
create index if not exists audit_events_group_gin  on public.audit_events using gin (subject_group_ids);

alter table public.audit_events enable row level security;
-- Deliberately no read/write policies. All access flows through the RPCs
-- below (SECURITY DEFINER), so the table is effectively private.

-- ---------- trigger function -------------------------------------------
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor               uuid := auth.uid();
  actor_lbl           text;
  new_j               jsonb;
  old_j               jsonb;
  effective           jsonb;
  ent_id              text;
  s_player_ids        uuid[] := '{}';
  s_club_slugs        text[] := '{}';
  s_group_ids         uuid[] := '{}';
  s_privileged        boolean := false;
  rec                 jsonb;
  skip                boolean := coalesce(current_setting('boast.audit_skip', true), '') = 'true';
begin
  if skip then
    return coalesce(NEW, OLD);
  end if;

  if actor is not null then
    select coalesce(full_name, '') || ' <' || coalesce(email, '') || '>'
      into actor_lbl from public.profiles where id = actor;
  end if;

  new_j := case when NEW is null then null else to_jsonb(NEW) end;
  old_j := case when OLD is null then null else to_jsonb(OLD) end;
  effective := coalesce(new_j, old_j);
  ent_id := effective->>'id';

  -- Per-table subject arrays + privileged flag. Each branch reads through
  -- jsonb because NEW/OLD have dynamic record type in a generic trigger.
  if TG_TABLE_NAME = 'players' then
    s_player_ids := array[(effective->>'id')::uuid];
    if coalesce(effective->>'club_slug', '') <> '' then
      s_club_slugs := array[effective->>'club_slug'];
    end if;
  elsif TG_TABLE_NAME = 'matches' then
    s_player_ids := array[
      (effective->>'player_a_id')::uuid,
      (effective->>'player_b_id')::uuid
    ];
    -- Pull club_slugs of both participants so a club admin sees the match
    -- if either side is in their club.
    select coalesce(array_agg(distinct club_slug), '{}')::text[] into s_club_slugs
      from public.players
     where id = any(s_player_ids) and club_slug is not null;
  elsif TG_TABLE_NAME = 'challenges' then
    s_player_ids := array[
      (effective->>'from_player_id')::uuid,
      (effective->>'to_player_id')::uuid
    ];
    select coalesce(array_agg(distinct club_slug), '{}')::text[] into s_club_slugs
      from public.players
     where id = any(s_player_ids) and club_slug is not null;
  elsif TG_TABLE_NAME = 'profiles' then
    -- Resolve the profile's owned player + their current club so a club
    -- admin sees identity changes for members of their club.
    select coalesce(array_agg(id), '{}')::uuid[] into s_player_ids
      from public.players where user_id = (effective->>'id')::uuid;
    if s_player_ids <> '{}' then
      select coalesce(array_agg(distinct club_slug), '{}')::text[] into s_club_slugs
        from public.players where id = any(s_player_ids) and club_slug is not null;
    end if;
    -- is_admin-only changes are privileged regardless of subject scope.
    if TG_OP = 'UPDATE'
       and (new_j->>'is_admin') is distinct from (old_j->>'is_admin')
       and (new_j - 'is_admin') = (old_j - 'is_admin')
    then
      s_privileged := true;
    end if;
  elsif TG_TABLE_NAME = 'clubs' then
    if coalesce(effective->>'slug', '') <> '' then
      s_club_slugs := array[effective->>'slug'];
    end if;
  elsif TG_TABLE_NAME = 'club_admins' then
    if coalesce(effective->>'club_slug', '') <> '' then
      s_club_slugs := array[effective->>'club_slug'];
    end if;
    select coalesce(array_agg(id), '{}')::uuid[] into s_player_ids
      from public.players where user_id = (effective->>'user_id')::uuid;
  elsif TG_TABLE_NAME = 'groups' then
    s_group_ids := array[(effective->>'id')::uuid];
  elsif TG_TABLE_NAME = 'group_members' then
    s_group_ids := array[(effective->>'group_id')::uuid];
    s_player_ids := array[(effective->>'player_id')::uuid];
  elsif TG_TABLE_NAME = 'settings' then
    -- App-wide algorithm tuning — only global admins should see this.
    s_privileged := true;
  end if;

  -- Diff payload.
  if TG_OP = 'INSERT' then
    rec := new_j;
  elsif TG_OP = 'DELETE' then
    rec := old_j;
  else
    rec := jsonb_build_object('before', old_j, 'after', new_j);
  end if;

  insert into public.audit_events (
    actor_user_id, actor_label, entity_type, entity_id, op,
    changed, subject_player_ids, subject_club_slugs, subject_group_ids, privileged
  ) values (
    actor, actor_lbl, TG_TABLE_NAME, ent_id, lower(TG_OP),
    rec, s_player_ids, s_club_slugs, s_group_ids, s_privileged
  );

  return coalesce(NEW, OLD);
end;
$$;

-- ---------- attach triggers --------------------------------------------
-- Drop-then-create so re-running the migration doesn't pile up duplicates.

drop trigger if exists audit_profiles      on public.profiles;
drop trigger if exists audit_players       on public.players;
drop trigger if exists audit_matches       on public.matches;
drop trigger if exists audit_challenges    on public.challenges;
drop trigger if exists audit_clubs         on public.clubs;
drop trigger if exists audit_club_admins   on public.club_admins;
drop trigger if exists audit_groups        on public.groups;
drop trigger if exists audit_group_members on public.group_members;
drop trigger if exists audit_settings      on public.settings;

create trigger audit_profiles
  after insert or update or delete on public.profiles
  for each row execute function public.audit_row_change();
create trigger audit_players
  after insert or update or delete on public.players
  for each row execute function public.audit_row_change();
create trigger audit_matches
  after insert or update or delete on public.matches
  for each row execute function public.audit_row_change();
create trigger audit_challenges
  after insert or update or delete on public.challenges
  for each row execute function public.audit_row_change();
create trigger audit_clubs
  after insert or update or delete on public.clubs
  for each row execute function public.audit_row_change();
create trigger audit_club_admins
  after insert or update or delete on public.club_admins
  for each row execute function public.audit_row_change();
create trigger audit_groups
  after insert or update or delete on public.groups
  for each row execute function public.audit_row_change();
create trigger audit_group_members
  after insert or update or delete on public.group_members
  for each row execute function public.audit_row_change();
create trigger audit_settings
  after insert or update or delete on public.settings
  for each row execute function public.audit_row_change();

-- ---------- cascade-skip wrapping for ensure_/sync_player_from_profile -
-- The user action is "edit profile". The sync_player_from_profile cascade
-- then writes the players row. We want ONE audit row (the profile event)
-- and to swallow the players cascade. Same for ensure_player_for_profile
-- on signup — the profile insert is the user-facing action.
--
-- We bracket the cascade writes with a session GUC. The audit trigger
-- short-circuits when it sees `boast.audit_skip = 'true'`. Setting via
-- `set_config(..., true)` (the `is_local` flag) scopes the change to the
-- current transaction.

create or replace function public.sync_player_from_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('boast.audit_skip', 'true', true);
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
  end if;

  if claimed_id is null then
    insert into public.players (
      id, name, starting_level, email, user_id, created_at, created_by,
      phone, country, city, club, avatar_url, birth_year, gender, dominant_hand
    ) values (
      gen_random_uuid(), new.full_name, new.starting_level, new.email,
      new.id, now(), new.id,
      new.phone, new.country, new.city, new.club, new.avatar_url,
      new.birth_year, new.gender, new.dominant_hand
    );
  end if;

  perform set_config('boast.audit_skip', 'false', true);
  return new;
end;
$$;

-- ---------- list_audit_events RPC --------------------------------------
create or replace function public.list_audit_events(
  p_after        timestamptz default null,
  p_limit        int default 50,
  p_actor        uuid default null,
  p_entity_type  text default null
) returns setof public.audit_events
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer          uuid := auth.uid();
  is_global       boolean;
  my_clubs        text[] := '{}';
  my_groups       uuid[] := '{}';
  my_players      uuid[] := '{}';
  capped_limit    int := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  if viewer is null then
    raise exception 'not authenticated';
  end if;

  is_global := public.is_admin(viewer);

  if not is_global then
    select coalesce(array_agg(club_slug), '{}')::text[] into my_clubs
      from public.club_admins where user_id = viewer;
    select coalesce(array_agg(gm.group_id), '{}')::uuid[] into my_groups
      from public.group_members gm
      join public.players p on p.id = gm.player_id
      where p.user_id = viewer and gm.is_admin = true;
    if (my_clubs = '{}' and my_groups = '{}') then
      -- Not an admin of anything. Return empty rather than raise — the
      -- audit page handles the empty state with a clear message.
      return;
    end if;
    select coalesce(array_agg(distinct id), '{}')::uuid[] into my_players
      from (
        select id from public.players where club_slug = any(my_clubs)
        union
        select player_id as id from public.group_members where group_id = any(my_groups)
      ) ids;
  end if;

  return query
    select e.*
    from public.audit_events e
    where (p_after is null or e.at < p_after)
      and (p_actor is null or e.actor_user_id = p_actor)
      and (p_entity_type is null or e.entity_type = p_entity_type)
      and (
        is_global
        or (
          not e.privileged
          and (
            e.subject_player_ids && my_players
            or e.subject_club_slugs && my_clubs
            or e.subject_group_ids && my_groups
          )
        )
      )
    order by e.at desc, e.id desc
    limit capped_limit;
end;
$$;

grant execute on function public.list_audit_events(timestamptz, int, uuid, text) to authenticated;
