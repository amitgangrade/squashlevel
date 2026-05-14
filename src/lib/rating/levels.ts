import type { GameScore, Settings } from '../../types'

/**
 * Provisional rule (per openspec/specs/rating/spec.md §Provisional):
 *   - Seeded players (registered with an explicit SquashLevels.com /
 *     LevelTech rating) bypass provisional from match 1 — their level
 *     is already trustworthy.
 *   - Everyone else is provisional until `matchesPlayed` reaches the
 *     `provisionalThreshold`.
 *
 * Use this helper everywhere a "is X provisional" check is needed, so
 * the rule stays in one place if it changes.
 */
export function isProvisional(
  p: { matchesPlayed?: number | null; seededRating?: boolean | null },
  settings: { provisionalThreshold: number },
): boolean {
  if (p.seededRating) return false
  return (p.matchesPlayed ?? 0) < settings.provisionalThreshold
}


export function pointsRatio(games: GameScore[]): number {
  let a = 0
  let b = 0
  for (const g of games) {
    a += g.a
    b += g.b
  }
  const total = a + b
  if (total === 0) return 0.5
  return a / total
}

export function gamesRatio(games: GameScore[]): number {
  let aWins = 0
  let played = 0
  for (const g of games) {
    if (g.a === g.b) continue
    played += 1
    if (g.a > g.b) aWins += 1
  }
  if (played === 0) return 0.5
  return aWins / played
}

export function gamesWonBy(games: GameScore[], side: 'a' | 'b'): number {
  let wins = 0
  for (const g of games) {
    if (side === 'a' ? g.a > g.b : g.b > g.a) wins += 1
  }
  return wins
}

export function winnerSide(games: GameScore[]): 'a' | 'b' | null {
  const a = gamesWonBy(games, 'a')
  const b = gamesWonBy(games, 'b')
  if (a === b) return null
  return a > b ? 'a' : 'b'
}

function sigmoidFromRatio(r: number, exponent: number): number {
  const p = Math.pow(r, exponent)
  return p / (p + 1)
}

export function expectedPointsRatio(levelA: number, levelB: number, settings: Settings): number {
  return sigmoidFromRatio(levelA / levelB, settings.pointsExponent)
}

export function expectedGamesRatio(levelA: number, levelB: number, settings: Settings): number {
  return sigmoidFromRatio(levelA / levelB, settings.gamesExponent)
}

export function expectedPerformance(levelA: number, levelB: number, settings: Settings): number {
  const eP = expectedPointsRatio(levelA, levelB, settings)
  const eG = expectedGamesRatio(levelA, levelB, settings)
  return settings.pointsWeight * eP + (1 - settings.pointsWeight) * eG
}

export function actualPerformance(games: GameScore[], settings: Settings): number {
  return (
    settings.pointsWeight * pointsRatio(games) +
    (1 - settings.pointsWeight) * gamesRatio(games)
  )
}
