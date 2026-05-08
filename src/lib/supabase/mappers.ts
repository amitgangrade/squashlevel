import type { Match, Player, Settings } from '../../types'

export interface PlayerRow {
  id: string
  name: string
  starting_level: number
  notes: string | null
  email: string | null
  user_id: string | null
  created_at: string
  phone: string | null
  country: string | null
  city: string | null
  club: string | null
  avatar_url: string | null
  birth_year: number | null
  gender: 'male' | 'female' | null
  dominant_hand: 'right' | 'left' | 'ambi' | null
}

export interface ProfileRow {
  id: string
  full_name: string
  username: string
  email: string
  phone: string | null
  country: string | null
  city: string | null
  club: string | null
  avatar_url: string | null
  birth_year: number | null
  gender: 'male' | 'female' | null
  dominant_hand: 'right' | 'left' | 'ambi' | null
  starting_level: number
  is_admin: boolean
  created_at: string
}

export interface MatchRow {
  id: string
  date: string
  player_a_id: string
  player_b_id: string
  games: Array<{ a: number; b: number }>
  type: Match['type']
  venue: string | null
  notes: string | null
  status: 'pending' | 'confirmed' | 'disputed' | null
  confirmed_at: string | null
  disputed_at: string | null
  auto_confirmed: boolean | null
  created_by: string | null
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
  userId: r.user_id ?? undefined,
  createdAt: r.created_at,
  phone: r.phone ?? undefined,
  country: r.country ?? undefined,
  city: r.city ?? undefined,
  club: r.club ?? undefined,
  avatarUrl: r.avatar_url ?? undefined,
  birthYear: r.birth_year ?? undefined,
  gender: r.gender ?? undefined,
  dominantHand: r.dominant_hand ?? undefined,
})

export const toPlayerRow = (p: Player): PlayerRow => ({
  id: p.id,
  name: p.name,
  starting_level: p.startingLevel,
  notes: p.notes ?? null,
  email: p.email ?? null,
  user_id: p.userId ?? null,
  created_at: p.createdAt,
  phone: p.phone ?? null,
  country: p.country ?? null,
  city: p.city ?? null,
  club: p.club ?? null,
  avatar_url: p.avatarUrl ?? null,
  birth_year: p.birthYear ?? null,
  gender: p.gender ?? null,
  dominant_hand: p.dominantHand ?? null,
})

export const fromProfileRow = (r: ProfileRow): import('../../types').Profile => ({
  id: r.id,
  fullName: r.full_name,
  username: r.username,
  email: r.email,
  phone: r.phone ?? undefined,
  country: r.country ?? undefined,
  city: r.city ?? undefined,
  club: r.club ?? undefined,
  avatarUrl: r.avatar_url ?? undefined,
  birthYear: r.birth_year ?? undefined,
  gender: r.gender ?? undefined,
  dominantHand: r.dominant_hand ?? undefined,
  startingLevel: Number(r.starting_level),
  isAdmin: r.is_admin,
  createdAt: r.created_at,
})

export const fromMatchRow = (r: MatchRow): Match => ({
  id: r.id,
  date: r.date,
  playerAId: r.player_a_id,
  playerBId: r.player_b_id,
  games: r.games,
  type: r.type,
  venue: r.venue ?? undefined,
  notes: r.notes ?? undefined,
  status: r.status ?? undefined,
  confirmedAt: r.confirmed_at ?? undefined,
  disputedAt: r.disputed_at ?? undefined,
  autoConfirmed: r.auto_confirmed ?? undefined,
  createdBy: r.created_by ?? undefined,
  createdAt: r.created_at,
})

export const toMatchRow = (m: Match): MatchRow => ({
  id: m.id,
  date: m.date,
  player_a_id: m.playerAId,
  player_b_id: m.playerBId,
  games: m.games,
  type: m.type,
  venue: m.venue ?? null,
  notes: m.notes ?? null,
  status: m.status ?? null,
  confirmed_at: m.confirmedAt ?? null,
  disputed_at: m.disputedAt ?? null,
  auto_confirmed: m.autoConfirmed ?? null,
  created_by: m.createdBy ?? null,
  created_at: m.createdAt ?? new Date().toISOString(),
})
