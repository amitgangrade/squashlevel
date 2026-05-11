import { useMemo, useState } from 'react'
import { Pagination } from '../components/Pagination'
import { Link } from 'react-router-dom'
import { useStore } from '../state/store'
import { fmtLevel, playerAge } from '../lib/format'
import { COUNTRIES, distinctValues } from '../lib/places'
import { parseProfileFields } from '../lib/profile-validation'
import { filterByTokens, joinHay } from '../lib/search'
import {
  DOMINANT_HAND_LABEL,
  GENDER_LABEL,
  type DominantHand,
  type Gender,
  type Player,
} from '../types'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { PlayerLink, PlayerMetaLinks } from '../components/PlayerLinks'
import { ProvisionalTag } from '../components/ProvisionalTag'

interface FormState {
  name: string
  startingLevel: string
  email: string
  phone: string
  country: string
  city: string
  club: string
  birthYear: string
  gender: Gender | ''
  dominantHand: DominantHand | ''
  notes: string
}

const emptyForm: FormState = {
  name: '',
  startingLevel: '1000',
  email: '',
  phone: '',
  country: '',
  city: '',
  club: '',
  birthYear: '',
  gender: '',
  dominantHand: '',
  notes: '',
}

function fromPlayer(p: Player): FormState {
  return {
    name: p.name,
    startingLevel: String(p.startingLevel),
    email: p.email ?? '',
    phone: p.phone ?? '',
    country: p.country ?? '',
    city: p.city ?? '',
    club: p.club ?? '',
    birthYear: p.birthYear ? String(p.birthYear) : '',
    gender: p.gender ?? '',
    dominantHand: p.dominantHand ?? '',
    notes: p.notes ?? '',
  }
}

