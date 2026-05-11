# player-claim Specification

## Purpose
TBD - created by archiving change seed-domain-specs. Update Purpose after archive.
## Requirements
### Requirement: One ranked player per user

Each authenticated user SHALL be associated with at most one row in `public.players` via `players.user_id` (a unique nullable FK to `auth.users.id`). A row with `user_id IS NULL` is **unclaimed** (legacy or admin-pre-created); a row with a non-null `user_id` is **claimed** by exactly that user.

The uniqueness invariant MUST be enforced at the schema level (`user_id uuid unique`).

#### Scenario: Two players claim the same user
- **WHEN** an attempt is made to set `user_id = U` on two different rows
- **THEN** the database rejects the second update with a unique-constraint violation

#### Scenario: User account deletion
- **WHEN** a row in `auth.users` is deleted
- **THEN** any `players.user_id` referencing it is set to `NULL` (the player becomes unclaimed; match history is retained)

---

### Requirement: Auto-create-or-claim at first profile insert

The `profiles_ensure_player` AFTER INSERT trigger on `profiles` SHALL guarantee that every newly created profile has a corresponding player row. Specifically:

1. If the user already owns a player (`exists where user_id = new.id`), do nothing.
2. Otherwise, look for an unclaimed player whose `norm_email(email) = norm_email(new.email)`; if found, claim the oldest one (set `user_id = new.id` and copy missing identity fields from the profile via `coalesce`).
3. Otherwise, insert a fresh player row with `id = new.id`, `name = new.full_name`, `starting_level = new.starting_level`, and the rich identity fields copied from the profile.

The trigger SHALL run as `security definer` so it can write to `players` regardless of the inserting user's RLS context.

#### Scenario: Admin pre-created an unclaimed player by email
- **WHEN** an admin previously inserted `players(name='Jane Doe', email='jane@example.com', user_id=null)` and Jane signs in for the first time
- **THEN** the trigger claims Jane's existing player row (preserving any matches attached to it) instead of creating a duplicate

#### Scenario: No matching unclaimed player
- **WHEN** a brand-new user signs in and no unclaimed player matches their email
- **THEN** the trigger inserts a fresh `players` row using the profile's `id` as the player id

#### Scenario: Already-owned profile
- **WHEN** a user's profile is re-inserted (shouldn't happen in normal flow, but tested)
- **THEN** the trigger no-ops without creating a duplicate player

---

### Requirement: Email normalization for claim matching

The `norm_email(text)` immutable SQL function SHALL normalize an email address such that two strings represent "the same mailbox" iff their normalizations are equal. Specifically:

- Lowercase everything.
- For `@gmail.com` and `@googlemail.com`: strip dots from the local part and drop anything from `+` onward; canonicalize the domain to `gmail.com`.
- For other domains: lowercase only.
- Return `NULL` for empty or malformed input (no `@`).

This function is the only acceptable comparator for matching claim candidates. Direct `lower(email) = lower(other)` comparisons MUST NOT be used in claim flows.

#### Scenario: Gmail dot/plus normalization
- **WHEN** comparing `j.doe+work@googlemail.com` and `jdoe@gmail.com`
- **THEN** both normalize to `jdoe@gmail.com` and are treated as the same mailbox

#### Scenario: Non-gmail domain
- **WHEN** comparing `Foo@Example.COM` and `foo@example.com`
- **THEN** both normalize to `foo@example.com` and match

#### Scenario: Empty or malformed input
- **WHEN** `norm_email('')` or `norm_email('not-an-email')` is called
- **THEN** the function returns `NULL` (which can never match anything)

---

### Requirement: Explicit claim by id

The `claim_player_by_id(target uuid)` SECURITY DEFINER RPC SHALL allow a signed-in user to take over a specific unclaimed player row (e.g. a name match suggested at onboarding). Behavior:

- If the target is already claimed by the caller, return it (idempotent).
- If the target is claimed by someone else, raise `player already claimed by someone else`.
- If the target doesn't exist, raise `player not found`.
- If the caller already owns a different player row (the auto-created stub from `ensure_player_for_profile`), the RPC SHALL atomically:
  1. Repoint any matches referencing the stub's id to the target's id.
  2. Move identity fields (`name`, `email`, `starting_level`, plus rich fields via `coalesce`) onto the target.
  3. Set `user_id = caller`.
  4. Delete the stub.
