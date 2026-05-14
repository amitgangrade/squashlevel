import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../types'
import {
  actualPerformance,
  expectedGamesRatio,
  expectedPerformance,
  expectedPointsRatio,
  gamesRatio,
  isProvisional,
  pointsRatio,
  winnerSide,
} from '../levels'
import { updateLevels } from '../update'
import { recomputeAll } from '../recompute'
import type { Player, Match } from '../../../types'

describe('score ratios', () => {
  it('computes points ratio across multiple games', () => {
    const ratio = pointsRatio([
      { a: 9, b: 4 },
      { a: 9, b: 7 },
      { a: 6, b: 9 },
      { a: 9, b: 5 },
    ])
    expect(ratio).toBeCloseTo(33 / 58, 4)
  })

  it('computes games ratio', () => {
    expect(
      gamesRatio([
        { a: 11, b: 5 },
        { a: 11, b: 9 },
        { a: 6, b: 11 },
        { a: 11, b: 7 },
      ]),
    ).toBeCloseTo(3 / 4, 4)
  })

  it('detects winner', () => {
    expect(
      winnerSide([
        { a: 11, b: 5 },
        { a: 11, b: 9 },
        { a: 6, b: 11 },
      ]),
    ).toBe('a')
  })
})

describe('expected ratios match documented behaviour', () => {
  it('equal levels -> 50/50', () => {
    expect(expectedPointsRatio(1000, 1000, DEFAULT_SETTINGS)).toBeCloseTo(0.5, 4)
    expect(expectedGamesRatio(1000, 1000, DEFAULT_SETTINGS)).toBeCloseTo(0.5, 4)
  })

  it('2x level -> ~80% points and ~97% games (per SquashLevels docs)', () => {
    const eP = expectedPointsRatio(2000, 1000, DEFAULT_SETTINGS)
    const eG = expectedGamesRatio(2000, 1000, DEFAULT_SETTINGS)
    expect(eP).toBeCloseTo(0.8, 2)
    expect(eG).toBeGreaterThan(0.95)
  })

  it('ratios are symmetric around 0.5', () => {
    const a = expectedPerformance(1500, 1000, DEFAULT_SETTINGS)
    const b = expectedPerformance(1000, 1500, DEFAULT_SETTINGS)
    expect(a + b).toBeCloseTo(1, 4)
  })
})

describe('level updates', () => {
  it('equal players, dominant win -> winner up, loser down, symmetric', () => {
    const r = updateLevels({
      levelA: 1000,
      levelB: 1000,
      games: [
        { a: 11, b: 2 },
        { a: 11, b: 3 },
        { a: 11, b: 4 },
      ],
      matchType: 'friendly',
      settings: DEFAULT_SETTINGS,
    })
    expect(r.deltaA).toBeGreaterThan(0)
    expect(r.deltaB).toBeLessThan(0)
    expect(r.deltaA).toBeCloseTo(-r.deltaB, 6)
  })

  it('underdog over-performs (loses but better than expected) -> underdog up', () => {
    const r = updateLevels({
      levelA: 1000,
      levelB: 2000,
      games: [
        { a: 11, b: 9 },
        { a: 9, b: 11 },
        { a: 9, b: 11 },
        { a: 10, b: 12 },
      ],
      matchType: 'friendly',
      settings: DEFAULT_SETTINGS,
    })
    expect(r.deltaA).toBeGreaterThan(0)
    expect(r.deltaB).toBeLessThan(0)
  })

  it('winning a closer-than-expected match -> can go down', () => {
    const r = updateLevels({
      levelA: 5000,
      levelB: 1000,
      games: [
        { a: 11, b: 9 },
        { a: 11, b: 10 },
        { a: 11, b: 9 },
      ],
      matchType: 'friendly',
      settings: DEFAULT_SETTINGS,
    })
    expect(r.deltaA).toBeLessThan(0)
  })

  it('provisional player only updates their own level', () => {
    const r = updateLevels({
      levelA: 1000,
      levelB: 1000,
      games: [{ a: 11, b: 2 }, { a: 11, b: 3 }, { a: 11, b: 4 }],
      matchType: 'friendly',
      provisionalA: true,
      provisionalB: false,
      settings: DEFAULT_SETTINGS,
    })
    expect(r.deltaA).toBeGreaterThan(0)
    expect(r.deltaB).toBe(0)
  })

  it('tournament weight produces larger swings than friendly', () => {
    const base = {
      levelA: 1000,
      levelB: 1000,
      games: [{ a: 11, b: 2 }, { a: 11, b: 3 }, { a: 11, b: 4 }],
      settings: DEFAULT_SETTINGS,
    }
    const f = updateLevels({ ...base, matchType: 'friendly' })
    const t = updateLevels({ ...base, matchType: 'tournament' })
    expect(Math.abs(t.deltaA)).toBeGreaterThan(Math.abs(f.deltaA))
  })
})

describe('actualPerformance', () => {
  it('blends points and games via pointsWeight', () => {
    const games = [
      { a: 11, b: 9 },
      { a: 11, b: 7 },
      { a: 11, b: 8 },
    ]
    const p = actualPerformance(games, DEFAULT_SETTINGS)
    expect(p).toBeGreaterThan(0.5)
    expect(p).toBeLessThan(1)
  })
})

