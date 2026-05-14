import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useStore } from '../state/store'
import { fmtDate, fmtLevel, playerAge } from '../lib/format'
import { movingAverage } from '../lib/rating/recompute'
import { gamesWonBy, isProvisional, winnerSide } from '../lib/rating/levels'
import { fetchProfile } from '../lib/supabase/profile'
import { AdminEditProfileModal } from '../components/AdminEditProfileModal'
import { Alert } from '../components/Alert'
import { BackLink } from '../components/BackLink'
import { EmptyState } from '../components/EmptyState'
import { MatchCard } from '../components/MatchCard'
import { Pagination } from '../components/Pagination'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { PlayerMetaLinks } from '../components/PlayerLinks'
import { PlayerSearch } from '../components/PlayerSearch'
import { ProvisionalTag } from '../components/ProvisionalTag'
import { ChallengeButton } from '../components/ChallengeButton'
import { ShareButton } from '../components/ShareButton'
import { SkeletonMatchCard } from '../components/Skeleton'
import { CloseIcon, HistoryIcon, MoreVerticalIcon } from '../components/Icons'
import { DOMINANT_HAND_LABEL, GENDER_LABEL, type Match, type Player, type Profile } from '../types'

// Short date format for the chart X-axis on narrow viewports — full
// `fmtDate` overflows the available label width once a profile has more than
// ~6 matches. "Mar '25" stays readable down to ~320px.
function fmtChartTick(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
  } catch {
    return iso
  }
}

// Up to MAX_COMPARE other players can be overlaid on the level chart.
// Matches the colour palette length below — adding more colours implicitly
// raises the cap.
const MAX_COMPARE = 10
// Visually distinct palette for the compared series. The profile owner is
// always rendered in the brand purple regardless of these.
const COMPARE_COLORS = [
  '#0ea5e9', // sky
  '#16a34a', // green
  '#f59e0b', // amber
  '#dc2626', // red
  '#0891b2', // cyan
  '#9333ea', // violet
  '#be185d', // pink
  '#65a30d', // lime
  '#ea580c', // orange
  '#475569', // slate
] as const

interface Series {
  id: string
  name: string
  color: string
  /** Sorted ascending by date. First entry is always the player's createdAt
   *  at startingLevel — anchors the line at their join date. */
  points: Array<{ date: string; level: number }>
}

