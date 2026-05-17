import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { listAuditEvents, type AuditEvent } from '../lib/supabase/audit'

const ENTITY_LABEL: Record<AuditEvent['entity_type'], string> = {
  profiles: 'Profile',
  players: 'Player',
  matches: 'Match',
  challenges: 'Challenge',
  clubs: 'Club',
  club_admins: 'Club admin grant',
  groups: 'Group',
  group_members: 'Group member',
  settings: 'Settings',
}

const ENTITY_OPTIONS: Array<{ value: AuditEvent['entity_type'] | ''; label: string }> = [
  { value: '', label: 'All entities' },
  ...(Object.keys(ENTITY_LABEL) as AuditEvent['entity_type'][]).map((k) => ({
    value: k,
    label: ENTITY_LABEL[k],
  })),
]

/**
 * Reverse-chronological audit feed. Server-paginated via the
 * `list_audit_events` RPC: 50 rows per fetch, "Load more" stitches the next
 * page using the oldest visible event's `at` as the cursor.
 *
 * Access: visible to any signed-in admin (global, club, group). The RPC
 * scopes the rows server-side — global admins see everything; scoped
 * admins see only events whose subject arrays overlap their scope.
 */
export function AuditLogPage() {
  const { session, isAdmin, myClubAdminSlugs } = useStore()
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reachedEnd, setReachedEnd] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [entityFilter, setEntityFilter] = useState<AuditEvent['entity_type'] | ''>('')

  const PAGE = 50

  const load = useCallback(async (after?: string) => {
    try {
      const rows = await listAuditEvents({
        after,
        limit: PAGE,
        entityType: entityFilter || undefined,
      })
      return rows
    } catch (e) {
      throw e
    }
  }, [entityFilter])

  // Initial / filter-change reload.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setReachedEnd(false)
    setErr(null)
    load()
      .then((rows) => {
        if (cancelled) return
        setEvents(rows)
        if (rows.length < PAGE) setReachedEnd(true)
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [load])

  const onLoadMore = async () => {
    if (loadingMore || reachedEnd || events.length === 0) return
    setLoadingMore(true)
    setErr(null)
    try {
      const cursor = events[events.length - 1].at
      const rows = await load(cursor)
      setEvents((prev) => [...prev, ...rows])
      if (rows.length < PAGE) setReachedEnd(true)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }

  // Determine if the viewer has ANY audit scope. Group-admin scope isn't
  // tracked in the store today, so we treat "no global / no club admin" as
  // "probably nothing to see" — the RPC will return [] for them and we
  // render the empty-scope hint.
  const probablyHasScope = isAdmin || myClubAdminSlugs.length > 0

  if (!session) {
    return <div className="card text-center text-slate-500">Sign in to view the audit log.</div>
  }

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1>Audit log</h1>
          <p className="text-sm text-slate-500 mt-1">
            {isAdmin
              ? 'Every state change across the app. Most recent first.'
              : 'State changes involving players in your clubs and groups. Most recent first.'}
          </p>
        </div>
        <div>
          <label className="sr-only" htmlFor="entity-filter">Entity</label>
          <select
            id="entity-filter"
            className="input text-sm"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value as AuditEvent['entity_type'] | '')}
          >
            {ENTITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </header>

      {err && <div className="text-sm text-red-600">{err}</div>}

      {loading ? (
        <div className="card text-sm text-slate-500 text-center">Loading…</div>
      ) : events.length === 0 ? (
        <div className="card text-sm text-slate-500 text-center">
          {probablyHasScope
            ? 'No events to show with the current filter.'
            : 'No audit scope. Only global, club and group admins see entries here.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <AuditRow key={e.id} event={e} />
          ))}
          {!reachedEnd && (
            <li>
              <button
                onClick={onLoadMore}
                disabled={loadingMore}
                className="btn-secondary w-full text-sm"
              >
                {loadingMore ? 'Loading…' : 'Load 50 more'}
              </button>
            </li>
          )}
          {reachedEnd && (
            <li className="text-center text-xs text-slate-500 pt-1">
              End of history.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function AuditRow({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false)
  const when = useMemo(() => new Date(event.at).toLocaleString(), [event.at])
  const summary = event.summary ?? summarise(event)
  return (
    <li className="card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm">
            <span className="font-medium">{event.actor_label ?? 'System'}</span>
            <span className="text-slate-500"> · {summary}</span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {when} · {ENTITY_LABEL[event.entity_type]} · {event.op}
            {event.privileged && (
              <span className="ml-2 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                privileged
              </span>
            )}
          </div>
        </div>
        <span className="text-slate-400 text-xs shrink-0" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        isObjectDiff(event.changed) ? (
          <DiffView before={event.changed.before} after={event.changed.after} />
        ) : (
          <pre className="mt-2 text-xs overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-2 whitespace-pre-wrap break-words">
{JSON.stringify(event.changed, null, 2)}
          </pre>
        )
      )}
    </li>
  )
}

function isObjectDiff(c: unknown): c is { before: Record<string, unknown>; after: Record<string, unknown> } {
  return !!c && typeof c === 'object' && 'before' in c && 'after' in c
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
  }
  return false
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') {
    if (v.length > 80) return v.slice(0, 77) + '…'
    return v || '(empty)'
  }
  try { return JSON.stringify(v) } catch { return String(v) }
}

