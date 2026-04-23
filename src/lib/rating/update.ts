import type { GameScore, MatchType, Settings } from '../../types'
import { MATCH_TYPE_WEIGHT } from '../../types'
import { actualPerformance, expectedPerformance } from './levels'

export interface LevelUpdate {
  levelAAfter: number
  levelBAfter: number
  deltaA: number
  deltaB: number
  expected: number
  actual: number
}

export interface UpdateInput {
  levelA: number
  levelB: number
  games: GameScore[]
  matchType: MatchType
  provisionalA?: boolean
  provisionalB?: boolean
  settings: Settings
}

export function updateLevels({
  levelA,
  levelB,
  games,
  matchType,
  provisionalA,
  provisionalB,
  settings,
}: UpdateInput): LevelUpdate {
  const expected = expectedPerformance(levelA, levelB, settings)
  const actual = actualPerformance(games, settings)
  const delta = actual - expected
  const weight = MATCH_TYPE_WEIGHT[matchType]
  const change = settings.dampingK * weight * delta

  let levelAAfter = levelA * (1 + change)
  let levelBAfter = levelB * (1 - change)

  if (provisionalA && !provisionalB) {
    levelBAfter = levelB
  } else if (provisionalB && !provisionalA) {
    levelAAfter = levelA
  }

  levelAAfter = Math.max(1, levelAAfter)
  levelBAfter = Math.max(1, levelBAfter)

  return {
    levelAAfter,
    levelBAfter,
    deltaA: levelAAfter - levelA,
    deltaB: levelBAfter - levelB,
    expected,
    actual,
  }
}
