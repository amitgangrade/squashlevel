import { useEffect, useMemo, useState } from 'react'
import { Pagination } from '../components/Pagination'
import { Link, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { useStore } from '../state/store'
import { fmtLevel, playerAge } from '../lib/format'
import { movingAverage } from '../lib/rating/recompute'
import { isProvisional } from '../lib/rating/levels'
import { filterByTokens, joinHay } from '../lib/search'
import { EmptyState } from '../components/EmptyState'
import { InfoIcon, UsersIcon } from '../components/Icons'
import { LevelHelpPanel } from '../components/LevelHelpPanel'
import { PullToRefresh } from '../components/PullToRefresh'
import { SkeletonRow } from '../components/Skeleton'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { PlayerLink, PlayerMetaLinks } from '../components/PlayerLinks'
import { ProvisionalTag } from '../components/ProvisionalTag'
import { UnclaimedTag } from '../components/UnclaimedTag'
import { RankChip } from '../components/RankChip'
import { SignedOutHero } from '../components/SignedOutHero'

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
  const { players, recomputed, settings, isAdmin, session, myPlayer, loading, refresh, pendingForMe, runAutoConfirmAged, playerUrl } = useStore()
  const signedIn = !!session
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
  // Toggleable explainer panel for the Level column. Discoverability lives
  // next to the heading + as a small info icon in the desktop table header;
  // both target the same disclosure so the explanation is one source of
  // truth rather than a brittle tooltip-on-th.
  const [levelHelpOpen, setLevelHelpOpen] = useState(false)
  const PAGE_SIZE = 50

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
          // Prefer server-truth fields on Player (cloud); fall back to the
          // in-memory recompute (local mode where matches are fully loaded).
          const s = recomputed.states.get(p.id)
          const level = p.currentLevel ?? s?.currentLevel ?? p.startingLevel
          const played = p.matchesPlayed ?? s?.matchesPlayed ?? 0
          // moving-average ranking still requires per-match history — only
          // available from the in-memory recompute. When matches aren't loaded
          // we sort by the current level itself.
          const ranking = s && s.history.length > 1 ? movingAverage(s.history, settings.movingAverageWindow) : level
          return {
            id: p.id,
            name: p.name,
            player: p,
            level,
            ranking,
            played,
            provisional: isProvisional({ matchesPlayed: played, seededRating: p.seededRating }, settings),
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

  const rows = useMemo(
    () =>
      filterByTokens(filteredByFacet, search, (r) =>
        joinHay([r.name, r.player.club, r.player.country, r.player.city]),
      ),
    [filteredByFacet, search],
  )

  const visibleRows = useMemo(
    () => rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [rows, page, PAGE_SIZE],
  )

  const activeFilters = FILTER_KEYS.filter((k) => filters[k])

  // Open the existing LevelHelpPanel and scroll it into view. Used by the
  // signed-out hero's "How does the rating work?" link so the explainer
  // lives in one place (not duplicated in a marketing section).
  const openLevelHelp = () => {
    setLevelHelpOpen(true)
    requestAnimationFrame(() => {
      document
        .getElementById('level-help-panel')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  return (
    <PullToRefresh onRefresh={refresh}>
      <div className="space-y-6">
        {!signedIn && (
          <SignedOutHero onLearnMore={openLevelHelp} playerCount={players.length} />
        )}

        {pendingForMe.length > 0 && (
          <Link
            to="/activity"
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
            <div className="flex items-center gap-2">
              <h1>Leaderboard</h1>
              <button
                type="button"
                onClick={() => setLevelHelpOpen((v) => !v)}
                aria-expanded={levelHelpOpen}
                aria-controls="level-help-panel"
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline-offset-2 hover:underline"
              >
                <InfoIcon className="h-4 w-4" />
                <span>How levels work</span>
              </button>
            </div>
            {/* Log-match CTA lives in the header for both desktop (button) and
                mobile (FAB), so we don't duplicate it here. Add-player stays
                because it's an admin-only contextual action. */}
            {isAdmin && (
              <div className="hidden sm:flex gap-2">
                <Link className="btn-secondary" to="/roster">Add player</Link>
              </div>
            )}
          </div>

          {levelHelpOpen && <LevelHelpPanel onClose={() => setLevelHelpOpen(false)} />}

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
              <button onClick={clearAllFilters} className="btn-text text-xs">
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
            <EmptyState
              icon={<UsersIcon className="h-6 w-6" />}
              title="No players yet"
              description={isAdmin ? 'Add the first player to get the leaderboard going.' : 'Players will appear here once an admin adds them.'}
              ctaLabel={isAdmin ? 'Add your first player' : undefined}
              ctaTo={isAdmin ? '/roster' : undefined}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title={activeFilters.length > 0 ? 'No players match these filters' : `No players match "${search}"`}
              description={activeFilters.length > 0 ? 'Try clearing one or more filters.' : 'Try a different name, club, or country.'}
              ctaLabel={activeFilters.length > 0 ? 'Clear filters' : undefined}
              ctaOnClick={activeFilters.length > 0 ? clearAllFilters : undefined}
            />
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
                      <RankChip rank={rank} />
                      <Link to={playerUrl(r.id)} aria-label={`View ${r.name}'s profile`}>
                        <PlayerAvatar name={r.name} avatarUrl={r.player.avatarUrl} size={36} />
                      </Link>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <PlayerLink id={r.id} name={r.name} className="font-medium truncate" />
                          {!r.player.userId && <UnclaimedTag />}
                          {r.provisional && <ProvisionalTag />}
                          {isMe && <span className="tag-brand">you</span>}
                        </div>
                        <div className="truncate">
                          <PlayerMetaLinks player={r.player} />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-lg font-bold leading-none tabular-nums text-accent-700 dark:text-accent-400">{fmtLevel(r.level)}</div>
                        <div className="text-[10px] text-slate-400 mt-1 tabular-nums">{r.played} {r.played === 1 ? 'match' : 'matches'}</div>
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
                      <th className="px-3 py-2 text-left">Club</th>
                      <th className="px-3 py-2 text-left">Country</th>
                      <th className="px-3 py-2 text-left">City</th>
                      <th className="px-3 py-2 text-right">Age</th>
                      <th className="px-3 py-2 text-right">Matches</th>
                      <th className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setLevelHelpOpen((v) => !v)}
                          aria-expanded={levelHelpOpen}
                          aria-controls="level-help-panel"
                          className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                          title="How levels work"
                        >
                          Level
                          <InfoIcon className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r, i) => {
                      const rank = page * PAGE_SIZE + i + 1
                      const age = playerAge(r.player.birthYear)
                      const isMe = myPlayer?.id === r.id
                      return (
                        <tr
                          key={r.id}
                          className={clsx(
                            'border-t border-slate-100 dark:border-slate-800 even:bg-slate-50/60 dark:even:bg-slate-900/30',
                            isMe && 'bg-brand-50/80 dark:bg-brand-900/30 ring-1 ring-inset ring-brand-500/30',
                          )}
                        >
                          <td className="px-3 py-2">
                            <RankChip rank={rank} />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-3 min-w-0">
                              <Link to={playerUrl(r.id)} aria-label={`View ${r.name}'s profile`}>
                                <PlayerAvatar name={r.name} avatarUrl={r.player.avatarUrl} size={28} />
                              </Link>
                              <div className="min-w-0">
                                <div className="font-medium truncate">
                                  <PlayerLink id={r.id} name={r.name} />
                                  {!r.player.userId && <span className="ml-2 inline-block"><UnclaimedTag /></span>}
                                  {r.provisional && <span className="ml-2 inline-block"><ProvisionalTag /></span>}
                                  {isMe && <span className="ml-2 inline-block tag-brand">you</span>}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-300 truncate max-w-[12rem]">
                            {r.player.club ? (
                              <Link to={`/?club=${encodeURIComponent(r.player.club)}`} className="hover:underline">{r.player.club}</Link>
                            ) : ''}
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-300 truncate max-w-[10rem]">
                            {r.player.country ? (
                              <Link to={`/?country=${encodeURIComponent(r.player.country)}`} className="hover:underline">{r.player.country}</Link>
                            ) : ''}
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-300 truncate max-w-[10rem]">
                            {r.player.city ? (
                              <Link to={`/?city=${encodeURIComponent(r.player.city)}`} className="hover:underline">{r.player.city}</Link>
                            ) : ''}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-500">{age ?? ''}</td>
                          <td className="px-3 py-2 text-right text-slate-500">{r.played}</td>
                          <td className="px-3 py-2 text-right font-bold tabular-nums text-accent-700 dark:text-accent-400">{fmtLevel(r.level)}</td>
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
      </div>
    </PullToRefresh>
  )
}

