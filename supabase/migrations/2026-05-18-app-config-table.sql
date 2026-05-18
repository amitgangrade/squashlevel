-- Owner-email config via admin-only table (supersedes
-- 2026-05-18-bootstrap-admin-via-guc.sql).
--
-- Hosted Supabase blocks `ALTER DATABASE ... SET app.owner_email` with
-- permission-denied 42501 (no superuser access for non-platform code), so
-- the GUC approach from the prior migration doesn't work in production.
-- We replace it with a small admin-only key/value table that the trigger
-- reads via SECURITY DEFINER (bypassing RLS so it works during anonymous
-- profile inserts at sign-up time).
--
-- OPERATOR ACTION REQUIRED:
--   After this migration runs, set the owner email **once** in the
--   Supabase SQL Editor (which runs as the postgres role and bypasses
--   RLS, so the insert works even though API clients are blocked):
--
--     insert into public.app_config (key, value)
--     values ('owner_email', 'owner@example.com')
--     on conflict (key) do update
--       set value = excluded.value, updated_at = now();
--
--   Existing admins are unaffected. If the row is missing the trigger
--   fail-closes (no auto-promotion); admins must use `set_admin` manually.
--
-- Safe to run multiple times (idempotent table create + create or replace).

create table if not exists public.app_config (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

drop policy if exists "admin read app_config" on public.app_config;
create policy "admin read app_config" on public.app_config
  for select to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists "admin write app_config" on public.app_config;
create policy "admin write app_config" on public.app_config
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create or replace function public.bootstrap_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_email text;
begin
  select nullif(trim(value), '') into owner_email
  from public.app_config
  where key = 'owner_email';

  if owner_email is not null and lower(new.email) = lower(owner_email) then
    new.is_admin := true;
  end if;
  return new;
end;
$$;
