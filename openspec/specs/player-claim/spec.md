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

### Requirement: One player per email

Email is the primary identity key for a player on Boast — every claim flow (auto-claim by email at signup, onboarding email-match suggestion) assumes one player per email. The schema SHALL enforce this with a partial unique index `players_email_unique` on `lower(email)` where `email is not null`, so every write path (RPC, direct upsert, future backfills) gets the same guarantee.

NULL emails are exempt (legacy unclaimed rows pre-dating the email-required rule may exist without one). New stubs created via `create_unclaimed_player` require email, so the gap is closing organically.

Client write paths (`store.addPlayer`, `store.updatePlayer`) MUST translate the resulting unique-constraint violation into a clear "A player already exists with the email X" message rather than surfacing the raw Postgres error.

#### Scenario: Admin tries to add a second player with the same email
- **WHEN** an admin uses the Roster page or PlayerFormModal to add a player whose email matches an existing claimed or unclaimed row
- **THEN** the insert is rejected at the DB level (unique-index violation); the client surfaces "A player already exists with the email X. Email is a player's identity on Boast — open that player to edit them, or use a different email." instead of the raw constraint message

#### Scenario: create_unclaimed_player de-dupes before insert
- **WHEN** a signed-in user calls `create_unclaimed_player` with an email that already exists on a player
- **THEN** the RPC returns the existing player (case-insensitive match on raw email) rather than attempting the insert — so the unique index acts as a backstop, not the primary defence on this path

#### Scenario: Two unclaimed rows with NULL email
- **WHEN** two legacy unclaimed rows exist with `email IS NULL`
- **THEN** both are accepted (the partial index does not constrain NULL); only claimed/email-bearing rows are subject to the uniqueness check

---

### Requirement: Auto-create-or-claim at first profile insert

The `profiles_ensure_player` AFTER INSERT trigger on `profiles` SHALL guarantee that every newly created profile has a corresponding player row. Specifically:

