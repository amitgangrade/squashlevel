## 1. Pre-flight audit

- [ ] 1.1 Run a one-off query on production to count `matches` rows where `date < (select created_at::date from players where id = player_a_id)` OR same for `player_b_id` OR `date > current_date`. Record counts in this change folder as `audit.md` before adding the trigger.
- [ ] 1.2 Decide per-case how to handle any pre-existing violators: data fix, adjust `players.created_at` backward, or grandfather via trigger cutoff. Document the decision in `audit.md`.

> **Status**: audit query is captured in [audit.md](audit.md); both checkboxes wait on a human running the query against production. The grandfather guard (`tg_op='UPDATE' AND new.date=old.date`) is included unconditionally as a safety net — see migration `2026-05-14-backdated-match-handling.sql` — so even if pre-existing violators exist, score-typo fixes on legacy rows still work.

## 2. Schema: date validation trigger

- [x] 2.1 Add migration `supabase/migrations/2026-05-14-backdated-match-handling.sql` defining `matches_validate_date()` as a `BEFORE INSERT OR UPDATE` trigger on `public.matches`.
- [x] 2.2 Trigger logic: looks up `created_at::date` for both `new.player_a_id` and `new.player_b_id`; raises `match date precedes participant's created_at` if `new.date < greatest(...)`; raises `match date is in the future` if `new.date > current_date`.
- [x] 2.3 Grandfather guard: skips the check when `tg_op = 'UPDATE' AND new.date = old.date` (included by default; permits non-date edits on legacy rows regardless of audit outcome).
- [x] 2.4 `supabase/schema.sql` updated to mirror the migration.

## 3. Schema: levels_stale flag and AFTER-trigger staleness signal

- [x] 3.1 Added `players.levels_stale boolean not null default false` in the same migration as section 2.
- [x] 3.2 Added `matches_after_date_reorder` AFTER INSERT/UPDATE/DELETE trigger that sets `levels_stale = true` on both participants when the mutation is NOT strictly the latest confirmed-match date for both. **Implementation deviation from design.md** — does not run a scoped recompute (see design.md Decision 2 update for why; transitive correctness makes scoped recompute infeasible). The proper synchronous recompute is a future improvement.
- [ ] 3.3 ~~Implement `rebuild_levels_for_players(p_ids uuid[])`~~ **Deferred** — not built in v1 (see 3.2). The full admin Rebuild Levels is the canonical resolver.
- [ ] 3.4 ~~On any failure ensure mutation rolls back~~ **Deferred** with 3.3.
- [x] 3.5 `rebuild_levels_finalize()` patched to clear `levels_stale = false` for every player on completion.

## 4. Server: trigger responsibility split + comments

- [x] 4.1 `matches_after_levels` audited — confirmed it only does incremental delta bookkeeping. Correct for latest-dated inserts; defers history-reordering correctness to the new AFTER trigger / admin Rebuild.
- [x] 4.2 Comment block in `schema.sql` near both triggers documents the split of responsibility.

## 5. Client: date validation

- [x] 5.1 `src/pages/LogMatch.tsx` derives `dateFloor = max(playerA.createdAt::date, playerB.createdAt::date)` and `today = todayIso()`; sets `<input type="date" min={dateFloor} max={today}>`; rejects out-of-range dates in `onSubmit` with an inline error.
- [x] 5.2 `src/components/EditMatchDialog.tsx` mirrors the same `min`/`max` and validation, reading `recomputed` from the store.
- [x] 5.3 Errors surface inline under the date field (not as a toast).

## 6. Client: reorder warning

- [x] 6.1 Inline amber warning under the date field in both `LogMatch` and `EditMatchDialog` when the chosen date is older than either participant's most-recent-confirmed-match date; submit remains enabled.
- [x] 6.2 Qualitative warning — no per-keystroke count query.

## 7. Admin: seeded_rating retroactivity confirmation

- [x] 7.1 `AdminEditProfileModal` shows an inline "I understand this rewrites history" acknowledgement when the user toggles `seeded_rating` AND the linked player has `matches_played > 0`. Save is blocked with an inline error until the box is ticked.
- [ ] 7.2 ~~Follow-up nudge in success toast~~ **Re-scoped** — the inline acknowledgement already names the next step (Admin → Rebuild levels). Re-adding it as a post-save toast would require new infra (the modal currently closes silently on success). Skipped.

## 8. Specs and docs

- [x] 8.1 Spec deltas applied to `openspec/specs/match-recording/spec.md` (3 new requirements: date validation, persisted-columns invariant, reorder-warning UI) and `openspec/specs/rating/spec.md` (modified starting_level + Provisional players requirements; new backdated-match scenario).
- [x] 8.2 `ARCHITECTURE.md` server-side notes section updated with the four-trigger table.
- [x] 8.3 `AGENTS.md` updated: seeded_rating retroactivity callout added; new "Match dates" section.

## 9. Tests

- [ ] 9.1 ~~SQL test: insert pre-`created_at` match~~ **Deferred** — no pgTAP / SQL test harness in this repo. Covered by manual smoke-test 10.2 and by the migration's idempotent re-run on staging.
- [ ] 9.2 ~~SQL test: insert future-dated match~~ **Deferred** — same reason as 9.1.
- [x] 9.3 `src/lib/rating/__tests__/backdated.test.ts` proves `recomputeAll` is insertion-order-independent and that a backdated insert deterministically shifts downstream snapshots — confirms the invariant that running Rebuild Levels after a staleness flag resolves everything to canonical state.
- [ ] 9.4 ~~Component test for `LogMatch` warning~~ **Deferred** — no component-test infrastructure in this repo (`__tests__` are pure-function only; the page imports the whole store + supabase client + router). Setting up RTL for this single test is larger than the test it would enable. Covered by manual smoke-test 10.2.
- [ ] 9.5 ~~Component test for admin modal acknowledgement~~ **Deferred** — same reason as 9.4. Covered by manual smoke-test 10.2.

## 10. Rollout (human-driven; waiting on you)

- [ ] 10.1 Run audit query (see `audit.md`) on production. If `pre_a_count`, `pre_b_count`, or `future_count` are non-zero, decide whether to fix data or rely on the grandfather guard, and record in `audit.md`.
- [ ] 10.2 Land the migration on staging. Smoke-test five flows manually:
  1. Today's match (no warning, accepts).
  2. Backdated within window (amber warning, accepts, `players.levels_stale=true` after for both participants).
  3. Pre-`created_at` (red error, server trigger rejects).
  4. Future-dated (red error, server trigger rejects).
  5. Admin toggles `seeded_rating` on a played player → acknowledgement required → save → flag persists on `players.seeded_rating` → running Admin → Rebuild levels clears `levels_stale`.
- [ ] 10.3 Promote to production with the client changes in the same release so users never see a stricter server with the old client.
