## ADDED Requirements

### Requirement: Match date validation

A match's `date` SHALL fall within the closed interval `[max(playerA.created_at::date, playerB.created_at::date), current_date]` at INSERT and UPDATE time. This range SHALL be enforced by:

1. A `BEFORE INSERT OR UPDATE` trigger on `public.matches` that looks up `created_at` for both participants and raises an exception on violation.
2. Client-side form validation in `LogMatch` and `EditMatchDialog` that surfaces an inline error before submission.

Rationale: `players.starting_level` is defined as the player's level at `created_at` (see `rating` spec). Admitting matches dated earlier than `created_at` would treat that "starting level" as a mid-history checkpoint, contradicting its definition. Future-dated matches are nonsensical given that `matches.date` is the date the match was played.

The trigger SHALL be the authority; client validation is a UX courtesy. Global admins MAY bypass the constraint by first adjusting an affected player's `created_at` backward — there is no flag-gated bypass.

#### Scenario: Match dated before a participant joined
- **WHEN** a user attempts to insert a match dated `2024-01-01` where `player_a.created_at = '2024-06-01'`
- **THEN** the trigger raises an exception (`match date precedes participant's created_at`); no row is written

#### Scenario: Match dated in the future
- **WHEN** a user attempts to insert a match where `date > current_date`
- **THEN** the trigger raises an exception (`match date is in the future`); no row is written

#### Scenario: Match dated exactly on a participant's join date
- **WHEN** a user inserts a match where `date = max(playerA.created_at::date, playerB.created_at::date)`
- **THEN** the insert succeeds; the boundary is inclusive

#### Scenario: Admin adjusts created_at to admit a legacy import
- **WHEN** a global admin sets `players.created_at` to an earlier date and then inserts a match dated after the new `created_at`
- **THEN** the trigger accepts the insert; the admin has explicitly enlarged the player's validity window

---

### Requirement: Persisted match level columns must equal recompute output (admin-gated for backdated mutations)

After a full `recomputeAll(players, matches, settings)` run, the persisted `level_a_before`, `level_a_after`, `level_b_before`, `level_b_after`, `delta_a`, `delta_b`, `provisional_a`, and `provisional_b` columns on every confirmed, non-unranked match SHALL equal the recompute output. These columns are caches of canonical recompute output, not independent state.

Between recompute runs, the persisted columns MAY be stale when a match is inserted, updated, or deleted with a `date` that is NOT strictly the latest confirmed-match date for both participants — the live incremental insert path computes deltas against the live `players.current_level` and does not re-derive prior or subsequent matches. To signal this drift:

1. The system SHALL maintain a `players.levels_stale boolean not null default false` column.
2. An `AFTER INSERT OR UPDATE OR DELETE` trigger on `matches` SHALL set `levels_stale = true` for `player_a_id` and `player_b_id` whenever the mutation's effective date is not strictly the latest confirmed-match date for both participants (or when the mutation is a DELETE of a non-latest confirmed match).
3. The admin "Rebuild levels" surface SHALL display a banner with the count of players where `levels_stale = true`.
4. `rebuild_levels_finalize()` SHALL set `levels_stale = false` for every row in `players` on completion (the full rebuild is the canonical answer that clears all staleness).

Rationale: a correct synchronous recompute after a backdated mutation would have to walk transitive opponents of the affected players (player A's level shift changes the formula's input for every match A is in, which changes the post-match level for A's opponent C in those matches, which then drifts every match C plays subsequently — full transitive closure). This is effectively a full rebuild, which is too expensive to run on every insert. The stale-flag pattern lets the rating engine continue accepting live writes while giving administrators a clear, actionable signal to run the (already-chunked, admin-gated) full rebuild.

#### Scenario: Backdated insert in the middle of history flags both participants
- **WHEN** a match dated `2026-03-01` is inserted while either participant already has a confirmed match dated after `2026-03-01`
- **THEN** the AFTER trigger sets `levels_stale = true` for both `player_a_id` and `player_b_id`; the inserted row's persisted level/provisional columns reflect the live-incremental path (not necessarily canonical) until an admin runs **Rebuild levels**

#### Scenario: Latest-date insert does not flag staleness
- **WHEN** a match is inserted with `date >= max(date)` over both participants' confirmed-match history
- **THEN** the AFTER trigger leaves `levels_stale` unchanged; the live incremental update is already canonical for this position

#### Scenario: Match deletion mid-history flags staleness
- **WHEN** a confirmed match is DELETEd and other confirmed matches with later dates exist for either participant
- **THEN** the AFTER trigger sets `levels_stale = true` for both former participants

#### Scenario: Admin rebuild clears the stale flag
- **WHEN** an admin runs **Rebuild levels** through completion (`rebuild_levels_finalize` succeeds)
- **THEN** every row in `players` has `levels_stale = false`; the admin banner disappears

---

### Requirement: Date-reorder warning in match entry UI

The `LogMatch` and `EditMatchDialog` forms SHALL display a non-blocking inline warning when the user-entered `date` is older than the most recent confirmed match date for at least one participant. The warning SHALL communicate that saving will reorder match history and trigger a levels rebuild. Save MUST still proceed; the warning is informational.

#### Scenario: User backdates a match below their last-confirmed date
- **WHEN** the user picks a date older than at least one participant's most-recent-confirmed-match date
- **THEN** an inline warning appears below the date field; the submit button remains enabled

#### Scenario: User enters today's date with no prior history disruption
- **WHEN** the user picks a date >= every participant's most-recent-confirmed-match date
- **THEN** no warning is shown
