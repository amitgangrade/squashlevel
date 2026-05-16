## Context

The rating engine sorts matches by `(date asc, id asc)` everywhere it matters: [`recomputeAll`](../../../src/lib/rating/recompute.ts#L32-L35), [`rebuild_levels_chunk`](../../../supabase/schema.sql#L960-L1099). `matches.date` is documented in [match-recording/spec.md:10](../../specs/match-recording/spec.md) as "the date the match was played (not the date it was recorded)". Backdating is therefore a first-class concept *in recompute*.

What is missing today:

1. **No date validation** anywhere. `matches.date date not null` has no CHECK. `LogMatch.tsx:446` and `EditMatchDialog.tsx:109` are plain `<input type="date">` with no min/max. A user can record a match dated 1900-01-01 or 2099-01-01 — both are accepted.
2. **`starting_level` semantics are violated by pre-`created_at` matches.** The recompute seeds every player at `startingLevel` and processes matches forward; a match dated before `created_at` is therefore evaluated as that player's first match against their starting level, which contradicts the intent of `starting_level` (an estimate of their level at the time they joined).
3. **The live-insert path computes incrementally** against the player's *current* level ([`store.addMatch`](../../../src/state/store.tsx#L432-L518) and the [`matches_after_levels` trigger](../../../supabase/schema.sql#L567-L656)). A backdated insert is processed as if it were the latest match — the persisted `level_*_before/after`, `delta_*`, `provisional_*` columns on that row, and on every later match, are then wrong until an admin runs **Rebuild levels**.
4. **`seeded_rating` is the player's *current* flag** ([`isProvisional`](../../../src/lib/rating/levels.ts#L14-L20)), applied uniformly to every historical match during rebuild. Toggling it silently rewrites the past. The spec acknowledges the rebuild step but doesn't call out the retroactivity.

The provisional `matchesPlayed` check IS already date-aware in recompute (`matchesPlayed` is iteration-local, [recompute.ts:100-101](../../../src/lib/rating/recompute.ts#L100)), so we do not need to redesign provisional logic. The fix is about input validation and cache coherence, not about the math.

## Goals / Non-Goals

**Goals:**

- Make backdating a *supported and validated* path: dates must fall in `[max(playerA.created_at, playerB.created_at), today]`, enforced on both client and server.
- After any match mutation whose date is not the latest for both participants, guarantee that the persisted `level_*` / `provisional_*` columns on every affected match equal the `recomputeAll` output.
- Lock down the contract for `starting_level` and the retroactivity of `seeded_rating` in the specs so future contributors don't have to re-derive it.
- Surface a non-blocking UI warning when a user is about to reorder history.

**Non-Goals:**

- Effective-dated `seeded_rating` (e.g., `seeded_rating_set_at`). Documented as a known limitation; deferred to a future change.
- Changes to the rating formula or the provisional threshold.
- Migration of any existing rows that may already violate the date constraints. If audit reveals violations, they're a separate data fix.
- Allowing matches to be dated before *one* player's `created_at` but after the other's (e.g., "I played him before I had an account here"). Could be revisited if requested; out of scope here.

## Decisions

### Decision 1: Date validation lives at both client and server, with the server as the authority

- **What**: client form-level validation (HTML5 `min`/`max` plus an explicit error on submit) AND a `BEFORE INSERT OR UPDATE` trigger on `matches` that re-validates. The trigger looks up both players' `created_at` and rejects on violation.
- **Why a trigger, not a `CHECK` constraint**: a `CHECK` cannot reference another table. The constraint must compare `matches.date` to `players.created_at` for both `player_a_id` and `player_b_id`, so it needs a trigger (or, less idiomatically, a generated column + CHECK — uglier).
- **Why not RLS / app-only**: live inserts go through Supabase clients with permissive write paths for match owners; trusting the client is exactly the gap we're closing. The trigger is the line of defense.
- **Alternatives considered**:
  - `CHECK (date <= current_date)` for the future-date half only — partially addresses the problem, but rejects nothing about the past, so we'd still need the trigger. Skip the half-measure.
  - Allow pre-`created_at` matches and just synthesize a synthetic `starting_level` from them. Rejected: makes `starting_level` lose its meaning and forces every consumer of `starting_level` to know about it.

### Decision 2: Cache coherence — stale-flag + admin-driven full rebuild (v1)

**Updated 2026-05-14 during implementation.** The original plan was synchronous scoped recompute over the two participants. On closer analysis the scoped approach isn't actually correct: when player A's level changes due to a backdated match, every match where A is a participant has a different post-update for A's *opponent* too (the formula depends on A's pre-match level). That cascades transitively through the opponent's later matches. A correct recompute is therefore effectively a full recompute, which is too expensive to run synchronously on every insert.

- **What v1 does**: add `players.levels_stale boolean default false`. The `AFTER INSERT OR UPDATE OR DELETE` trigger on `matches` sets `levels_stale = true` for both `player_a_id` and `player_b_id` whenever the mutation is NOT strictly the latest-dated confirmed match for both participants. The admin dashboard / Rebuild page surfaces "N players need rebuild" so an admin can run **Admin → Rebuild levels** at their convenience. `rebuild_levels_finalize` clears the flag for every player when it completes.
- **Trade-off accepted**: persisted `level_*` / `provisional_*` columns on the inserted-and-later matches stay stale until an admin clicks Rebuild. The leaderboard's `players.current_level` also stays at whatever the live-incremental path computed (i.e., as if the backdated match were the latest). This is the same staleness that exists *today* after any backdated edit — but now we have an explicit signal admins can act on, instead of silent drift.
- **Why not synchronous full rebuild on the trigger path**: full rebuild iterates all confirmed matches, can take many seconds at scale, and the existing function is admin-gated (`if not is_admin then raise`) — calling it from a regular user's INSERT path would either need privilege elevation or a forked SECURITY DEFINER copy. Both add surface area; neither closes the transitivity gap better than admin-driven rebuild does.
- **Future improvement**: a properly-correct scoped recompute (or background job that runs full rebuild automatically when `levels_stale` rows exist) is a clean follow-up change. Keeping it out of v1 keeps this change small and reversible.
- **Alternatives considered**:
  - Synchronous scoped recompute over two participants. Rejected — incorrect transitively (see preamble).
  - Synchronous full rebuild on trigger. Rejected — performance and privilege concerns above.
  - Background async job (pg_cron + check for stale rows). Reasonable next step; deferred so v1 ships without depending on `pg_cron` availability.

### Decision 3: `seeded_rating` retroactivity — document, warn, don't fix

- **What**: spec update calling out that `seeded_rating` is read as the player's *current* flag at recompute time and is therefore retroactive on rebuild. UI confirmation modal when an admin toggles the flag on a player with ≥1 confirmed match: "this will change historical provisional flags on N matches when levels are next rebuilt".
- **Why not effective-dated**: requires a new schema (either `seeded_rating_set_at` on `players`/`profiles`, or a separate `seeded_rating_events` table), changes the recompute signature, and is meaningful only if the flag is expected to change after history accumulates. Today the flag is set at onboarding and rarely toggled. The cost outweighs the benefit until we see a real use case.
- **Alternatives considered**:
  - Add `seeded_rating_set_at timestamptz null`. Lightweight but introduces a "before this date, treat as unseeded" rule that has to land in two implementations (TS + plpgsql) and creates a four-way matrix (current flag × historical flag) that's easy to get wrong.
  - Event-sourced flag changes. Too much for the actual frequency of toggles.

### Decision 4: UI warning, not UI block

- **What**: in `LogMatch` and `EditMatchDialog`, when the chosen `date` is older than at least one participant's most recent confirmed match, show inline text ("This will reorder N matches; levels will be rebuilt on save") below the date field. Save still proceeds.
- **Why not block**: backdating is the legitimate use case we're enabling. Blocking would defeat the purpose. The warning exists so users aren't surprised when their dashboard changes.

## Risks / Trade-offs

- **Risk**: Synchronous trigger recompute slows down match inserts measurably for players with long histories. **Mitigation**: scoped recompute is bounded by the player's own match count, which is small in practice (typical league player has <500 lifetime matches; chunked rebuild handles 100K+ in batches). Measure on staging; if a single match's recompute exceeds ~1s, fall back to the stale-flag path for that mutation and surface it in the admin banner.
- **Risk**: Trigger errors (e.g., recompute throws) leave the live-insert path in a half-updated state — match row written, levels not propagated. **Mitigation**: the recompute runs inside the same transaction as the INSERT; if it fails, the entire mutation rolls back. Set `players.levels_stale = true` as a defense-in-depth signal if the trigger swallows a partial failure.
- **Risk**: The date-validation trigger refuses inserts an admin legitimately wants to make (e.g., importing legacy data dated before this app existed). **Mitigation**: leave a documented escape hatch — admins can adjust `players.created_at` backward to admit the historical range. Cleaner than a flag-gated bypass.
- **Risk**: Drift between TS `recomputeAll` and plpgsql `rebuild_levels_chunk` becomes more painful now that the trigger calls into the plpgsql path on every mutation. **Mitigation**: out of scope for this change, but worth flagging — a contract test that runs both implementations over the same fixture and diffs outputs is the right long-term answer. Track in a follow-up.
- **Trade-off**: Documented (not fixed) `seeded_rating` retroactivity means a future toggle still rewrites history. Accepted because the alternative is a much larger refactor. The confirmation modal mitigates the surprise.
- **Trade-off**: We do not transitively re-derive opponents' historical match snapshots on backdated inserts (decision 2 scope). Opponents' `current_level` stays correct because it's derived from their own match history (which the trigger does re-walk where applicable), but a participant's historical snapshot of *their own opponents' levels at the time* can drift. Accepted: the canonical answer is always `recomputeAll`, and the admin "Rebuild levels" button does a full rebuild any time someone is concerned.

## Migration Plan

1. Ship schema changes (trigger, optional `levels_stale` column) behind a Supabase migration. No data backfill required for new rules — they apply going forward.
2. Audit existing `matches` rows for violations of `date >= max(players.created_at)` and `date <= current_date`. Report counts; if non-zero, decide whether to fix data or grandfather (probably grandfather by skipping the trigger's check via a `created_at <` cutoff or temporarily disabling the trigger for the migration window).
3. Ship client changes (validation + warning copy) in the same release as the schema.
4. Roll out admin-modal confirmation for `seeded_rating` toggles independently — purely additive.
5. **Rollback**: drop the trigger; revert the client changes. No data is created by this change that needs cleanup.

## Open Questions

- Do we need a per-match-type cutoff (e.g., friendlies can be backdated, tournaments cannot)? Not raised; assume no.
- Should the warning in `LogMatch` show the actual count of matches that will be reordered, or just a qualitative warning? Lean qualitative — counting requires a query per keystroke. Re-evaluate once the warning is in.
- Should admin-edited matches (the higher-privilege path in `EditMatchDialog`) bypass the date floor entirely? Probably yes for global admin only — call out in spec if so.
