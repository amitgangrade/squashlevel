# auth-permissions Specification

## Purpose
TBD - created by archiving change add-auth-permissions-spec. Update Purpose after archive.
## Requirements
### Requirement: Sign-in via Google OAuth

The system SHALL authenticate users exclusively through Google OAuth using Supabase Auth (`supabase.auth.signInWithOAuth({ provider: 'google' })`). Email/password and magic-link flows MUST NOT be offered.

#### Scenario: New visitor signs in
- **WHEN** an unauthenticated visitor clicks "Sign in with Google" and completes the Google consent screen
- **THEN** Supabase creates an `auth.users` row, returns a session, and the client persists it (`persistSession: true`)

#### Scenario: Returning user revisits
- **WHEN** a previously signed-in user reloads the app
- **THEN** the session is restored from local storage without a fresh Google round-trip until the refresh token expires

#### Scenario: Magic-link or password attempted
- **WHEN** a contributor tries to add a magic-link or password sign-in path
- **THEN** the change is rejected as out of scope for the auth model

---

### Requirement: One profile row per authenticated user

The `public.profiles` table SHALL be the source of truth for user identity. Every signed-in user MUST have at most one row, with `profiles.id = auth.users.id`. Each profile MUST have a unique `username`. The `is_admin` boolean SHALL default to `false`.

#### Scenario: First sign-in with no profile
- **WHEN** a user signs in and `select * from profiles where id = auth.uid()` returns no row
- **THEN** the client renders the `OnboardingModal` and blocks all other UI until the profile is created

#### Scenario: Username collision on profile insert
- **WHEN** the auto-generated username (`slugify(full_name)`) is already taken
- **THEN** the client appends `-2`, `-3`, … until unused, then inserts the profile with the unique candidate

#### Scenario: Profile insert with duplicate id
- **WHEN** an insert is attempted with an `id` that already exists in `profiles`
- **THEN** the insert fails (primary-key violation) and the client treats the existing row as the user's profile

---

### Requirement: Players are claimable and link to one user

The `public.players` table SHALL carry an optional `user_id uuid unique references auth.users(id) on delete set null`. A player with `user_id IS NULL` is "unclaimed" (legacy or admin-pre-created). A player with a non-null `user_id` belongs to exactly one authenticated user. A user MUST own at most one player.

#### Scenario: Profile creation auto-creates a player
- **WHEN** a profile row is inserted for `auth.uid() = U`
- **THEN** the `profiles_ensure_player` trigger either (a) claims an existing unclaimed player whose email matches the profile email and sets its `user_id = U`, or (b) inserts a new player with `user_id = U` if no email match exists

#### Scenario: User claims an unclaimed player at onboarding
- **WHEN** a signed-in user calls `claim_player_by_id(target)` and that player's `user_id IS NULL`
- **THEN** the RPC atomically sets `user_id = auth.uid()` and returns the updated player; any historical matches attached to that player are preserved

#### Scenario: User attempts to claim an already-claimed player
- **WHEN** the target player's `user_id IS NOT NULL`
- **THEN** the RPC raises an error and no change is made

#### Scenario: Auth user is deleted
- **WHEN** a row in `auth.users` is deleted
- **THEN** `players.user_id` for any rows referencing that user is set to `NULL` (the player becomes unclaimed again, history retained)

---

### Requirement: Admin election

The first profile inserted whose email matches the `owner_email` row in the admin-only `public.app_config` table SHALL be promoted to `is_admin = true` automatically by the `profiles_bootstrap_admin` BEFORE INSERT trigger. Email comparison is case-insensitive. If the row is missing or empty, no profile SHALL be auto-promoted (the trigger fail-closes). All other profiles SHALL be inserted with `is_admin = false`. The flag MAY only be changed thereafter via the admin-only `set_admin(target_id, value)` RPC. Direct UPDATEs of the `is_admin` column on `public.profiles` SHALL be rejected by the `profiles_protect_is_admin` BEFORE UPDATE trigger unless `auth.uid()` is already an admin — so `set_admin` (SECURITY DEFINER, validates caller is admin before issuing the UPDATE) remains the only path for privilege changes.

The `public.app_config` table SHALL have RLS enabled with **admin-only read and admin-only write**. The bootstrap_admin trigger reads the value via SECURITY DEFINER and therefore bypasses RLS, so it works for anonymous profile inserts at sign-up time while keeping the owner email hidden from API clients.