export function RosterPage() {
  const { players, recomputed, settings, isAdmin, addPlayer, updatePlayer, removePlayer, playerUrl } = useStore()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 100
  const cityOptions = useMemo(() => distinctValues(players, 'city'), [players])
  const clubOptions = useMemo(() => distinctValues(players, 'club'), [players])

  const reset = () => {
    setForm(emptyForm)
    setEditingId(null)
    setError('')
    setShowForm(false)
  }

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const lvl = Number(form.startingLevel)
    if (!form.name.trim()) return setError('Name is required')
    if (!Number.isFinite(lvl) || lvl <= 0) return setError('Starting level must be a positive number')
    const trimmedEmail = form.email.trim()
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return setError('Email looks invalid')
    }
    const parsed = parseProfileFields({ birthYear: form.birthYear, country: form.country, city: form.city })
    if (!parsed.ok) return setError(parsed.error)
    const data = {
      name: form.name.trim(),
      startingLevel: lvl,
      email: trimmedEmail || undefined,
      phone: form.phone.trim() || undefined,
      country: parsed.values.country,
      city: parsed.values.city,
      club: form.club.trim() || undefined,
      birthYear: parsed.values.birthYear,
      gender: form.gender || undefined,
      dominantHand: form.dominantHand || undefined,
      notes: form.notes.trim() || undefined,
    }
    try {
      if (editingId) {
        const existing = players.find((p) => p.id === editingId)!
        await updatePlayer({ ...existing, ...data })
      } else {
        await addPlayer(data)
      }
      reset()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const beginEdit = (p: Player) => {
    setEditingId(p.id)
    setForm(fromPlayer(p))
    setError('')
    setShowForm(true)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const remove = async (p: Player) => {
    // Wording mirrors the destructiveness of the underlying action:
    //   • Claimed → full user delete via admin_delete_user (auth + profile +
    //     player cascade). Match the language used in Settings → Admins.
    //   • Unclaimed → drop the stub player row; matches cascade.
    let msg: string
    if (p.userId) {
      msg =
        `Permanently delete ${p.name}${p.email ? ` (${p.email})` : ''}?\n\n` +
        `This removes their account, profile, player record, and every match, ` +
        `group membership, and challenge they were part of. ` +
        `Levels for opponents will be stale until you run "Rebuild levels".\n\n` +
        `This cannot be undone.`
    } else {
      const hasMatches = recomputed.matches.some(
        (m) => m.playerAId === p.id || m.playerBId === p.id,
      )
      msg = hasMatches
        ? `${p.name} has matches logged. Remove the player AND all their matches?`
        : `Remove ${p.name}?`
    }
    if (!window.confirm(msg)) return
    try {
      await removePlayer(p.id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const filteredPlayers = useMemo(
    () => filterByTokens(players, search, (p) => joinHay([p.name, p.club, p.country, p.city, p.email])),
    [players, search],
  )

  const visiblePlayers = useMemo(
    () => filteredPlayers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filteredPlayers, page, PAGE_SIZE],
  )

  return (
    <div className="space-y-6">
      {isAdmin && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h1>{editingId ? 'Edit player' : 'Players'}</h1>
            {!showForm && !editingId && (
              <button className="btn-primary" onClick={() => setShowForm(true)}>+ Add player</button>
            )}
          </div>
          {showForm && (
            <form onSubmit={onSubmit} className="card space-y-3 max-w-2xl">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="name">Name</label>
                  <input id="name" className="input w-full" value={form.name} onChange={(e) => update('name', e.target.value)} autoFocus />
                </div>
                <div>
                  <label className="label" htmlFor="level">Starting level</label>
                  <input
                    id="level"
                    className="input w-full"
                    inputMode="numeric"
                    value={form.startingLevel}
                    onChange={(e) => update('startingLevel', e.target.value)}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Use the player's SquashLevels.com rating if known (e.g. 1200), otherwise 1000.
                  </p>
                </div>
                <div>
                  <label className="label" htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    className="input w-full"
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                    placeholder="player@example.com"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="phone">Phone</label>
                  <input id="phone" type="tel" className="input w-full" value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="+65 9123 4567" />
                </div>
                <div>
                  <label className="label" htmlFor="club">Club</label>
                  <input id="club" list="roster-club-options" className="input w-full" value={form.club} onChange={(e) => update('club', e.target.value)} placeholder="e.g. Singapore Cricket Club" />
                </div>
                <div>
                  <label className="label" htmlFor="country">Country</label>
                  <input id="country" list="roster-country-options" className="input w-full" value={form.country} onChange={(e) => update('country', e.target.value)} placeholder="Singapore" autoComplete="country-name" />
                </div>
                <div>
                  <label className="label" htmlFor="city">City</label>
                  <input id="city" list="roster-city-options" className="input w-full" value={form.city} onChange={(e) => update('city', e.target.value)} placeholder="Singapore" autoComplete="address-level2" />
                </div>
                <datalist id="roster-country-options">
                  {COUNTRIES.map((c) => <option key={c} value={c} />)}
                </datalist>
                <datalist id="roster-city-options">
                  {cityOptions.map((c) => <option key={c} value={c} />)}
                </datalist>
                <datalist id="roster-club-options">
                  {clubOptions.map((c) => <option key={c} value={c} />)}
                </datalist>
                <div>
                  <label className="label" htmlFor="birthYear">Year of birth</label>
                  <input id="birthYear" inputMode="numeric" className="input w-full" value={form.birthYear} onChange={(e) => update('birthYear', e.target.value)} placeholder="1985" />
                </div>
                <div>
                  <label className="label" htmlFor="gender">Gender</label>
                  <select id="gender" className="input w-full" value={form.gender} onChange={(e) => update('gender', e.target.value as Gender | '')}>
                    <option value="">—</option>
                    {(Object.keys(GENDER_LABEL) as Gender[]).map((g) => (
                      <option key={g} value={g}>{GENDER_LABEL[g]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="hand">Dominant hand</label>
                  <select id="hand" className="input w-full" value={form.dominantHand} onChange={(e) => update('dominantHand', e.target.value as DominantHand | '')}>
                    <option value="">—</option>
                    {(Object.keys(DOMINANT_HAND_LABEL) as DominantHand[]).map((h) => (
                      <option key={h} value={h}>{DOMINANT_HAND_LABEL[h]}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="notes">Notes</label>
                  <input id="notes" className="input w-full" value={form.notes} onChange={(e) => update('notes', e.target.value)} />
                </div>
              </div>
              {error && <div className="text-sm text-red-600">{error}</div>}
              <div className="flex gap-2">
                <button className="btn-primary" type="submit">{editingId ? 'Save' : 'Add'}</button>
                <button type="button" className="btn-secondary" onClick={reset}>Cancel</button>
              </div>
            </form>
          )}
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-2 gap-2">
          <h2>
            Players{' '}
            {search.trim()
              ? `(${filteredPlayers.length.toLocaleString()} of ${players.length.toLocaleString()})`
              : `(${players.length.toLocaleString()})`}
          </h2>
          <input
            type="search"
            className="input w-40 sm:w-64"
            placeholder="Search by name, club, country…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
          />
        </div>
        {players.length === 0 ? (
          <div className="card text-slate-500 text-center">No players yet.</div>
        ) : filteredPlayers.length === 0 ? (
          <div className="card text-slate-500 text-center">No players match "{search}".</div>
        ) : (
          <>
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Player</th>
                  <th className="px-3 py-2 text-left hidden md:table-cell">Club</th>
                  <th className="px-3 py-2 text-left hidden md:table-cell">Country</th>
                  <th className="px-3 py-2 text-right">Start</th>
                  <th className="px-3 py-2 text-right">Current</th>
                  <th className="px-3 py-2 text-right">Matches</th>
                  {isAdmin && <th className="px-3 py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {visiblePlayers.map((p) => {
                  // Prefer server-truth fields on Player (cloud, where the
                  // store's matches array is lazy-loaded and the in-memory
                  // recompute returns 0 for everyone). Fall back to the
                  // recompute for local mode.
                  const s = recomputed.states.get(p.id)
                  const currentLevel = p.currentLevel ?? s?.currentLevel ?? p.startingLevel
                  const matchesPlayed = p.matchesPlayed ?? s?.matchesPlayed ?? 0
                  const prov = matchesPlayed < settings.provisionalThreshold
                  const age = playerAge(p.birthYear)
                  return (
                    <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <Link to={playerUrl(p.id)} aria-label={`View ${p.name}'s profile`}>
                            <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} size={32} />
                          </Link>
                          <div className="min-w-0">
                            <div className="font-medium truncate flex items-center gap-2">
                              <PlayerLink id={p.id} name={p.name} className="truncate" />
                              {prov && <ProvisionalTag />}
                            </div>
                            <div className="truncate md:hidden">
                              <PlayerMetaLinks player={p} />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 hidden md:table-cell text-slate-600 dark:text-slate-300">
                        {p.club ? (
                          <Link to={`/?club=${encodeURIComponent(p.club)}`} className="hover:underline">
                            {p.club}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 hidden md:table-cell text-slate-600 dark:text-slate-300">
                        {p.country ? (
                          <Link to={`/?country=${encodeURIComponent(p.country)}`} className="hover:underline">
                            {p.country}
                          </Link>
                        ) : (
                          '—'
                        )}
                        {age !== null && <span className="text-xs text-slate-400 ml-1">· age {age}</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{fmtLevel(p.startingLevel)}</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        <Link to={playerUrl(p.id)} className="hover:underline">
                          {fmtLevel(currentLevel)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">
                        {matchesPlayed > 0 ? (
                          <Link to={playerUrl(p.id)} className="hover:underline">
                            {matchesPlayed}
                          </Link>
                        ) : (
                          0
                        )}
                      </td>
                      {isAdmin && (
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button className="btn-link" onClick={() => beginEdit(p)}>Edit</button>
                          <button className="btn-link-danger ml-1" onClick={() => remove(p)}>Delete</button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={filteredPlayers.length}
            onPage={setPage}
            noun="players"
          />
          </>
        )}
      </section>
    </div>
  )
}