describe('recomputeAll', () => {
  it('replays history deterministically from starting levels', () => {
    const players: Player[] = [
      { id: 'a', name: 'A', startingLevel: 1000, createdAt: '2026-01-01' },
      { id: 'b', name: 'B', startingLevel: 1000, createdAt: '2026-01-01' },
    ]
    const matches: Match[] = [
      {
        id: 'm1',
        date: '2026-02-01',
        playerAId: 'a',
        playerBId: 'b',
        games: [
          { a: 11, b: 6 },
          { a: 11, b: 4 },
          { a: 11, b: 8 },
        ],
        type: 'friendly',
      },
      {
        id: 'm2',
        date: '2026-02-10',
        playerAId: 'a',
        playerBId: 'b',
        games: [
          { a: 9, b: 11 },
          { a: 11, b: 8 },
          { a: 11, b: 9 },
          { a: 11, b: 7 },
        ],
        type: 'box',
      },
    ]
    const r1 = recomputeAll(players, matches, { ...DEFAULT_SETTINGS, provisionalThreshold: 0 })
    const r2 = recomputeAll(players, matches, { ...DEFAULT_SETTINGS, provisionalThreshold: 0 })
    const a1 = r1.states.get('a')!.currentLevel
    const a2 = r2.states.get('a')!.currentLevel
    expect(a1).toBeCloseTo(a2, 10)
    expect(r1.matches[1].levelAAfter).toBeDefined()
  })
})

describe('isProvisional', () => {
  it('returns true when matchesPlayed is below threshold and not seeded', () => {
    expect(isProvisional({ matchesPlayed: 2, seededRating: false }, DEFAULT_SETTINGS)).toBe(true)
  })
  it('returns false when matchesPlayed is at threshold', () => {
    expect(isProvisional({ matchesPlayed: 5, seededRating: false }, DEFAULT_SETTINGS)).toBe(false)
  })
  it('always returns false for seeded players, even at zero matches', () => {
    expect(isProvisional({ matchesPlayed: 0, seededRating: true }, DEFAULT_SETTINGS)).toBe(false)
  })
  it('treats nullish matchesPlayed as zero', () => {
    expect(isProvisional({ seededRating: false }, DEFAULT_SETTINGS)).toBe(true)
    expect(isProvisional({ matchesPlayed: null, seededRating: false }, DEFAULT_SETTINGS)).toBe(true)
  })
  it('treats nullish seededRating as false', () => {
    expect(isProvisional({ matchesPlayed: 0 }, DEFAULT_SETTINGS)).toBe(true)
    expect(isProvisional({ matchesPlayed: 0, seededRating: null }, DEFAULT_SETTINGS)).toBe(true)
  })
})

describe('recomputeAll with seeded players', () => {
  it('flags a seeded newcomer as non-provisional from their very first match', () => {
    // Two seeded newcomers play each other on day 1. Both should be marked
    // non-provisional and update symmetrically — the seeded exemption applies
    // even before matchesPlayed reaches the threshold.
    const players: Player[] = [
      { id: 'a', name: 'Seeded A', startingLevel: 1500, seededRating: true, createdAt: '2026-01-01' },
      { id: 'b', name: 'Seeded B', startingLevel: 1500, seededRating: true, createdAt: '2026-01-01' },
    ]
    const matches: Match[] = [{
      id: 'm1',
      date: '2026-02-01',
      playerAId: 'a',
      playerBId: 'b',
      games: [{ a: 11, b: 6 }, { a: 11, b: 4 }, { a: 11, b: 8 }],
      type: 'friendly',
    }]
    const r = recomputeAll(players, matches, DEFAULT_SETTINGS)
    const m = r.matches[0]
    expect(m.provisionalA).toBe(false)
    expect(m.provisionalB).toBe(false)
    // Both levels actually moved (no asymmetric lock).
    expect(m.levelAAfter).not.toBe(m.levelABefore)
    expect(m.levelBAfter).not.toBe(m.levelBBefore)
    // Symmetric: delta magnitudes match when starting from equal levels.
    expect(m.deltaA).toBeCloseTo(-(m.deltaB ?? 0), 4)
  })

  it('an unseeded newcomer playing a seeded veteran locks only the seeded side', () => {
    // Confirms that the seeded exemption interacts correctly with the
    // existing asymmetric rule: when one is provisional (unseeded, 0 prior
    // matches) and one is not (seeded), only the provisional side's level
    // moves.
    const players: Player[] = [
      { id: 'a', name: 'Seeded', startingLevel: 1500, seededRating: true, createdAt: '2026-01-01' },
      { id: 'b', name: 'Newcomer', startingLevel: 1500, createdAt: '2026-01-01' },
    ]
    const matches: Match[] = [{
      id: 'm1',
      date: '2026-02-01',
      playerAId: 'a',
      playerBId: 'b',
      games: [{ a: 11, b: 6 }, { a: 11, b: 4 }, { a: 11, b: 8 }],
      type: 'friendly',
    }]
    const r = recomputeAll(players, matches, DEFAULT_SETTINGS)
    const m = r.matches[0]
    expect(m.provisionalA).toBe(false) // seeded
    expect(m.provisionalB).toBe(true)  // unseeded + 0 matches
    expect(m.levelAAfter).toBe(m.levelABefore) // seeded locked
    expect(m.levelBAfter).not.toBe(m.levelBBefore) // newcomer moves
  })
})
