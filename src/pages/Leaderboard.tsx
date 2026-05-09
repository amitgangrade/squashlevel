import { useEffect, useMemo, useState } from 'react'
import { Pagination } from '../components/Pagination'
import { Link, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { useStore } from '../state/store'
import type { Match } from '../types'
import { fmtDate, fmtDelta, fmtLevel } from '../lib/format'
import { movingAverage } from '../lib/rating/recompute'
import { summarizeMatch } from '../lib/match-summary'
import { GameScores } from '../components/MatchScores'
import { PullToRefresh } from '../components/PullToRefresh'
import { SkeletonRow } from '../components/Skeleton'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { PlayerLink, PlayerMetaLinks } from '../components/PlayerLinks'
import { UnrankedTag } from '../components/UnrankedTag'

const AUTO_CONFIRM_KICK_KEY = 'sl_auto_confirm_kicked_at'
const AUTO_CONFIRM_KICK_INTERVAL_MS = 60 * 60 * 1000 // 1h

const FILTER_KEYS = ['club', 'country', 'city'] as const
type FilterKey = (typeof FILTER_KEYS)[number]
const FILTER_LABEL: Record<FilterKey, string> = {
  club: 'Club',
  country: 'Country',
  city: 'City',
}

export function LeaderboardPage() {
  const { players, matches, recomputed, settings, isAdmin, session, myPlayer, loading, refresh, pendingForMe, runAutoConfirmAged, fetchRecentMatches } = useStore()
  const signedIn = !!session
  const canLogMatch = signedIn && (isAdmin || !!myPlayer)
  const [searchParams, setSearchParams] = useSearchParams()

  // Best-effort fallback for projects without pg_cron: kick the aging job at most
  // once an hour per browser. Idempotent on the server (no-op when nothing aged).
  useEffect(() => {
    if (!signedIn) return
    const last = Number(localStorage.getItem(AUTO_CONFIRM_KICK_KEY) || 0)
    if (Date.now() - last < AUTO_CONFIRM_KICK_INTERVAL_MS) return
    localStorage.setItem(AUTO_CONFIRM_KICK_KEY, String(Date.now()))
    runAutoConfirmAged().catch(() => {})
  }, [signedIn, runAutoConfirmAged])

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 100

  const filters = useMemo(() => {
    const out: Partial<Record<FilterKey, string>> = {}
    for (const k of FILTER_KEYS) {
      const v = searchParams.get(k)?.trim()
      if (v) out[k] = v
    }
    return out
  }, [searchParams])

  const clearFilter = (k: FilterKey) => {
    const next = new URLSearchParams(searchParams)
    next.delete(k)
    setSearchParams(next, { replace: true })
  }
  const clearAllFilters = () => {
    const next = new URLSearchParams(searchParams)
    for (const k of FILTER_KEYS) next.delete(k)
    setSearchParams(next, { replace: true })
  }

  const allRows = useMemo(
    () =>
      players
        .map((p) => {
          const s = recomputed.states.get(p.id)
          const level = s?.currentLevel ?? p.startingLevel
          const ranking = s ? movingAverage(s.history, settings.movingAverageWindow) : level
          return {
            id: p.id,
            name: p.name,
            player: p,
            level,
            ranking,
            played: s?.matchesPlayed ?? 0,
            provisional: (s?.matchesPlayed ?? 0) < settings.provisionalThreshold,
          }
        })
        .sort((a, b) => b.ranking - a.ranking),
    [players, recomputed, settings.movingAverageWindow, settings.provisionalThreshold],
  )

  const filteredByFacet = useMemo(() => {
    if (Object.keys(filters).length === 0) return allRows
    return allRows.filter((r) => {
      for (const k of FILTER_KEYS) {
        const want = filters[k]
        if (!want) continue
        const got = (r.player[k] ?? '').toString().toLowerCase()
        if (got !== want.toLowerCase()) return false
      }
      return true
    })
  }, [allRows, filters])

  const rows = useMemo(() => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return filteredByFacet
    return filteredByFacet.filter((r) => {
      const hay = [r.name, r.player.club, r.player.country, r.player.city].filter(Boolean).join(' ').toLowerCase()
      return tokens.every((t) => hay.includes(t))
    })
  }, [filteredByFacet, search])

  const visibleRows = useMemo(
    () => rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [rows, page, PAGE_SIZE],
  )

  const [recent, setRecent] = useState<Match[]>([])
  useEffect(() => {
    fetchRecentMatches(5).then(setRecent).catch(console.error)
  }, [fetchRecentMatches])
  const activeFilters = FILTER_KEYS.filter((k) => filters[k])

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
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h1>Leaderboard</h1>
            <div className="hidden sm:flex gap-2">
              {isAdmin && <Link className="btn-secondary" to="/roster">Add player</Link>}
              {canLogMatch && <Link className="btn-primary" to="/log">Log match</Link>}
            </div>
          </div>

          {activeFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {activeFilters.map((k) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-100 text-brand-800 text-xs font-medium pl-2.5 pr-1 py-1 dark:bg-brand-900/40 dark:text-brand-200"
                >
                  <span className="text-brand-600 dark:text-brand-300">{FILTER_LABEL[k]}:</span>
                  <span>{filters[k]}</span>
                  <button
                    onClick={() => clearFilter(k)}
                    aria-label={`Remove ${FILTER_LABEL[k]} filter`}
                    className="ml-0.5 grid h-5 w-5 place-items-center rounded-full hover:bg-brand-200 dark:hover:bg-brand-900/60"
                  >
                    ×
                  </button>
                </span>
              ))}
              <button onClick={clearAllFilters} className="btn-link text-xs">
                Clear all
              </button>
              <span className="text-xs text-slate-500 ml-auto">
                {filteredByFacet.length} {filteredByFacet.length === 1 ? 'player' : 'players'}
              </span>
            </div>
          )}

          {allRows.length > 0 && (
            <input
              type="search"
              className="input w-full sm:max-w-sm mb-3"
              placeholder="Search by name, club, country…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            />
          )}

          {loading && players.length === 0 ? (
            <div className="space-y-2">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : allRows.length === 0 ? (
            <div className="card text-center text-slate-500">
              {isAdmin ? (
                <>No players yet. <Link className="text-brand-600 underline" to="/roster">Add your first player</Link> to get started.</>
              ) : (
                <>No players yet.</>
              )}
            </div>
          ) : rows.length === 0 ? (
            <div className="card text-center text-slate-500">
              {activeFilters.length > 0 ? (
                <>No players match this filter. <button onClick={clearAllFilters} className="text-brand-600 underline">Clear filters</button></>
              ) : (
                <>No players match "{search}".</>
              )}
            </div>
          ) : (
            <>
              {/* Mobile: card list */}
              <ul className="sm:hidden space-y-2">
                {visibleRows.map((r, i) => {
                  const isMe = myPlayer?.id === r.id
                  const rank = page * PAGE_SIZE + i + 1
                  return (
                    <li
                      key={r.id}
                      className={clsx(
                        'card flex items-center gap-3 py-3',
                        isMe && 'ring-2 ring-brand-500/40',
                      )}
                    >
                      <div className="w-6 text-center text-sm font-semibold text-slate-400 shrink-0">{rank}</div>
                      <Link to={`/players/${r.id}`} aria-label={`View ${r.name}'s profile`}>
                        <PlayerAvatar name={r.name} avatarUrl={r.player.avatarUrl} size={36} />
                      </Link>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <PlayerLink id={r.id} name={r.name} className="font-medium truncate" />
                          {r.provisional && <span className="tag">P</span>}
                          {isMe && <span className="tag bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">you</span>}
                        </div>
                        <div className="truncate">
                          <PlayerMetaLinks player={r.player} />
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
                    {visibleRows.map((r, i) => {
                      const rank = page * PAGE_SIZE + i + 1
                      return (
                        <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2 text-slate-400">{rank}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-3 min-w-0">
                              <Link to={`/players/${r.id}`} aria-label={`View ${r.name}'s profile`}>
                                <PlayerAvatar name={r.name} avatarUrl={r.player.avatarUrl} size={28} />
                              </Link>
                              <div className="min-w-0">
                                <div className="font-medium truncate">
                                  <PlayerLink id={r.id} name={r.name} />
                                  {r.provisional && <span className="ml-2 tag">P</span>}
                                </div>
                                <div className="truncate">
                                  <PlayerMetaLinks player={r.player} />
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">{fmtLevel(r.level)}</td>
                          <td className="px-3 py-2 text-right">{fmtLevel(r.ranking)}</td>
                          <td className="px-3 py-2 text-right text-slate-500">{r.played}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={rows.length}
                onPage={setPage}
                noun="players"
              />
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
                const a = players.find((p) => p.id === m.playerAId)
                const b = players.find((p) => p.id === m.playerBId)
                return (
                  <div key={m.id} className="card space-y-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <PlayerLink
                        id={m.playerAId}
                        name={s.aName}
                        className={clsx('font-semibold', aIsWinner ? 'text-green-700 dark:text-green-400' : 'text-slate-500')}
                      />
                      <span className="font-mono">
                        <span className={aIsWinner ? 'font-bold' : ''}>{s.aGames}</span>
                        <span className="text-slate-400 mx-1">–</span>
                        <span className={bIsWinner ? 'font-bold' : ''}>{s.bGames}</span>
                      </span>
                      <PlayerLink
                        id={m.playerBId}
                        name={s.bName}
                        className={clsx('font-semibold', bIsWinner ? 'text-green-700 dark:text-green-400' : 'text-slate-500')}
                      />
                      {m.unranked && <UnrankedTag />}
                    </div>
                    {(a || b) && (
                      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                        {a && <div className="truncate"><span className="text-slate-400">{s.aName}: </span><PlayerMetaLinks player={a} /></div>}
                        {b && <div className="truncate"><span className="text-slate-400">{s.bName}: </span><PlayerMetaLinks player={b} /></div>}
                      </div>
                    )}
                    <div className="text-xs text-slate-500">
                      {fmtDate(m.date)} · {m.type}
                      {m.venue && <> · {m.venue}</>}
                    </div>
                    <div className="text-xs">
                      <GameScores games={m.games} />
                    </div>
                    {!m.unranked && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-1 border-t border-slate-100 dark:border-slate-800">
                        <span>
                          <PlayerLink id={m.playerAId} name={s.aName} className="text-slate-500" />{' '}
                          <span className={(m.deltaA ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtDelta(m.deltaA)}</span>
                        </span>
                        <span>
                          <PlayerLink id={m.playerBId} name={s.bName} className="text-slate-500" />{' '}
                          <span className={(m.deltaB ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtDelta(m.deltaB)}</span>
                        </span>
                      </div>
                    )}
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
