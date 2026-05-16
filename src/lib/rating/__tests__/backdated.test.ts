// Recompute correctness in the presence of backdated match inserts.
//
// Covers the canonical promise from openspec/specs/rating §Full recomputation:
//   "results match the chronological-order computation; insertion order does
//    not affect outcomes"
//
// This is the property the new levels_stale flag relies on — a full
// rebuild always produces the canonical answer, so flagging staleness on a
// backdated insert and resolving it later via Rebuild Levels gets the
// same result as if the match had been entered in chronological order
// to begin with.

import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Match, type Player } from '../../../types'
import { recomputeAll } from '../recompute'

function mkMatch(
  id: string,
  date: string,
  aWins: boolean,
  type: Match['type'] = 'friendly',
): Match {
  return {
    id,
    date,
    playerAId: 'a',
    playerBId: 'b',
    games: aWins
      ? [{ a: 11, b: 6 }, { a: 11, b: 4 }, { a: 11, b: 8 }]
      : [{ a: 6, b: 11 }, { a: 4, b: 11 }, { a: 8, b: 11 }],
    type,
  }
}

describe('recomputeAll with backdated inserts', () => {
  const players: Player[] = [
    { id: 'a', name: 'A', startingLevel: 1000, createdAt: '2026-01-01' },
    { id: 'b', name: 'B', startingLevel: 1000, createdAt: '2026-01-01' },
  ]

  it('insertion order does not affect the final state', () => {
    const chronological: Match[] = [
      mkMatch('m1', '2026-02-01', true),
      mkMatch('m2', '2026-02-05', false),
      mkMatch('m3', '2026-02-10', true),
      mkMatch('m4', '2026-02-15', true),
      mkMatch('m5', '2026-02-20', false),
    ]
    // Same matches, but in arbitrary insertion order (e.g. m4 inserted first,
    // then a backdated m1 and m3, then m5 and m2).
    const scrambled: Match[] = [
      chronological[3],
      chronological[0],
      chronological[2],
      chronological[4],
      chronological[1],
    ]

    const a = recomputeAll(players, chronological, DEFAULT_SETTINGS)
    const b = recomputeAll(players, scrambled, DEFAULT_SETTINGS)

    expect(a.states.get('a')!.currentLevel).toBeCloseTo(
      b.states.get('a')!.currentLevel,
      10,
    )
    expect(a.states.get('b')!.currentLevel).toBeCloseTo(
      b.states.get('b')!.currentLevel,
      10,
    )

    // Per-match snapshots align by id, not by insertion position.
    const byId = (mm: Match[]) => new Map(mm.map((m) => [m.id, m]))
    const aById = byId(a.matches)
    const bById = byId(b.matches)
    for (const id of ['m1', 'm2', 'm3', 'm4', 'm5'] as const) {
      const ax = aById.get(id)!
      const bx = bById.get(id)!
      expect(ax.levelAAfter!).toBeCloseTo(bx.levelAAfter!, 10)
      expect(ax.levelBAfter!).toBeCloseTo(bx.levelBAfter!, 10)
      expect(ax.deltaA!).toBeCloseTo(bx.deltaA!, 10)
      expect(ax.deltaB!).toBeCloseTo(bx.deltaB!, 10)
      expect(ax.provisionalA).toBe(bx.provisionalA)
      expect(ax.provisionalB).toBe(bx.provisionalB)
    }
  })

  it('a backdated match slotted between #3 and #4 changes downstream snapshots deterministically', () => {
    // Baseline: five chronological matches.
    const baseline: Match[] = [
      mkMatch('m1', '2026-02-01', true),
      mkMatch('m2', '2026-02-05', false),
      mkMatch('m3', '2026-02-10', true),
      mkMatch('m4', '2026-02-15', true),
      mkMatch('m5', '2026-02-20', false),
    ]
    const baseResult = recomputeAll(players, baseline, DEFAULT_SETTINGS)
    const baseFinalA = baseResult.states.get('a')!.currentLevel

    // Insert a 6th match dated between m3 (Feb 10) and m4 (Feb 15).
    const inserted: Match = mkMatch('m_back', '2026-02-12', false)
    const withInsert = [...baseline, inserted]
    const withResult = recomputeAll(players, withInsert, DEFAULT_SETTINGS)
    const withFinalA = withResult.states.get('a')!.currentLevel

    // Two assertions matter for the spec invariant:
    // 1. The order in which we append the backdated match must not matter.
    const reversed = [inserted, ...baseline]
    const reversedResult = recomputeAll(players, reversed, DEFAULT_SETTINGS)
    expect(withFinalA).toBeCloseTo(
      reversedResult.states.get('a')!.currentLevel,
      10,
    )
    // 2. The result genuinely differs from baseline (i.e. the backdated
    //    match's effect propagates through the downstream snapshots —
    //    confirming that doing nothing after a backdated insert would
    //    leave persisted columns stale, which is exactly what
    //    levels_stale signals).
    expect(withFinalA).not.toBeCloseTo(baseFinalA, 6)

    // Downstream m4 and m5 snapshots must reflect the new chronology.
    const byId = (mm: Match[]) => new Map(mm.map((m) => [m.id, m]))
    const baseById = byId(baseResult.matches)
    const withById = byId(withResult.matches)
    expect(withById.get('m4')!.levelABefore).not.toBeCloseTo(
      baseById.get('m4')!.levelABefore!,
      6,
    )
    expect(withById.get('m5')!.levelABefore).not.toBeCloseTo(
      baseById.get('m5')!.levelABefore!,
      6,
    )
  })
})
