import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { useStore } from '../state/store'
import { fmtDate, fmtDelta, fmtLevel } from '../lib/format'
import { movingAverage } from '../lib/rating/recompute'
import { summarizeMatch } from '../lib/match-summary'
import { GameScores } from '../components/MatchScores'
import { PullToRefresh } from '../components/PullToRefresh'
import { SkeletonRow } from '../components/Skeleton'

const AUTO_CONFIRM_KICK_KEY = 'sl_auto_confirm_kicked_at'
const AUTO_CONFIRM_KICK_INTERVAL_MS = 60 * 60 * 1000 // 1h

export function DashboardPage() {
  const { players, matches, recomputed, settings, isAdmin, session, myPlayer, loading, refresh, pendingForMe, runAutoConfirmAged } = useStore()
  const signedIn = !!session
  const canLogMatch = signedIn && (isAdmin || !!myPlayer)

  // Best-effort fallback for projects without pg_cron: kick the aging job at most
  // once an hour per browser. Idempotent on the server (no-op when nothing aged).
  useEffect(() => {
    if (!signedIn) return
    const last = Number(localStorage.getItem(AUTO_CONFIRM_KICK_KEY) || 0)
    if (Date.now() - last < AUTO_CONFIRM_KICK_INTERVAL_MS) return
    localStorage.setItem(AUTO_CONFIRM_KICK_KEY, String(Date.now()))
    runAutoConfirmAged().catch(() => {})
  }, [signedIn, runAutoConfirmAged])

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
        played: s?.matchesPlayed ?? 0,
        provisional: (s?.matchesPlayed ?? 0) < settings.provisionalThreshold,
      }
    })
    .sort((a, b) => b.ranking - a.ranking)

  const recent = [...recomputed.matches].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)

  return (
    <PullToRefresh onRefresh={refresh}>
      <div className="space-y-6">
        {pendingForMe.length > 0 && (
          <Link
            to="/matches/pending"
            className="card flex items-center gap-3 ring-1 ring-amber-300 dark:ring-amber-900/60 hover:bg-amber-50 dark:hover:bg-amber-900/10"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-800 font-semibold dark:bg-amber-900/40 dark:text-amber-200">
              {pendingForMe.length}
            </span>
            <span className="flex-1 text-sm">
              <span className="font-semibold">{pendingForMe.length === 1 ? 'A match is' : `${pendingForMe.length} matches are`}</span>{' '}
              awaiting your confirmation.
              <span className="block text-xs text-slate-500 mt-0.5">Auto-confirms in 3 days otherwise.</span>
            </span>
            <span className="text-amber-700 dark:text-amber-300" aria-hidden>→</span>
          </Link>
        )}

        <section>
          <div className="flex items-center justify-between mb-3">
            <h1>Leaderboard</h1>
            <div className="hidden sm:flex gap-2">
              {isAdmin && <Link className="btn-secondary" to="/roster">Add player</Link>}
              {canLogMatch && <Link className="btn-primary" to="/log">Log match</Link>}
            </div>
          </div>

          {loading && players.length === 0 ? (
            <div className="space-y-2">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : rows.length === 0 ? (
            <div className="card text-center text-slate-500">
              {isAdmin ? (
                <>No players yet. <Link className="text-brand-600 underline" to="/roster">Add your first player</Link> to get started.</>
              ) : (
                <>No players yet.</>
              )}
            </div>
          ) : (
            <>
              {/* Mobile: card list */}
              <ul className="sm:hidden space-y-2">
                {rows.map((r, i) => {
                  const isMe = myPlayer?.id === r.id
                  return (
                    <li
                      key={r.id}
                      className={clsx(
                        'card flex items-center gap-3 py-3',
                        isMe && 'ring-2 ring-brand-500/40',
                      )}
                    >
                      <div className="w-7 text-center text-sm font-semibold text-slate-400">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{r.name}</span>
                          {r.provisional && <span className="tag">P</span>}
                          {isMe && <span className="tag bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">you</span>}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {r.played} {r.played === 1 ? 'match' : 'matches'} · 4-match avg {fmtLevel(r.ranking)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-lg font-semibold leading-none">{fmtLevel(r.level)}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wider">level</div>
                      </div>
                    </li>
                  )
                })}
              </ul>

              {/* Desktop: table */}
              <div className="hidden sm:block card overflow-x-auto p-0">
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
            </>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h2>Recent matches</h2>
            {matches.length > 0 && <Link to="/history" className="text-sm text-brand-600 active:text-brand-700">View all →</Link>}
          </div>
          {loading && recent.length === 0 ? (
            <div className="space-y-2">
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : recent.length === 0 ? (
            <div className="card text-center text-slate-500">No matches logged yet.</div>
          ) : (
            <div className="space-y-2">
              {recent.map((m) => {
                const s = summarizeMatch(m, players)
                const aIsWinner = !s.isDraw && s.winnerId === m.playerAId
                const bIsWinner = !s.isDraw && s.winnerId === m.playerBId
                return (
                  <div key={m.id} className="card space-y-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={clsx('font-semibold', aIsWinner ? 'text-green-700 dark:text-green-400' : 'text-slate-500')}>
                        {s.aName}
                      </span>
                      <span className="font-mono">
                        <span className={aIsWinner ? 'font-bold' : ''}>{s.aGames}</span>
                        <span className="text-slate-400 mx-1">–</span>
                        <span className={bIsWinner ? 'font-bold' : ''}>{s.bGames}</span>
                      </span>
                      <span className={clsx('font-semibold', bIsWinner ? 'text-green-700 dark:text-green-400' : 'text-slate-500')}>
                        {s.bName}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {fmtDate(m.date)} · {m.type}
                    </div>
                    <div className="text-xs">
                      <GameScores games={m.games} />
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-1 border-t border-slate-100 dark:border-slate-800">
                      <span>
                        <span className="text-slate-500">{s.aName}</span>{' '}
                        <span className={(m.deltaA ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtDelta(m.deltaA)}</span>
                      </span>
                      <span>
                        <span className="text-slate-500">{s.bName}</span>{' '}
                        <span className={(m.deltaB ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtDelta(m.deltaB)}</span>
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </PullToRefresh>
  )
}
