-- admin_soft_delete_user RPC.
--
-- Companion to admin_delete_user (2026-05-10). Gives admins a less destructive
-- option when removing another user from the system:
--
--   • Deletes auth.users (which cascades the profile row).
--   • Leaves the linked players row in place. Because the FK
--       players.user_id references auth.users(id) on delete set null
--     the player automatically becomes unclaimed (user_id = NULL) and keeps
--     every match, challenge, and group_membership it was part of.
--   • Player identity fields (name, email, club, etc.) are intentionally NOT
--     anonymized so that if the same person signs back in later with the
--     same email, profiles_ensure_player auto-claims their original player
--     and the user picks up where they left off.
--
-- For unclaimed-stub players (user_id IS NULL) there is no auth/profile to
-- soft-delete from; callers should fall through to the existing
-- "DELETE FROM players" path. This RPC requires a non-null target_user_id.
--
-- Self-delete is refused — admins can't accidentally lock themselves out,
-- mirroring admin_delete_user's guardrail.
--
-- Safe to run multiple times (create or replace).
-- See openspec/specs/auth-permissions/spec.md → "Player RLS" for the full
-- behavior contract.

create or replace function public.admin_soft_delete_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '30s'
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'cannot delete yourself';
  end if;
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  -- Only touch auth.users. The profile cascades via profiles.id FK;
  -- the players row stays alive with user_id flipped to NULL via the
  -- on-delete-set-null FK. Matches / challenges / group_members are
  -- untouched.
  delete from auth.users where id = target_user_id;
end;
$$;

grant execute on function public.admin_soft_delete_user(uuid) to authenticated;
