import type { Match, Player, Settings } from '../../types'
import { updateLevels } from './update'

export interface PlayerState {
  player: Player
  currentLevel: number
  matchesPlayed: number
  history: Array<{ date: string; matchId: string; level: number }>
}

export interface RecomputeResult {
  states: Map<string, PlayerState>
  matches: Match[]
}

export function recomputeAll(
  players: Player[],
  matches: Match[],
  settings: Settings,
): RecomputeResult {
  const states = new Map<string, PlayerState>()
  for (const p of players) {
    states.set(p.id, {
      player: p,
      currentLevel: p.startingLevel,
      matchesPlayed: 0,
      history: [{ date: p.createdAt, matchId: 'start', level: p.startingLevel }],
    })
  }

  const sorted = [...matches].sort((x, y) => {
    const d = x.date.localeCompare(y.date)
    return d !== 0 ? d : x.id.localeCompare(y.id)
  })

  const enriched: Match[] = []

  for (const m of sorted) {
    const a = states.get(m.playerAId)
    const b = states.get(m.playerBId)
    if (!a || !b) {
      enriched.push(m)
      continue
    }

    const provisionalA = a.matchesPlayed < settings.provisionalThreshold
    const provisionalB = b.matchesPlayed < settings.provisionalThreshold

    const upd = updateLevels({
      levelA: a.currentLevel,
      levelB: b.currentLevel,
      games: m.games,
      matchType: m.type,
      provisionalA,
      provisionalB,
      settings,
    })

    const updatedMatch: Match = {
      ...m,
      levelABefore: a.currentLevel,
      levelBBefore: b.currentLevel,
      levelAAfter: upd.levelAAfter,
      levelBAfter: upd.levelBAfter,
      deltaA: upd.deltaA,
      deltaB: upd.deltaB,
      provisionalA,
      provisionalB,
    }
    enriched.push(updatedMatch)

    a.currentLevel = upd.levelAAfter
    b.currentLevel = upd.levelBAfter
    a.matchesPlayed += 1
    b.matchesPlayed += 1
    a.history.push({ date: m.date, matchId: m.id, level: upd.levelAAfter })
    b.history.push({ date: m.date, matchId: m.id, level: upd.levelBAfter })
  }

  return { states, matches: enriched }
}

export function movingAverage(
  history: Array<{ level: number }>,
  window: number,
): number {
  if (history.length === 0) return 0
  const slice = history.slice(-window)
  return slice.reduce((s, p) => s + p.level, 0) / slice.length
}
