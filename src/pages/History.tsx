import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { MATCH_TYPE_LABEL } from '../types'
import { fmtDate, fmtDelta, fmtLevel } from '../lib/format'

export function HistoryPage() {
  const { players, recomputed, removeMatch } = useStore()
  const [filter, setFilter] = useState<string>('')

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?'

  const rows = useMemo(() => {
    const sorted = [...recomputed.matches].sort((a, b) => b.date.localeCompare(a.date))
    if (!filter) return sorted
    return sorted.filter(
      (m) => m.playerAId === filter || m.playerBId === filter,
    )
  }, [recomputed.matches, filter])

  const remove = async (id: string) => {
    if (!window.confirm('Delete this match? Levels will be recomputed from history.')) return
    await removeMatch(id)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h1>Match history</h1>
        <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All players</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="card text-center text-slate-500">No matches found.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((m) => {
            const a = nameOf(m.playerAId)
            const b = nameOf(m.playerBId)
            return (
              <div key={m.id} className="card">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      {a} <span className="text-slate-400">vs</span> {b}
                    </div>
                    <div className="text-xs text-slate-500">
                      {fmtDate(m.date)} · {MATCH_TYPE_LABEL[m.type]} · {m.games.map((g) => `${g.a}-${g.b}`).join(', ')}
                    </div>
                    {m.notes && <div className="text-xs text-slate-500 mt-1 italic">{m.notes}</div>}
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="text-right">
                      <div className="text-xs text-slate-500">{a}</div>
                      <div>{fmtLevel(m.levelABefore)} → <span className="font-semibold">{fmtLevel(m.levelAAfter)}</span></div>
                      <div className={(m.deltaA ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtDelta(m.deltaA)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">{b}</div>
                      <div>{fmtLevel(m.levelBBefore)} → <span className="font-semibold">{fmtLevel(m.levelBAfter)}</span></div>
                      <div className={(m.deltaB ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtDelta(m.deltaB)}</div>
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-right">
                  <button className="text-xs text-red-600 hover:underline" onClick={() => remove(m.id)}>Delete</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
