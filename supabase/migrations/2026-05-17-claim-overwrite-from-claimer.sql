-- 2026-05-17: claim overwrites from claimer, not stub
--
-- When a user signs up and their email matches an existing unclaimed
-- player stub, `ensure_player_for_profile` previously kept the stub's
-- starting_level and used `coalesce(stub.X, profile.X)` for identity
-- fields — meaning the claimer's values were dropped if the stub had
-- anything in those columns.
--
-- Bug repro (from amitgangrade, 2026-05-17): admin pre-created stub
-- "Amit Test Account" with starting_level=1000 and logged 1 match
-- against them (current_level rose to 1008.35). The real user then
-- signed up with the matching email, entered starting_level=3383 in
-- onboarding — leaderboard still showed ~1008.
--
-- This migration:
--   1. Always overwrites `starting_level` and `seeded_rating` from the
--      profile (the user's explicit onboarding choices).
--   2. Resets `current_level = new.starting_level` so the leaderboard
--      reflects the new seed immediately. Per-match cached level columns
--      are still stale until Rebuild Levels runs.
--   3. Sets `levels_stale = true` if the stub already had matches, so
--      the admin Rebuild Levels banner surfaces the player.
--   4. Flips coalesce direction on identity fields: claimer wins where
--      they provided a value, stub fills blanks. An admin's careful
--      "Singapore Cricket Club" isn't wiped by a user who left the
--      club field blank.

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
           seeded_rating = new.seeded_rating,
           starting_level = new.starting_level,
           current_level = new.starting_level,
           levels_stale = case
             when public.players.matches_played > 0 then true
             else public.players.levels_stale
           end,
           phone = coalesce(new.phone, public.players.phone),
           country = coalesce(new.country, public.players.country),
           city = coalesce(new.city, public.players.city),
           club = coalesce(new.club, public.players.club),
           avatar_url = coalesce(new.avatar_url, public.players.avatar_url),
           birth_year = coalesce(new.birth_year, public.players.birth_year),
           gender = coalesce(new.gender, public.players.gender),
           dominant_hand = coalesce(new.dominant_hand, public.players.dominant_hand)
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
