## MODIFIED Requirements

### Requirement: Player RLS

`public.players` SHALL have RLS enabled with:
- **Read**: anyone MAY select any player row.
- **Insert**: a global admin MAY insert any player; a non-admin MAY only insert a row where `user_id = auth.uid()`; a **club admin** for a player's club MAY insert an unclaimed (`user_id IS NULL`) player whose `club` is a club they administer. Unclaimed-player creation by regular users MUST go through the `create_unclaimed_player` SECURITY DEFINER RPC, not a direct insert.
- **Update**: the owning user (`user_id = auth.uid()`), a global admin, OR a **club admin** for the player's current club MAY update.
- **Delete**: only a **global admin** MAY delete a player. Club admins MAY add and edit but not delete — a single delete cascades to every match the player was in (including matches against players outside the admin's club), every group membership, and every challenge sent or received, so the blast radius is reserved for global admins.

A global admin SHALL be able to remove a claimed user (one whose linked player has `user_id IS NOT NULL`) in one of two explicit modes:

1. **Soft delete** (default) via the `admin_soft_delete_user(target_user_id)` SECURITY DEFINER RPC: removes only `auth.users` (cascading the `profiles` row). The linked `players` row SHALL survive with `user_id` set to `NULL` via the existing `players.user_id … on delete set null` FK — i.e., the player becomes unclaimed. Matches, challenges, and group memberships SHALL be preserved unchanged. Player identity fields (`name`, `email`, `club`, `avatar_url`, `phone`, `birth_year`, `gender`, `dominant_hand`) SHALL NOT be anonymized — they are kept intact so the same person can re-claim the player later when they sign in again with the same email (auto-claim via `profiles_ensure_player` matches on normalized email).

2. **Hard delete** via the existing `admin_delete_user(target_user_id)` SECURITY DEFINER RPC: deletes the linked `players` row first (cascading every match, group membership, and challenge involving that player) and then `auth.users` (cascading the profile). Used for spam accounts and for the merged-from side of a future profile-merge flow.

Deleting a player whose `user_id IS NULL` (unclaimed stub) deletes only the player row plus the cascaded matches / group_members / challenges; no auth / profile rows exist to remove. The soft / hard distinction does not apply to unclaimed players — there is nothing to soft-detach from — and the UI SHALL NOT offer a mode choice in that case.

Both `admin_soft_delete_user` and `admin_delete_user` SHALL refuse execution unless `is_admin(auth.uid())`, SHALL refuse `target_user_id = auth.uid()` (an admin cannot delete themselves through either path), and SHALL raise on a NULL `target_user_id`.

After a **hard** delete, opponents' `current_level` and `matches_played` become stale until **Admin → Rebuild levels** is run. After a **soft** delete, opponents' levels are unaffected because match history is preserved.

#### Scenario: Club admin attempts to delete a player
- **WHEN** a club admin (without global-admin) tries to delete any player — claimed or unclaimed, soft or hard — via UI or direct API call
- **THEN** the action is rejected (UI hides the Delete control; RLS denies a direct `DELETE FROM players`; both `admin_soft_delete_user` and `admin_delete_user` raise `admin only`)

#### Scenario: Global admin soft-deletes a claimed player
- **WHEN** a global admin invokes the soft-delete action on a player with `user_id = U`
- **THEN** the client calls `admin_soft_delete_user(U)`, which removes the `auth.users` row (cascading the profile); the `players` row remains with `user_id` set to `NULL`; the player's `name`, `email`, `club`, and other identity fields are unchanged; every match, challenge, and group_membership the player was in is preserved; opponents' levels remain valid (no rebuild required)

#### Scenario: Global admin hard-deletes a claimed player
- **WHEN** a global admin invokes the hard-delete action on a player with `user_id = U`
- **THEN** the client routes the action through `admin_delete_user(U)`, which removes the `auth.users` row (cascading the profile and the player) and triggers FK cascades for matches / group_members / challenges; opponents' `current_level` and `matches_played` are now stale until Rebuild levels runs

#### Scenario: Global admin deletes an unclaimed player
- **WHEN** a global admin deletes a player with `user_id IS NULL`
- **THEN** the client issues `DELETE FROM players WHERE id = …`; matches / group_members / challenges cascade; no auth or profile rows are touched; the UI does not present a soft/hard choice (only hard applies)

#### Scenario: Soft-deleted user signs in again with the same email
- **WHEN** a user whose account was previously soft-deleted signs in with Google using the same email and the `OnboardingModal` creates a new `profiles` row
- **THEN** the `profiles_ensure_player` trigger matches the surviving unclaimed player by normalized email and sets its `user_id` to the new auth uid; the user regains access to their original player and all preserved match history without further action

#### Scenario: Soft-deleted player is claimed by a different user
- **WHEN** a soft-deleted (unclaimed) player is targeted by `claim_player_by_id(target)` from a signed-in user whose email does NOT match the player's email
- **THEN** the RPC atomically sets `user_id = auth.uid()` and returns the updated player — the same behavior as for any other unclaimed player. Admins SHOULD reserve soft delete for users who plan to return; for users who explicitly disown the data, hard delete is the appropriate choice.

#### Scenario: Admin attempts to soft-delete themselves
- **WHEN** the calling admin's own `auth.uid()` equals `target_user_id` for either `admin_soft_delete_user` or `admin_delete_user`
- **THEN** the RPC raises `cannot delete yourself` and no change is made

#### Scenario: Admin pre-creates an unclaimed player
- **WHEN** an admin inserts a player with `user_id IS NULL` and an email
- **THEN** the insert succeeds; the row will be auto-claimed when a profile with the matching email is later created

#### Scenario: Regular user creates an unclaimed opponent via RPC
- **WHEN** a signed-in non-admin calls `create_unclaimed_player(...)` to log a match against someone not on Boast
- **THEN** the RPC creates (or dedupes by email) a player with `user_id = NULL` and returns it

#### Scenario: Non-admin attempts direct unclaimed insert
- **WHEN** a non-admin tries `insert into players (...) values (..., user_id := null)` directly
- **THEN** RLS rejects the insert
