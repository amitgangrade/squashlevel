import type { Challenge, ChallengeStatus } from '../../types'
import { supabase } from './client'
import { fromChallengeRow, type ChallengeRow } from './mappers'

export interface CreateChallengeInput {
  toPlayerId: string
  message?: string
  proposedDate?: string
  venue?: string
  /** Optional: only useful for admins challenging on behalf of someone else. */
  fromPlayerId?: string
}

export async function createChallenge(input: CreateChallengeInput): Promise<Challenge> {
  const sb = supabase!
  const { data, error } = await sb.rpc('create_challenge', {
    to_player: input.toPlayerId,
    msg: input.message ?? null,
    proposed: input.proposedDate ?? null,
    venue_name: input.venue ?? null,
    from_player: input.fromPlayerId ?? null,
  })
  if (error) throw error
  return fromChallengeRow(data as ChallengeRow)
}

export async function respondToChallenge(
  challengeId: string,
  response: Exclude<ChallengeStatus, 'pending' | 'expired'>,
): Promise<Challenge> {
  const sb = supabase!
  const { data, error } = await sb.rpc('respond_to_challenge', {
    challenge_id: challengeId,
    response,
  })
  if (error) throw error
  return fromChallengeRow(data as ChallengeRow)
}

export async function fetchChallenges(): Promise<Challenge[]> {
  const sb = supabase!
  const { data, error } = await sb
    .from('challenges')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as ChallengeRow[]).map(fromChallengeRow)
}
