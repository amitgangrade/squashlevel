import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fmtDate, fmtLevel } from '../lib/format'
import { gamesWonBy, pointsRatio, winnerSide } from '../lib/rating/levels'

const PALETTE = ['#7c3aed', '#06b6d4', '#f59e0b', '#ef4444', '#10b981', '#ec4899', '#6366f1', '#84cc16']

export function AnalyticsPage() {
  const { players, recomputed } = useStore()
  const [hid, setHid] = useState<Set<string>>(new Set())
  const [h2hA, setH2hA] = useState('')
  const [h2hB, setH2hB] = useState('')

  const chartData = useMemo(() => {
    const dates = new Set<string>()
    for (const p of players) {
      const s = recomputed.states.get(p.id)
      if (!s) continue
      for (const h of s.history) dates.add(h.date)
    }
    const sorted = [...dates].sort()
    return sorted.map((d) => {
      const row: Record<string, number | string> = { date: d }
      for (const p of players) {
        const s = recomputed.states.get(p.id)
        if (!s) continue
        const atOrBefore = s.history.filter((h) => h.date <= d)
        if (atOrBefore.length > 0) {
          row[p.name] = Math.round(atOrBefore[atOrBefore.length - 1].level)
        }
      }
      return row
    })
  }, [players, recomputed])

  const perPlayer = players.map((p) => {
    const ms = recomputed.matches.filter((m) => m.playerAId === p.id || m.playerBId === p.id)
    let wins = 0
    let losses = 0
    let pointsFor = 0
    let pointsAgainst = 0
    for (const m of ms) {
      const side = m.playerAId === p.id ? 'a' : 'b'
      const w = winnerSide(m.games)
      if (w === side) wins++
      else if (w !== null) losses++
      const mine = gamesWonBy(m.games, side)
      const theirs = m.games.length - mine
      pointsFor += mine
      pointsAgainst += theirs
      const pr = side === 'a' ? pointsRatio(m.games) : 1 - pointsRatio(m.games)
      pointsFor += pr * 0
    }
    const total = wins + losses
    return {
      id: p.id,
      name: p.name,
      matches: ms.length,
      wins,
      losses,
      winRate: total > 0 ? wins / total : 0,
    }
  })

  const h2h = useMemo(() => {
    if (!h2hA || !h2hB || h2hA === h2hB) return null
    const ms = recomputed.matches.filter(
      (m) =>
        (m.playerAId === h2hA && m.playerBId === h2hB) ||
        (m.playerAId === h2hB && m.playerBId === h2hA),
    )
    let aWins = 0
    let bWins = 0
    for (const m of ms) {
      const w = winnerSide(m.games)
      if (w === 'a') m.playerAId === h2hA ? aWins++ : bWins++
      else if (w === 'b') m.playerBId === h2hA ? aWins++ : bWins++
    }
    return { matches: ms, aWins, bWins }
  }, [h2hA, h2hB, recomputed.matches])

  const toggleHidden = (name: string) => {
    setHid((prev) => {
      const n = new Set(prev)
      if (n.has(name)) n.delete(name)
      else n.add(name)
      return n
    })
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="mb-3">Level over time</h1>
        {chartData.length <= 1 ? (
          <div className="card text-center text-slate-500">Log some matches to see trends.</div>
        ) : (
          <div className="card">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" tickFormatter={(d) => fmtDate(String(d))} fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip
                    labelFormatter={(l) => fmtDate(String(l))}
                    formatter={(v) => fmtLevel(Number(v))}
                  />
                  <Legend onClick={(e) => toggleHidden(String(e.dataKey ?? ''))} />
                  {players.map((p, i) => (
                    <Line
                      key={p.id}
                      type="monotone"
                      dataKey={p.name}
                      stroke={PALETTE[i % PALETTE.length]}
                      strokeWidth={2}
                      dot={false}
                      hide={hid.has(p.name)}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-slate-500 mt-2">Click a player in the legend to show/hide.</p>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3">Player stats</h2>
        {perPlayer.length === 0 ? (
          <div className="card text-center text-slate-500">No players.</div>
        ) : (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Player</th>
                  <th className="px-3 py-2 text-right">Matches</th>
                  <th className="px-3 py-2 text-right">W</th>
                  <th className="px-3 py-2 text-right">L</th>
                  <th className="px-3 py-2 text-right">Win %</th>
                </tr>
              </thead>
              <tbody>
                {perPlayer.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-right">{r.matches}</td>
                    <td className="px-3 py-2 text-right text-green-600">{r.wins}</td>
                    <td className="px-3 py-2 text-right text-red-600">{r.losses}</td>
                    <td className="px-3 py-2 text-right">{(r.winRate * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3">Head-to-head</h2>
        <div className="card space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <select className="input" value={h2hA} onChange={(e) => setH2hA(e.target.value)}>
              <option value="">Player A…</option>
              {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="input" value={h2hB} onChange={(e) => setH2hB(e.target.value)}>
              <option value="">Player B…</option>
              {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {h2h && (
            <div className="text-sm">
              <div className="font-medium mb-2">
                {players.find((p) => p.id === h2hA)?.name} {h2h.aWins} – {h2h.bWins} {players.find((p) => p.id === h2hB)?.name}
                <span className="ml-2 text-slate-500">({h2h.matches.length} matches)</span>
              </div>
              <ul className="space-y-1 text-xs">
                {h2h.matches.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).map((m) => (
                  <li key={m.id} className="text-slate-600 dark:text-slate-300">
                    {fmtDate(m.date)} — {m.games.map((g) => `${g.a}-${g.b}`).join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
