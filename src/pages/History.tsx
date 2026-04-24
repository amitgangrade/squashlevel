import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../state/store'
import { MATCH_TYPE_LABEL } from '../types'
import { fmtDate, fmtDelta, fmtLevel } from '../lib/format'
import { summarizeMatch } from '../lib/match-summary'
import { GameScores } from '../components/MatchScores'

export function HistoryPage() {
  const { players, recomputed, canEdit, removeMatch } = useStore()
  const [filter, setFilter] = useState<string>('')

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
            const s = summarizeMatch(m, players)
            const aIsWinner = !s.isDraw && s.winnerId === m.playerAId
            const bIsWinner = !s.isDraw && s.winnerId === m.playerBId
            return (
              <div key={m.id} className="card">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={clsx('font-semibold', aIsWinner ? 'text-green-700 dark:text-green-400' : 'text-slate-500')}>
                        {s.aName}
                      </span>
                      <span className="font-mono text-base">
                        <span className={aIsWinner ? 'font-bold' : ''}>{s.aGames}</span>
                        <span className="text-slate-400 mx-1">–</span>
                        <span className={bIsWinner ? 'font-bold' : ''}>{s.bGames}</span>
                      </span>
                      <span className={clsx('font-semibold', bIsWinner ? 'text-green-700 dark:text-green-400' : 'text-slate-500')}>
                        {s.bName}
                      </span>
                      {!s.isDraw && (
                        <span className="ml-1 rounded-full bg-green-100 text-green-800 text-[10px] font-semibold px-2 py-0.5 dark:bg-green-900/40 dark:text-green-300">
                          {s.winnerName} won
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {fmtDate(m.date)} · {MATCH_TYPE_LABEL[m.type]}
                    </div>
                    <div className="mt-1">
                      <GameScores games={m.games} />
                    </div>
                    {m.notes && <div className="text-xs text-slate-500 mt-1 italic">{m.notes}</div>}
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm shrink-0">
                    <div className="text-right">
                      <div className={clsx('text-xs', aIsWinner ? 'text-green-700 dark:text-green-400 font-medium' : 'text-slate-500')}>{s.aName}</div>
                      <div>{fmtLevel(m.levelABefore)} → <span className="font-semibold">{fmtLevel(m.levelAAfter)}</span></div>
                      <div className={(m.deltaA ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtDelta(m.deltaA)}</div>
                    </div>
                    <div className="text-right">
                      <div className={clsx('text-xs', bIsWinner ? 'text-green-700 dark:text-green-400 font-medium' : 'text-slate-500')}>{s.bName}</div>
                      <div>{fmtLevel(m.levelBBefore)} → <span className="font-semibold">{fmtLevel(m.levelBAfter)}</span></div>
                      <div className={(m.deltaB ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtDelta(m.deltaB)}</div>
                    </div>
                  </div>
                </div>
                {canEdit && (
                  <div className="mt-2 text-right">
                    <button className="text-xs text-red-600 hover:underline" onClick={() => remove(m.id)}>Delete</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