- Otherwise (no existing player), simply set `user_id = caller` on the target.

Match history attached to the claimed row MUST be preserved through the operation.

#### Scenario: User claims an unclaimed player at onboarding
- **WHEN** a fresh user with stub player `S` calls `claim_player_by_id(P)` and `P` is unclaimed
- **THEN** `P.user_id = caller`, all matches that referenced `S` now reference `P`, and `S` is deleted

#### Scenario: Claim a player already claimed by you
- **WHEN** a user calls `claim_player_by_id(P)` and `P.user_id` already equals their uid
- **THEN** `P` is returned unchanged (idempotent)

#### Scenario: Claim a player owned by someone else
- **WHEN** a user calls `claim_player_by_id(P)` and `P.user_id` is some other uid
- **THEN** the RPC raises `player already claimed by someone else`

---

### Requirement: Unclaimed-player creation by participants

The `create_unclaimed_player(p_name, p_email, p_starting_level?, p_club?, p_city?, p_country?, p_phone?, p_birth_year?, p_gender?, p_dominant_hand?)` SECURITY DEFINER RPC SHALL allow any signed-in user to create a stub player to log a match against someone not yet on Boast. The RPC:

- Requires authentication; raises `not authenticated` if `auth.uid()` is null.
- Requires a non-empty trimmed `p_name`; raises `name required` otherwise.
- **Requires** a non-empty trimmed `p_email`; raises `email required` otherwise. Email keys the auto-claim flow when the real user signs up later (`ensure_player_for_profile` matches by normalised email) and powers the dedup step. Without email the row is unreachable by claim and unsafe to admit into the rating system.
- Validates email shape (raises `email looks invalid`), `p_gender` ∈ `{male, female}`, `p_dominant_hand` ∈ `{right, left, ambi}`, `p_birth_year` ∈ `[1900, current_year]`.
- Stamps `created_by = auth.uid()`.
- Sets `user_id = NULL` (unclaimed).
- If a player (claimed or unclaimed) with the same email already exists, returns the existing player rather than creating a duplicate (case-insensitive match on raw email; the more elaborate `norm_email` is reserved for the claim trigger).
- Defaults `starting_level = 1000` when not specified.
- Accepts the full identity field set (phone, birth_year, gender, dominant_hand alongside club/city/country) so the future claimer sees their data pre-filled in onboarding via the `OnboardingModal` pick-an-existing-row flow.

#### Scenario: Logging a match against a friend not on Boast
- **WHEN** a signed-in user calls `create_unclaimed_player('Alex Smith', 'alex@example.com', 1200, 'Singapore Cricket Club')` and no such player exists
- **THEN** a new unclaimed player row is created with the supplied fields and returned, ready to be the opponent in a match insert

#### Scenario: Missing email
- **WHEN** the RPC is called with `p_email = null` or an empty string
- **THEN** it raises `email required` (was previously permitted as of 2026-05-10; tightened 2026-05-11 to gate the auto-claim path and prevent unbounded ghost-player creation)

#### Scenario: Email-based dedupe
- **WHEN** the RPC is called with an email that already exists on a player
- **THEN** the existing player is returned; no new row is created

#### Scenario: Unauthenticated call
- **WHEN** an anonymous request calls the RPC
- **THEN** it raises `not authenticated`

---

### Requirement: Profile edits mirror to player

The `profiles_sync_player` AFTER UPDATE trigger SHALL mirror the following fields from a profile to its linked player row whenever the profile is updated: `full_name → name`, `email`, `starting_level`, plus `phone`, `country`, `city`, `club`, `avatar_url`, `birth_year`, `gender`, `dominant_hand`. This means a user (or an admin) only has to edit one place to update the public-facing identity.

The mirror SHALL apply unconditionally (no `coalesce`) so a profile edit is the source of truth — including clearing fields by setting them to null.

#### Scenario: User changes their club
- **WHEN** a user updates `profiles.club` from "Westside" to "Eastside"
- **THEN** their linked player row's `club` becomes "Eastside" via the trigger

#### Scenario: Admin clears a player's avatar via the profile
- **WHEN** an admin updates a profile to set `avatar_url = NULL`
- **THEN** the linked player's `avatar_url` also becomes `NULL`

