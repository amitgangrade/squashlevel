-- Tighten DELETE on public.players to global admins only.
--
-- Background: a previous migration extended the DELETE policy to also allow
-- club admins to delete players in their own club. The blast radius is too
-- wide:
--   • matches FK cascades, so all matches involving the deleted player are
--     gone — including matches against players from other clubs.
--   • group_members and challenges cascade too.
--   • opponents' players.current_level and matches_played become stale until
--     Admin → Rebuild levels is run.
--
-- Reserve player deletion for global admins. Club admins keep insert/update
-- rights and can still curate their club's roster — they just can't delete.
--
-- See openspec/specs/auth-permissions/spec.md (§Player RLS, 2026-05-11).
-- Idempotent — safe to re-run.

drop policy if exists "admin delete player" on public.players;
create policy "admin delete player" on public.players
  for delete to authenticated
  using (public.is_admin(auth.uid()));