The literal owner email MUST NOT be checked into source. Keeping it in `app_config` instead of `schema.sql` keeps the maintainer's personal email out of the public repo.

#### Scenario: Configured owner signs in for the first time
- **WHEN** a user whose email (case-insensitively) matches the `owner_email` row in `app_config` signs in and inserts their profile
- **THEN** the trigger flips `is_admin` to `true` before the row is committed

#### Scenario: Owner email is not configured
- **WHEN** the `owner_email` row in `app_config` is missing or empty and any user signs in for the first time
- **THEN** the trigger leaves `is_admin = false` for every profile — no auto-promotion occurs and an existing admin must use `set_admin` to promote them manually

#### Scenario: Non-admin reads app_config
- **WHEN** an authenticated non-admin (or anonymous request) selects from `public.app_config`
- **THEN** RLS returns no rows; the owner email is not visible via the API

#### Scenario: Non-owner attempts to insert with is_admin=true
- **WHEN** any other user attempts an insert with `is_admin: true` in the payload
- **THEN** the trigger leaves `is_admin = false` (or RLS rejects the write — see Profile RLS)

#### Scenario: Non-admin attempts to escalate via direct UPDATE
- **WHEN** a signed-in non-admin issues `update public.profiles set is_admin = true where id = auth.uid()` directly via the Supabase client / PostgREST (bypassing the `set_admin` RPC)
- **THEN** the `profiles_protect_is_admin` BEFORE UPDATE trigger sees `auth.uid()` is non-null and `is_admin(auth.uid()) = false`, raises `is_admin can only be changed via set_admin(...)`, and the update is rejected; the user remains a non-admin

#### Scenario: Maintainer seeds the first admin via direct SQL
- **WHEN** a maintainer connected as the `postgres` superuser (Supabase SQL editor, psql migration) issues `update public.profiles set is_admin = true where id = '<owner-uuid>'`
- **THEN** `auth.uid()` is NULL in that context, the trigger's null-guard skips the check, and the update succeeds — the trigger does not interfere with bootstrap or recovery operations performed at the trusted superuser tier

#### Scenario: set_admin flips the flag normally
- **WHEN** an admin calls `set_admin(target_id, true)` against a non-admin target
- **THEN** the RPC's own check confirms the caller is admin, the UPDATE runs, the trigger sees `is_admin(auth.uid()) = true` (caller is still the original admin even inside SECURITY DEFINER), allows the change, and the target's flag flips to true

#### Scenario: Last admin tries to demote themselves
- **WHEN** an admin calls `set_admin(self_id, false)` and they are the only remaining admin
- **THEN** the RPC raises an error and the demotion is not applied

#### Scenario: Non-admin calls set_admin
- **WHEN** a non-admin calls `set_admin(any_id, any_value)`
- **THEN** the RPC raises an error and no change is made

---

### Requirement: Profile RLS

`public.profiles` SHALL have row-level security enabled with the following policies:
- **Read**: anyone (including anonymous) MAY select any profile row.
- **Insert**: only the authenticated user themselves MAY insert their own row (`auth.uid() = id`).
- **Update**: the row's owner OR an admin MAY update.
- **Delete**: only an admin MAY delete.

#### Scenario: Anonymous reads leaderboard
- **WHEN** an unauthenticated request selects from `profiles`
- **THEN** all rows are returned

#### Scenario: User edits their own profile
- **WHEN** a signed-in user updates their own profile row
- **THEN** the update succeeds and the `profiles_sync_player` trigger mirrors the changed identity fields onto their linked player row

#### Scenario: User edits someone else's profile
- **WHEN** a non-admin user updates a profile row where `id <> auth.uid()`
- **THEN** RLS rejects the update

#### Scenario: Non-admin attempts to change their own email
- **WHEN** a signed-in non-admin (or admin) attempts to change `profiles.email` via direct UPDATE (e.g. `update profiles set email = 'other@gmail.com' where id = auth.uid()`)
- **THEN** the `profiles_protect_columns` BEFORE UPDATE trigger raises `profiles.email is locked …` and the update is rejected; `profile.email` cannot drift from `auth.users.email`, closing the auto-claim hijack vector

