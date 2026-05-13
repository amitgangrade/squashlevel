# audit Specification

## Purpose
Provide an append-only, queryable history of state changes across the
app so admins can investigate "who did what, when" without piecing it
together from logs scattered between Postgres, the client, and Supabase.

## Requirements

### Requirement: Capture every write across load-bearing tables

The system SHALL persist one row in `public.audit_events` for each
INSERT, UPDATE, or DELETE on the following tables: `profiles`,
`players`, `matches`, `challenges`, `clubs`, `club_admins`, `groups`,
`group_members`, `settings`.

Captures SHALL be implemented by a generic AFTER trigger
(`public.audit_row_change`) attached to each of those tables, so every
write path — UI mutation, SECURITY DEFINER RPC, direct SQL, server-side
trigger — produces an audit row. Application code SHALL NOT be the only
source of audit data.

Each row SHALL record:
- `at` — server timestamp.
- `actor_user_id` + `actor_label` — `auth.uid()` and a snapshot of
  `"<full_name> <email>"` from `profiles`, captured at write time so the
  audit row survives subsequent user deletion.
- `entity_type` — the source table name.
- `entity_id` — the row's primary key as text.
- `op` — `insert`, `update`, or `delete`.
- `changed` — for INSERT / DELETE the full row as JSON; for UPDATE
  `{ before, after }`.
- `subject_player_ids[]`, `subject_club_slugs[]`, `subject_group_ids[]`
  — denormalised arrays describing which players / clubs / groups this
  event "involves". Backs cheap scoped reads via GIN indexes.
- `privileged` — true when the event SHALL only be visible to global
  admins regardless of subject scope (see below).

#### Scenario: Player creation is captured
- **WHEN** any caller inserts a row into `public.players`
- **THEN** an `audit_events` row is written with `entity_type='players'`, `op='insert'`, `subject_player_ids=[that id]`, and the player's `club_slug` in `subject_club_slugs` if non-empty

#### Scenario: System actions have a null actor
- **WHEN** `auto_confirm_aged_matches` (cron, no `auth.uid()`) confirms a match
- **THEN** the row is captured with `actor_user_id = null`, `actor_label = null`; the UI renders the actor as "System"

---

### Requirement: One audit row per logical user action

Cascade triggers SHALL NOT produce additional audit rows for writes
they fire on behalf of a parent action. Specifically:
`ensure_player_for_profile` and `sync_player_from_profile` SHALL wrap
their `players` writes in a `boast.audit_skip = 'true'` session-local
GUC, which `audit_row_change` honours by returning early.

#### Scenario: User edits their profile
- **WHEN** a user updates their own profile row
- **THEN** exactly one audit row is written, with `entity_type='profiles'`; the cascaded `players` update via `sync_player_from_profile` produces no audit row

#### Scenario: User signs up
- **WHEN** a profile is inserted and `ensure_player_for_profile` creates or claims a `players` row
- **THEN** exactly one audit row is written, with `entity_type='profiles', op='insert'`; the player create/claim produces no audit row

---

### Requirement: Privileged events

When a `profiles` UPDATE changes ONLY the `is_admin` column (no other
field differs), the resulting audit row SHALL be marked
`privileged = true`. Privileged rows SHALL also be set for `settings`
table writes.

#### Scenario: is_admin toggle hidden from scoped admins
- **WHEN** a global admin promotes a club member to global admin, then a non-global admin of that user's club queries `list_audit_events`
- **THEN** the promotion event is excluded from the response (the column-only-changed check flagged it privileged)

#### Scenario: Other profile edits stay visible to scoped admins
- **WHEN** a user changes their own `country` (no `is_admin` change), and a club admin of that user's club queries the log
- **THEN** the event is returned (privileged = false, subject_player_ids overlaps the club admin's scope)

---

### Requirement: Append-only, immutable

`public.audit_events` SHALL have RLS enabled with no SELECT / INSERT /
UPDATE / DELETE policies. All access SHALL flow through the
`list_audit_events` SECURITY DEFINER RPC. The audit trigger function,
also SECURITY DEFINER, is the only writer.

#### Scenario: Direct delete attempt
- **WHEN** any authenticated user tries `DELETE FROM audit_events WHERE id = …`
- **THEN** RLS denies the operation (no DELETE policy exists)

---

### Requirement: Scoped reads via list_audit_events RPC

The `list_audit_events(p_after timestamptz, p_limit int, p_actor uuid,
p_entity_type text)` RPC SHALL return at most `p_limit` rows
(server-capped at 200) older than `p_after`, ordered by `(at desc, id
desc)`.

Scoping by viewer role:
- **Global admin** (`is_admin(viewer)` returns true): no scope filter.
- **Club admin** (rows in `club_admins`) OR **group admin** (owns a
  player flagged `is_admin = true` in any `group_members` row): return
  events where `subject_player_ids` overlaps members of their clubs +
  groups, OR `subject_club_slugs` overlaps clubs they administer, OR
  `subject_group_ids` overlaps groups they administer. Privileged
  events are excluded for this tier.
- **Anyone else** (signed-in but no admin scope): empty result.
- **Unauthenticated**: RPC raises `not authenticated`.

#### Scenario: Club admin sees a member's match
- **WHEN** a club admin of slug `singapore-cricket-club` queries `list_audit_events`, and an audit row exists for a match whose `player_a_id` is in that club
- **THEN** the row is returned (subject_club_slugs overlap)

#### Scenario: Club admin doesn't see settings changes
- **WHEN** the same club admin queries `list_audit_events` after a global admin tunes algorithm constants
- **THEN** the settings event is excluded (privileged=true)

#### Scenario: Unauthenticated read rejected
- **WHEN** an unauthenticated request calls the RPC
- **THEN** it raises `not authenticated`

---

### Requirement: Retention

The system SHALL retain audit events indefinitely. A future RPC
(`purge_audit_before(timestamptz)`, admin-only) MAY be added when a
retention or right-to-be-forgotten policy is needed.

#### Scenario: Old events still queryable
- **WHEN** an admin queries `list_audit_events` with no filter, six months after deployment
- **THEN** events from day 1 are still returned
