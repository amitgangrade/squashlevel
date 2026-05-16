# match-recording Specification

## Purpose
TBD - created by archiving change seed-domain-specs. Update Purpose after archive.
## Requirements
### Requirement: Match data model

A match SHALL be a row in `public.matches` with:
- `id uuid` primary key.
- `date date NOT NULL` — the date the match was played (not the date it was recorded). Constrained to `[max(players.created_at::date), current_date]` — see §Match date validation.
- `player_a_id`, `player_b_id` — non-null FK references to two distinct `players` rows.
- `games jsonb NOT NULL` — an ordered array of `{ a: int, b: int }` game scores; at least one game.
- `type text NOT NULL` — one of `friendly | box | league | tournament`.
- `status text NOT NULL` — one of `pending | confirmed | disputed`.
- `unranked boolean NOT NULL DEFAULT false` — when true, the match is recorded but excluded from rating updates.
- `auto_confirmed boolean NOT NULL DEFAULT false` — set true when the system (not the opponent) advanced the match to `confirmed`.
- Optional: `notes`, `venue`, `confirmed_at`, `disputed_at`, `created_by`, `created_at`.

#### Scenario: Recording a 3-game match
- **WHEN** a participant submits a match with `games = [{a:11,b:9},{a:9,b:11},{a:11,b:7}]`, `type = 'box'`
- **THEN** the row is inserted with `status = 'pending'` (unless an auto-confirm rule applies — see below)

#### Scenario: Insert with empty games array
- **WHEN** an insert is attempted with `games = []`
- **THEN** the insert is rejected (zod `min(1)` on the client; the JSON column trusts the client check)

---

### Requirement: Match lifecycle

A match SHALL transition between exactly these statuses:

```
                     ┌────────────┐
   (insert)──────────► pending    │
                     └─────┬──────┘
                           │
            ┌──────────────┼─────────────────┐
            ▼              ▼                 ▼
        confirmed      disputed         (stays pending
        (terminal)     (terminal)        until aged out)
```

The `pending → *` transitions SHALL be triggered by either: (a) the `matches_before_insert` trigger setting `status = 'confirmed'` at insert time per the auto-confirm rules, (b) the opponent (or a global admin) calling `confirm_match(id, dispute := false|true)`, or (c) the `auto_confirm_aged_matches()` job promoting matches older than 3 days to `confirmed` — *except* matches where either participant has `user_id IS NULL` (unclaimed), which are excluded from aging and require explicit global-admin confirmation via `confirm_match` instead.

Once a match reaches a terminal status (`confirmed` or `disputed`), it MUST NOT transition back to `pending`. Only a global admin or qualifying club admin (via direct UPDATE) MAY change a terminal match's status, and doing so SHALL be considered an admin correction, not a normal transition.

#### Scenario: Opponent confirms a pending match
- **WHEN** the participant who did NOT record the match calls `confirm_match(id, false)`
- **THEN** the match's `status` becomes `confirmed`, `confirmed_at = now()`, `auto_confirmed` stays false

#### Scenario: Opponent disputes a pending match
- **WHEN** the non-recorder participant calls `confirm_match(id, true)`
- **THEN** `status = 'disputed'`, `disputed_at = now()`

#### Scenario: Recorder tries to confirm their own match
- **WHEN** a non-admin user who created the match calls `confirm_match(...)` on it
- **THEN** the RPC raises `you cannot confirm a match you recorded`

#### Scenario: Non-participant tries to confirm
- **WHEN** a signed-in non-admin who owns neither participating player calls `confirm_match(...)`
- **THEN** the RPC raises `only a participant can confirm or dispute`

#### Scenario: Global admin confirms a match against an unclaimed player
- **WHEN** an admin calls `confirm_match(id, false)` for a pending match where one participant is an unclaimed player
- **THEN** the RPC accepts the call regardless of whether the admin recorded the match or is a participant; `status` becomes `confirmed`, `confirmed_at = now()`, `auto_confirmed` stays false (this is an explicit admin action, not an automatic one)

