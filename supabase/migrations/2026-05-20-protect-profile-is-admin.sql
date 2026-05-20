-- Protect public.profiles.is_admin from direct UPDATE by non-admins.
--
-- The "self update profile" RLS policy lets row-owners update their own
-- profile, but it is row-level — there is no column restriction. The
-- auth-permissions spec states `is_admin` may only be changed via the
-- admin-only set_admin(target_id, value) RPC, but until now nothing
-- enforced that on the UPDATE path. A signed-in non-admin could run:
--
--   update public.profiles set is_admin = true where id = auth.uid();
--
-- directly via the Supabase client / PostgREST and grant themselves
-- global-admin privileges. RLS passed (own row), no trigger blocked
-- it, audit_profiles only logged the escalation after the fact.
--
-- This BEFORE UPDATE trigger closes that gap: any attempt to flip
-- is_admin where the caller is not already a global admin raises an
-- exception. set_admin keeps working because it is SECURITY DEFINER
-- and auth.uid() inside the trigger still resolves to the original
-- caller (already verified admin by set_admin's own check) — so the
-- trigger lets that path through.
--
-- Safe to rerun (create or replace + drop trigger if exists).

create or replace function public.protect_profiles_is_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Skip when there is no authenticated caller (auth.uid() is NULL) —
  -- that's the case for direct superuser SQL (migrations, manual seed
  -- from the Supabase SQL editor as `postgres`), which is already
  -- trusted. PostgREST requests always carry a JWT so auth.uid() is
  -- never NULL for an attacker.
  if old.is_admin is distinct from new.is_admin
     and auth.uid() is not null
     and not public.is_admin(auth.uid()) then
    raise exception 'is_admin can only be changed via set_admin(...)';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_is_admin on public.profiles;
create trigger profiles_protect_is_admin
  before update on public.profiles
  for each row execute function public.protect_profiles_is_admin();
