import { Link } from 'react-router-dom'
import { useStore } from '../state/store'
import { fmtDate, fmtDelta, fmtLevel } from '../lib/format'
import { movingAverage } from '../lib/rating/recompute'

export function DashboardPage() {
  const { players, matches, recomputed, settings, canEdit } = useStore()

  const rows = players
    .map((p) => {
      const s = recomputed.states.get(p.id)
      const level = s?.currentLevel ?? p.startingLevel
      const ranking = s ? movingAverage(s.history, settings.movingAverageWindow) : level
      return {
        id: p.id,
        name: p.name,
        level,
        ranking,
        played: (s?.matchesPlayed ?? 0),
        provisional: (s?.matchesPlayed ?? 0) < settings.provisionalThreshold,
      }
    })
    .sort((a, b) => b.ranking - a.ranking)

  const recent = [...recomputed.matches].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)

  const playerName = (id: string) => players.find((p) => p.id === id)?.name ?? 'Unknown'

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between mb-2">
          <h1>Leaderboard</h1>
          {canEdit && (
            <div className="flex gap-2">
              <Link className="btn-secondary" to="/roster">Add player</Link>
              <Link className="btn-primary" to="/log">Log match</Link>
            </div>
          )}
        </div>
        {rows.length === 0 ? (
          <div className="card text-center text-slate-500">
            {canEdit ? (
              <>No players yet. <Link className="text-brand-600 underline" to="/roster">Add your first player</Link> to get started.</>
            ) : (
              <>No players yet.</>
            )}
          </div>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Player</th>
                  <th className="px-3 py-2 text-right">Level</th>
                  <th className="px-3 py-2 text-right">4-match avg</th>
                  <th className="px-3 py-2 text-right">Matches</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">
                      {r.name}
                      {r.provisional && <span className="ml-2 tag">P</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{fmtLevel(r.level)}</td>
                    <td className="px-3 py-2 text-right">{fmtLevel(r.ranking)}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{r.played}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2>Recent matches</h2>
          {matches.length > 0 && <Link to="/history" className="text-sm text-brand-600">View all →</Link>}
        </div>
        {recent.length === 0 ? (
          <div className="card text-center text-slate-500">No matches logged yet.</div>
        ) : (
          <div className="space-y-2">
            {recent.map((m) => (
              <div key={m.id} className="card flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {playerName(m.playerAId)} <span className="text-slate-400">vs</span> {playerName(m.playerBId)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {fmtDate(m.date)} · {m.type} · {m.games.map((g) => `${g.a}-${g.b}`).join(', ')}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className={m.deltaA && m.deltaA >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {fmtDelta(m.deltaA)}
                  </div>
                  <div className={m.deltaB && m.deltaB >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {fmtDelta(m.deltaB)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
