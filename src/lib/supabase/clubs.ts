import type { Club, ClubAdmin } from '../../types'
import { supabase } from './client'
import {
  fromClubAdminRow,
  fromClubRow,
  type ClubAdminRow,
  type ClubRow,
} from './mappers'

/**
 * Slugify a club name into a URL-safe key. MUST match the SQL `club_slug()`
 * function in `supabase/schema.sql` so server-side RLS and client-side route
 * matching agree.
 */
export function clubSlug(name: string | null | undefined): string {
  if (!name) return ''
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface ClubSummary {
  slug: string
  /** Canonical display name (first-seen casing wins, like distinctValues). */
  name: string
  members: number
  city?: string
  country?: string
}

/**
 * Roll up the player roster into a list of clubs (case-insensitive). Mirrors
 * `distinctValues(players, 'club')` but enriches each club with its size and
 * its modal city/country so the browse page can show useful metadata.
 */
export function summarizeClubs(
  players: Array<{ club?: string; city?: string; country?: string }>,
): ClubSummary[] {
  const buckets = new Map<string, {
    slug: string
    name: string
    members: number
    cities: Map<string, number>
    countries: Map<string, number>
  }>()
  for (const p of players) {
    const club = (p.club ?? '').trim()
    if (!club) continue
    const slug = clubSlug(club)
    if (!slug) continue
    let b = buckets.get(slug)
    if (!b) {
      b = { slug, name: club, members: 0, cities: new Map(), countries: new Map() }
      buckets.set(slug, b)
    }
    b.members += 1
    if (p.city) b.cities.set(p.city, (b.cities.get(p.city) ?? 0) + 1)
    if (p.country) b.countries.set(p.country, (b.countries.get(p.country) ?? 0) + 1)
  }
  const top = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return [...buckets.values()]
    .map((b) => ({
      slug: b.slug,
      name: b.name,
      members: b.members,
      city: top(b.cities),
      country: top(b.countries),
    }))
    .sort((a, b) => b.members - a.members || a.name.localeCompare(b.name))
}

/** Admin-only: list all club admin grants (across all clubs). */
export async function listClubAdminsForAdmin(): Promise<ClubAdmin[]> {
  const sb = supabase!
  const { data, error } = await sb.rpc('list_club_admins_for_admin')
  if (error) throw error
  return (data as ClubAdminRow[]).map(fromClubAdminRow)
}

/** Admin-only: grant or revoke club-admin status for a profile. */
export async function setClubAdmin(
  targetUserId: string,
  slug: string,
  value: boolean,
): Promise<void> {
  const sb = supabase!
  const { error } = await sb.rpc('set_club_admin', {
    target_user: targetUserId,
    slug,
    value,
  })
  if (error) throw error
}

/**
 * Fetch the slugs of clubs the *current* user administers. Cheap; fetched
 * once after sign-in and stored on the store so write-permission checks
 * don't need an extra round-trip.
 */
export async function fetchMyClubAdminSlugs(userId: string): Promise<string[]> {
  const sb = supabase!
  const { data, error } = await sb
    .from('club_admins')
    .select('club_slug')
    .eq('user_id', userId)
  if (error) throw error
  return (data as Array<{ club_slug: string }>).map((r) => r.club_slug)
}

// ---------------------------------------------------------------------------
// Curated clubs registry: the global admin can add/remove club entries that
// exist independently of player rows (e.g. before any members join).
// ---------------------------------------------------------------------------
export async function listClubs(): Promise<Club[]> {
  const sb = supabase!
  const { data, error } = await sb.from('clubs').select('*').order('name')
  if (error) throw error
  return (data as ClubRow[]).map(fromClubRow)
}

export async function createClub(input: {
  name: string
  city?: string
  country?: string
  description?: string
}): Promise<Club> {
  const sb = supabase!
  const { data, error } = await sb.rpc('create_club', {
    p_name: input.name,
    p_city: input.city ?? null,
    p_country: input.country ?? null,
    p_description: input.description ?? null,
  })
  if (error) throw error
  return fromClubRow(data as ClubRow)
}

export async function deleteClub(slug: string): Promise<void> {
  const sb = supabase!
  const { error } = await sb.rpc('delete_club', { p_slug: slug })
  if (error) throw error
}

/**
 * Merge a curated clubs list with clubs derived from player.club strings.
 * The registry is the authoritative source for name/description/city/country
 * but member counts always come from the player roster.
 */
export function mergeClubs(
  registered: Club[],
  derived: ClubSummary[],
): ClubSummary[] {
  const bySlug = new Map<string, ClubSummary>()
  for (const d of derived) bySlug.set(d.slug, d)
  for (const c of registered) {
    const existing = bySlug.get(c.slug)
    bySlug.set(c.slug, {
      slug: c.slug,
      name: c.name,
      members: existing?.members ?? 0,
      city: c.city ?? existing?.city,
      country: c.country ?? existing?.country,
    })
  }
  return [...bySlug.values()].sort(
    (a, b) => b.members - a.members || a.name.localeCompare(b.name),
  )
}
