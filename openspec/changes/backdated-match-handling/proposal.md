## Why

Match `date` is the date the match was played and `recomputeAll` correctly sorts by `(date, id)`, so backdated entries are technically supported — but nothing in the system actually constrains the date or keeps caches honest when one is logged. A user can record a match dated before either player existed in the system (which breaks `starting_level`'s contract of "the level at `created_at`"), a match dated in the future, or a match slotted into the middle of either player's history that silently leaves every later match's persisted `level_*` / `provisional_*` columns stale until an admin remembers to run **Rebuild levels**. Today none of this is validated or signalled.

## What Changes

- Reject matches dated before `max(playerA.created_at, playerB.created_at)` or dated in the future, on the client (form-level error) and on the server (CHECK or trigger on `matches`).
- After any match insert/update/delete whose date is NOT strictly the latest for both participants, recompute levels for the affected players automatically — OR, if synchronous recompute is too expensive, set a `levels_stale = true` flag on the affected players and surface a "Levels need rebuild" admin banner. Decision deferred to design.md.
- Spec the invariant: persisted `level_*_before/after`, `delta_*`, `provisional_*` columns on `matches` MUST equal `recomputeAll` output. These are caches that the live-insert path was allowed to drift on; that drift is now a bug, not a feature.
- Tighten `rating/spec.md`: state that `players.starting_level` is the level at `players.created_at` and matches cannot be dated earlier.
- Tighten `match-recording/spec.md`: require the date validation rules above as a hard requirement.
- Document — do NOT fix — the retroactivity of `seeded_rating`. Add a spec note that toggling the flag rewrites every historical match's provisional flags on the next rebuild, and add a confirmation prompt to the admin **Edit profile** modal when toggling on a player with existing matches. (Effective-dated seeded_rating is a future change.)
- Add a UX warning in `LogMatch` and `EditMatchDialog` when the chosen date is older than at least one participant's most recent confirmed match: "this will reorder N matches and trigger a rebuild" — purely informational, save still proceeds.

No data migration required — existing matches are presumed valid; the new constraint applies to new writes only. If audit finds existing rows that violate `date >= player.created_at`, those are handled separately as a data fix.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `match-recording`: add date-validation requirement (date in `[max(players.created_at), today]`); add cache-coherence requirement (persisted level/provisional columns must equal recompute output after any match mutation).
- `rating`: tighten `starting_level` semantics to "level at `players.created_at`"; document that `seeded_rating` is applied as the current value across all historical matches and that toggling it is retroactive on next rebuild.

## Impact

- **Schema**: new CHECK constraint or BEFORE INSERT/UPDATE trigger on `matches.date`. Possibly a new `players.levels_stale boolean` column (design decision).
- **Server logic**: `matches_after_levels` (or a new trigger) extended to invoke `rebuild_levels_chunk` for affected players, or mark them stale.
- **Client**: `src/pages/LogMatch.tsx` and `src/components/EditMatchDialog.tsx` gain date validation + the reorder warning. `src/state/store.tsx` propagates server errors.
- **Admin UI**: `AdminEditProfileModal` adds a confirmation prompt when toggling `seeded_rating` on a player with match history. Admin dashboard surfaces a "levels stale" banner if the flag approach is chosen.
- **Specs**: deltas to `openspec/specs/match-recording/spec.md` and `openspec/specs/rating/spec.md`.
- **Out of scope**: effective-dated `seeded_rating`, retroactive correction of any existing pre-`created_at` matches in production data, changes to the rating formula itself.
