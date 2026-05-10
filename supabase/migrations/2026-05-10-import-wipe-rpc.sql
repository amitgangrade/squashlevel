-- Import-wipe RPC.
--
-- Reason for this file: the client-side wipe in replaceEverything() issues
-- one DELETE per table (matches, group_members, groups, challenges,
-- club_admins, players, clubs, settings). Once matches has tens of
-- thousands of rows, `DELETE FROM matches WHERE id <> sentinel` hits the
-- default 8s statement_timeout via PostgREST and fails the import with
-- "wipe matches: canceling statement due to statement timeout".
--
-- Fix: do the wipe server-side via a security-definer function that
-- TRUNCATEs every import-managed table in one statement (TRUNCATE is
-- O(1) per table regardless of row count) and bumps statement_timeout
-- to 60s as a safety margin. profiles is intentionally excluded — it
-- FKs to auth.users which we don't manage; replaceEverything() upserts
-- it instead.
--
-- Safe to run multiple times — `create or replace`.

create or replace function public.import_wipe_all()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  truncate
    public.matches,
    public.group_members,
    public.groups,
    public.challenges,
    public.club_admins,
    public.level_rebuild_state,
    public.players,
    public.clubs,
    public.settings
  cascade;
end;
$$;

grant execute on function public.import_wipe_all() to authenticated;
