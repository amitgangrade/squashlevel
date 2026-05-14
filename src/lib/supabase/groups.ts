import type { Group, GroupMember } from '../../types'
import { supabase } from './client'
import {
  fromGroupRow,
  fromGroupMemberRow,
  type GroupRow,
  type GroupMemberRow,
} from './mappers'

/** List every group the caller is allowed to see (RLS hides private ones). */
export async function listGroups(): Promise<Group[]> {
  const sb = supabase!
  const { data, error } = await sb
    .from('groups')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as GroupRow[]).map(fromGroupRow)
}

export async function fetchGroupBySlug(slug: string): Promise<Group | null> {
  const sb = supabase!
  const { data, error } = await sb.from('groups').select('*').eq('slug', slug).maybeSingle()
  if (error) throw error
  return data ? fromGroupRow(data as GroupRow) : null
}

export async function listGroupMembers(groupId: string): Promise<GroupMember[]> {
  const sb = supabase!
  const { data, error } = await sb
    .from('group_members')
    .select('*')
    .eq('group_id', groupId)
  if (error) throw error
  return (data as GroupMemberRow[]).map(fromGroupMemberRow)
}

/** Groups the given player is a member of (used for badges on profile pages). */
export async function listGroupsForPlayer(playerId: string): Promise<Group[]> {
  const sb = supabase!
  const { data, error } = await sb
    .from('group_members')
    .select('group_id, groups!inner(*)')
    .eq('player_id', playerId)
  if (error) throw error
  type Row = { groups: GroupRow }
  return (data as unknown as Row[]).map((r) => fromGroupRow(r.groups))
}

/**
 * For each group the current user administers, the set of player IDs in
 * that group. Powers the client-side mirror of `is_group_admin_for_pair`
 * — `canWriteMatch` returns true when both participants share a group I
 * admin, so the Edit / Delete buttons can render without round-tripping
 * to the server first. RLS still enforces the rule on the actual write.
 *
 * Empty for users who don't admin any group.
 */
export async function fetchMyGroupAdminScope(): Promise<Map<string, Set<string>>> {
  const sb = supabase!
  const { data, error } = await sb.rpc('list_my_group_admin_scope')
  if (error) throw error
  const rows = (data ?? []) as Array<{ group_id: string; player_id: string }>
  const out = new Map<string, Set<string>>()
  for (const r of rows) {
    let set = out.get(r.group_id)
    if (!set) {
      set = new Set()
      out.set(r.group_id, set)
    }
    set.add(r.player_id)
  }
  return out
}

/**
 * Map of group_id → is_admin for the given player, fetched in one round-trip.
 * Used by the Groups index to tag each card with the viewer's relationship
 * (admin / member / public / private-admin-view).
 */
export async function fetchMyGroupRoles(
  playerId: string,
): Promise<Map<string, { isAdmin: boolean }>> {
  const sb = supabase!
  const { data, error } = await sb
    .from('group_members')
    .select('group_id, is_admin')
    .eq('player_id', playerId)
  if (error) throw error
  const out = new Map<string, { isAdmin: boolean }>()
  for (const r of (data as Array<{ group_id: string; is_admin: boolean }>) ?? []) {
    out.set(r.group_id, { isAdmin: r.is_admin })
  }
  return out
}

export async function createGroup(input: {
  name: string
  description?: string
  isPrivate?: boolean
}): Promise<Group> {
  const sb = supabase!
  const { data, error } = await sb.rpc('create_group', {
    p_name: input.name,
    p_description: input.description ?? null,
    p_is_private: input.isPrivate ?? false,
  })
  if (error) throw error
  return fromGroupRow(data as GroupRow)
}

export async function updateGroup(input: {
  id: string
  name: string
  description?: string
  isPrivate: boolean
}): Promise<Group> {
  const sb = supabase!
  const { data, error } = await sb.rpc('update_group', {
    p_id: input.id,
    p_name: input.name,
    p_description: input.description ?? null,
    p_is_private: input.isPrivate,
  })
  if (error) throw error
  return fromGroupRow(data as GroupRow)
}

export async function deleteGroup(id: string): Promise<void> {
  const sb = supabase!
  const { error } = await sb.rpc('delete_group', { p_id: id })
  if (error) throw error
}

export async function addGroupMember(
  groupId: string,
  playerId: string,
  isAdmin = false,
): Promise<GroupMember> {
  const sb = supabase!
  const { data, error } = await sb.rpc('add_group_member', {
    p_group: groupId,
    p_player: playerId,
    p_is_admin: isAdmin,
  })
  if (error) throw error
  return fromGroupMemberRow(data as GroupMemberRow)
}

export async function removeGroupMember(groupId: string, playerId: string): Promise<void> {
  const sb = supabase!
  const { error } = await sb.rpc('remove_group_member', {
    p_group: groupId,
    p_player: playerId,
  })
  if (error) throw error
}

/**
 * Build a public share URL for a group. WhatsApp / Telegram both accept any
 * URL in their share intents; we pass through the SPA's hash route.
 */
export function buildGroupShareUrl(slug: string): string {
  const origin =
    typeof window !== 'undefined' ? window.location.origin + window.location.pathname : ''
  return `${origin}#/groups/${encodeURIComponent(slug)}`
}

export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

export function telegramShareUrl(url: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
}
