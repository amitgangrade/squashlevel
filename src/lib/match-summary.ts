import type { GameScore, Match, Player } from '../types'
import { gamesWonBy, winnerSide } from './rating/levels'

export interface MatchSummary {
  winnerName: string | null
  loserName: string | null
  winnerId: string | null
  loserId: string | null
  winnerGames: number
  loserGames: number
  winnerPoints: number
  loserPoints: number
  aName: string
  bName: string
  aGames: number
  bGames: number
  aPoints: number
  bPoints: number
  isDraw: boolean
}

export function summarizeMatch(m: Match, players: Player[]): MatchSummary {
  const aName = players.find((p) => p.id === m.playerAId)?.name ?? '?'
  const bName = players.find((p) => p.id === m.playerBId)?.name ?? '?'
  const aGames = gamesWonBy(m.games, 'a')
  const bGames = gamesWonBy(m.games, 'b')
  const { a: aPoints, b: bPoints } = totalPoints(m.games)
  const w = winnerSide(m.games)
  if (w === null) {
    return {
      winnerName: null,
      loserName: null,
      winnerId: null,
      loserId: null,
      winnerGames: 0,
      loserGames: 0,
      winnerPoints: 0,
      loserPoints: 0,
      aName,
      bName,
      aGames,
      bGames,
      aPoints,
      bPoints,
      isDraw: true,
    }
  }
  const aIsWinner = w === 'a'
  return {
    winnerName: aIsWinner ? aName : bName,
    loserName: aIsWinner ? bName : aName,
    winnerId: aIsWinner ? m.playerAId : m.playerBId,
    loserId: aIsWinner ? m.playerBId : m.playerAId,
    winnerGames: aIsWinner ? aGames : bGames,
    loserGames: aIsWinner ? bGames : aGames,
    winnerPoints: aIsWinner ? aPoints : bPoints,
    loserPoints: aIsWinner ? bPoints : aPoints,
    aName,
    bName,
    aGames,
    bGames,
    aPoints,
    bPoints,
    isDraw: false,
  }
}

export function totalPoints(games: GameScore[]): { a: number; b: number } {
  let a = 0
  let b = 0
  for (const g of games) {
    a += g.a
    b += g.b
  }
  return { a, b }
}