---

### Requirement: Auto-confirm rules

The `matches_before_insert` trigger SHALL automatically set `status = 'confirmed'`, `confirmed_at = now()`, `auto_confirmed = true` at insert time when any of:

1. The recorder (`new.created_by`) is a global admin (`is_admin(uid)` returns true). Admin authority is implicit.
2. The recorder owns one of the two participating players AND the recorder's side LOST (won fewer games). There is no incentive to fake your own loss, so opponent confirmation is unnecessary.

In all other cases the match SHALL remain `pending` until either the opponent acts or the 3-day aging job fires.

#### Scenario: Admin records a match
- **WHEN** an admin inserts any match
- **THEN** the trigger sets `status = 'confirmed'` and `auto_confirmed = true`

#### Scenario: Self-loss recorded
- **WHEN** a participant records a match where their own side won fewer games (e.g. they were `player_a` and `b_games > a_games`)
- **THEN** the trigger auto-confirms the match

#### Scenario: Self-win recorded
- **WHEN** a participant records a match where their own side won
- **THEN** the match stays `pending` and awaits opponent confirmation

#### Scenario: Recorder is not a participant
- **WHEN** a non-admin who isn't either participant inserts a match
- **THEN** RLS rejects the insert (see `auth-permissions`); the auto-confirm rules don't apply because no row is created

---

### Requirement: 3-day aging

The `auto_confirm_aged_matches()` SECURITY DEFINER function SHALL promote any match with `status = 'pending'` and `created_at < now() - interval '3 days'` to `confirmed`, setting `auto_confirmed = true` — **unless** either participant has `user_id IS NULL` (unclaimed), in which case the match is skipped (rationale: the unclaimed side has no account to confirm with, so a timer would let non-admin recorders push fake self-wins into the rating system; those matches are routed to admin confirmation instead). The function SHALL be idempotent (re-running it is safe and is a no-op if no aged eligible-pending matches exist) and SHALL return the count of rows updated.

Pending matches involving an unclaimed player MAY be retrieved by global admins via the `list_pending_unclaimed_matches_for_admin()` RPC, which returns the queue for the Activity "needs admin confirmation" section.

When `pg_cron` is available, the function SHALL be scheduled daily at `0 3 * * *` under the job name `boast-auto-confirm`. Where `pg_cron` is not available (e.g. local dev, Supabase Free), the dashboard MAY call the RPC at app load as a fallback.

#### Scenario: Aging promotes old pending matches
- **WHEN** `auto_confirm_aged_matches()` runs and there are 5 pending matches older than 3 days
- **THEN** all 5 become `confirmed` with `auto_confirmed = true`, and the function returns 5

#### Scenario: Aging is a no-op when nothing qualifies
- **WHEN** `auto_confirm_aged_matches()` runs with no pending matches older than 3 days
- **THEN** zero rows update and the function returns 0

#### Scenario: Aging skips matches with an unclaimed participant
- **WHEN** `auto_confirm_aged_matches()` runs and there are 3 aged pending matches, one of which has `player_b.user_id IS NULL`
- **THEN** the 2 fully-claimed matches are promoted to `confirmed`; the unclaimed-participant one stays `pending` and awaits a global-admin `confirm_match` call

---

### Requirement: Unranked matches

Setting `unranked = true` on a match SHALL cause it to be recorded for history (it remains visible in match feeds) but SHALL NOT contribute to either player's level. The rating recomputation MUST pass an unranked match through with `deltaA = deltaB = 0` and `levelAAfter = levelABefore`, `levelBAfter = levelBBefore`.

#### Scenario: Unranked match in recompute
- **WHEN** `recomputeAll(...)` encounters a match with `unranked = true`
- **THEN** the resulting enriched match has both deltas equal to 0 and both "after" levels equal to the pre-match levels

#### Scenario: Toggling unranked retroactively
- **WHEN** an admin updates an existing confirmed match to set `unranked = true`
- **THEN** a subsequent recompute will treat that match as zero-impact and re-derive every downstream player level accordingly

