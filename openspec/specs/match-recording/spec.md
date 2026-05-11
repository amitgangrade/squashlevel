# match-recording Specification

## Purpose
TBD - created by archiving change seed-domain-specs. Update Purpose after archive.
## Requirements
### Requirement: Match data model

A match SHALL be a row in `public.matches` with:
- `id uuid` primary key.
- `date date NOT NULL` — the date the match was played (not the date it was recorded).
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

Direct UPDATE on `matches` by participants MUST be blocked (RLS); the only sanctioned state transitions for non-admins are via `confirm_match`. This prevents an opponent from silently rewriting a recorded score. See `auth-permissions` for the RLS specifics.

#### Scenario: Participant tries to fix a typo via UPDATE
- **WHEN** a non-admin participant runs `UPDATE matches SET games = ... WHERE id = ...`
- **THEN** RLS rejects the update; the participant must ask an admin or club admin to make the correction

