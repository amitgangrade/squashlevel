import { useState } from 'react'
import { useStore } from '../state/store'
import { fmtLevel } from '../lib/format'
import type { Player } from '../types'

export function RosterPage() {
  const { players, recomputed, settings, canEdit, addPlayer, updatePlayer, removePlayer } = useStore()
  const [name, setName] = useState('')
  const [startingLevel, setStartingLevel] = useState<string>('1000')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const reset = () => {
    setName('')
    setStartingLevel('1000')
    setNotes('')
    setEditingId(null)
    setError('')
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const lvl = Number(startingLevel)
    if (!name.trim()) return setError('Name is required')
    if (!Number.isFinite(lvl) || lvl <= 0) return setError('Starting level must be a positive number')
    if (editingId) {
      const existing = players.find((p) => p.id === editingId)!
      await updatePlayer({ ...existing, name: name.trim(), startingLevel: lvl, notes: notes || undefined })
    } else {
      await addPlayer({ name: name.trim(), startingLevel: lvl, notes: notes || undefined })
    }
    reset()
  }

  const beginEdit = (p: Player) => {
    setEditingId(p.id)
    setName(p.name)
    setStartingLevel(String(p.startingLevel))
    setNotes(p.notes ?? '')
    setError('')
  }

  const remove = async (p: Player) => {
    const hasMatches = recomputed.matches.some(
      (m) => m.playerAId === p.id || m.playerBId === p.id,
    )
    const msg = hasMatches
      ? `${p.name} has matches logged. Remove the player AND all their matches?`
      : `Remove ${p.name}?`
    if (!window.confirm(msg)) return
    await removePlayer(p.id)
  }

  return (
    <div className="space-y-6">
      {canEdit && (
      <section>
        <h1 className="mb-3">{editingId ? 'Edit player' : 'Add player'}</h1>
        <form onSubmit={onSubmit} className="card space-y-3 max-w-lg">
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" className="input w-full" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label" htmlFor="level">Starting level</label>
            <input
              id="level"
              className="input w-full"
              inputMode="numeric"
              value={startingLevel}
              onChange={(e) => setStartingLevel(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              Use the player's current rating from SquashLevels.com (e.g. 1200). Scale: 50 beginner → 50,000+ top pro.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="notes">Notes (optional)</label>
            <input id="notes" className="input w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <div className="flex gap-2">
            <button className="btn-primary" type="submit">{editingId ? 'Save' : 'Add'}</button>
            {editingId && <button type="button" className="btn-secondary" onClick={reset}>Cancel</button>}
          </div>
        </form>
      </section>
      )}

      <section>
        <h2 className="mb-2">Players ({players.length})</h2>
        {players.length === 0 ? (
          <div className="card text-slate-500 text-center">No players yet.</div>
        ) : (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-right">Start</th>
                  <th className="px-3 py-2 text-right">Current</th>
                  <th className="px-3 py-2 text-right">Matches</th>
                  {canEdit && <th className="px-3 py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {players.map((p) => {
                  const s = recomputed.states.get(p.id)
                  const prov = (s?.matchesPlayed ?? 0) < settings.provisionalThreshold
                  return (
                    <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 font-medium">
                        {p.name}
                        {prov && <span className="ml-2 tag">P</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{fmtLevel(p.startingLevel)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmtLevel(s?.currentLevel)}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{s?.matchesPlayed ?? 0}</td>
                      {canEdit && (
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button className="text-xs text-brand-600 hover:underline" onClick={() => beginEdit(p)}>Edit</button>
                          <button className="ml-3 text-xs text-red-600 hover:underline" onClick={() => remove(p)}>Delete</button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
