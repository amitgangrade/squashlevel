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
  email: z.string().email().optional(),
  userId: z.string().uuid().optional(),
  phone: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  club: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  birthYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
  gender: z.enum(['male', 'female']).optional(),
  dominantHand: z.enum(['right', 'left', 'ambi']).optional(),
  // Server-managed: maintained by the matches trigger. NULL when the player has
  // not yet played a rated match — frontend should fall back to startingLevel.
  currentLevel: z.number().optional(),
  matchesPlayed: z.number().int().nonnegative().optional(),
})
export type Player = z.infer<typeof PlayerSchema>

export const Gender = z.enum(['male', 'female'])
export type Gender = z.infer<typeof Gender>

export const DominantHand = z.enum(['right', 'left', 'ambi'])
export type DominantHand = z.infer<typeof DominantHand>

export const GENDER_LABEL: Record<Gender, string> = {
  male: 'Male',
  female: 'Female',
}

export const DOMINANT_HAND_LABEL: Record<DominantHand, string> = {
  right: 'Right',
  left: 'Left',
  ambi: 'Ambidextrous',
}

export const ProfileSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().min(1),
  username: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  club: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  birthYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
  gender: Gender.optional(),
  dominantHand: DominantHand.optional(),
  startingLevel: z.number().positive(),
  isAdmin: z.boolean(),
  createdAt: z.string(),
})
export type Profile = z.infer<typeof ProfileSchema>

export const GameScoreSchema = z.object({
  a: z.number().int().min(0),
  b: z.number().int().min(0),
})
export type GameScore = z.infer<typeof GameScoreSchema>

export const MatchStatus = z.enum(['pending', 'confirmed', 'disputed'])
export type MatchStatus = z.infer<typeof MatchStatus>

export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  pending: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  disputed: 'Disputed',
}

export const MatchSchema = z.object({
  id: z.string(),
  date: z.string(),
  playerAId: z.string(),
  playerBId: z.string(),
  games: z.array(GameScoreSchema).min(1),
  type: MatchType,
  venue: z.string().optional(),
  notes: z.string().optional(),
  status: MatchStatus.optional(),
  confirmedAt: z.string().optional(),
  disputedAt: z.string().optional(),
  autoConfirmed: z.boolean().optional(),
  unranked: z.boolean().optional(),
  createdBy: z.string().optional(),
  createdAt: z.string().optional(),
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

// Zod schemas for the auxiliary tables we now include in the full backup.
// Keep these in sync with the TS interfaces below.
export const ChallengeSchema = z.object({
  id: z.string(),
  fromPlayerId: z.string(),
  toPlayerId: z.string(),
  message: z.string().optional(),
  proposedDate: z.string().optional(),
  venue: z.string().optional(),
  status: z.enum(['pending', 'accepted', 'declined', 'cancelled', 'expired']),
  createdAt: z.string(),
  respondedAt: z.string().optional(),
  createdBy: z.string().optional(),
})

export const ClubSchema = z.object({
  slug: z.string(),
  name: z.string(),
  city: z.string().optional(),
  country: z.string().optional(),
  description: z.string().optional(),
  createdBy: z.string().optional(),
  createdAt: z.string(),
})

export const ClubAdminSchema = z.object({
  userId: z.string(),
  clubSlug: z.string(),
  fullName: z.string(),
  email: z.string(),
  grantedAt: z.string(),
})

export const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  isPrivate: z.boolean(),
  createdBy: z.string().optional(),
  createdAt: z.string(),
})

export const GroupMemberSchema = z.object({
  groupId: z.string(),
  playerId: z.string(),
  isAdmin: z.boolean(),
  addedBy: z.string().optional(),
  addedAt: z.string(),
})

// Export shape. v1 = original (players + matches + settings only). v2 adds
// the auxiliary tables so the export round-trips faithfully. The auxiliary
// arrays are optional on the schema so v1 files still parse — v1 import
// just leaves the auxiliary tables alone.
export const ExportSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.string(),
  players: z.array(PlayerSchema),
  matches: z.array(MatchSchema),
  settings: SettingsSchema,
  // v2 additions — all optional so v1 still validates.
  profiles: z.array(ProfileSchema).optional(),
  challenges: z.array(ChallengeSchema).optional(),
  clubs: z.array(ClubSchema).optional(),
  clubAdmins: z.array(ClubAdminSchema).optional(),
  groups: z.array(GroupSchema).optional(),
  groupMembers: z.array(GroupMemberSchema).optional(),
})
export type ExportData = z.infer<typeof ExportSchema>

export const ChallengeStatus = z.enum(['pending', 'accepted', 'declined', 'cancelled', 'expired'])
export type ChallengeStatus = z.infer<typeof ChallengeStatus>

export const CHALLENGE_STATUS_LABEL: Record<ChallengeStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

export interface Challenge {
  id: string
  fromPlayerId: string
  toPlayerId: string
  message?: string
  proposedDate?: string
  venue?: string
  status: ChallengeStatus
  createdAt: string
  respondedAt?: string
  createdBy?: string
}

export interface ClubAdmin {
  userId: string
  clubSlug: string
  fullName: string
  email: string
  grantedAt: string
}

export interface Club {
  slug: string
  name: string
  city?: string
  country?: string
  description?: string
  createdBy?: string
  createdAt: string
}

export interface Group {
  id: string
  name: string
  slug: string
  description?: string
  isPrivate: boolean
  createdBy?: string
  createdAt: string
}

export interface GroupMember {
  groupId: string
  playerId: string
  isAdmin: boolean
  addedBy?: string
  addedAt: string
}
