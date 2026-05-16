## MODIFIED Requirements

### Requirement: Level scale and starting level

A player's level SHALL be a positive number (`> 0`). New players SHALL start at a configurable `starting_level` (default `1000`). After any update, levels MUST be clamped to a minimum of `1`.

`starting_level` SHALL represent the player's level at `players.created_at`. The full recomputation walks match history forward from `starting_level` in `(date, id)` order; admitting any match dated earlier than `players.created_at` would treat `starting_level` as a mid-history checkpoint and is therefore disallowed (see `match-recording` for the enforcement trigger).

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

The `seeded_rating` flag, by contrast, is NOT date-aware: the recompute reads the player's *current* `seeded_rating` value and applies it uniformly to every match in their history. Toggling the flag is therefore **retroactive** — on the next rebuild, every historical match's `provisional_a/b` column is re-derived against the new flag value. The system intentionally does not track when the flag was set; effective-dated seeded ratings are a future capability, not a current one.

The `seeded_rating` flag SHALL be set during onboarding based on the
user's "Do you have a SquashLevels.com rating?" choice, persisted on
both `profiles` and `players` (the `sync_player_from_profile` AFTER
UPDATE trigger keeps them in sync), and respected by both the live
match-insert path and `rebuild_levels_chunk`. A global admin MAY
amend the flag for any profile via the **Edit profile (admin)** modal
on a player profile page — useful for backfilling players who
registered before the flag existed, or correcting an obvious onboarding
mis-pick. The admin modal SHALL display a confirmation prompt when the
flag is toggled on a player with at least one confirmed match, stating
that the next rebuild will rewrite historical provisional flags.
Toggling the flag does NOT automatically re-derive historical match
`provisional_a/b` columns; running **Admin → Rebuild levels** afterwards
is required to keep history consistent with the new flag value.

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
- **THEN** the modal first prompts for confirmation noting that this will rewrite historical provisional flags on the next rebuild; on confirm, `profiles.seeded_rating` flips to `true`, the `sync_player_from_profile` trigger mirrors it onto the linked players row, and the next match that user plays uses the new flag in its provisional computation. Historical `matches.provisional_a/b` flags are NOT automatically re-derived — the admin SHOULD run **Admin → Rebuild levels** afterwards to bring history in line with the new flag value.

#### Scenario: Provisional threshold reached mid-recompute
- **WHEN** during `recomputeAll`, player A (unseeded) crosses `provisionalThreshold` after match #5
- **THEN** match #5 is processed with A still treated as provisional (the count is read BEFORE the update); match #6 sees A as non-provisional

#### Scenario: Backdated match changes a later match's provisional status
- **WHEN** a backdated match is inserted that, when sorted into chronological order, pushes one participant past `provisionalThreshold` earlier in their history than before
- **THEN** the scoped rebuild (see `match-recording`) re-derives `provisional_a/b` on every affected match; the participant's later matches may flip from provisional to non-provisional or vice versa as a deterministic consequence of the new chronological position
