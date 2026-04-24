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
import { totalPoints } from '../lib/match-summary'
import { GameScores } from '../components/MatchScores'

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
    let aMatchWins = 0
    let bMatchWins = 0
    let aGamesWon = 0
    let bGamesWon = 0
    let aPoints = 0
    let bPoints = 0
    for (const m of ms) {
      const aIsSideA = m.playerAId === h2hA
      const winner = winnerSide(m.games)
      if (winner === 'a') aIsSideA ? aMatchWins++ : bMatchWins++
      else if (winner === 'b') aIsSideA ? bMatchWins++ : aMatchWins++
      const gA = gamesWonBy(m.games, 'a')
      const gB = gamesWonBy(m.games, 'b')
      aGamesWon += aIsSideA ? gA : gB
      bGamesWon += aIsSideA ? gB : gA
      const pts = totalPoints(m.games)
      aPoints += aIsSideA ? pts.a : pts.b
      bPoints += aIsSideA ? pts.b : pts.a
    }
    const totalGames = aGamesWon + bGamesWon
    const totalPts = aPoints + bPoints
    return {
      matches: ms,
      aMatchWins,
      bMatchWins,
      aGamesWon,
      bGamesWon,
      aPoints,
      bPoints,
      gameShareA: totalGames > 0 ? aGamesWon / totalGames : 0,
      gameShareB: totalGames > 0 ? bGamesWon / totalGames : 0,
      pointShareA: totalPts > 0 ? aPoints / totalPts : 0,
      pointShareB: totalPts > 0 ? bPoints / totalPts : 0,
    }
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
            <div className="text-sm space-y-4">
              <H2HBreakdown
                nameA={players.find((p) => p.id === h2hA)?.name ?? '?'}
                nameB={players.find((p) => p.id === h2hB)?.name ?? '?'}
                h2h={h2h}
              />
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Matches</div>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {h2h.matches.slice().sort((a, b) => b.date.localeCompare(a.date)).map((m) => {
                    const aName = players.find((p) => p.id === m.playerAId)?.name ?? '?'
                    const bName = players.find((p) => p.id === m.playerBId)?.name ?? '?'
                    const aGames = gamesWonBy(m.games, 'a')
                    const bGames = gamesWonBy(m.games, 'b')
                    const winner = winnerSide(m.games)
                    return (
                      <li key={m.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-xs text-slate-500 w-20 shrink-0">{fmtDate(m.date)}</span>
                        <span className="flex items-center gap-2">
                          <span className={winner === 'a' ? 'font-semibold text-green-700 dark:text-green-400' : 'text-slate-500'}>
                            {aName}
                          </span>
                          <span className="font-mono text-sm">
                            <span className={winner === 'a' ? 'font-bold' : ''}>{aGames}</span>
                            <span className="text-slate-400">–</span>
                            <span className={winner === 'b' ? 'font-bold' : ''}>{bGames}</span>
                          </span>
                          <span className={winner === 'b' ? 'font-semibold text-green-700 dark:text-green-400' : 'text-slate-500'}>
                            {bName}
                          </span>
                        </span>
                        <GameScores games={m.games} />
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

interface H2HData {
  matches: unknown[]
  aMatchWins: number
  bMatchWins: number
  aGamesWon: number
  bGamesWon: number
  aPoints: number
  bPoints: number
  gameShareA: number
  gameShareB: number
  pointShareA: number
  pointShareB: number
}

function H2HBreakdown({ nameA, nameB, h2h }: { nameA: string; nameB: string; h2h: H2HData }) {
  const totalMatches = h2h.aMatchWins + h2h.bMatchWins
  const matchShareA = totalMatches > 0 ? h2h.aMatchWins / totalMatches : 0
  const matchShareB = totalMatches > 0 ? h2h.bMatchWins / totalMatches : 0
  return (
    <div className="grid sm:grid-cols-3 gap-3">
      <StatBar
        label="Matches"
        a={{ name: nameA, value: h2h.aMatchWins, share: matchShareA }}
        b={{ name: nameB, value: h2h.bMatchWins, share: matchShareB }}
      />
      <StatBar
        label="Games"
        a={{ name: nameA, value: h2h.aGamesWon, share: h2h.gameShareA }}
        b={{ name: nameB, value: h2h.bGamesWon, share: h2h.gameShareB }}
      />
      <StatBar
        label="Points"
        a={{ name: nameA, value: h2h.aPoints, share: h2h.pointShareA }}
        b={{ name: nameB, value: h2h.bPoints, share: h2h.pointShareB }}
      />
    </div>
  )
}

function StatBar({
  label,
  a,
  b,
}: {
  label: string
  a: { name: string; value: number; share: number }
  b: { name: string; value: number; share: number }
}) {
  const aWins = a.value > b.value
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-800 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">{label}</div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className={aWins ? 'font-semibold text-green-700 dark:text-green-400' : 'text-slate-600 dark:text-slate-300'}>
          {a.name} <span className="font-mono">{a.value}</span>
        </span>
        <span className={!aWins ? 'font-semibold text-green-700 dark:text-green-400' : 'text-slate-600 dark:text-slate-300'}>
          <span className="font-mono">{b.value}</span> {b.name}
        </span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
        <div className="bg-brand-500" style={{ width: `${a.share * 100}%` }} />
        <div className="bg-slate-400 dark:bg-slate-600" style={{ width: `${b.share * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-500 font-mono">
        <span>{(a.share * 100).toFixed(0)}%</span>
        <span>{(b.share * 100).toFixed(0)}%</span>
      </div>
    </div>
  )
}
