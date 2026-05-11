-- Unclaimed-player flow tightening (2026-05-11).
--
-- Three changes that together make "non-admin records a match against
-- someone not on Boast" safe and useful:
--
--   1. create_unclaimed_player REQUIRES email + accepts the full identity
--      field set (phone, birth_year, gender, dominant_hand). Email gates
--      the auto-claim path on later signup; the rich fields seed a real
--      profile so the claimer sees their existing data in onboarding.
--   2. confirm_match now allows global admins to confirm/dispute any
--      pending match, including ones they recorded. This is the path
--      admins use to step in for an unclaimed opponent who can't act.
--   3. auto_confirm_aged_matches skips matches where either participant
--      is unclaimed — those can't be confirmed by the opponent, so the
--      3-day timer would otherwise let non-admin recorders push fake
--      self-wins into the rating system. Replaced by the explicit
--      list_pending_unclaimed_matches_for_admin RPC + admin confirmation.
--
-- Idempotent. Safe to re-run.

-- ---------- 1. create_unclaimed_player (drop old 6-arg signature first
--               so the new overload is unambiguous) -----------------------
drop function if exists public.create_unclaimed_player(text, text, numeric, text, text, text);

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

-- ---------- 2. confirm_match admin override -----------------------------
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

-- ---------- 3. auto_confirm_aged_matches skips unclaimed pairs ----------
create or replace function public.auto_confirm_aged_matches()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
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

-- ---------- 4. list_pending_unclaimed_matches_for_admin -----------------
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
