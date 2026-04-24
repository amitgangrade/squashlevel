import type { Match, Player, Settings } from '../../types'

export interface PlayerRow {
  id: string
  name: string
  starting_level: number
  notes: string | null
  email: string | null
  created_at: string
}

export interface MatchRow {
  id: string
  date: string
  player_a_id: string
  player_b_id: string
  games: Array<{ a: number; b: number }>
  type: Match['type']
  notes: string | null
  created_at: string
}

export interface SettingsRow {
  id: string
  data: Settings
}

export const fromPlayerRow = (r: PlayerRow): Player => ({
  id: r.id,
  name: r.name,
  startingLevel: Number(r.starting_level),
  notes: r.notes ?? undefined,
  email: r.email ?? undefined,
  createdAt: r.created_at,
})

export const toPlayerRow = (p: Player): PlayerRow => ({
  id: p.id,
  name: p.name,
  starting_level: p.startingLevel,
  notes: p.notes ?? null,
  email: p.email ?? null,
  created_at: p.createdAt,
})

export const fromMatchRow = (r: MatchRow): Match => ({
  id: r.id,
  date: r.date,
  playerAId: r.player_a_id,
  playerBId: r.player_b_id,
  games: r.games,
  type: r.type,
  notes: r.notes ?? undefined,
})

export const toMatchRow = (m: Match): MatchRow => ({
  id: m.id,
  date: m.date,
  player_a_id: m.playerAId,
  player_b_id: m.playerBId,
  games: m.games,
  type: m.type,
  notes: m.notes ?? null,
  created_at: new Date().toISOString(),
})
