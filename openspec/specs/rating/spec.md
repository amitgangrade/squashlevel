# rating Specification

## Purpose
TBD - created by archiving change seed-domain-specs. Update Purpose after archive.
## Requirements
### Requirement: Level scale and starting level

A player's level SHALL be a positive number (`> 0`). New players SHALL start at a configurable `starting_level` (default `1000`). After any update, levels MUST be clamped to a minimum of `1`.

`starting_level` SHALL represent the player's level at `players.created_at`. The full recomputation walks match history forward from `starting_level` in `(date, id)` order; admitting any match dated earlier than `players.created_at` would treat `starting_level` as a mid-history checkpoint and is therefore disallowed (see `match-recording` §Match date validation for the enforcement trigger).

For seeded players (`seeded_rating = true`), `starting_level` SHOULD be set during onboarding from the user's reported SquashLevels.com / LevelTech rating; for unseeded players it defaults to the system-wide configured value.

#### Scenario: Default starting level
- **WHEN** a new player row is inserted without an explicit `starting_level`
- **THEN** `starting_level = 1000`

#### Scenario: Floor clamp after a heavy loss
- **WHEN** a level update would drop a player's level below 1
- **THEN** the resulting level is set to exactly 1

#### Scenario: starting_level is anchored at created_at
- **WHEN** a recompute runs over a player's match history
- **THEN** the player begins the iteration at `starting_level`, and every match processed is dated `>= players.created_at` (enforced by the match-date validation trigger)

---

### Requirement: Expected performance is a sigmoid blend of points and games ratios

For two players A and B with levels `lA, lB` and configurable settings, expected performance SHALL be defined as:

```
expectedPointsRatio = sigmoid(lA / lB, settings.pointsExponent)
expectedGamesRatio  = sigmoid(lA / lB, settings.gamesExponent)
expectedPerformance = settings.pointsWeight * expectedPointsRatio
                    + (1 - settings.pointsWeight) * expectedGamesRatio
```

where `sigmoid(r, n) = r^n / (r^n + 1)`. The `pointsExponent` and `gamesExponent` SHALL be positive; `pointsWeight ∈ [0, 1]`. Defaults: `pointsExponent = 2`, `gamesExponent = 5`, `pointsWeight = 0.5`.

#### Scenario: Equal levels
- **WHEN** `lA = lB`
- **THEN** `expectedPerformance = 0.5` regardless of exponents (because `1^n = 1` and `1/(1+1) = 0.5`)

#### Scenario: Higher exponent makes games ratio more decisive
- **WHEN** `lA / lB = 1.2` and `gamesExponent` is increased from 5 to 10
- **THEN** `expectedGamesRatio` rises further toward 1.0 (the higher exponent makes the dominant player expected to take MORE of the games)

---

### Requirement: Actual performance mirrors expected performance

Given a match's `games`, `actualPerformance` SHALL be defined as:

```
pointsRatio(games) = sum(g.a) / sum(g.a + g.b)         // 0.5 if total = 0
gamesRatio(games)  = (#games where a > b) / (#decisive games)   // 0.5 if no decisive game
actualPerformance  = settings.pointsWeight * pointsRatio + (1 - settings.pointsWeight) * gamesRatio
```

Tied games (`g.a === g.b`) SHALL NOT count toward `gamesRatio`'s denominator. When all games are tied, `gamesRatio` defaults to `0.5`.

#### Scenario: Clean 3-0 sweep
- **WHEN** `games = [{a:11,b:0},{a:11,b:0},{a:11,b:0}]`
- **THEN** `pointsRatio = 1.0`, `gamesRatio = 1.0`, `actualPerformance = 1.0`

#### Scenario: All ties (degenerate)
- **WHEN** every game has `a === b`
- **THEN** `gamesRatio = 0.5`, `pointsRatio` reflects total points, `actualPerformance` blends them

---

### Requirement: Level update formula

After a match between A (level `lA`) and B (level `lB`), the post-match levels SHALL be computed as:

```
delta  = actualPerformance - expectedPerformance
weight = MATCH_TYPE_WEIGHT[matchType]   // friendly 0.7, box 1.0, league 1.3, tournament 1.6
change = settings.dampingK * weight * delta
lA'    = clamp_min_1( lA * (1 + change) )
lB'    = clamp_min_1( lB * (1 - change) )
```

Default `dampingK = 0.12`. The update SHALL be **multiplicative on level**, not additive — large changes scale with the player's current level. Players SHALL move in opposite directions by equal proportional amounts before the floor clamp.

#### Scenario: Match-type weight scales the delta
- **WHEN** the same scoreline is logged as a `tournament` versus a `friendly`
- **THEN** the absolute level change in the tournament case is `1.6 / 0.7 ≈ 2.29×` the friendly case (before clamping)

#### Scenario: Damping parameter halves changes
- **WHEN** `dampingK` is reduced from 0.12 to 0.06 with all else equal
- **THEN** every level change is exactly halved (before clamping)

---

### Requirement: Provisional players

A player SHALL be considered **provisional** when BOTH of these hold:
1. `matchesPlayed < settings.provisionalThreshold` (default 5), AND
2. `seededRating` is FALSE — i.e. they did NOT register with an explicit
   SquashLevels.com / LevelTech rating.

Seeded players (registered with an explicit external rating) are
**never provisional** — their starting level is already trustworthy, so
they participate in symmetric level updates from match 1.

When exactly one of the two players is provisional, the non-provisional player's level MUST NOT change for that match — only the provisional player's level updates. This protects established players from rating noise while a newcomer's level is still finding its true value.

When both players are provisional, both levels update normally.

The `matchesPlayed` half of the rule IS date-aware: during `recomputeAll`, it is the count of earlier matches in `(date, id)` order — so a player's provisional status at the time of any given match reflects how much history existed before it, not their current total.

