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

The first profile inserted for the original-owner email (`amit.gangrade@gmail.com`) SHALL be promoted to `is_admin = true` automatically by the `profiles_bootstrap_admin` BEFORE INSERT trigger. All other profiles SHALL be inserted with `is_admin = false`. The flag MAY only be changed thereafter via the admin-only `set_admin(target_id, value)` RPC.

#### Scenario: Owner signs in for the first time
- **WHEN** the owner email signs in and inserts their profile
- **THEN** the trigger flips `is_admin` to `true` before the row is committed

#### Scenario: Non-owner attempts to insert with is_admin=true
- **WHEN** any other user attempts an insert with `is_admin: true` in the payload
- **THEN** the trigger leaves `is_admin = false` (or RLS rejects the write — see Profile RLS)

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

When deleting a player whose `user_id IS NOT NULL` (claimed), the system SHALL delete the entire user via the `admin_delete_user` SECURITY DEFINER RPC (auth.users + profiles + the player row, cascading matches / group_members / challenges). Deleting a player whose `user_id IS NULL` (unclaimed stub) deletes only the player row plus the cascaded matches / group_members / challenges; no auth / profile rows exist to remove.

After any player deletion, opponents' `current_level` and `matches_played` become stale until **Admin → Rebuild levels** is run.

#### Scenario: Club admin attempts to delete a player
- **WHEN** a club admin (without global-admin) tries to delete any player — claimed or unclaimed — via UI or direct API call
- **THEN** the action is rejected (UI hides the Delete control; RLS denies a direct `DELETE FROM players`)

#### Scenario: Global admin deletes a claimed player
- **WHEN** a global admin deletes a player with `user_id = U`
- **THEN** the client routes the action through `admin_delete_user(U)`, which removes the `auth.users` row (cascading the profile and the player) and triggers FK cascades for matches / group_members / challenges

#### Scenario: Global admin deletes an unclaimed player
- **WHEN** a global admin deletes a player with `user_id IS NULL`
- **THEN** the client issues `DELETE FROM players WHERE id = …`; matches / group_members / challenges cascade; no auth or profile rows are touched

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
- **Update**: a global admin OR a club admin for either participant's club MAY update. Regular participants MAY NOT update a match (so opponents cannot silently rewrite history); they confirm or dispute via the `confirm_match` RPC instead — see the `match-recording` capability.
- **Delete**: a global admin OR a club admin for either participant's club MAY delete.

The `matches_before_insert` trigger SHALL stamp `created_by = auth.uid()` and reject inserts where the recorder cannot be resolved to a participant (and is not an admin).

#### Scenario: Player records a match they played in
- **WHEN** signed-in user U inserts a match where `player_a_id` or `player_b_id` is owned by U
- **THEN** the insert succeeds and `created_by = U`

#### Scenario: Player tries to record a match between two other people
- **WHEN** signed-in non-admin user U inserts a match where neither participant's `user_id = U`
- **THEN** RLS (and the trigger) reject the insert

#### Scenario: Non-admin tries to edit or delete a match
- **WHEN** a non-admin attempts an UPDATE or DELETE on `matches`
- **THEN** RLS rejects it regardless of whether the user was a participant

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