export function PlayerProfilePage() {
  // The route param is /players/:id, but ":id" can be either a UUID (legacy
  // bookmarks, unclaimed players) or a username (new human-readable form).
  // findPlayerByRouteParam resolves both transparently.
  const { id: routeParam } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { players, recomputed, settings, myPlayer, isAdmin, fetchRecentMatches, findPlayerByRouteParam, playerUrl } = useStore()

  const player = useMemo(
    () => (routeParam ? findPlayerByRouteParam(routeParam) : null),
    [routeParam, findPlayerByRouteParam],
  )
  const id = player?.id
  const state = id ? recomputed.states.get(id) : undefined

  // Canonicalize the URL: when the user lands here via the UUID form (legacy
  // bookmark, link built before usernames loaded, paste from history) and we
  // now know a username for them, replace the URL in-place so the address
  // bar reflects the readable form. Replace (not push) so back-button still
  // returns to wherever they came from.
  useEffect(() => {
    if (!player || !routeParam) return
    const canonical = playerUrl(player.id)
    const wanted = canonical.replace(/^\/players\//, '')
    if (wanted !== routeParam) {
      navigate(canonical, { replace: true })
    }
  }, [player, routeParam, playerUrl, navigate])

  // Admin-edit-profile modal state. The target profile is fetched on demand
  // when the admin clicks Edit — we only have the player row in the store,
  // not the profile.
  const [adminEditOpen, setAdminEditOpen] = useState(false)
  const [adminEditProfile, setAdminEditProfile] = useState<Profile | null>(null)
  const [adminEditLoading, setAdminEditLoading] = useState(false)
  const [adminEditError, setAdminEditError] = useState<string | null>(null)

  const [playerMatches, setPlayerMatches] = useState<Match[]>([])
  // Distinct from "no matches" — this stays true until the first fetch
  // resolves, so we can show skeletons instead of an empty-state CTA on
  // initial load. Reset whenever the viewed player changes.
  const [matchesLoading, setMatchesLoading] = useState(true)
  useEffect(() => {
    if (!id) return
    setMatchesLoading(true)
    fetchRecentMatches(10000, [id])
      .then(setPlayerMatches)
      .catch(console.error)
      .finally(() => setMatchesLoading(false))
  }, [id, fetchRecentMatches])

  // Match-history pagination. Reset to page 0 whenever we look at a different
  // player so navigating between profiles doesn't leave you stuck on page 7.
  const HISTORY_PAGE_SIZE = 100
  const [historyPage, setHistoryPage] = useState(0)
  useEffect(() => { setHistoryPage(0) }, [id])

  // Head-to-head: a single opponent the user wants to drill into. Lives
  // separately from the comparison chart selection — they answer different
  // questions ("how do our levels stack up over time" vs "what's our
  // record against each other"). Reset when the viewed profile changes.
  const [h2hOpponentId, setH2hOpponentId] = useState<string | null>(null)
  useEffect(() => { setH2hOpponentId(null) }, [id])

  // Comparison: up to MAX_COMPARE other players overlaid on the level chart.
  // Clear the selection when the profile we're viewing changes — comparing
  // Alice's chart to Bob, then visiting Bob's profile, shouldn't carry the
  // comparison list over.
  const [comparedIds, setComparedIds] = useState<string[]>([])
  const [comparedMatches, setComparedMatches] = useState<Map<string, Match[]>>(new Map())
  useEffect(() => { setComparedIds([]); setComparedMatches(new Map()) }, [id])

  // Fetch matches for any newly added compared player. Cached in
  // comparedMatches so removing then re-adding is free.
  useEffect(() => {
    for (const cid of comparedIds) {
      if (comparedMatches.has(cid)) continue
      fetchRecentMatches(10000, [cid]).then((ms) => {
        setComparedMatches((prev) => {
          if (prev.has(cid)) return prev
          const next = new Map(prev)
          next.set(cid, ms)
          return next
        })
      }).catch(console.error)
    }
  }, [comparedIds, comparedMatches, fetchRecentMatches])

  const stats = useMemo(() => {
    if (!id) return null
    const ms = playerMatches
    let wins = 0
    let losses = 0
    let gamesFor = 0
    let gamesAgainst = 0
    for (const m of ms) {
      const side = m.playerAId === id ? 'a' : 'b'
      const w = winnerSide(m.games)
      if (w === side) wins++
      else if (w !== null) losses++
      const mine = gamesWonBy(m.games, side)
      gamesFor += mine
      gamesAgainst += m.games.length - mine
    }
    const total = wins + losses
    return {
      total: ms.length,
      wins,
      losses,
      winRate: total > 0 ? wins / total : 0,
      gamesFor,
      gamesAgainst,
      // date desc, then createdAt desc — most recent entry first when two
      // matches share the same date. Mirrors the backend sort.
      matches: [...ms].sort((a, b) =>
        b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
      ),
    }
  }, [id, playerMatches])

  // Distinct opponents the profile owner has played at least once. Drives
  // the H2H picker so it only offers people there's actually data for.
  const pastOpponentIds = useMemo(() => {
    if (!id) return new Set<string>()
    const ids = new Set<string>()
    for (const m of playerMatches) {
      if (m.playerAId === id && m.playerBId) ids.add(m.playerBId)
      else if (m.playerBId === id && m.playerAId) ids.add(m.playerAId)
    }
    return ids
  }, [id, playerMatches])

  // Head-to-head record vs the selected opponent, computed from the same
  // playerMatches we already loaded. Keeps the heavy lifting out of effects.
  const h2h = useMemo(() => {
    if (!id || !h2hOpponentId) return null
    const opp = players.find((p) => p.id === h2hOpponentId) ?? null
    if (!opp) return null
    const matchesVs = playerMatches
      .filter((m) =>
        (m.playerAId === id && m.playerBId === h2hOpponentId) ||
        (m.playerBId === id && m.playerAId === h2hOpponentId),
      )
      .sort((a, b) =>
        b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
      )
    let wins = 0
    let losses = 0
    let draws = 0
    let setsFor = 0
    let setsAgainst = 0
    let pointsFor = 0
    let pointsAgainst = 0
    for (const m of matchesVs) {
      const ownerSide: 'a' | 'b' = m.playerAId === id ? 'a' : 'b'
      const w = winnerSide(m.games)
      if (w === ownerSide) wins++
      else if (w === null) draws++
      else losses++
      const ownerSets = gamesWonBy(m.games, ownerSide)
      const oppSets = m.games.length - ownerSets
      setsFor += ownerSets
      setsAgainst += oppSets
      for (const g of m.games) {
        const my = ownerSide === 'a' ? g.a : g.b
        const their = ownerSide === 'a' ? g.b : g.a
        pointsFor += my
        pointsAgainst += their
      }
    }
    const total = matchesVs.length
    return {
      opponent: opp,
      matches: matchesVs,
      total,
      wins,
      losses,
      draws,
      setsFor,
      setsAgainst,
      pointsFor,
      pointsAgainst,
      winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    }
  }, [id, h2hOpponentId, playerMatches, players])

  if (!player) {
    return (
      <EmptyState
        title="Player not found"
        description="The link may be old or the player may have been removed."
        ctaLabel="Back to leaderboard"
        ctaTo="/"
      />
    )
  }

  // Prefer server-truth on Player; fall back to in-memory recompute (local mode).
  const currentLevel = player.currentLevel ?? state?.currentLevel ?? player.startingLevel
  // Use playerMatches.length as the source of truth for the displayed count —
  // it reflects every match this player participated in. The server's
  // matches_played is rated-only and starts at 0 for players whose history
  // pre-dates the trigger (until Rebuild Levels backfills). Take the max so
  // we never show zero when matches are clearly loaded.
  const matchesPlayed = Math.max(
    playerMatches.length,
    player.matchesPlayed ?? 0,
    state?.matchesPlayed ?? 0,
  )
  const provisional = isProvisional({ matchesPlayed, seededRating: player.seededRating }, settings)
  const ranking = state && state.history.length > 1
    ? movingAverage(state.history, settings.movingAverageWindow)
    : currentLevel
  const isMe = myPlayer?.id === player.id
  const age = playerAge(player.birthYear)

  // Build the per-player series for the chart. Owner is always first; compared
  // players follow in selection order so colours stay stable as the user adds
  // and removes.
  const serieses = useMemo<Series[]>(() => {
    if (!player) return []
    const out: Series[] = []
    out.push({
      id: player.id,
      name: player.name,
      color: '#7c3aed',
      points: levelHistory(player, playerMatches, state),
    })
    comparedIds.forEach((cid, i) => {
      const cp = players.find((p) => p.id === cid)
      if (!cp) return
      const cm = comparedMatches.get(cid)
      // Skip until matches are fetched — line will appear once data loads.
      if (!cm) return
      out.push({
        id: cid,
        name: cp.name,
        color: COMPARE_COLORS[i % COMPARE_COLORS.length],
        points: levelHistory(cp, cm, undefined),
      })
    })
    return out
  }, [player, playerMatches, state, comparedIds, comparedMatches, players])

  // Wide-format chart data: one row per unique date, columns per player. Each
  // player's value is forward-filled — it stays at their last-seen level until
  // their next match. Before a player's createdAt, value is null so Recharts
  // doesn't draw a line where they didn't exist.
  const chartData = useMemo(() => buildWideChartData(serieses), [serieses])

  const ownerSeriesPoints = serieses[0]?.points ?? []
  const hasOwnerHistory = ownerSeriesPoints.length > 1

  const onAdminEdit = async () => {
    if (!player.userId) return
    setAdminEditError(null)
    setAdminEditLoading(true)
    try {
      const p = await fetchProfile(player.userId)
      if (!p) {
        setAdminEditError('Profile not found for this player.')
        return
      }
      setAdminEditProfile(p)
      setAdminEditOpen(true)
    } catch (e) {
      setAdminEditError((e as Error).message)
    } finally {
      setAdminEditLoading(false)
    }
  }

  const showAdminEdit = isAdmin && !isMe && !!player.userId

  return (
    <div className="space-y-6">
      <BackLink fallback="/" />

      <section>
        <div className="card space-y-4">
          {/* Identity row: avatar + name/tags + (desktop-only) overflow menu.
              Action buttons live below on mobile so the name has full width to
              breathe; on desktop they sit to the right in their own column. */}
          <div className="flex items-start gap-3 sm:gap-4">
            <PlayerAvatar name={player.name} avatarUrl={player.avatarUrl} size={64} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="!mb-0 text-xl sm:text-2xl truncate">{player.name}</h1>
                {provisional && <ProvisionalTag variant="full" />}
                {isMe && (
                  <span className="tag-brand">you</span>
                )}
              </div>
              <div className="mt-1">
                <PlayerMetaLinks player={player} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                {player.gender && <span>{GENDER_LABEL[player.gender]}</span>}
                {player.dominantHand && <span>{DOMINANT_HAND_LABEL[player.dominantHand]}-handed</span>}
                {age != null && <span>Age {age}</span>}
              </div>
            </div>

            {/* Desktop-only action stack. Mobile gets a dedicated row below. */}
            <div className="hidden sm:flex flex-col items-end gap-2 shrink-0">
              {isMe ? (
                <Link to="/profile" className="btn-secondary">Edit</Link>
              ) : (
                <ChallengeButton toPlayerId={player.id} toPlayerName={player.name} />
              )}
              <ShareButton kind="player" id={player.id} title={`${player.name} on Boast`} />
              {showAdminEdit && (
                <ProfileOverflowMenu
                  busy={adminEditLoading}
                  onAdminEdit={onAdminEdit}
                />
              )}
            </div>

            {/* Mobile-only overflow icon for admin actions. The two main
                actions (Challenge/Edit, Share) live in their own row below so
                they're easy to tap. */}
            {showAdminEdit && (
              <div className="sm:hidden">
                <ProfileOverflowMenu
                  busy={adminEditLoading}
                  onAdminEdit={onAdminEdit}
                />
              </div>
            )}
          </div>

          {/* Mobile action row. Hidden on desktop where actions live in the
              identity row. ChallengeButton expands into its own card when
              clicked — flex-wrap lets it take a full row in that state without
              breaking the Share button below. */}
          <div className="sm:hidden flex flex-wrap items-center gap-2">
            {isMe ? (
              <Link to="/profile" className="btn-secondary">Edit profile</Link>
            ) : (
              <ChallengeButton toPlayerId={player.id} toPlayerName={player.name} />
            )}
            <ShareButton kind="player" id={player.id} title={`${player.name} on Boast`} />
          </div>

          {adminEditError && (
            <Alert variant="error">{adminEditError}</Alert>
          )}

          {/* Hero stat: current level dominates, supporting stats sit below.
              On mobile the hero is left-aligned full-width; on desktop the
              hero floats inline and the secondary grid takes the remaining
              space, keeping the card compact. */}
          <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-4 sm:space-y-0 sm:flex sm:items-end sm:gap-6">
            <div className="sm:shrink-0">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Current level</div>
              <div className="flex items-baseline gap-2">
                <div className="text-4xl sm:text-5xl font-bold tabular-nums leading-none">{fmtLevel(currentLevel) ?? '—'}</div>
                {provisional && (
                  <span className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-400">provisional</span>
                )}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                Started at {fmtLevel(player.startingLevel)} · {fmtDate(player.createdAt)}
              </div>
            </div>
            <div className="sm:flex-1 grid grid-cols-3 gap-3 sm:gap-4">
              <Stat label="4-match avg" value={fmtLevel(ranking) ?? '—'} />
              <Stat label="Matches" value={String(matchesPlayed)} />
              <Stat
                label="Win rate"
                value={stats && stats.total > 0 ? `${(stats.winRate * 100).toFixed(0)}%` : '—'}
                sub={stats && stats.total > 0 ? `${stats.wins}W · ${stats.losses}L` : undefined}
              />
            </div>
          </div>
        </div>
      </section>

      {hasOwnerHistory && (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
            <h2 className="!mb-0">Level over time</h2>
            <span className="text-xs text-slate-500">
              {comparedIds.length}/{MAX_COMPARE} compared
            </span>
          </div>
          <div className="card space-y-3">
            <div className="h-56 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => fmtChartTick(String(d))}
                    fontSize={11}
                    minTickGap={24}
                    interval="preserveStartEnd"
                  />
                  <YAxis fontSize={11} domain={['auto', 'auto']} width={36} />
                  <Tooltip
                    labelFormatter={(l) => fmtDate(String(l))}
                    formatter={(v, key) => {
                      const s = serieses.find((x) => x.id === key)
                      return [fmtLevel(Number(v)), s?.name ?? String(key)]
                    }}
                  />
                  {serieses.map((s) => (
                    <Line
                      key={s.id}
                      type="monotone"
                      dataKey={s.id}
                      name={s.name}
                      stroke={s.color}
                      strokeWidth={s.id === player.id ? 2.5 : 1.5}
                      dot={false}
                      activeDot={{ r: 4 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Legend chips. Owner is always present. Compared players show
                a real CloseIcon button (not an × glyph) so the tap target is
                comfortable on mobile. */}
            <div className="flex flex-wrap gap-2">
              {serieses.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 pl-2 pr-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900/40"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden />
                  <span className="font-medium py-1">{s.name}</span>
                  {s.id !== player.id && (
                    <button
                      type="button"
                      onClick={() => setComparedIds((ids) => ids.filter((x) => x !== s.id))}
                      aria-label={`Remove ${s.name} from comparison`}
                      className="grid h-7 w-7 place-items-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 dark:hover:text-slate-200 dark:hover:bg-slate-700/60"
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              ))}
            </div>

            {/* Compare picker. Hidden when full. */}
            {comparedIds.length < MAX_COMPARE && (
              <CompareSearch
                ownerId={player.id}
                excludedIds={comparedIds}
                onAdd={(p) => setComparedIds((ids) => (ids.includes(p.id) ? ids : [...ids, p.id]))}
              />
            )}

            <div className="text-xs text-slate-500">
              From {fmtLevel(player.startingLevel)} on {fmtDate(player.createdAt)}{' '}
              → {fmtLevel(currentLevel)} now ({matchesPlayed} {matchesPlayed === 1 ? 'match' : 'matches'})
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
          <h2 className="!mb-0">Head to Head</h2>
          {h2h && (
            <button
              type="button"
              className="btn-text text-xs"
              onClick={() => setH2hOpponentId(null)}
            >
              Clear
            </button>
          )}
        </div>
        <div className="card space-y-3">
          {!h2h ? (
            <H2HSearch
              ownerId={player.id}
              opponentIds={pastOpponentIds}
              onPick={(p) => setH2hOpponentId(p.id)}
            />
          ) : (
            <H2HSummary owner={player} h2h={h2h} />
          )}
        </div>

        {h2h && h2h.matches.length > 0 && (
          <div className="mt-3 space-y-2">
            {h2h.matches.map((m) => (
              <MatchCard key={m.id} match={m} players={players} settings={settings} viewerId={player.id} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="!mb-0">Match history</h2>
          {stats && stats.total > 0 && (
            <span className="text-xs text-slate-500">
              {stats.total.toLocaleString()} total · {stats.wins}W · {stats.losses}L
            </span>
          )}
        </div>
        {matchesLoading && playerMatches.length === 0 ? (
          <div className="space-y-2">
            <SkeletonMatchCard />
            <SkeletonMatchCard />
            <SkeletonMatchCard />
          </div>
        ) : !stats || stats.total === 0 ? (
          <EmptyState
            icon={<HistoryIcon className="h-6 w-6" />}
            title="No matches yet"
            description={isMe
              ? 'Log your first match to start tracking your level over time.'
              : `${player.name} hasn't logged any matches yet.`}
            ctaLabel={isMe ? 'Log a match' : undefined}
            ctaTo={isMe ? '/log' : undefined}
          />
        ) : (
          <>
            <div className="space-y-2">
              {stats.matches
                .slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE)
                .map((m) => (
                  <MatchCard key={m.id} match={m} players={players} settings={settings} viewerId={player.id} />
                ))}
            </div>
            <Pagination
              page={historyPage}
              pageSize={HISTORY_PAGE_SIZE}
              total={stats.total}
              onPage={setHistoryPage}
              noun="matches"
            />
          </>
        )}
      </section>

      {adminEditOpen && adminEditProfile && (
        <AdminEditProfileModal
          target={adminEditProfile}
          onClose={() => { setAdminEditOpen(false); setAdminEditProfile(null) }}
          onSaved={(updated) => setAdminEditProfile(updated)}
        />
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-slate-500 truncate">{label}</div>
      <div className="text-lg sm:text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-slate-400 truncate">{sub}</div>}
    </div>
  )
}

/**
 * Overflow menu for header-row admin actions. Currently houses just one item
 * (Edit profile as admin), but exists as a discrete component so future admin
 * actions — merge players, transfer matches, etc. — slot in without bloating
 * the main header layout.
 */
function ProfileOverflowMenu({ busy, onAdminEdit }: { busy: boolean; onAdminEdit: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="btn-icon"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVerticalIcon className="h-5 w-5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-30 min-w-[12rem] rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            className="block w-full text-left px-3 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            onClick={() => {
              setOpen(false)
              onAdminEdit()
            }}
          >
            {busy ? 'Loading…' : 'Edit profile (admin)'}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Single-shot opponent picker for the head-to-head section. Restricted to
 * past opponents — searching for someone the owner hasn't played would only
 * show an empty H2H, which isn't useful.
 */
function H2HSearch({
  ownerId,
  opponentIds,
  onPick,
}: {
  ownerId: string
  opponentIds: Set<string>
  onPick: (p: Player) => void
}) {
  if (opponentIds.size === 0) {
    return (
      <p className="text-sm text-slate-500">
        No past opponents yet — head-to-head will appear once this player has logged a match.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500">
        Pick a past opponent to see the head-to-head record.
      </p>
      <PlayerSearch
        value={null}
        onChange={(p) => {
          if (!p || p.id === ownerId) return
          onPick(p)
        }}
        excludeId={ownerId}
        placeholder={`Search past opponents (${opponentIds.size})…`}
        restrictToIds={opponentIds}
      />
    </div>
  )
}

interface H2HData {
  opponent: Player
  matches: Match[]
  total: number
  wins: number
  losses: number
  draws: number
  setsFor: number
  setsAgainst: number
  pointsFor: number
  pointsAgainst: number
  winRate: number
}

/**
 * Summary stats card for a head-to-head matchup. Shown above the filtered
 * match list once the user has picked an opponent.
 */
function H2HSummary({
  owner,
  h2h,
}: {
  owner: Player
  h2h: H2HData
}) {
  const { opponent, total, wins, losses, draws, setsFor, setsAgainst, pointsFor, pointsAgainst } = h2h
  const decided = wins + losses
  const ownerWinPct = decided > 0 ? Math.round((wins / decided) * 100) : null
  const oppWinPct = decided > 0 ? 100 - ownerWinPct! : null
  // Each row: label · owner-side value · opponent-side value. The "winning"
  // side gets the green emphasis so the owner can see at a glance who's
  // ahead on each axis.
  const rows: Array<{ label: string; ownerValue: string; oppValue: string; ownerLeads: boolean; oppLeads: boolean }> = [
    {
      label: 'Sets won',
      ownerValue: String(setsFor),
      oppValue: String(setsAgainst),
      ownerLeads: setsFor > setsAgainst,
      oppLeads: setsAgainst > setsFor,
    },
    {
      label: 'Points scored',
      ownerValue: pointsFor.toLocaleString(),
      oppValue: pointsAgainst.toLocaleString(),
      ownerLeads: pointsFor > pointsAgainst,
      oppLeads: pointsAgainst > pointsFor,
    },
    {
      label: 'Win rate',
      ownerValue: ownerWinPct != null ? `${ownerWinPct}%` : '—',
      oppValue: oppWinPct != null ? `${oppWinPct}%` : '—',
      ownerLeads: wins > losses,
      oppLeads: losses > wins,
    },
  ]
  return (
    <div className="space-y-4">
      {/* Top row: avatar · big score · avatar, with names directly under each avatar. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="flex flex-col items-center text-center min-w-0">
          <PlayerAvatar name={owner.name} avatarUrl={owner.avatarUrl} size={48} />
          <div className="mt-2 font-semibold truncate w-full">{owner.name}</div>
          {owner.club && (
            <div className="text-xs text-slate-500 truncate w-full">{owner.club}</div>
          )}
        </div>
        <div className="text-center font-mono text-3xl sm:text-4xl leading-none">
          <span className={wins > losses ? 'font-bold text-green-700 dark:text-green-400' : ''}>{wins}</span>
          <span className="text-slate-400 mx-2">–</span>
          <span className={losses > wins ? 'font-bold text-green-700 dark:text-green-400' : ''}>{losses}</span>
        </div>
        <div className="flex flex-col items-center text-center min-w-0">
          <PlayerAvatar name={opponent.name} avatarUrl={opponent.avatarUrl} size={48} />
          <div className="mt-2 font-semibold truncate w-full">{opponent.name}</div>
          {opponent.club && (
            <div className="text-xs text-slate-500 truncate w-full">{opponent.club}</div>
          )}
        </div>
      </div>
      {/* Per-side comparison table. */}
      <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
        <dl className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-4 text-sm">
              <dd className={clsx('text-right font-mono tabular-nums', r.ownerLeads && 'font-semibold text-green-700 dark:text-green-400')}>
                {r.ownerValue}
              </dd>
              <dt className="text-xs uppercase tracking-wide text-slate-500 text-center min-w-[5.5rem]">
                {r.label}
              </dt>
              <dd className={clsx('text-left font-mono tabular-nums', r.oppLeads && 'font-semibold text-green-700 dark:text-green-400')}>
                {r.oppValue}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="text-center text-xs text-slate-500">
        {total} {total === 1 ? 'match' : 'matches'}
        {draws > 0 && <> · {draws} drawn</>}
      </div>
    </div>
  )
}

/**
 * Wraps PlayerSearch to behave as a recurring "add player" picker — picking a
 * player fires onAdd and the search clears for the next selection. Excludes
 * the profile owner and any already-compared players from results.
 */
function CompareSearch({
  ownerId,
  excludedIds,
  onAdd,
}: {
  ownerId: string
  excludedIds: string[]
  onAdd: (p: Player) => void
}) {
  const [tick, setTick] = useState(0) // remount key — resets PlayerSearch's internal q state cleanly
  return (
    <PlayerSearch
      key={tick}
      value={null}
      onChange={(p) => {
        if (!p) return
        if (p.id === ownerId) return
        if (excludedIds.includes(p.id)) return
        onAdd(p)
        setTick((n) => n + 1)
      }}
      excludeId={ownerId}
      placeholder="Compare with another player…"
    />
  )
}

/**
 * Build a player's level history as a sorted list of {date, level} points.
 *
 * Returned points are always sorted ascending — buildWideChartData's
 * forward-fill cursor depends on this. Critically: when admin-imported
 * matches predate the player's createdAt (a player whose roster was loaded
 * before they signed up), we anchor at the earliest match's stored
 * `level_X_before` rather than at createdAt, since claiming "this player was
 * at startingLevel on date X" would draw a misleading flat segment.
 */
function levelHistory(
  p: Player,
  matches: Match[],
  state: { history: Array<{ date: string; level: number }> } | undefined,
): Series['points'] {
  const filtered = [...matches]
    .filter((m) => !m.unranked && (!m.status || m.status === 'confirmed'))
    .sort((a, b) => a.date.localeCompare(b.date))

  const fromMatches: Series['points'] = []
  for (const m of filtered) {
    const isA = m.playerAId === p.id
    const after = isA ? m.levelAAfter : m.levelBAfter
    if (after == null) continue
    fromMatches.push({ date: m.date, level: Math.round(after) })
  }

  if (fromMatches.length > 0) {
    // Pick the best anchor point — a {date, level} that should appear
    // *before* the first stored "after" point so the chart starts at the
    // right level, not jumping in mid-air.
    const earliest = filtered[0]
    const earliestIsA = earliest.playerAId === p.id
    const earliestBefore = earliestIsA ? earliest.levelABefore : earliest.levelBBefore
    const createdAt = (p.createdAt || '').slice(0, 10)
    let anchor: { date: string; level: number } | null = null

    if (earliestBefore != null) {
      // Most accurate: the level the player was at right before their first
      // recorded match. Always positioned at the earliest match's date.
      anchor = { date: earliest.date, level: Math.round(earliestBefore) }
    } else if (createdAt && createdAt <= fromMatches[0].date) {
      // Fall back to createdAt only when it's actually before the matches.
      anchor = { date: createdAt, level: Math.round(p.startingLevel) }
    } else {
      // Last resort: claim startingLevel at the earliest match date — better
      // than dropping the anchor entirely (chart would start mid-line).
      anchor = { date: fromMatches[0].date, level: Math.round(p.startingLevel) }
    }

    // Prepend, then re-sort defensively in case the anchor's date collides
    // with the first match's date (edge case but cheap to handle).
    return [anchor, ...fromMatches].sort((a, b) => a.date.localeCompare(b.date))
  }

  if (state) {
    return state.history.map((h) => ({ date: h.date, level: Math.round(h.level) }))
  }

  const createdAt = (p.createdAt || '').slice(0, 10)
  return createdAt ? [{ date: createdAt, level: Math.round(p.startingLevel) }] : []
}

/**
 * Forward-fill multiple series into a single wide table for Recharts. Each
 * row represents a unique date in the union of all series, with one column
 * per series. A series's value at a date is its last-seen level — null if
 * the series hadn't started yet (so Recharts won't draw before their
 * createdAt).
 */
function buildWideChartData(serieses: Series[]): Array<Record<string, string | number | null>> {
  if (serieses.length === 0) return []
  const allDates = Array.from(
    new Set(serieses.flatMap((s) => s.points.map((p) => p.date))),
  ).sort()
  const cursors = serieses.map(() => 0)
  const lastVals: (number | null)[] = serieses.map(() => null)
  return allDates.map((d) => {
    const row: Record<string, string | number | null> = { date: d }
    serieses.forEach((s, i) => {
      while (cursors[i] < s.points.length && s.points[cursors[i]].date <= d) {
        lastVals[i] = s.points[cursors[i]].level
        cursors[i] += 1
      }
      row[s.id] = lastVals[i]
    })
    return row
  })
}