The `seeded_rating` flag, by contrast, is NOT date-aware: the recompute reads the player's *current* `seeded_rating` value and applies it uniformly to every match in their history. Toggling the flag is therefore **retroactive** — on the next rebuild, every historical match's `provisional_a/b` column is re-derived against the new flag value. The system intentionally does not track when the flag was set; effective-dated seeded ratings are a future capability.

The `seeded_rating` flag SHALL be set during onboarding based on the
user's "Do you have a SquashLevels.com rating?" choice, persisted on
both `profiles` and `players` (the `sync_player_from_profile` AFTER
UPDATE trigger keeps them in sync), and respected by both the live
match-insert path and `rebuild_levels_chunk`. A global admin MAY
amend the flag for any profile via the **Edit profile (admin)** modal
on a player profile page — useful for backfilling players who
registered before the flag existed, or correcting an obvious onboarding
mis-pick. The admin modal SHALL require an explicit acknowledgement
("I understand this rewrites history") when the toggle is changed on a
player with `matchesPlayed > 0`, before allowing save. Toggling the flag
does NOT automatically re-derive historical match `provisional_a/b`
columns; running **Admin → Rebuild levels** afterwards is required to
keep history consistent with the new flag.

#### Scenario: Unseeded newcomer plays an established player
- **WHEN** A has `matchesPlayed < provisionalThreshold` and `seededRating = false`, and B has `matchesPlayed >= provisionalThreshold`
- **THEN** after the match A's level updates per the formula but B's level is unchanged (A is provisional, B is not)

#### Scenario: Seeded player from match 1
- **WHEN** a brand-new player has `matchesPlayed = 0` but `seededRating = true` (they entered their SquashLevels rating at signup), and they play any opponent
- **THEN** both players' levels update symmetrically — the seeded player is NOT treated as provisional, so neither side's level is locked on that account

#### Scenario: Both provisional (both unseeded, both under threshold)
- **WHEN** both players have `matchesPlayed < provisionalThreshold` and `seededRating = false`
- **THEN** both levels update normally

#### Scenario: Stub claimed at signup inherits the user's seeded choice
- **WHEN** an unclaimed stub (created via `create_unclaimed_player`, `seeded_rating = false`) is claimed by a real signup whose profile has `seeded_rating = true`
- **THEN** `ensure_player_for_profile` overwrites the claimed player's `seeded_rating` with the profile's value (TRUE), so the user is non-provisional from their next confirmed match

#### Scenario: Admin backfills seeded_rating for a pre-existing player
- **WHEN** a global admin opens the **Edit profile (admin)** modal for a user who registered before the flag existed, ticks "Seeded rating (skip provisional)", and saves
- **THEN** if the linked player has `matches_played > 0` the modal requires an explicit "I understand this rewrites history" acknowledgement before save proceeds; on save, `profiles.seeded_rating` flips to `true`, the `sync_player_from_profile` trigger mirrors it onto the linked players row, and the next match that user plays uses the new flag in its provisional computation. Historical `matches.provisional_a/b` flags are NOT automatically re-derived — the admin SHOULD run **Admin → Rebuild levels** afterwards to bring history in line with the new flag value.

#### Scenario: Provisional threshold reached mid-recompute
- **WHEN** during `recomputeAll`, player A (unseeded) crosses `provisionalThreshold` after match #5
- **THEN** match #5 is processed with A still treated as provisional (the count is read BEFORE the update); match #6 sees A as non-provisional

#### Scenario: Backdated match changes a later match's provisional status
- **WHEN** a backdated match is inserted that, when sorted into chronological order, pushes one participant past `provisionalThreshold` earlier in their history than before
- **THEN** the next full rebuild re-derives `provisional_a/b` on every affected match; the participant's later matches may flip from provisional to non-provisional or vice versa as a deterministic consequence of the new chronological position

---

### Requirement: Full recomputation is the source of truth

The canonical level for any player at any point in time SHALL be derived by `recomputeAll(players, matches, settings)`, which:

1. Initializes every player at their `startingLevel`.
2. Sorts matches by `(date, id)` ascending — date primary, id as a stable tiebreaker.
3. For each match, reads pre-match levels and provisional flags, computes the update, writes `levelABefore/levelBBefore/levelAAfter/levelBAfter/deltaA/deltaB/provisionalA/provisionalB` onto the enriched match, advances each player's `currentLevel` and `matchesPlayed`, and pushes a history entry.
4. Treats `unranked` matches as zero-impact pass-throughs (see `match-recording`).

The function MUST be deterministic for a given `(players, matches, settings)` triple. Persisted level fields on `matches` (if any) are derived caches — the recompute output is authoritative and SHALL be re-derived rather than trusted from storage.

#### Scenario: Reordering matches by date
- **WHEN** `recomputeAll` runs over a set of matches whose insertion order differs from chronological order
- **THEN** results match the chronological-order computation; insertion order does not affect outcomes

#### Scenario: A player has no matches
- **WHEN** a player exists but has played zero matches
- **THEN** their resulting `currentLevel` equals their `startingLevel` and their history has exactly one entry (the `'start'` marker)

---

### Requirement: Moving-average smoothing for display

The `movingAverage(history, window)` helper SHALL return the simple mean of the last `window` level entries (or all of them if there are fewer than `window`). Default `movingAverageWindow = 4`. This is a display-time smoothing aid and MUST NOT be used as input to the level-update formula.

#### Scenario: Smoothing the leaderboard's headline number
- **WHEN** the UI renders a player's "trend level" using `movingAverage(history, 4)`
- **THEN** the displayed number is the mean of the player's last four post-match levels (or all entries if fewer than four)

