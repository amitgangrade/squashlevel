-- Admin RLS bypass for groups and group_members.
--
-- Reason: schema.sql intentionally omits an INSERT policy on public.groups
-- (the comment says "inserts go via RPC create_group"). public.group_members
-- has only an "is_group_admin" write policy. Both block the bulk import path
-- in replaceEverything() with:
--
--   insert groups: new row violates row-level security policy for table "groups"
--
-- Players, matches, etc. already follow the pattern of an extra admin policy
-- alongside the user-level one (e.g. "self insert player" allows
-- is_admin(auth.uid()) too). Mirror that here so the importing app admin
-- can insert directly without bypassing RLS.
--
-- Safe to run multiple times.

drop policy if exists "admin all groups" on public.groups;
create policy "admin all groups" on public.groups
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "admin all group_members" on public.group_members;
create policy "admin all group_members" on public.group_members
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
