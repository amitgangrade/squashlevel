import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { downloadExport, restoreFromJson } from '../lib/storage/import-export'
import { DEFAULT_SETTINGS, type Profile, type Settings } from '../types'
import { listAllProfiles, setAdminFlag } from '../lib/supabase/profile'
import { listClubAdminsForAdmin, setClubAdmin, summarizeClubs } from '../lib/supabase/clubs'
import { supabaseEnabled } from '../lib/supabase/client'
import { PlayerAvatar } from '../components/PlayerAvatar'
import type { ClubAdmin } from '../types'

export function SettingsPage() {
  const {
    settings, isAdmin, updateSettings, resetAll, refresh,
    rebuildLevels, rebuildRunning, rebuildStatus, rebuildError, rebuildStartedAt, dismissRebuildError,
  } = useStore()
  const [draft, setDraft] = useState<Settings>(settings)
  const [msg, setMsg] = useState('')
  const [importing, setImporting] = useState(false)
  const [, forceTick] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  // Tick once a second while rebuilding so the elapsed-time counter stays
  // live. Driven by store state, so it picks back up correctly if the user
  // navigates away and returns mid-rebuild.
  useEffect(() => {
    if (!rebuildRunning) return
    const t = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [rebuildRunning])

  const save = async () => {
    await updateSettings(draft)
    setMsg('Saved. Levels recompute automatically.')
    setTimeout(() => setMsg(''), 2500)
  }

  const onExport = () => downloadExport()

  const onImportClick = () => fileRef.current?.click()

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      const text = await f.text()
      if (!window.confirm('This will replace ALL current data. Continue?')) return
      setImporting(true)
      setMsg('Importing… this may take several minutes for large files.')
      await restoreFromJson(text)
      await refresh()
      setMsg('Import succeeded.')
    } catch (err) {
      setMsg('Import failed: ' + (err as Error).message)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
      setTimeout(() => setMsg(''), 3500)
    }
  }

  const onReset = async () => {
    if (!window.confirm('Delete ALL players, matches, and settings? This cannot be undone.')) return
    await resetAll()
    setDraft(DEFAULT_SETTINGS)
    setMsg('All data cleared.')
    setTimeout(() => setMsg(''), 2500)
  }

  const onRebuild = async () => {
    if (rebuildRunning) return
    if (!window.confirm('Recompute every player\'s level and match count from match history? This may take a while on large datasets.')) return
    try {
      const r = await rebuildLevels()
      // r is null only if a guard rejected the call (already running) — else
      // we have a fresh result to surface. Error path is handled by the store
      // setting rebuildError; nothing to do here.
      if (r) {
        setMsg(`Rebuild complete: ${r.matchesUpdated.toLocaleString()} matches, ${r.playersUpdated.toLocaleString()} players updated.`)
        setTimeout(() => setMsg(''), 8000)
      }
    } catch {
      // Already captured into rebuildError by the store; no extra UI work here.
    }
  }

  const elapsedLabel = rebuildStartedAt ? `${Math.floor((Date.now() - rebuildStartedAt) / 1000)}s` : ''

  const num = (val: string, fallback: number) => {
    const n = Number(val)
    return Number.isFinite(n) ? n : fallback
  }

  if (!isAdmin) {
    return (
      <div className="card text-slate-500 text-sm">
        Settings are only editable by the owner. Current algorithm values are applied automatically.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {supabaseEnabled && (
        <section>
          <h1 className="mb-3">Admins</h1>
          <AdminManager />
        </section>
      )}

      {supabaseEnabled && (
        <section>
          <h2 className="mb-3">Club admins</h2>
          <ClubAdminManager />
        </section>
      )}

      <section>
        <h2 className="mb-3">Algorithm settings</h2>
        <p className="text-sm text-slate-500 mb-3">
          These tune how the SquashLevels-style algorithm behaves. Defaults are calibrated to match documented behaviour (equal levels → 50/50 points, 2× level → ~80% points / ~97% games). Changing values triggers a full recompute from match history.
        </p>
        <div className="card space-y-3 max-w-lg">
          <Field label="Damping (K)" help="How fast levels move per match. Higher = more volatile.">
            <input
              type="number"
              step="0.01"
              className="input w-full"
              value={draft.dampingK}
              onChange={(e) => setDraft({ ...draft, dampingK: num(e.target.value, draft.dampingK) })}
            />
          </Field>
          <Field label="Points weight" help="0 = games only, 1 = points only, 0.5 = blend. Keep at 0.5 unless you know why.">
            <input
              type="number"
              step="0.05"
              min={0}
              max={1}
              className="input w-full"
              value={draft.pointsWeight}
              onChange={(e) => setDraft({ ...draft, pointsWeight: num(e.target.value, draft.pointsWeight) })}
            />
          </Field>
          <Field label="Points exponent" help="Steepness of points-ratio curve. Default 2 → 2× level ≈ 80% points.">
            <input
              type="number"
              step="0.1"
              className="input w-full"
              value={draft.pointsExponent}
              onChange={(e) => setDraft({ ...draft, pointsExponent: num(e.target.value, draft.pointsExponent) })}
            />
          </Field>
          <Field label="Games exponent" help="Steepness of games-ratio curve. Default 5 → 2× level ≈ 97% games.">
            <input
              type="number"
              step="0.1"
              className="input w-full"
              value={draft.gamesExponent}
              onChange={(e) => setDraft({ ...draft, gamesExponent: num(e.target.value, draft.gamesExponent) })}
            />
          </Field>
          <Field label="Provisional threshold" help="Matches needed before a player stops being provisional.">
            <input
              type="number"
              step="1"
              className="input w-full"
              value={draft.provisionalThreshold}
              onChange={(e) => setDraft({ ...draft, provisionalThreshold: num(e.target.value, draft.provisionalThreshold) })}
            />
          </Field>
          <Field label="Moving-average window" help="Used for the 'ranking' stable level display.">
            <input
              type="number"
              step="1"
              className="input w-full"
              value={draft.movingAverageWindow}
              onChange={(e) => setDraft({ ...draft, movingAverageWindow: num(e.target.value, draft.movingAverageWindow) })}
            />
          </Field>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={save}>Save</button>
            <button className="btn-secondary" onClick={() => setDraft(DEFAULT_SETTINGS)}>Reset to defaults</button>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3">Maintenance</h2>
        <div className="card space-y-3 max-w-lg">
          <p className="text-sm text-slate-500">
            Recompute every player's current level and match count by replaying all confirmed matches.
            Use this after editing or deleting old matches, or after a dispute that flipped a confirmed match — incremental updates can drift in those cases.
          </p>
          <div className="flex gap-2 flex-wrap items-center">
            <button className="btn-secondary" onClick={onRebuild} disabled={rebuildRunning}>
              {rebuildRunning ? 'Rebuilding…' : 'Rebuild levels'}
            </button>
            {rebuildRunning && (
              <span className="text-xs text-slate-500">elapsed {elapsedLabel}</span>
            )}
          </div>

          {rebuildStatus && (
            <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3">
              <div className="flex items-center gap-2">
                <Spinner />
                <div className="text-sm text-slate-700 dark:text-slate-200 truncate">{rebuildStatus}</div>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Safe to navigate to other pages — rebuild keeps running in the background.
              </div>
            </div>
          )}

          {rebuildError && (
            <div className="rounded border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-900/20 p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-red-700 dark:text-red-300">Rebuild failed</div>
                  <pre className="mt-1 text-xs whitespace-pre-wrap break-words text-red-800 dark:text-red-200">{rebuildError}</pre>
                </div>
                <button
                  onClick={dismissRebuildError}
                  aria-label="Dismiss error"
                  className="text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 rounded px-2 py-0.5 leading-none"
                >
                  ×
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3">Backup & restore</h2>
        <div className="card space-y-2 max-w-lg">
          <p className="text-sm text-slate-500">
            Download a JSON backup of all your players, matches and settings. Import replaces everything.
          </p>
          <div className="flex gap-2 flex-wrap">
            <button className="btn-secondary" onClick={onExport}>Export JSON</button>
            <button className="btn-secondary" onClick={onImportClick} disabled={importing}>
              {importing ? 'Importing…' : 'Import JSON…'}
            </button>
            <button className="btn-danger" onClick={onReset}>Reset all data</button>
          </div>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={onFile} />
        </div>
      </section>

      {msg && <div className="fixed bottom-4 right-4 card text-sm">{msg}</div>}
    </div>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-slate-300 border-t-brand-600 animate-spin dark:border-slate-700 dark:border-t-brand-400"
    />
  )
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  )
}

function ClubAdminManager() {
  const { players } = useStore()
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [grants, setGrants] = useState<ClubAdmin[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // userId|slug
  const [err, setErr] = useState<string | null>(null)
  const [selectedSlug, setSelectedSlug] = useState<string>('')
  const [search, setSearch] = useState('')

  const clubs = useMemo(() => summarizeClubs(players), [players])

  useEffect(() => {
    Promise.all([listAllProfiles(), listClubAdminsForAdmin()])
      .then(([ps, gs]) => { setProfiles(ps); setGrants(gs) })
      .catch((e) => setErr((e as Error).message))
  }, [])

  // Default the picker to the first club so the section feels populated.
  useEffect(() => {
    if (!selectedSlug && clubs.length > 0) setSelectedSlug(clubs[0].slug)
  }, [clubs, selectedSlug])

  if (err && !profiles) return <div className="card text-sm text-red-600">{err}</div>
  if (profiles === null || grants === null) return <div className="card text-sm text-slate-500">Loading…</div>
  if (clubs.length === 0) {
    return <div className="card text-sm text-slate-500">No clubs yet — players need a "Club" set on their profile to form one.</div>
  }

  const club = clubs.find((c) => c.slug === selectedSlug)
  const grantedHere = grants.filter((g) => g.clubSlug === selectedSlug)
  const isGranted = (uid: string) => grantedHere.some((g) => g.userId === uid)

  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const candidates = profiles
    .filter((p) => {
      if (tokens.length === 0) return true
      const hay = [p.fullName, p.email, p.club, p.username].filter(Boolean).join(' ').toLowerCase()
      return tokens.every((t) => hay.includes(t))
    })
    .slice(0, 20)

  const toggle = async (uid: string, value: boolean) => {
    if (!selectedSlug) return
    setBusy(`${uid}|${selectedSlug}`)
    setErr(null)
    try {
      await setClubAdmin(uid, selectedSlug, value)
      const refreshed = await listClubAdminsForAdmin()
      setGrants(refreshed)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card space-y-3">
      <p className="text-sm text-slate-500">
        Club admins can add and edit players in their club, and log/edit matches involving any
        of their members. They cannot change global settings or promote other admins.
      </p>
      <div>
        <label className="label" htmlFor="club-pick">Club</label>
        <select
          id="club-pick"
          className="input w-full sm:max-w-md"
          value={selectedSlug}
          onChange={(e) => setSelectedSlug(e.target.value)}
        >
          {clubs.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name} — {c.members} {c.members === 1 ? 'member' : 'members'}
            </option>
          ))}
        </select>
      </div>

      {grantedHere.length > 0 ? (
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">
            Current admins for {club?.name}
          </p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {grantedHere.map((g) => {
              const profile = profiles.find((p) => p.id === g.userId)
              return (
                <li key={g.userId} className="flex items-center gap-3 py-2">
                  <PlayerAvatar name={g.fullName} avatarUrl={profile?.avatarUrl} size={32} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{g.fullName}</div>
                    <div className="text-xs text-slate-500 truncate">{g.email}</div>
                  </div>
                  <button
                    className="btn-link-danger"
                    onClick={() => toggle(g.userId, false)}
                    disabled={busy === `${g.userId}|${selectedSlug}`}
                  >
                    Revoke
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-slate-500">No club admins yet for {club?.name}.</p>
      )}

      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500 mt-3 mb-1">Add admin</p>
        <input
          type="search"
          className="input w-full"
          placeholder="Search registered users…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search.trim() && (
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-auto">
            {candidates.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <PlayerAvatar name={p.fullName} avatarUrl={p.avatarUrl} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.fullName}</div>
                  <div className="text-xs text-slate-500 truncate">{[p.club, p.email].filter(Boolean).join(' · ')}</div>
                </div>
                {isGranted(p.id) ? (
                  <span className="text-xs text-slate-400">already admin</span>
                ) : (
                  <button
                    className="btn-link"
                    onClick={() => toggle(p.id, true)}
                    disabled={busy === `${p.id}|${selectedSlug}`}
                  >
                    {busy === `${p.id}|${selectedSlug}` ? '…' : 'Make admin'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {err && <div className="text-sm text-red-600">{err}</div>}
    </div>
  )
}

function AdminManager() {
  const { profile: me } = useStore()
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    listAllProfiles()
      .then(setProfiles)
      .catch((e) => setErr((e as Error).message))
  }, [])

  const toggle = async (p: Profile) => {
    setBusyId(p.id)
    setErr(null)
    try {
      const updated = await setAdminFlag(p.id, !p.isAdmin)
      setProfiles((prev) => prev?.map((x) => (x.id === p.id ? updated : x)) ?? null)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  if (profiles === null && !err) {
    return <div className="card text-sm text-slate-500">Loading…</div>
  }
  if (err && !profiles) {
    return <div className="card text-sm text-red-600">{err}</div>
  }

  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const filtered = (profiles ?? []).filter((p) => {
    if (tokens.length === 0) return true
    const hay = [p.fullName, p.email, p.club, p.country, p.username].filter(Boolean).join(' ').toLowerCase()
    return tokens.every((t) => hay.includes(t))
  })

  return (
    <div className="card space-y-3">
      <p className="text-sm text-slate-500">
        Admins can edit any player, manage matches, and promote others. Only registered (signed-in) users appear here.
      </p>
      <input
        type="search"
        className="input w-full"
        placeholder="Search by name, email, club…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {err && <div className="text-sm text-red-600">{err}</div>}
      {filtered.length === 0 ? (
        <div className="text-sm text-slate-500 text-center py-3">No matches.</div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {filtered.map((p) => {
            const isMe = p.id === me?.id
            return (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <PlayerAvatar name={p.fullName} avatarUrl={p.avatarUrl} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate flex items-center gap-2">
                    <span className="truncate">{p.fullName}</span>
                    {p.isAdmin && (
                      <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">
                        admin
                      </span>
                    )}
                    {isMe && <span className="text-xs text-slate-500">(you)</span>}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {[p.club, p.country, p.email].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <button
                  className={p.isAdmin ? 'btn-link-danger' : 'btn-link'}
                  onClick={() => toggle(p)}
                  disabled={busyId === p.id}
                >
                  {busyId === p.id ? '…' : p.isAdmin ? 'Demote' : 'Make admin'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
