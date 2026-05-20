-- Protect three more public.profiles columns from direct UPDATE by
-- non-admins (and email from anyone). Same vulnerability class as the
-- is_admin and players rating-fields fixes shipped earlier this day.
--
-- Spec intent (openspec/specs/auth-permissions/spec.md):
--   - `email` is "auth.users canonical + auto-claim key" (line 120).
--     The admin SHALL NOT change it. By extension, neither shall the
--     owner — profile.email is a mirror of auth.users.email and must
--     not drift, because `profiles_ensure_player` matches unclaimed
--     players to new profiles by normalised email and any drift is a
--     potential account-takeover vector.
--   - `starting_level` is "set at onboarding (or amended by an admin)"
--     — never changed by the owner after profile creation.
--   - `seeded_rating` is "set at onboarding or amended by an admin —
--     never self-set by non-admins" (see src/pages/Profile.tsx:30).
--
-- Reality before this trigger: the "self update profile" RLS policy
-- was row-level only. A signed-in user could change any column on
-- their own profile. Exploits:
--
--   -- Rewrite email → poison the auto-claim path so the next sign-up
--   -- with that email auto-claims unrelated stub players.
--   await supabase.from('profiles').update({ email: 'victim@gmail.com' })
--     .eq('id', auth.uid())
--
--   -- Self-promote out of provisional with an inflated seed:
--   await supabase.from('profiles')
--     .update({ starting_level: 9999, seeded_rating: true })
--     .eq('id', auth.uid())
--   -- The sync_player_from_profile trigger mirrors these to the
--   -- player row, bypassing the new players rating-fields trigger
--   -- because the sync path is trusted (it's the legitimate
--   -- onboarding mirror).
--
-- Fix: BEFORE UPDATE trigger that rejects changes to those columns
-- when the caller doesn't have the right tier:
--   - email: locked for everyone (including admins). The only legal
--     writers are INSERT (onboarding) and direct superuser SQL.
--   - starting_level / seeded_rating: admin-only.
--   - auth.uid() is NULL: bypass (migrations, superuser SQL).
--
-- Note: the trigger uses IS DISTINCT FROM so a profile UPDATE that
-- re-sends the existing values (the common case — most clients send
-- all editable columns whether or not they changed) is unaffected.
-- Only an actual value change trips the check.
--
-- Safe to rerun (create or replace + drop trigger if exists).

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Superuser SQL (no JWT) — trusted.
  if auth.uid() is null then
    return new;
  end if;

  -- email: locked for everyone. profile.email mirrors auth.users.email
  -- and is the auto-claim key in profiles_ensure_player; drift is a
  -- takeover vector. Even admins must not change it via this path.
  if old.email is distinct from new.email then
    raise exception 'profiles.email is locked — it mirrors auth.users.email and is the auto-claim key';
  end if;

  -- starting_level: admin-only post-create. Owners set it at
  -- onboarding (profile INSERT); after that, only admins may amend.
  if old.starting_level is distinct from new.starting_level
     and not public.is_admin(auth.uid()) then
    raise exception 'profiles.starting_level can only be changed by an admin';
  end if;

  -- seeded_rating: admin-only post-create. Owners pick at onboarding;
  -- after that, only admins may amend.
  if old.seeded_rating is distinct from new.seeded_rating
     and not public.is_admin(auth.uid()) then
    raise exception 'profiles.seeded_rating can only be changed by an admin';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_columns on public.profiles;
create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();