#### Scenario: Non-admin attempts to inflate their own starting_level or seeded_rating
- **WHEN** a signed-in non-admin attempts to change `profiles.starting_level` or `profiles.seeded_rating` via direct UPDATE
- **THEN** the `profiles_protect_columns` BEFORE UPDATE trigger raises an exception and the update is rejected; the user can only set those fields at onboarding (INSERT) or have an admin amend them later

#### Scenario: Profile UPDATE that re-sends unchanged sensitive values
- **WHEN** a signed-in non-admin updates their profile (e.g. changes their phone) and the client payload re-sends `email`, `starting_level`, `seeded_rating` unchanged (the common case — clients send all editable columns)
- **THEN** the trigger checks `IS DISTINCT FROM` on each protected column, finds no actual change, and allows the update — the protection has no false-positive on legitimate edits to other fields

#### Scenario: Global admin edits another user's profile
- **WHEN** a global admin updates a profile row for a different `auth.users.id`, modifying any of `full_name`, `phone`, `country`, `city`, `club`, `birth_year`, `gender`, `dominant_hand`, `starting_level`
- **THEN** RLS permits the update and the `profiles_sync_player` AFTER UPDATE trigger mirrors the changed identity fields onto the target's linked player row. The admin SHALL NOT change `username` (canonical handle backing shareable URLs), `email` (auth.users canonical + auto-claim key), `avatar_url` (avatar bucket is owner-write only), or `is_admin` (gated by the separate `set_admin` RPC).

---

### Requirement: Player RLS