---

### Requirement: Match writes restricted to RPCs and admins for state changes

Direct UPDATE on `matches` by participants MUST be blocked (RLS); the only sanctioned state transitions for non-admins are via `confirm_match`. This prevents an opponent from silently rewriting a recorded score. Group admins MAY update or delete matches where both participants are members of a group they administer (see `auth-permissions` for the RLS specifics + the `is_group_admin_for_pair` predicate); the same predicate also extends the `confirm_match` override to group admins acting on within-group matches.

#### Scenario: Participant tries to fix a typo via UPDATE
- **WHEN** a non-admin participant runs `UPDATE matches SET games = ... WHERE id = ...`
- **THEN** RLS rejects the update; the participant must ask a global admin, a qualifying club admin, or a group admin of a group containing both players to make the correction

#### Scenario: Group admin confirms an internal group match
- **WHEN** a group admin (not a participant, not a global / club admin) calls `confirm_match(id)` for a match where both `player_a_id` and `player_b_id` are members of a group they administer
- **THEN** the RPC accepts the call (via `can_write_match` extended with `is_group_admin_for_pair`); `status` becomes `confirmed`, `confirmed_at = now()`, `auto_confirmed = false` (explicit admin action)

---

### Requirement: Match date validation

A match's `date` SHALL fall within the closed interval `[max(playerA.created_at::date, playerB.created_at::date), current_date]` at INSERT and UPDATE time. This range SHALL be enforced by:

1. A `BEFORE INSERT OR UPDATE` trigger on `public.matches` (`matches_validate_date`) that looks up `created_at` for both participants and raises an exception on violation.
2. Client-side form validation in `LogMatch` and `EditMatchDialog` that surfaces an inline error before submission.

Rationale: `players.starting_level` is defined as the player's level at `created_at` (see `rating` spec). Admitting matches dated earlier than `created_at` would treat that "starting level" as a mid-history checkpoint, contradicting its definition. Future-dated matches are nonsensical given that `matches.date` is the date the match was played.

The trigger SHALL be the authority; client validation is a UX courtesy. The trigger SHALL grandfather-allow UPDATEs whose `date` is unchanged (`tg_op = 'UPDATE' AND new.date = old.date`) so existing rows that violate the new rule can still be edited in non-date ways (e.g. fixing a score typo on a legacy row). Global admins MAY accommodate legitimate legacy imports by adjusting an affected player's `created_at` backward — there is no flag-gated bypass.

#### Scenario: Match dated before a participant joined
- **WHEN** a user attempts to insert a match dated `2024-01-01` where `player_a.created_at = '2024-06-01'`
- **THEN** the trigger raises an exception (`match date precedes participant's created_at`); no row is written

#### Scenario: Match dated in the future
- **WHEN** a user attempts to insert a match where `date > current_date`
- **THEN** the trigger raises an exception (`match date is in the future`); no row is written

#### Scenario: Match dated exactly on a participant's join date
- **WHEN** a user inserts a match where `date = max(playerA.created_at::date, playerB.created_at::date)`
- **THEN** the insert succeeds; the boundary is inclusive

#### Scenario: Grandfather: editing a legacy row without changing date
- **WHEN** an admin updates a legacy match (whose `date` predates `players.created_at`) without changing `new.date` (e.g. fixing the games array)
- **THEN** the trigger skips the check and the UPDATE succeeds

#### Scenario: Admin adjusts created_at to admit a legacy import
- **WHEN** a global admin sets `players.created_at` to an earlier date and then inserts a match dated after the new `created_at`
- **THEN** the trigger accepts the insert; the admin has explicitly enlarged the player's validity window

---

### Requirement: Persisted match level columns must equal recompute output (admin-gated for backdated mutations)

After a full `recomputeAll(players, matches, settings)` run, the persisted `level_a_before`, `level_a_after`, `level_b_before`, `level_b_after`, `delta_a`, `delta_b`, `provisional_a`, and `provisional_b` columns on every confirmed, non-unranked match SHALL equal the recompute output. These columns are caches of canonical recompute output, not independent state.

