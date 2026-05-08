import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { downloadExport, restoreFromJson } from '../lib/storage/import-export'
import { DEFAULT_SETTINGS, type Profile, type Settings } from '../types'
import { listAllProfiles, setAdminFlag } from '../lib/supabase/profile'
import { supabaseEnabled } from '../lib/supabase/client'
import { PlayerAvatar } from '../components/PlayerAvatar'

export function SettingsPage() {
  const { settings, isAdmin, updateSettings, resetAll, refresh } = useStore()
  const [draft, setDraft] = useState<Settings>(settings)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

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
      await restoreFromJson(text)
      await refresh()
      setMsg('Import succeeded.')
    } catch (err) {
      setMsg('Import failed: ' + (err as Error).message)
    } finally {
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
        <h2 className="mb-3">Backup & restore</h2>
        <div className="card space-y-2 max-w-lg">
          <p className="text-sm text-slate-500">
            Download a JSON backup of all your players, matches and settings. Import replaces everything.
          </p>
          <div className="flex gap-2 flex-wrap">
            <button className="btn-secondary" onClick={onExport}>Export JSON</button>
            <button className="btn-secondary" onClick={onImportClick}>Import JSON…</button>
            <button className="btn-danger" onClick={onReset}>Reset all data</button>
          </div>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={onFile} />
        </div>
      </section>

      {msg && <div className="fixed bottom-4 right-4 card text-sm">{msg}</div>}
    </div>
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
