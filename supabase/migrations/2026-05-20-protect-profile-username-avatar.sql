-- Extend protect_profile_columns to cover the last two sensitive
-- columns flagged in the audit: username and avatar_url.
--
-- Spec intent (openspec/specs/auth-permissions/spec.md line 120):
-- when a global admin edits another user's profile they SHALL NOT
-- change `username` (canonical handle backing shareable URLs) or
-- `avatar_url` (avatar bucket is owner-write only). Today the
-- "self update profile" RLS policy is row-level only, so:
--
--   * An admin editing someone else's profile can in fact change
--     either field via direct UPDATE (the UI hides them; DevTools
--     can still send the column).
--   * An owner editing their OWN profile can change either field.
--     This is the spec's implicit allowance — the bucket is
--     owner-write so the owner is the only one who can put a file
--     there in the first place, and the owner's username is their
--     own handle.
--
-- Rule for both columns: the change is rejected unless `auth.uid()`
-- equals the row's id (i.e. the caller is the row owner) OR the
-- caller is unauthenticated postgres (superuser SQL). Admins do NOT
-- get a bypass here — the spec explicitly excludes them from
-- changing these two fields when editing someone else, and an admin
-- editing their OWN profile is also the row owner so they still
-- pass the owner check.
--
-- Safe to rerun (create or replace).

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if old.email is distinct from new.email then
    raise exception 'profiles.email is locked — it mirrors auth.users.email and is the auto-claim key';
  end if;

  -- username: only the row owner may change it (canonical handle
  -- backing shareable URLs; admins editing another user cannot
  -- touch this per spec).
  if old.username is distinct from new.username
     and new.id <> auth.uid() then
    raise exception 'profiles.username can only be changed by the row owner';
  end if;

  -- avatar_url: only the row owner may change it (avatar bucket is
  -- owner-write only per spec; admins editing another user cannot
  -- swap someone else's avatar).
  if old.avatar_url is distinct from new.avatar_url
     and new.id <> auth.uid() then
    raise exception 'profiles.avatar_url can only be changed by the row owner';
  end if;

  if old.starting_level is distinct from new.starting_level
     and not public.is_admin(auth.uid()) then
    raise exception 'profiles.starting_level can only be changed by an admin';
  end if;

  if old.seeded_rating is distinct from new.seeded_rating
     and not public.is_admin(auth.uid()) then
    raise exception 'profiles.seeded_rating can only be changed by an admin';
  end if;

  return new;
end;
$$;