/**
 * Per-field diff view. Shows only fields that actually changed, formatted
 * `key: before → after`. Falls back to a "Show full before / after" details
 * disclosure for the raw JSON, since occasionally an audit row will surface
 * derived fields (e.g. `levels_stale`, `current_level`) that the viewer
 * wants to confirm alongside the user-driven change.
 */
function DiffView({ before, after }: { before: Record<string, unknown>; after: Record<string, unknown> }) {
  const keys = useMemo(() => {
    const set = new Set([...Object.keys(before), ...Object.keys(after)])
    const out: Array<{ key: string; b: unknown; a: unknown }> = []
    for (const k of set) {
      const b = before[k], a = after[k]
      if (!valuesEqual(b, a)) out.push({ key: k, b, a })
    }
    out.sort((x, y) => x.key.localeCompare(y.key))
    return out
  }, [before, after])

  return (
    <div className="mt-2 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-2 text-xs space-y-1.5">
      {keys.length === 0 ? (
        <div className="text-slate-500">No field changes (trigger fired without a value change).</div>
      ) : (
        <ul className="space-y-1">
          {keys.map(({ key, b, a }) => (
            <li key={key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-mono text-slate-700 dark:text-slate-300">{key}:</span>
              <span className="font-mono text-red-700 dark:text-red-400 line-through opacity-80 break-all">{fmtValue(b)}</span>
              <span className="text-slate-400" aria-hidden>→</span>
              <span className="font-mono text-green-700 dark:text-green-400 break-all">{fmtValue(a)}</span>
            </li>
          ))}
        </ul>
      )}
      <details className="pt-1">
        <summary className="cursor-pointer text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
          Show full before / after
        </summary>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words">
{JSON.stringify({ before, after }, null, 2)}
        </pre>
      </details>
    </div>
  )
}

/**
 * Best-effort human summary built from the entity_type + op + diff. Pure
 * function; falls back to a generic "<entity> <op>" if it can't recognise
 * the shape. Calling code can override by writing `summary` on the
 * audit_events row itself.
 */
function summarise(e: AuditEvent): string {
  const op = e.op
  const t = e.entity_type
  const changed = e.changed as Record<string, unknown> | { before: Record<string, unknown>; after: Record<string, unknown> } | null
  const diff = (op === 'update' && changed && typeof changed === 'object' && 'before' in changed && 'after' in changed)
    ? changed as { before: Record<string, unknown>; after: Record<string, unknown> }
    : null
  const row = (op !== 'update' ? changed : null) as Record<string, unknown> | null

  if (t === 'matches') {
    if (op === 'insert') return `recorded a match (status ${row?.status ?? 'pending'})`
    if (op === 'delete') return `deleted a match`
    if (diff) {
      const beforeStatus = diff.before.status, afterStatus = diff.after.status
      if (beforeStatus !== afterStatus) {
        if (afterStatus === 'confirmed') return diff.after.auto_confirmed
          ? `match auto-confirmed`
          : `confirmed a match`
        if (afterStatus === 'disputed') return `disputed a match`
      }
      return `edited a match`
    }
  }

  if (t === 'profiles') {
    if (op === 'insert') return `signed up (${row?.full_name ?? 'unknown'})`
    if (op === 'delete') return `account deleted`
    if (diff) {
      if (diff.before.is_admin !== diff.after.is_admin) {
        return diff.after.is_admin ? `promoted to global admin` : `demoted from global admin`
      }
      return `edited profile`
    }
  }

  if (t === 'players') {
    if (op === 'insert') return row?.user_id ? `linked player created` : `unclaimed player created (${row?.name ?? '?'})`
    if (op === 'delete') return `deleted player (${row?.name ?? '?'})`
    if (diff) {
      if (!diff.before.user_id && diff.after.user_id) return `claimed a player`
      return `edited player ${diff.after.name ?? ''}`
    }
  }

  if (t === 'challenges') {
    if (op === 'insert') return `sent a challenge`
    if (op === 'delete') return `removed a challenge`
    if (diff) {
      if (diff.before.status !== diff.after.status) return `challenge ${diff.after.status}`
      return `edited a challenge`
    }
  }

  if (t === 'club_admins') {
    if (op === 'insert') return `granted club-admin (${row?.club_slug ?? ''})`
    if (op === 'delete') return `revoked club-admin (${row?.club_slug ?? ''})`
  }

  if (t === 'clubs') {
    if (op === 'insert') return `created club ${row?.name ?? row?.slug ?? ''}`
    if (op === 'delete') return `deleted club ${row?.name ?? row?.slug ?? ''}`
    if (diff) return `edited club ${diff.after.name ?? diff.after.slug ?? ''}`
  }

  if (t === 'groups') {
    if (op === 'insert') return `created group ${row?.name ?? ''}`
    if (op === 'delete') return `deleted group ${row?.name ?? ''}`
    if (diff) return `edited group ${diff.after.name ?? ''}`
  }

  if (t === 'group_members') {
    if (op === 'insert') return row?.is_admin ? `added group admin` : `added a group member`
    if (op === 'delete') return `removed a group member`
    if (diff) {
      if (diff.before.is_admin !== diff.after.is_admin) {
        return diff.after.is_admin ? `promoted group member to admin` : `demoted group admin to member`
      }
      return `edited group member`
    }
  }

  if (t === 'settings') {
    if (op === 'insert') return `initial settings saved`
    if (op === 'update') return `algorithm settings changed`
    if (op === 'delete') return `settings reset`
  }

  return `${ENTITY_LABEL[t]} ${op}`
}