1. If the user already owns a player (`exists where user_id = new.id`), do nothing.
2. Otherwise, look for an unclaimed player whose `norm_email(email) = norm_email(new.email)`; if found, claim the oldest one. On claim:
   - `starting_level`, `seeded_rating`, and `name` are taken unconditionally from the profile (the user's onboarding choices are authoritative for who they are and at what level they enter the system).
   - `current_level` is reset to `new.starting_level` so leaderboards reflect the new seed immediately.
   - `levels_stale = true` is set if the stub already had `matches_played > 0` (cached `current_level` and per-match `level_*` columns were computed against the old `starting_level` — admin Rebuild Levels resolves them, including opponents' levels).
   - Identity fields (`phone`, `country`, `city`, `club`, `avatar_url`, `birth_year`, `gender`, `dominant_hand`) use `coalesce(new.X, players.X)` — the claimer's value wins when they provided one; the stub's value fills blanks so an admin-entered field isn't wiped by an empty form input.
   - **`created_at` is preserved** — the stub's original creation timestamp is the player's anchor in time and MUST NOT be overwritten with the profile-insert moment. Any matches another user logged against the stub between stub-creation and claim are attached to the player row's id, and the rating system relies on every such match being dated `>= players.created_at` (enforced by the `matches_validate_date` trigger in `match-recording`). Resetting `created_at` to the claim moment would either invalidate those historical matches or force the trigger to be loosened — both worse than the small UX oddity of a "joined on" date that predates the user's first sign-in.
3. Otherwise, insert a fresh player row with `id = new.id`, `name = new.full_name`, `starting_level = new.starting_level`, and the rich identity fields copied from the profile.

The trigger SHALL run as `security definer` so it can write to `players` regardless of the inserting user's RLS context.

#### Scenario: Admin pre-created an unclaimed player by email
- **WHEN** an admin previously inserted `players(name='Jane Doe', email='jane@example.com', user_id=null)` and Jane signs in for the first time
- **THEN** the trigger claims Jane's existing player row (preserving any matches attached to it) instead of creating a duplicate

#### Scenario: Claimer's starting rating overrides the stub's
- **WHEN** an admin pre-created a stub with `starting_level=1000` and 1 match was played against it (`current_level` rose to e.g. 1008), and the real user signs up entering `starting_level=3383` in onboarding
- **THEN** the claimed player row ends up with `starting_level=3383`, `current_level=3383`, and `levels_stale=true`; the admin's Rebuild Levels banner surfaces the player, and running Rebuild reconciles the cached `level_*` columns on the played match (including the opponent's `current_level`)

#### Scenario: Claimer leaves an identity field blank that the stub had filled
- **WHEN** the admin's stub has `club='Singapore Cricket Club'` and the claimer leaves the club field blank in onboarding
- **THEN** the claimed player row retains `club='Singapore Cricket Club'` (stub fills the blank via `coalesce(new.club, players.club)`)

#### Scenario: Claimer provides an identity field that conflicts with the stub
- **WHEN** the admin's stub has `country='Singapore'` and the claimer enters `country='India'`
- **THEN** the claimed player row ends up with `country='India'` (claimer's non-null value wins)

#### Scenario: created_at survives the claim
- **WHEN** Player A creates an unclaimed stub for Player B on 2026-05-01 and logs a match against them on 2026-05-03, and Player B signs in and claims the stub on 2026-05-15
- **THEN** the claimed player row keeps `created_at = 2026-05-01`; the 2026-05-03 match remains valid (date >= created_at); Player B's profile page shows "Started at … 1 May 2026"; the match-date validation trigger continues to accept matches dated on or after 2026-05-01

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

### Requirement: Onboarding email-based claim suggestion

The `find_unclaimed_by_email(p_email text)` SECURITY DEFINER RPC SHALL return up to 5 unclaimed player rows whose email matches `p_email` under `norm_email` semantics. The onboarding modal SHALL call this once on mount with the signed-in user's auth email and surface any match as a "we already have a player linked to this email — your match history and profile data will follow you" banner that prefills form fields from the stub.

Email is the chosen key (not name) because name collisions are common ("Amit", "John") and produced noisy suggestions, and because the server-side auto-claim already uses email; aligning the suggestion lookup with the server eliminates the case where a stub gets silently auto-claimed on submit that the UI never offered to the user.

**The claim is mandatory when there's an email match.** Google has verified the user owns the email; the stub is tagged with that email, so the stub IS the user. The modal SHALL auto-select the oldest match and lock the choice — there is no "None of these — I'm new to Boast" escape hatch, because the server-side `ensure_player_for_profile` trigger would claim the stub anyway on profile insert, and offering an opt-out would mislead the user into thinking they can start fresh under the same email when they cannot.

The email field in the onboarding form SHALL be read-only, pre-filled with the signed-in user's Google account email (Boast is Google-auth-only as of 2026-05-17). A user wanting to use a different email must sign out and sign in with a different Google account.

#### Scenario: Stub matches signed-in user's email
- **WHEN** an admin pre-created `players(name='Jane Doe', email='jane@example.com', user_id=null)` and Jane opens the onboarding modal after signing in with `JANE+work@gmail.com`
- **THEN** `find_unclaimed_by_email` returns Jane's stub (gmail dot/plus normalisation matches), the banner appears with the stub locked in, and form fields prefill from it; on submit, the server claims the stub regardless

#### Scenario: User cannot opt out of email-match claim
- **WHEN** a user signs in with an email that matches an existing unclaimed stub, regardless of which buttons they click in the modal
- **THEN** the stub is claimed on submit by `ensure_player_for_profile`; the user cannot register a parallel account under the same email

#### Scenario: No email match
- **WHEN** a brand-new user opens the onboarding modal and no unclaimed stub matches their email
- **THEN** the banner does not appear; the user fills the form from scratch and `ensure_player_for_profile` inserts a fresh player row

---

### Requirement: Explicit claim by id

The `claim_player_by_id(target uuid)` SECURITY DEFINER RPC SHALL allow a signed-in user to take over a specific unclaimed player row (e.g. a stub surfaced by the email-match suggestion at onboarding). Behavior:

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

The `create_unclaimed_player(p_name, p_email, p_starting_level?, p_club?, p_city?, p_country?, p_phone?, p_birth_year?, p_gender?, p_dominant_hand?, p_seeded_rating?)` SECURITY DEFINER RPC SHALL allow any signed-in user to create a stub player to log a match against someone not yet on Boast. The RPC:

- Requires authentication; raises `not authenticated` if `auth.uid()` is null.
- Requires a non-empty trimmed `p_name`; raises `name required` otherwise.
- **Requires** a non-empty trimmed `p_email`; raises `email required` otherwise. Email keys the auto-claim flow when the real user signs up later (`ensure_player_for_profile` matches by normalised email) and powers the dedup step. Without email the row is unreachable by claim and unsafe to admit into the rating system.
- Validates email shape (raises `email looks invalid`), `p_gender` ∈ `{male, female}`, `p_dominant_hand` ∈ `{right, left, ambi}`, `p_birth_year` ∈ `[1900, current_year]`.
- **Gmail-only restriction (2026-05-17):** the email's domain MUST be `gmail.com` or `googlemail.com` (case-insensitive). Boast signs in via Google only as of this date, and a stub registered with a non-Gmail address can never claim itself — the `ensure_player_for_profile` email match won't fire because the user can never authenticate. Raises `email must be @gmail.com or @googlemail.com (Boast signs in via Google)` otherwise. Client write paths (LogMatch inline "Add new player", Roster, PlayerFormModal) MUST mirror this check with a helper hint under the email field so admins understand the restriction up-front. Existing players with non-Gmail emails are grandfathered. Remove the restriction when additional auth providers are supported.
- Stamps `created_by = auth.uid()`.
- Sets `user_id = NULL` (unclaimed).
- If a player (claimed or unclaimed) with the same email already exists, returns the existing player rather than creating a duplicate (case-insensitive match on raw email; the more elaborate `norm_email` is reserved for the claim trigger).
- Defaults `starting_level = 1000` when not specified.
- Defaults `seeded_rating = false` when not specified. The caller passes `true` when they're recording a known external rating (SquashLevels.com / LevelTech / confident coach estimate); without this the stub is treated as provisional for its first `settings.provisionalThreshold` matches, which means the recorder's own rating doesn't move when playing them. UI surfaces (LogMatch "Add new player" inline form, PlayerFormModal) MUST require the recorder to make an explicit choice rather than silently defaulting — provisional has real consequences for both parties' rating arcs.
- Accepts the full identity field set (phone, birth_year, gender, dominant_hand alongside club/city/country) so the future claimer sees their data pre-filled in onboarding via the `OnboardingModal` pick-an-existing-row flow.

#### Scenario: Logging a match against a friend not on Boast
- **WHEN** a signed-in user calls `create_unclaimed_player('Alex Smith', 'alex@gmail.com', 1200, 'Singapore Cricket Club')` and no such player exists
- **THEN** a new unclaimed player row is created with the supplied fields and returned, ready to be the opponent in a match insert

#### Scenario: Non-Gmail email rejected
- **WHEN** an admin or signed-in user tries to call `create_unclaimed_player('Pat Doe', 'pat@yahoo.com', …)`
- **THEN** the RPC raises `email must be @gmail.com or @googlemail.com (Boast signs in via Google)` and no row is created; the client forms surface the same message before the round-trip

#### Scenario: Recording a known external rating for a new opponent
- **WHEN** an admin uses LogMatch's "Add new player" to record an opponent with a known SquashLevels.com rating of 3000, ticking "I know their rating"
- **THEN** `create_unclaimed_player` is called with `p_starting_level=3000` and `p_seeded_rating=true`, the stub is created with `seeded_rating=true`, and the very first match logged against them updates both players' levels symmetrically (the stub is NOT provisional)

#### Scenario: Recording an opponent with no known rating
- **WHEN** an admin uses LogMatch's "Add new player" and picks "I don't know their rating"
- **THEN** `create_unclaimed_player` is called with `p_starting_level=1000` and `p_seeded_rating=false`, the stub starts at 1000 and is provisional for its first `settings.provisionalThreshold` matches — only the stub's level moves on those matches, established opponents are insulated

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

