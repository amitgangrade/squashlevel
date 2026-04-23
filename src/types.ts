import { z } from 'zod'

export const MatchType = z.enum(['friendly', 'box', 'league', 'tournament'])
export type MatchType = z.infer<typeof MatchType>

export const MATCH_TYPE_WEIGHT: Record<MatchType, number> = {
  friendly: 0.7,
  box: 1.0,
  league: 1.3,
  tournament: 1.6,
}

export const MATCH_TYPE_LABEL: Record<MatchType, string> = {
  friendly: 'Friendly',
  box: 'Box league',
  league: 'League',
  tournament: 'Tournament',
}

export const PlayerSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  startingLevel: z.number().positive(),
  createdAt: z.string(),
  notes: z.string().optional(),
})
export type Player = z.infer<typeof PlayerSchema>

export const GameScoreSchema = z.object({
  a: z.number().int().min(0),
  b: z.number().int().min(0),
})
export type GameScore = z.infer<typeof GameScoreSchema>

export const MatchSchema = z.object({
  id: z.string(),
  date: z.string(),
  playerAId: z.string(),
  playerBId: z.string(),
  games: z.array(GameScoreSchema).min(1),
  type: MatchType,
  notes: z.string().optional(),
  levelABefore: z.number().optional(),
  levelBBefore: z.number().optional(),
  levelAAfter: z.number().optional(),
  levelBAfter: z.number().optional(),
  deltaA: z.number().optional(),
  deltaB: z.number().optional(),
  provisionalA: z.boolean().optional(),
  provisionalB: z.boolean().optional(),
})
export type Match = z.infer<typeof MatchSchema>

export const SettingsSchema = z.object({
  dampingK: z.number().positive().default(0.12),
  pointsWeight: z.number().min(0).max(1).default(0.5),
  pointsExponent: z.number().positive().default(2),
  gamesExponent: z.number().positive().default(5),
  provisionalThreshold: z.number().int().nonnegative().default(5),
  movingAverageWindow: z.number().int().positive().default(4),
})
export type Settings = z.infer<typeof SettingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  dampingK: 0.12,
  pointsWeight: 0.5,
  pointsExponent: 2,
  gamesExponent: 5,
  provisionalThreshold: 5,
  movingAverageWindow: 4,
}

export const ExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  players: z.array(PlayerSchema),
  matches: z.array(MatchSchema),
  settings: SettingsSchema,
})
export type ExportData = z.infer<typeof ExportSchema>
