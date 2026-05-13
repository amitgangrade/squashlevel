import { supabase } from './client'

/**
 * Single audit event row, as returned by `list_audit_events`. Mirrors the
 * `public.audit_events` table shape. Subject arrays are pre-denormalised by
 * the trigger so scoped admins can be filtered cheaply server-side.
 */
export interface AuditEvent {
  id: number
  at: string
  actor_user_id: string | null
  actor_label: string | null
  entity_type:
    | 'profiles' | 'players' | 'matches' | 'challenges'
    | 'clubs' | 'club_admins' | 'groups' | 'group_members' | 'settings'
  entity_id: string | null
  op: 'insert' | 'update' | 'delete'
  summary: string | null
  changed: unknown
  subject_player_ids: string[]
  subject_club_slugs: string[]
  subject_group_ids: string[]
  privileged: boolean
}

export interface ListAuditOpts {
  /** Cursor for keyset pagination — return events strictly before this. */
  after?: string
  /** Server caps at 200. Default 50. */
  limit?: number
  actor?: string
  entityType?: AuditEvent['entity_type']
}

/**
 * Admin-only paginated read of the audit log. Returns at most `limit` rows
 * older than `after` (or the most recent rows when `after` is omitted).
 *
 * Scope is enforced server-side by `list_audit_events`:
 *   • Global admins see everything.
 *   • Club / group admins see events whose `subject_*[]` arrays overlap
 *     their admin scope (players in their clubs, members of their groups).
 *   • Privileged events (is_admin toggles, settings changes) only visible
 *     to global admins regardless of scope.
 *   • Anyone else gets an empty array.
 */
export async function listAuditEvents(opts: ListAuditOpts = {}): Promise<AuditEvent[]> {
  const sb = supabase!
  const { data, error } = await sb.rpc('list_audit_events', {
    p_after: opts.after ?? null,
    p_limit: opts.limit ?? 50,
    p_actor: opts.actor ?? null,
    p_entity_type: opts.entityType ?? null,
  })
  if (error) throw error
  return (data ?? []) as AuditEvent[]
}
