-- 2026-05-17: create_unclaimed_player accepts seeded_rating
--
-- Bug: admin used the LogMatch "Add new player" inline form to create a
-- stub with a known starting_level (e.g. 90000 from SquashLevels.com).
-- The RPC's INSERT omitted `seeded_rating`, so the column defaulted to
-- false — the stub was marked provisional despite having an obviously
-- known rating.
--
-- Fix: add `p_seeded_rating boolean default false` to the RPC and write
-- it into the INSERT. Callers that don't pass it (legacy) get the same
-- behaviour as before (unseeded). The LogMatch and PlayerFormModal
-- clients now pass `true` when the recorder ticked the "known rating"
-- option.
--
-- Note: changing a function's parameter list requires drop+create.

drop function if exists public.create_unclaimed_player(text, text, numeric, text, text, text, text, smallint, text, text);

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
  p_dominant_hand text default null,
  p_seeded_rating boolean default false
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
    id, name, starting_level, seeded_rating, email, user_id, created_at, created_by,
    club, city, country, phone, birth_year, gender, dominant_hand
  ) values (
    new_id,
    trim(p_name),
    coalesce(p_starting_level, 1000),
    coalesce(p_seeded_rating, false),
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
grant execute on function public.create_unclaimed_player(text, text, numeric, text, text, text, text, smallint, text, text, boolean) to authenticated;