Between recompute runs, the persisted columns MAY be stale when a match is inserted, updated, or deleted with a `date` that is NOT strictly the latest confirmed-match date for both participants — the live incremental insert path computes deltas against the live `players.current_level` and does not re-derive prior or subsequent matches. To signal this drift:

1. The system SHALL maintain a `players.levels_stale boolean not null default false` column.
2. An `AFTER INSERT OR UPDATE OR DELETE` trigger on `matches` (`matches_after_date_reorder`) SHALL set `levels_stale = true` for `player_a_id` and `player_b_id` whenever the mutation's effective date is not strictly the latest confirmed-match date for both participants (or when the mutation is a DELETE of a non-latest confirmed match).
3. The admin "Rebuild levels" surface SHALL display a banner with the count of players where `levels_stale = true`.
4. `rebuild_levels_finalize()` SHALL set `levels_stale = false` for every row in `players` on completion.

Rationale: a correct synchronous recompute after a backdated mutation would have to walk transitive opponents of the affected players (player A's level shift changes the formula's input for every match A is in, which changes the post-match level for A's opponent C in those matches, which then drifts every match C plays subsequently — full transitive closure). This is effectively a full rebuild, which is too expensive to run on every insert. The stale-flag pattern lets the rating engine continue accepting live writes while giving administrators a clear, actionable signal to run the (already-chunked, admin-gated) full rebuild.

#### Scenario: Backdated insert in the middle of history flags both participants
- **WHEN** a confirmed, ranked match dated `2026-03-01` is inserted while either participant already has a confirmed match dated after `2026-03-01`
- **THEN** the AFTER trigger sets `levels_stale = true` for both `player_a_id` and `player_b_id`

#### Scenario: Latest-date insert does not flag staleness
- **WHEN** a match is inserted with `date >= max(date)` over both participants' confirmed-match history
- **THEN** the AFTER trigger leaves `levels_stale` unchanged; the live incremental update is canonical for this position

#### Scenario: Match deletion mid-history flags staleness
- **WHEN** a confirmed, ranked match is DELETEd and other confirmed matches with later dates exist for either participant
- **THEN** the AFTER trigger sets `levels_stale = true` for both former participants

#### Scenario: Pending and unranked mutations do not flag staleness
- **WHEN** an unranked match or a pending (unconfirmed) match is inserted/updated
- **THEN** the AFTER trigger leaves `levels_stale` unchanged (these rows do not contribute to rating history)

#### Scenario: Admin rebuild clears the stale flag
- **WHEN** an admin runs **Rebuild levels** through completion (`rebuild_levels_finalize` succeeds)
- **THEN** every row in `players` has `levels_stale = false`

---

### Requirement: Date-reorder warning in match entry UI

The `LogMatch` and `EditMatchDialog` forms SHALL display a non-blocking inline warning when the user-entered `date` is older than the most recent confirmed match date for at least one participant. The warning SHALL communicate that saving will reorder match history and trigger a levels rebuild. Save MUST still proceed; the warning is informational.

The forms SHALL also set the date input's `min` to `max(playerA.createdAt::date, playerB.createdAt::date)` and `max` to today, and SHALL surface an inline error (not a toast) when submission would violate the floor or ceiling — letting the user correct the date in place.

#### Scenario: User backdates a match below their last-confirmed date
- **WHEN** the user picks a date older than at least one participant's most-recent-confirmed-match date but still within the valid range
- **THEN** an inline amber warning appears below the date field; the submit button remains enabled

#### Scenario: User picks a date earlier than a participant's created_at
- **WHEN** the user picks a date earlier than `max(playerA.createdAt::date, playerB.createdAt::date)`
- **THEN** an inline red error appears under the date input AND the form's submit handler refuses to call `addMatch` / `updateMatch` until the date is corrected

#### Scenario: User enters today's date with no prior history disruption
- **WHEN** the user picks a date >= every participant's most-recent-confirmed-match date
- **THEN** no warning is shown

