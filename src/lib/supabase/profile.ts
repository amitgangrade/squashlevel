import type { DominantHand, Gender, Player, Profile } from '../../types'
import { supabase } from './client'
import { fromPlayerRow, fromProfileRow, type PlayerRow, type ProfileRow } from './mappers'

const SLUG_RE = /[^a-z0-9]+/g

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(SLUG_RE, '-')
    .replace(/^-+|-+$/g, '')
}

export function suggestUsername(fullName: string): string {
  const slug = slugify(fullName)
  return slug || 'player'
}

async function usernameTaken(username: string): Promise<boolean> {
  const sb = supabase!
  const { data, error } = await sb.from('profiles').select('id').eq('username', username).maybeSingle()
  if (error) throw error
  return !!data
}

export async function pickUniqueUsername(fullName: string): Promise<string> {
  const base = suggestUsername(fullName)
  let candidate = base
  let i = 2
  // Cap loops; collisions are rare.
  while (await usernameTaken(candidate)) {
    candidate = `${base}-${i++}`
    if (i > 50) {
      candidate = `${base}-${Date.now().toString(36)}`
      break
    }
  }
  return candidate
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const sb = supabase!
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  return data ? fromProfileRow(data as ProfileRow) : null
}

export async function fetchPlayerForUser(userId: string): Promise<Player | null> {
  const sb = supabase!
  const { data, error } = await sb.from('players').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data ? fromPlayerRow(data as PlayerRow) : null
}

export interface OnboardingInput {
  fullName: string
  email: string
  startingLevel: number
  phone?: string
  country?: string
  city?: string
  club?: string
  birthYear?: number
  gender?: Gender
  dominantHand?: DominantHand
  avatarFile?: File | null
}

const AVATAR_BUCKET = 'avatars'
const MAX_AVATAR_BYTES = 5 * 1024 * 1024 // 5 MB

/**
 * Upload an avatar image to the public `avatars` bucket and return its URL.
 * Path: <userId>/avatar.<ext>. Cache-busted with a ?t=<timestamp> query.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error('Photo must be 5 MB or smaller')
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('Photo must be an image file')
  }
  const sb = supabase!
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${userId}/avatar.${ext}`
  const { error: upErr } = await sb.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type })
  if (upErr) throw upErr
  const { data } = sb.storage.from(AVATAR_BUCKET).getPublicUrl(path)
  return `${data.publicUrl}?t=${Date.now()}`
}

/**
 * Create a profile + linked player row for a freshly-signed-in user.
 *
 * If an admin pre-created a player with this user's email (case-insensitive),
 * we CLAIM that row instead of creating a new one — keeping any matches
 * already attributed to it. Otherwise we insert a fresh players row.
 *
 * Caller must already be authenticated (auth.uid() = userId).
 */
export async function createProfileAndPlayer(
  userId: string,
  input: OnboardingInput,
): Promise<{ profile: Profile; player: Player }> {
  const sb = supabase!
  const username = await pickUniqueUsername(input.fullName)

  const profileRow: ProfileRow = {
    id: userId,
    full_name: input.fullName,
    username,
    email: input.email,
    phone: input.phone?.trim() || null,
    country: input.country?.trim() || null,
    city: input.city?.trim() || null,
    club: input.club?.trim() || null,
    avatar_url: null,
    birth_year: input.birthYear ?? null,
    gender: input.gender ?? null,
    dominant_hand: input.dominantHand ?? null,
    starting_level: input.startingLevel,
    is_admin: false, // server trigger flips this for the original owner email
    created_at: new Date().toISOString(),
  }

  const { data: profileData, error: pErr } = await sb
    .from('profiles')
    .insert(profileRow)
    .select('*')
    .single()
  if (pErr) throw pErr

  // Optional avatar — failures are non-fatal so onboarding still completes.
  let profile = fromProfileRow(profileData as ProfileRow)
  if (input.avatarFile) {
    try {
      const avatarUrl = await uploadAvatar(userId, input.avatarFile)
      const { data: updated, error: uErr } = await sb
        .from('profiles')
        .update({ avatar_url: avatarUrl })
        .eq('id', userId)
        .select('*')
        .single()
      if (!uErr && updated) profile = fromProfileRow(updated as ProfileRow)
    } catch (e) {
      console.warn('avatar upload failed', e)
    }
  }

  // The DB trigger ensure_player_for_profile already created (or claimed) a
  // player row when we inserted the profile. Just read it back.
  const { data: playerRow, error: plErr } = await sb
    .from('players')
    .select('*')
    .eq('user_id', userId)
    .single()
  if (plErr) throw plErr
  const player = fromPlayerRow(playerRow as PlayerRow)

  return { profile, player }
}

export async function updateProfile(profile: Profile): Promise<Profile> {
  const sb = supabase!
  const { data, error } = await sb
    .from('profiles')
    .update({
      full_name: profile.fullName,
      phone: profile.phone ?? null,
      country: profile.country ?? null,
      city: profile.city ?? null,
      club: profile.club ?? null,
      avatar_url: profile.avatarUrl ?? null,
      birth_year: profile.birthYear ?? null,
      gender: profile.gender ?? null,
      dominant_hand: profile.dominantHand ?? null,
      starting_level: profile.startingLevel,
    })
    .eq('id', profile.id)
    .select('*')
    .single()
  if (error) throw error
  return fromProfileRow(data as ProfileRow)
}

/**
 * Server-side player search (typeahead). Uses ilike with a trigram index so it
 * stays cheap at tens of thousands of rows. Splits the query on whitespace and
 * requires every token to match (so "john do" finds "John Doe" but not just
 * "John" — useful when there are many people sharing a first name).
 */
export async function searchPlayers(query: string, limit = 20): Promise<Player[]> {
  const sb = supabase!
  const q = query.trim()
  if (!q) {
    const { data, error } = await sb.from('players').select('*').order('name').limit(limit)
    if (error) throw error
    return (data as PlayerRow[]).map(fromPlayerRow)
  }
  let req = sb.from('players').select('*')
  for (const token of q.split(/\s+/).filter(Boolean)) {
    req = req.ilike('name', `%${token}%`)
  }
  const { data, error } = await req.order('name').limit(limit)
  if (error) throw error
  return (data as PlayerRow[]).map(fromPlayerRow)
}

/** Admin-only: list every profile so admins can promote/demote others. */
export async function listAllProfiles(): Promise<Profile[]> {
  const sb = supabase!
  const { data, error } = await sb.rpc('list_profiles_for_admin')
  if (error) throw error
  return (data as ProfileRow[]).map(fromProfileRow)
}

/** Admin-only: flip the is_admin flag on another profile. */
export async function setAdminFlag(profileId: string, value: boolean): Promise<Profile> {
  const sb = supabase!
  const { data, error } = await sb.rpc('set_admin', { target_id: profileId, value })
  if (error) throw error
  return fromProfileRow(data as ProfileRow)
}