`public.players` SHALL have RLS enabled with:
- **Read**: anyone MAY select any player row.
- **Insert**: a global admin MAY insert any player; a non-admin MAY only insert a row where `user_id = auth.uid()`; a **club admin** for a player's club MAY insert an unclaimed (`user_id IS NULL`) player whose `club` is a club they administer. Unclaimed-player creation by regular users MUST go through the `create_unclaimed_player` SECURITY DEFINER RPC, not a direct insert.
- **Update**: the owning user (`user_id = auth.uid()`), a global admin, OR a **club admin** for the player's current club MAY update.
- **Delete**: only a **global admin** MAY delete a player. Club admins MAY add and edit but not delete — a single delete cascades to every match the player was in (including matches against players outside the admin's club), every group membership, and every challenge sent or received, so the blast radius is reserved for global admins.

The `current_level` and `matches_played` columns are server-truth — maintained by the `matches_after_levels` trigger and the admin "Rebuild levels" path. Direct UPDATEs of those two columns SHALL be rejected by the `players_protect_rating_fields` BEFORE UPDATE trigger unless `auth.uid()` is a global admin OR the update is happening inside the match rating-write path (signalled by the `boast.rating_write` session-local GUC, which `matches_after_levels` sets at the top of its function body). This closes the gap that would otherwise let a row-owner inflate themselves to the top of the leaderboard via a direct `update players set current_level = 9999 where id = mine`. `starting_level` and `seeded_rating` are NOT protected at this layer because they are owner-settable at onboarding via the profile → player sync trigger.

A global admin SHALL be able to remove a claimed user (one whose linked player has `user_id IS NOT NULL`) in one of two explicit modes:

1. **Soft delete** (default) via the `admin_soft_delete_user(target_user_id)` SECURITY DEFINER RPC: removes only `auth.users` (cascading the `profiles` row). The linked `players` row SHALL survive with `user_id` set to `NULL` via the existing `players.user_id … on delete set null` FK — i.e., the player becomes unclaimed. Matches, challenges, and group memberships SHALL be preserved unchanged. Player identity fields (`name`, `email`, `club`, `avatar_url`, `phone`, `birth_year`, `gender`, `dominant_hand`) SHALL NOT be anonymized — they are kept intact so the same person can re-claim the player later when they sign in again with the same email (auto-claim via `profiles_ensure_player` matches on normalized email).

2. **Hard delete** via the existing `admin_delete_user(target_user_id)` SECURITY DEFINER RPC: deletes the linked `players` row first (cascading every match, group membership, and challenge involving that player) and then `auth.users` (cascading the profile). Used for spam accounts and for the merged-from side of a future profile-merge flow.

Deleting a player whose `user_id IS NULL` (unclaimed stub) deletes only the player row plus the cascaded matches / group_members / challenges; no auth / profile rows exist to remove. The soft / hard distinction does not apply to unclaimed players — there is nothing to soft-detach from — and the UI SHALL NOT offer a mode choice in that case.

Both `admin_soft_delete_user` and `admin_delete_user` SHALL refuse execution unless `is_admin(auth.uid())`, SHALL refuse `target_user_id = auth.uid()` (an admin cannot delete themselves through either path), and SHALL raise on a NULL `target_user_id`.

After a **hard** delete, opponents' `current_level` and `matches_played` become stale until **Admin → Rebuild levels** is run. After a **soft** delete, opponents' levels are unaffected because match history is preserved.

#### Scenario: Non-admin attempts to inflate their own rating
- **WHEN** a signed-in non-admin runs `update public.players set current_level = 9999 where id = my_player_id` directly via the Supabase client / PostgREST
- **THEN** the `players_protect_rating_fields` BEFORE UPDATE trigger sees `auth.uid()` is non-null, the caller is not an admin, the `boast.rating_write` GUC is not set, and raises an exception — the leaderboard is unaffected

#### Scenario: Match recording legitimately writes rating fields
- **WHEN** a non-admin participant records a match (insert into `public.matches` with both players confirmed)
- **THEN** the `matches_after_levels` AFTER INSERT trigger fires, sets `boast.rating_write = 'true'` transaction-locally, and its UPDATEs on `players.current_level` and `matches_played` pass the protection trigger because the GUC sentinel is observed

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

---

### Requirement: Match RLS and participant rule

`public.matches` SHALL have RLS enabled with:
- **Read**: anyone MAY select any match.
- **Insert**: a global admin MAY insert any match; a non-admin MAY insert only if their `auth.uid()` matches the `user_id` of either `player_a_id` or `player_b_id`; a **club admin** for the club of either participant MAY insert.
- **Update**: a global admin OR a club admin for either participant's club OR a **group admin** of a group containing BOTH participants MAY update. Regular participants MAY NOT update a match (so opponents cannot silently rewrite history); they confirm or dispute via the `confirm_match` RPC instead — see the `match-recording` capability.
- **Delete**: a global admin OR a club admin for either participant's club OR a **group admin** of a group containing BOTH participants MAY delete.

The matches RLS policies use the `can_write_match(uid, p_a, p_b)` SECURITY DEFINER helper, which combines all three branches above (global / club-admin / group-admin) into one predicate. The group-admin branch is backed by `is_group_admin_for_pair(uid, p_a, p_b)` — TRUE iff `uid` admins at least one group that contains BOTH `p_a` and `p_b` as members. A match between two players who share NO group the caller admins falls back to the club / global branches only.

The `matches_before_insert` trigger SHALL stamp `created_by = auth.uid()` and reject inserts where the recorder cannot be resolved to a participant (and is not an admin).

#### Scenario: Player records a match they played in
- **WHEN** signed-in user U inserts a match where `player_a_id` or `player_b_id` is owned by U
- **THEN** the insert succeeds and `created_by = U`

#### Scenario: Player tries to record a match between two other people
- **WHEN** signed-in non-admin user U inserts a match where neither participant's `user_id = U`
- **THEN** RLS (and the trigger) reject the insert

#### Scenario: Non-admin tries to edit or delete a match
- **WHEN** a non-admin (no global / club / group-pair authority) attempts an UPDATE or DELETE on `matches`
- **THEN** RLS rejects it regardless of whether the user was a participant

#### Scenario: Group admin edits a match between two of their members
- **WHEN** a user who admins group G attempts UPDATE on a match where both `player_a_id` AND `player_b_id` are members of G
- **THEN** `is_group_admin_for_pair` returns TRUE → `can_write_match` returns TRUE → RLS permits the update

#### Scenario: Group admin tries to edit a match with one outside player
- **WHEN** the same user attempts UPDATE on a match where only one of the participants is a member of any group they admin
- **THEN** `is_group_admin_for_pair` returns FALSE; unless the caller is also a global / club admin for that pair, RLS rejects

---

### Requirement: Settings RLS

`public.settings` SHALL have RLS enabled with public read and admin-only write (insert/update/delete).

#### Scenario: Anyone reads settings
- **WHEN** any request (including anonymous) selects from `settings`
- **THEN** all rows are returned

#### Scenario: Non-admin attempts to write settings
- **WHEN** a non-admin tries to insert/update/delete a settings row
- **THEN** RLS rejects the write

---

### Requirement: Client uses isAdmin and myPlayer, not legacy gates

Client code SHALL gate UI on either `profile.isAdmin` (admin-only operations) or `myPlayer.id` (operations on the user's own player or matches involving them). The legacy `canEdit` flag and the `OWNER_EMAIL` constant MUST NOT be used as authorization gates in new code.

#### Scenario: Rendering an admin-only control
- **WHEN** the UI needs to show a destructive admin action (e.g. delete match, promote/demote)
- **THEN** the component checks `profile?.isAdmin === true` and hides the control otherwise

#### Scenario: Rendering "edit my profile"
- **WHEN** the UI shows an edit affordance on a player profile page
- **THEN** the affordance renders only if `myPlayer?.id === player.id` OR `profile?.isAdmin === true`

#### Scenario: Contributor reintroduces canEdit
- **WHEN** new code references `canEdit` or imports `OWNER_EMAIL` for authorization
- **THEN** the change is rejected in review; `OWNER_EMAIL` remains exported only as a UI hint ("you'll be promoted to admin") and MUST NOT control any write path

---

### Requirement: Admin-only RPCs

The following Postgres RPCs SHALL exist and SHALL refuse execution unless `is_admin(auth.uid())`:
- `list_profiles_for_admin()` — returns every profile, used by the admin user-management UI.
- `set_admin(target_id, value)` — flips the admin flag with the last-admin safety rule above.
- `list_club_admins_for_admin()` — joins `club_admins` with `profiles` for the admin UI.
- `set_club_admin(target_user, slug, value)` — grant or revoke per-club admin status.
- `create_club(...)` and `delete_club(slug)` — manage the curated `clubs` registry.

Non-admin callers MUST receive an error, not silently empty results.

#### Scenario: Admin lists all profiles
- **WHEN** an admin calls `list_profiles_for_admin()`
- **THEN** every profile row is returned, ordered by full name

#### Scenario: Non-admin calls list_profiles_for_admin
- **WHEN** a non-admin calls `list_profiles_for_admin()`
- **THEN** the function raises an error

#### Scenario: Non-admin calls set_club_admin
- **WHEN** a non-global-admin (even a club admin) calls `set_club_admin(...)`
- **THEN** the function raises `admin only`

---

### Requirement: Club admin tier

The `public.club_admins` table SHALL store `(user_id, club_slug)` grants. Membership in this table SHALL grant the user write access to (a) players whose `club_slug = ca.club_slug` and (b) matches involving at least one such player. Club admins MUST NOT have access to other clubs' players or matches, and MUST NOT be able to modify the `is_admin` flag on profiles or modify `club_admins` rows themselves (only global admins may).

The helper `is_club_admin(uid, slug)` SHALL return `true` iff `(uid, slug)` exists in `club_admins`.

#### Scenario: Club admin edits a player in their club
- **WHEN** a club admin for slug "westside" updates a player whose `club_slug = 'westside'`
- **THEN** the update succeeds via the RLS policy invoking `is_club_admin(auth.uid(), club_slug(club))`

#### Scenario: Club admin tries to edit a player in another club
- **WHEN** a club admin for "westside" tries to update a player with `club_slug = 'eastside'`
- **THEN** RLS rejects the update

#### Scenario: Club admin tries to grant club-admin to someone
- **WHEN** a club admin (not global admin) calls `set_club_admin(...)`
- **THEN** the RPC raises an error

---

### Requirement: Group admin tier

The `public.group_members` table SHALL carry an `is_admin boolean` per `(group_id, player_id)`. The helper `is_group_admin(uid, group_id)` SHALL return `true` iff the user is a global admin OR they own a player who is a member of the group with `is_admin = true`.

Group admins SHALL be able to (via dedicated RPCs only — not direct table writes by non-admins): edit the group's name/description/visibility, add or remove members, promote/demote members. Group-management RPCs MUST refuse to remove the last admin from a group so a steward always exists.

Visibility of a private group (`is_private = true`) SHALL be limited to global admins and members; public groups (`is_private = false`) are readable by anyone.

#### Scenario: Group admin invites a new member
- **WHEN** a group admin calls `add_group_member(group, player, false)`
- **THEN** the row is upserted into `group_members`

#### Scenario: Removing the last admin
- **WHEN** a group admin calls `remove_group_member(group, themselves)` and they are the only admin remaining
- **THEN** the RPC raises `cannot remove the last admin` and no change is made

#### Scenario: Non-member reads a private group
- **WHEN** an anonymous or non-member request selects a private group's row or its members
- **THEN** RLS returns no rows

