import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../state/store'
import { createGroup, fetchMyGroupRoles, listGroups } from '../lib/supabase/groups'
import { supabaseEnabled } from '../lib/supabase/client'
import { Alert } from '../components/Alert'
import { OrgAvatar } from '../components/OrgAvatar'
import type { Group } from '../types'

type Role = 'admin' | 'member' | 'public' | 'private-admin-view'

export function GroupsPage() {
  const { session, myPlayer, isAdmin } = useStore()
  const [groups, setGroups] = useState<Group[]>([])
  const [roles, setRoles] = useState<Map<string, { isAdmin: boolean }>>(new Map())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const refresh = () => {
    if (!supabaseEnabled) {
      setLoading(false)
      return
    }
    setLoading(true)
    Promise.all([
      listGroups(),
      myPlayer ? fetchMyGroupRoles(myPlayer.id).catch(() => new Map()) : Promise.resolve(new Map()),
    ])
      .then(([gs, rs]) => {
        setGroups(gs)
        setRoles(rs)
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPlayer?.id])

  const roleFor = (g: Group): Role => {
    const r = roles.get(g.id)
    if (r?.isAdmin) return 'admin'
    if (r) return 'member'
    if (!g.isPrivate) return 'public'
    return 'private-admin-view' // visible only because viewer is global admin
  }

  // Sort: admined groups first, then memberships, then public, then private-admin-view.
  // Within each tier, alphabetical by name.
  const ROLE_ORDER: Record<Role, number> = {
    admin: 0,
    member: 1,
    public: 2,
    'private-admin-view': 3,
  }

  const sortedGroups = useMemo(() => {
    const withRole = groups.map((g) => ({ g, role: roleFor(g) }))
    withRole.sort((a, b) => {
      const d = ROLE_ORDER[a.role] - ROLE_ORDER[b.role]
      return d !== 0 ? d : a.g.name.localeCompare(b.g.name)
    })
    return withRole
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, roles])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sortedGroups
    return sortedGroups.filter(({ g }) =>
      [g.name, g.description].filter(Boolean).join(' ').toLowerCase().includes(q),
    )
  }, [sortedGroups, search])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1>Groups</h1>
        <span className="text-sm text-slate-500">{groups.length} {groups.length === 1 ? 'group' : 'groups'}</span>
      </div>
      <p className="text-sm text-slate-500">
        Groups are casual circles of players who play often — your WhatsApp/Telegram squash crew.
        Anyone can start a group and automatically becomes its admin; admins add members and can
        promote other members to admin too.
      </p>

      {isAdmin && groups.some((g) => g.isPrivate && !roles.has(g.id)) && (
        <Alert variant="warn">
          As global admin, you can see every group, including private ones you're not a member of.
          You can edit settings and add members in any group.
        </Alert>
      )}

      {session && myPlayer && supabaseEnabled && (
        <CreateGroupForm onCreated={refresh} />
      )}
      {!myPlayer && session && supabaseEnabled && (
        <div className="card text-sm text-slate-500">
          Finish setting up your player profile to create a group.
        </div>
      )}

      {err && <div className="text-sm text-red-600">Failed to load groups: {err}</div>}

      {groups.length > 0 && (
        <input
          type="search"
          className="input w-full sm:max-w-sm"
          placeholder="Search groups…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {loading ? (
        <div className="card text-center text-slate-500">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="card text-center text-slate-500">
          No groups yet. {session && myPlayer ? 'Be the first to start one!' : 'Sign in to start one.'}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center text-slate-500">No groups match "{search}".</div>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-3">
          {filtered.map(({ g, role }) => (
            <li key={g.id}>
              <Link
                to={`/groups/${encodeURIComponent(g.slug)}`}
                className="card block hover:border-brand-300 dark:hover:border-brand-700 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <OrgAvatar name={g.name} kind="group" size={40} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{g.name}</span>
                      <RoleTag role={role} />
                      {g.isPrivate && role !== 'private-admin-view' && (
                        <span className="tag bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">private</span>
                      )}
                    </div>
                    {g.description && (
                      <div className="text-xs text-slate-500 line-clamp-2 mt-0.5">{g.description}</div>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RoleTag({ role }: { role: Role }) {
  switch (role) {
    case 'admin':
      return <span className="tag-admin">you admin</span>
    case 'member':
      return (
        <span className="tag-brand">
          member
        </span>
      )
    case 'private-admin-view':
      return (
        <span className="tag bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
          private · admin view
        </span>
      )
    case 'public':
      return null
  }
}

function CreateGroupForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setErr(null)
    try {
      await createGroup({
        name: name.trim(),
        description: description.trim() || undefined,
        isPrivate,
      })
      setName('')
      setDescription('')
      setIsPrivate(false)
      setOpen(false)
      onCreated()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary text-sm">
        + Start a group
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="card space-y-2">
      <input
        className="input w-full"
        placeholder="Group name (e.g. Tuesday Bukit Timah crew)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        required
      />
      <textarea
        className="input w-full"
        rows={2}
        placeholder="Optional description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
        <span>Private (only members can see the leaderboard)</span>
      </label>
      {err && <div className="text-sm text-red-600">{err}</div>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy || !name.trim()} className="btn-primary">
          {busy ? 'Creating…' : 'Create group'}
        </button>
        <button type="button" onClick={() => { setOpen(false); setErr(null) }} className="btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  )
}
