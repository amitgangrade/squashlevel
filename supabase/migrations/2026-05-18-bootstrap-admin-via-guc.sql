-- bootstrap_admin via configurable GUC (`app.owner_email`).
--
-- Replaces the hardcoded owner email in the BEFORE-INSERT trigger with
-- a lookup against a Postgres custom setting. Keeps the maintainer's
-- personal email out of source control (public GitHub repo).
--
-- OPERATOR ACTION REQUIRED:
--   After applying this migration, set the owner email **once** per
--   Supabase project via the SQL editor (or psql connected as superuser):
--
--     alter database postgres set app.owner_email = 'owner@example.com';
--
--   New connections pick up the value automatically. Existing admins are
--   not affected — this trigger only fires on BEFORE INSERT of new
--   profiles. If the GUC is unset, the trigger fail-closes (no one is
--   auto-promoted), which is safe.
--
-- Safe to run multiple times (create or replace).

create or replace function public.bootstrap_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_email text := nullif(trim(coalesce(current_setting('app.owner_email', true), '')), '');
begin
  if owner_email is not null and lower(new.email) = lower(owner_email) then
    new.is_admin := true;
  end if;
  return new;
end;
$$;
