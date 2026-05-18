## Why

Today an admin "delete user" is a single, all-or-nothing cascade: it tears down the auth row, the profile, the player, **and every match, challenge, and group membership the player ever touched**. That destroys other players' history and forces a level rebuild. For the common case — a user leaves, an admin asks "can you delete me" — preserving opponents' match history is almost always the right answer. We also need a hard-delete path for true garbage (spam accounts, the merged-from side of a future profile-merge flow), and the two intents should be distinct controls, not the same button with a scary confirm.

## What Changes

- Add a **soft delete** admin action: drop `auth.users` + `profiles` for the target user, but leave the `players` row intact with `user_id` set to `NULL` (unclaimed). Matches, challenges, and group memberships are untouched. Player can be re-claimed later via the existing `claim_player_by_id` flow when the same email signs back in.
  - New SECURITY DEFINER RPC `admin_soft_delete_user(target_user_id uuid)` with the same admin-only / no-self-delete guardrails as `admin_delete_user`.
- Keep the existing **hard delete** behavior under `admin_delete_user` unchanged — full cascade, opponents' levels go stale until Rebuild.
- UI: replace the single `window.confirm()` in Settings → Admins and in Roster (for claimed players) with a modal offering Soft vs Hard with clear descriptions of consequences. Unclaimed players keep the existing single-confirm path (soft delete doesn't apply — there's no auth/profile to detach from).
- Store: `removePlayer(id, mode: 'soft' | 'hard')`. For unclaimed players only `'hard'` is meaningful.
- Player details (name, email, club, etc.) are **NOT anonymized** on soft delete — kept intentionally so the same person can re-claim by email.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `auth-permissions`: extend the "Player RLS" requirement to describe two admin deletion modes (soft / hard). Add scenarios for admin soft-deleting a claimed player, for soft-deleted player being re-claimed later, and clarify that soft delete touches only auth+profile, not matches/challenges/group_members.

## Impact

- **SQL** (`supabase/schema.sql` + new migration): add `admin_soft_delete_user` RPC. No FK or RLS changes — the soft path uses the existing `players.user_id … on delete set null` FK behavior by way of deleting auth.users.
- **Client**: new `softDeleteUser(userId)` in [src/lib/supabase/profile.ts](src/lib/supabase/profile.ts) next to the existing `deleteUserCompletely`.
- **Store**: `removePlayer` in [src/state/store.tsx](src/state/store.tsx) gains a `mode` parameter. Local state update on soft delete keeps the player row (with `userId: null`) instead of dropping it; matches stay.
- **UI**:
  - [src/pages/Settings.tsx](src/pages/Settings.tsx) `AdminManager.remove` → new modal.
  - [src/pages/Roster.tsx](src/pages/Roster.tsx) `remove` → same modal for claimed players; unchanged path for unclaimed.
- **Spec**: [openspec/specs/auth-permissions/spec.md](openspec/specs/auth-permissions/spec.md) Player RLS requirement updated.
- **Out of scope**: self-service "delete my account" for regular users; anonymization of soft-deleted rows; the actual profile-merge flow (this change only prepares for it).
