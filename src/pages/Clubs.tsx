import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../state/store'
import { summarizeClubs } from '../lib/supabase/clubs'

export function ClubsPage() {
  const { players } = useStore()
  const [search, setSearch] = useState('')

  const clubs = useMemo(() => summarizeClubs(players), [players])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clubs
    return clubs.filter((c) =>
      [c.name, c.city, c.country].filter(Boolean).join(' ').toLowerCase().includes(q),
    )
  }, [clubs, search])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1>Clubs</h1>
        <span className="text-sm text-slate-500">{clubs.length} {clubs.length === 1 ? 'club' : 'clubs'}</span>
      </div>
      <p className="text-sm text-slate-500">
        Clubs are inferred from each player's home club. Join a club from your profile, or pick one
        below to see their leaderboard and recent matches.
      </p>

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
          No clubs yet. Set your home club from your profile to start one.
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center text-slate-500">No clubs match "{search}".</div>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-3">
          {filtered.map((c) => (
            <li key={c.slug}>
              <Link
                to={`/clubs/${encodeURIComponent(c.slug)}`}
                className="card flex items-start gap-3 hover:border-brand-300 dark:hover:border-brand-700 transition-colors"
              >
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-brand-100 text-brand-700 font-semibold dark:bg-brand-900/40 dark:text-brand-200">
                  {c.name.slice(0, 2).toUpperCase()}
                </div>
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
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
