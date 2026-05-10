import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../state/store'
import {
  createClub,
  deleteClub,
  listClubs,
  mergeClubs,
  summarizeClubs,
  type ClubSummary,
} from '../lib/supabase/clubs'
import { supabaseEnabled } from '../lib/supabase/client'
import { OrgAvatar } from '../components/OrgAvatar'
import type { Club } from '../types'

export function ClubsPage() {
  const { players, isAdmin } = useStore()
  const [search, setSearch] = useState('')
  const [registered, setRegistered] = useState<Club[]>([])
  const [registryError, setRegistryError] = useState<string | null>(null)

  const refresh = () => {
    if (!supabaseEnabled) return
    listClubs()
      .then(setRegistered)
      .catch((e) => setRegistryError((e as Error).message))
  }

  useEffect(() => {
    refresh()
  }, [])

  const derived = useMemo(() => summarizeClubs(players), [players])
  const clubs = useMemo<ClubSummary[]>(
    () => (supabaseEnabled ? mergeClubs(registered, derived) : derived),
    [registered, derived],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clubs
    return clubs.filter((c) =>
      [c.name, c.city, c.country].filter(Boolean).join(' ').toLowerCase().includes(q),
    )
  }, [clubs, search])

  const knownSlugs = useMemo(() => new Set(registered.map((c) => c.slug)), [registered])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1>Clubs</h1>
        <span className="text-sm text-slate-500">{clubs.length} {clubs.length === 1 ? 'club' : 'clubs'}</span>
      </div>
      <p className="text-sm text-slate-500">
        Clubs are home venues — players belong to one. Pick a club to see its leaderboard and
        recent matches, or join one from your profile.
      </p>

      {isAdmin && supabaseEnabled && (
        <AddClubForm onCreated={refresh} />
      )}
      {registryError && (
        <div className="text-xs text-red-600">Failed to load club registry: {registryError}</div>
      )}

      {clubs.length > 0 && (
        <input
          type="search"
          className="input w-full sm:max-w-sm"
          placeholder="Search clubs by name, city, or country…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {clubs.length === 0 ? (
        <div className="card text-center text-slate-500">
          No clubs yet. {isAdmin ? 'Add the first one above.' : 'Set your home club from your profile to start one.'}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center text-slate-500">No clubs match "{search}".</div>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-3">
          {filtered.map((c) => (
            <li key={c.slug} className="relative group">
              <Link
                to={`/clubs/${encodeURIComponent(c.slug)}`}
                className="card flex items-start gap-3 hover:border-brand-300 dark:hover:border-brand-700 transition-colors"
              >
                <OrgAvatar name={c.name} kind="club" size={40} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{c.name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {[c.city, c.country].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500 shrink-0">
                  <div className="text-base font-semibold text-slate-700 dark:text-slate-200">{c.members}</div>
                  <div className="uppercase tracking-wider">{c.members === 1 ? 'member' : 'members'}</div>
                </div>
              </Link>
              {isAdmin && knownSlugs.has(c.slug) && (
                <DeleteClubButton slug={c.slug} name={c.name} onDeleted={refresh} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AddClubForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setErr(null)
    try {
      await createClub({ name: name.trim(), city: city.trim() || undefined, country: country.trim() || undefined })
      setName('')
      setCity('')
      setCountry('')
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
      <button onClick={() => setOpen(true)} className="btn-secondary text-sm">
        + Add club
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="card space-y-2">
      <div className="grid sm:grid-cols-3 gap-2">
        <input
          className="input"
          placeholder="Club name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
        <input
          className="input"
          placeholder="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
        <input
          className="input"
          placeholder="Country"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        />
      </div>
      {err && <div className="text-sm text-red-600">{err}</div>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy || !name.trim()} className="btn-primary">
          {busy ? 'Adding…' : 'Add club'}
        </button>
        <button type="button" onClick={() => { setOpen(false); setErr(null) }} className="btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  )
}

function DeleteClubButton({
  slug,
  name,
  onDeleted,
}: {
  slug: string
  name: string
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Remove "${name}" from the club directory? Player records keep this club name.`)) return
    setBusy(true)
    try {
      await deleteClub(slug)
      onDeleted()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      title="Remove from directory"
      aria-label={`Remove ${name}`}
      className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-white/80 text-slate-500 hover:bg-red-100 hover:text-red-700 dark:bg-slate-900/80 dark:hover:bg-red-900/40 dark:hover:text-red-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
    >
      ×
    </button>
  )
}
