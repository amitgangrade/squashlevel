import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { useStore } from '../state/store'
import { MATCH_STATUS_LABEL, MATCH_TYPE_LABEL, type Player } from '../types'
import { fmtDate, fmtDelta, fmtLevel } from '../lib/format'
import { summarizeMatch } from '../lib/match-summary'
import { GameScores } from '../components/MatchScores'
import { PlayerSearch } from '../components/PlayerSearch'

export function HistoryPage() {
  const { players, matches, recomputed, isAdmin, removeMatch, confirmMatch, session, myPlayer } = useStore()
  const [filterPlayer, setFilterPlayer] = useState<Player | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const rows = useMemo(() => {
    // Merge enriched (recomputed) data for confirmed matches with raw matches for
    // pending/disputed ones, since those don't appear in `recomputed.matches`.
    const enrichedById = new Map(recomputed.matches.map((m) => [m.id, m] as const))
    const merged = matches.map((m) => enrichedById.get(m.id) ?? m)
    const sorted = [...merged].sort((a, b) => b.date.localeCompare(a.date))
    if (!filterPlayer) return sorted
    return sorted.filter((m) => m.playerAId === filterPlayer.id || m.playerBId === filterPlayer.id)
  }, [matches, recomputed.matches, filterPlayer])

  const remove = async (id: string) => {
    if (!window.confirm('Delete this match? Levels will be recomputed from history.')) return
    await removeMatch(id)
  }

  const act = async (id: string, dispute: boolean) => {
    setErr(null)
    setBusy(id + (dispute ? ':d' : ':c'))
    try {
      await confirmMatch(id, dispute)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h1>Match history</h1>
        <div className="w-full sm:w-72">
          <PlayerSearch
            value={filterPlayer}
            onChange={setFilterPlayer}
            placeholder="Filter by player…"
          />
        </div>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      {rows.length === 0 ? (
        <div className="card text-center text-slate-500">No matches found.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((m) => {
            const s = summarizeMatch(m, players)
            const aIsWinner = !s.isDraw && s.winnerId === m.playerAId
            const bIsWinner = !s.isDraw && s.winnerId === m.playerBId
            const status = m.status ?? 'confirmed'
            const isMyPending =
              status === 'pending' &&
              !!session?.user &&
              !!myPlayer &&
              (m.playerAId === myPlayer.id || m.playerBId === myPlayer.id) &&
              m.createdBy !== session.user.id
            const ringClass =
              status === 'pending'
                ? 'ring-1 ring-amber-200 dark:ring-amber-900/40'
                : status === 'disputed'
                  ? 'ring-1 ring-tin-300 dark:ring-tin-900/50'
                  : ''
            return (
              <div key={m.id} className={clsx('card', ringClass)}>
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
                      {!s.isDraw && status === 'confirmed' && (
                        <span className="rounded-full bg-green-100 text-green-800 text-[10px] font-semibold px-2 py-0.5 dark:bg-green-900/40 dark:text-green-300">
                          {s.winnerName} won
                        </span>
                      )}
                      <StatusBadge status={status} autoConfirmed={!!m.autoConfirmed} />
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {fmtDate(m.date)} · {MATCH_TYPE_LABEL[m.type]}
                      {m.venue && <> · <span>{m.venue}</span></>}
                    </div>
                    <div className="mt-1">
                      <GameScores games={m.games} />
                    </div>
                    {m.notes && <div className="text-xs text-slate-500 mt-1 italic">{m.notes}</div>}
                  </div>
                  {status === 'confirmed' && m.levelABefore != null && (
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
                  )}
                </div>

                {isMyPending && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="btn-primary"
                      onClick={() => act(m.id, false)}
                      disabled={busy !== null}
                    >
                      {busy === m.id + ':c' ? 'Confirming…' : 'Confirm'}
                    </button>
                    <button
                      className="btn bg-tin-100 text-tin-700 hover:bg-tin-200 dark:bg-tin-900/30 dark:text-tin-200"
                      onClick={() => act(m.id, true)}
                      disabled={busy !== null}
                    >
                      {busy === m.id + ':d' ? 'Reporting…' : 'Dispute'}
                    </button>
                  </div>
                )}
                {status === 'pending' && !isMyPending && session?.user?.id === m.createdBy && (
                  <div className="mt-2 text-xs text-slate-500">
                    Waiting on your opponent.{' '}
                    <Link to="/matches/pending" className="underline">View →</Link>
                  </div>
                )}

                {isAdmin && (
                  <div className="mt-2 flex justify-end">
                    <button className="btn-link-danger" onClick={() => remove(m.id)}>Delete</button>
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

function StatusBadge({ status, autoConfirmed }: { status: 'pending' | 'confirmed' | 'disputed'; autoConfirmed: boolean }) {
  if (status === 'confirmed' && !autoConfirmed) return null
  if (status === 'confirmed' && autoConfirmed) {
    return (
      <span className="ml-auto rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold px-2 py-0.5 dark:bg-slate-800 dark:text-slate-300" title="Auto-confirmed (recorder reported a self-loss, or 3-day timeout passed)">
        auto-confirmed
      </span>
    )
  }
  return (
    <span className={clsx(
      'ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
      status === 'pending' && 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
      status === 'disputed' && 'bg-tin-100 text-tin-800 dark:bg-tin-900/40 dark:text-tin-200',
    )}>
      {MATCH_STATUS_LABEL[status]}
    </span>
  )
}
