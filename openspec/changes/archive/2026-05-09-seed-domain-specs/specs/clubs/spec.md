## ADDED Requirements

### Requirement: A "club" is identified by a slugged name

A club's canonical identifier SHALL be a URL-safe slug derived from its display name by `club_slug(name)`:

- Trim and lowercase.
- Replace runs of non-alphanumeric characters with `-`.
- Strip leading/trailing `-`.
- Return `NULL` for empty/whitespace input.

The same slug SHALL be produced by both the SQL `public.club_slug(text)` function and the client-side `clubSlug(name)` function in `src/lib/supabase/clubs.ts`. These two implementations MUST agree, since RLS uses the SQL version and routing/lookup uses the client version.

#### Scenario: Casing and punctuation collapse
- **WHEN** slugifying "Westside Squash & Racquet Club"
- **THEN** the result is `westside-squash-racquet-club`

#### Scenario: Identical slugs from drifting names
- **WHEN** two players have `club = 'Westside SRC'` and `club = 'westside src'`
- **THEN** both map to the same slug `westside-src` and are treated as the same club

#### Scenario: Empty input
- **WHEN** slugifying `''` or `'   '` or `NULL`
- **THEN** the function returns `NULL` (SQL) or `''` (TypeScript) — both represent "no club"

---

### Requirement: Players carry their club as a string

The canonical record of a player's current club SHALL live on `players.club` as a free-form string. A generated stored column `players.club_slug = public.club_slug(club)` SHALL be maintained automatically and indexed for fast membership queries. There SHALL NOT be a foreign key from `players.club_slug` to the `clubs` registry — a player can claim membership in a club that hasn't been registered, and a registered club is allowed to have zero members.

#### Scenario: Player joins a brand-new club
- **WHEN** a player edits their profile to set `club = 'New Club Name'`
- **THEN** their `club_slug` is automatically `new-club-name` and the club becomes "discoverable" via the player roster, even if no `clubs` registry row exists

#### Scenario: Registered club with zero members
- **WHEN** an admin creates a club via `create_club('Pre-launch Club')` and no player has joined yet
- **THEN** the club appears in the registry but its derived member count is 0

---

### Requirement: Curated clubs registry

The `public.clubs` table SHALL act as an admin-curated registry, separate from the derived "clubs from player.club" view. Its purpose is to let global admins seed a club page (with city, country, description) before any members exist, and to remove stale entries from the directory.

- `slug text primary key`.
- `name text NOT NULL`.
- Optional: `city`, `country`, `description`, `created_by`, `created_at`.
- RLS: public read; insert/update/delete restricted to global admins.

Removing a registry row MUST NOT touch player records — it only removes the curated metadata. If players still claim that club name, the derived club page still renders from player rows.

#### Scenario: Admin creates a registry entry
- **WHEN** a global admin calls `create_club('Westside SRC', 'Berlin', 'Germany', '...')`
- **THEN** a row is upserted into `clubs` with `slug = 'westside-src'`. On conflict, name is overwritten and city/country/description are coalesced (existing non-null values preserved unless overridden)

#### Scenario: Non-admin creates a club
- **WHEN** a non-global-admin calls `create_club(...)`
- **THEN** the RPC raises `admin only`

#### Scenario: Deleting a registry entry that has members
- **WHEN** an admin calls `delete_club('westside-src')` and players still have `club = 'Westside SRC'`
- **THEN** the registry row is removed but no player rows are touched; the club still appears in the derived view via its members

---

### Requirement: Club summarization and merge

The `summarizeClubs(players)` client helper SHALL roll up the player roster into per-club summaries: `{ slug, name, members, city?, country? }`. The display `name` for a slug SHALL be the first-seen casing among players (so name drift across rows is hidden behind a stable representation). The optional `city`/`country` SHALL be the modal value among that club's members.

The `mergeClubs(registered, derived)` helper SHALL combine the curated registry with the derived view. The registry's `name`, `city`, `country`, `description` take precedence when present; the `members` count always comes from the derived view (registry entries with no players show `members = 0`).

The merged list SHALL be sorted by `members` descending, then `name` ascending.

#### Scenario: Players with mixed-casing club names
- **WHEN** five players have `club ∈ {'Westside SRC', 'westside src', 'Westside Src'}`
- **THEN** `summarizeClubs` returns one club row with `members = 5` and the first-seen casing

#### Scenario: Registry name overrides derived
- **WHEN** the derived view has `name = 'westside src'` (lowercase from a player row) but the registry has `name = 'Westside Squash & Racquet Club'`
- **THEN** the merged result uses the registry's name

---

### Requirement: Per-club admins

A user MAY be granted admin authority over one or more specific clubs via rows in `public.club_admins (user_id, club_slug)`. The `is_club_admin(uid, slug)` SQL helper SHALL return `true` iff such a row exists. This grants the user write access to players whose `club_slug` matches and to matches involving at least one such player. See `auth-permissions` for the exact RLS rules.

The `set_club_admin(target_user, slug, value)` RPC SHALL be the only sanctioned way to grant or revoke this status, and SHALL refuse execution unless the caller is a global admin.

#### Scenario: Global admin grants club-admin status
- **WHEN** a global admin calls `set_club_admin(user_X, 'westside-src', true)`
- **THEN** a row is upserted into `club_admins` and user_X can now edit Westside SRC players and matches

#### Scenario: Club admin tries to grant club-admin status
- **WHEN** a (non-global) club admin calls `set_club_admin(...)`
- **THEN** the RPC raises `admin only`

#### Scenario: Player changes clubs
- **WHEN** a player edits their profile to leave Westside SRC and join Eastside
- **THEN** the Westside club admin loses write access to that player (their `club_slug` no longer matches the grant), and the Eastside club admin gains it
