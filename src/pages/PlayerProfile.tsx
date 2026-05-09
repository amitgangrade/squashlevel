import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
import { fmtDate, fmtDelta, fmtLevel, playerAge } from '../lib/format'
import { movingAverage } from '../lib/rating/recompute'
import { actualPerformance, expectedPerformance, gamesWonBy, winnerSide } from '../lib/rating/levels'
import { GameScores } from '../components/MatchScores'
import { Pagination } from '../components/Pagination'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { PlayerLink, PlayerMetaLinks } from '../components/PlayerLinks'
import { ChallengeButton } from '../components/ChallengeButton'
import { ShareButton } from '../components/ShareButton'
import { UnrankedTag } from '../components/UnrankedTag'
import { DOMINANT_HAND_LABEL, GENDER_LABEL, MATCH_TYPE_LABEL, type Match, type Player, type Settings } from '../types'

export function PlayerProfilePage() {
  const { id } = useParams<{ id: string }>()
  const { players, recomputed, settings, myPlayer, fetchRecentMatches } = useStore()

  const player = useMemo(() => players.find((p) => p.id === id) ?? null, [players, id])
  const state = id ? recomputed.states.get(id) : undefined

  const [playerMatches, setPlayerMatches] = useState<Match[]>([])
  useEffect(() => {
    if (!id) return
    fetchRecentMatches(10000, [id]).then(setPlayerMatches).catch(console.error)
  }, [id, fetchRecentMatches])

  // Match-history pagination. Reset to page 0 whenever we look at a different
  // player so navigating between profiles doesn't leave you stuck on page 7.
  const HISTORY_PAGE_SIZE = 100
  const [historyPage, setHistoryPage] = useState(0)
  useEffect(() => { setHistoryPage(0) }, [id])

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
      matches: [...ms].sort((a, b) => b.date.localeCompare(a.date)),
    }
  }, [id, playerMatches])

  if (!player) {
    return (
      <div className="card text-center text-slate-500 space-y-2">
        <p>Player not found.</p>
        <Link className="btn-secondary" to="/">Back to leaderboard</Link>
      </div>
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
  const provisional = matchesPlayed < settings.provisionalThreshold
  const ranking = state && state.history.length > 1
    ? movingAverage(state.history, settings.movingAverageWindow)
    : currentLevel
  const isMe = myPlayer?.id === player.id
  const age = playerAge(player.birthYear)

  // Build the chart from each match's stored *_after value for this player.
  // Falls back to the in-memory recompute history when matches haven't been
  // fetched yet (or local mode with no level fields).
  const chartData = useMemo(() => {
    if (!player) return []
    const fromMatches: Array<{ date: string; level: number }> = []
    const sorted = [...playerMatches].sort((a, b) => a.date.localeCompare(b.date))
    for (const m of sorted) {
      if (m.unranked) continue
      if (m.status && m.status !== 'confirmed') continue
      const isA = m.playerAId === player.id
      const after = isA ? m.levelAAfter : m.levelBAfter
      if (after == null) continue
      fromMatches.push({ date: m.date, level: Math.round(after) })
    }
    if (fromMatches.length > 0) {
      return [
        { date: player.createdAt, level: Math.round(player.startingLevel) },
        ...fromMatches,
      ]
    }
    if (state) {
      return state.history.map((h) => ({ date: h.date, level: Math.round(h.level) }))
    }
    return []
  }, [player, playerMatches, state])

  return (
    <div className="space-y-6">
      <section>
        <div className="card space-y-4">
          <div className="flex items-start gap-4">
            <PlayerAvatar name={player.name} avatarUrl={player.avatarUrl} size={72} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="!mb-0 truncate">{player.name}</h1>
                {provisional && <span className="tag">Provisional</span>}
                {isMe && (
                  <span className="tag bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
                    you
                  </span>
                )}
              </div>
              <div className="mt-1">
                <PlayerMetaLinks player={player} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {player.gender && <span>{GENDER_LABEL[player.gender]}</span>}
                {player.dominantHand && <span>{DOMINANT_HAND_LABEL[player.dominantHand]}-handed</span>}
                {age != null && <span>Age {age}</span>}
                <span>Registered {fmtDate(player.createdAt)}</span>
                <span>
                  Starting level {fmtLevel(player.startingLevel)} on {fmtDate(player.createdAt)}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              {isMe ? (
                <Link to="/profile" className="btn-secondary">Edit</Link>
              ) : (
                <ChallengeButton toPlayerId={player.id} toPlayerName={player.name} />
              )}
              <ShareButton kind="player" id={player.id} title={`${player.name} on Boast`} />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Stat label="Current level" value={fmtLevel(currentLevel) ?? '—'} sub={provisional ? 'provisional' : undefined} />
            <Stat label="4-match avg" value={fmtLevel(ranking) ?? '—'} />
            <Stat label="Matches" value={String(matchesPlayed)} />
            <Stat
              label="Win rate"
              value={stats && stats.total > 0 ? `${(stats.winRate * 100).toFixed(0)}%` : '—'}
              sub={stats && stats.total > 0 ? `${stats.wins}W · ${stats.losses}L` : undefined}
            />
          </div>
        </div>
      </section>

      {chartData.length > 1 && (
        <section>
          <h2 className="mb-2">Level over time</h2>
          <div className="card">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" tickFormatter={(d) => fmtDate(String(d))} fontSize={12} />
                  <YAxis fontSize={12} domain={['auto', 'auto']} />
                  <Tooltip
                    labelFormatter={(l) => fmtDate(String(l))}
                    formatter={(v) => [fmtLevel(Number(v)), 'Level']}
                  />
                  <Line
                    type="monotone"
                    dataKey="level"
                    stroke="#7c3aed"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              From {fmtLevel(player.startingLevel)} on {fmtDate(player.createdAt)}{' '}
              → {fmtLevel(currentLevel)} now ({matchesPlayed} {matchesPlayed === 1 ? 'match' : 'matches'})
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2>Match history</h2>
          {stats && stats.total > 0 && (
            <span className="text-xs text-slate-500">
              {stats.total.toLocaleString()} total · {stats.wins}W · {stats.losses}L
            </span>
          )}
        </div>
        {!stats || stats.total === 0 ? (
          <div className="card text-center text-slate-500">No matches yet.</div>
        ) : (
          <>
            <div className="space-y-2">
              {stats.matches
                .slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE)
                .map((m) => (
                  <MatchHistoryCard key={m.id} match={m} player={player} players={players} settings={settings} />
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
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  )
}

/**
 * Match card on the profile page. Always renders the profile owner on the
 * left regardless of whether they were playerA or playerB in the match — this
 * makes a long list scannable without the eye having to figure out which side
 * is "me" each time. Win/Loss/Drew is called out as a coloured badge.
 */
function MatchHistoryCard({
  match: m,
  player,
  players,
  settings,
}: {
  match: Match
  player: Player
  players: Player[]
  settings: Settings
}) {
  const isA = m.playerAId === player.id
  const me = player
  const oppId = isA ? m.playerBId : m.playerAId
  const opponent = players.find((p) => p.id === oppId) ?? null
  const oppName = opponent?.name ?? 'Unknown'
  const myGames = gamesWonBy(m.games, isA ? 'a' : 'b')
  const oppGames = gamesWonBy(m.games, isA ? 'b' : 'a')
  const winner = winnerSide(m.games)
  const drew = winner === null
  const won = !drew && winner === (isA ? 'a' : 'b')
  const myBefore = isA ? m.levelABefore : m.levelBBefore
  const myAfter  = isA ? m.levelAAfter  : m.levelBAfter
  const myDelta  = isA ? m.deltaA       : m.deltaB
  const oppBefore = isA ? m.levelBBefore : m.levelABefore
  const oppAfter  = isA ? m.levelBAfter  : m.levelAAfter
  const oppDelta  = isA ? m.deltaB       : m.deltaA

  // Expected vs actual performance, from the profile owner's perspective.
  // Both helpers return A's share; flip when the owner is B.
  let perfExpected: number | null = null
  let perfActual: number | null = null
  if (!m.unranked && myBefore != null && oppBefore != null) {
    const expA = expectedPerformance(
      isA ? myBefore : oppBefore,
      isA ? oppBefore : myBefore,
      settings,
    )
    const actA = actualPerformance(m.games, settings)
    perfExpected = isA ? expA : 1 - expA
    perfActual = isA ? actA : 1 - actA
  }

  return (
    <div className="card space-y-3">
      {/* Top row: just date / type / venue. The result badge sits with the
          profile owner below so the eye groups Won/Lost with the right name. */}
      <div className="text-xs text-slate-500">
        {fmtDate(m.date)} · {MATCH_TYPE_LABEL[m.type]}
        {m.venue && <> · {m.venue}</>}
      </div>

      {/* Score row: profile owner on the left, overall + per-game score in
          the centre (always from the owner's perspective), opponent on right. */}
      <div className="flex items-start gap-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <PlayerAvatar name={me.name} avatarUrl={me.avatarUrl} size={36} />
          <div className="min-w-0 space-y-1">
            <div className="font-semibold truncate text-slate-900 dark:text-slate-100">
              {me.name}
            </div>
            <LevelChange before={myBefore} after={myAfter} delta={myDelta} unranked={m.unranked} />
            <div>
              {m.unranked ? (
                <UnrankedTag />
              ) : drew ? (
                <ResultBadge variant="draw">Drew</ResultBadge>
              ) : won ? (
                <ResultBadge variant="win">Won</ResultBadge>
              ) : (
                <ResultBadge variant="loss">Lost</ResultBadge>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 text-center space-y-1">
          <div className="font-mono text-lg leading-none">
            <span className={clsx(won && 'font-bold')}>{myGames}</span>
            <span className="text-slate-400 mx-1.5">–</span>
            <span className={clsx(!won && !drew && 'font-bold')}>{oppGames}</span>
          </div>
          {/* Per-game scores in profile owner's perspective. Larger text and
              no per-game colouring — the Won/Lost badge already conveys the
              result, so dressing each "11" in green is redundant noise. */}
          <div className="flex justify-center">
            <GameScores games={m.games} viewerSide={isA ? 'a' : 'b'} size="sm" colorize={false} />
          </div>
        </div>

        <div className="flex items-start gap-2 flex-1 min-w-0 justify-end">
          <div className="min-w-0 text-right">
            <div className="font-medium truncate text-slate-600 dark:text-slate-400">
              <PlayerLink id={oppId} name={oppName} />
            </div>
            <LevelChange before={oppBefore} after={oppAfter} delta={oppDelta} unranked={m.unranked} align="right" />
          </div>
          {opponent && <PlayerAvatar name={opponent.name} avatarUrl={opponent.avatarUrl} size={36} />}
        </div>
      </div>

      {perfExpected != null && perfActual != null && (
        <div className="text-xs text-slate-500 border-t border-slate-100 dark:border-slate-800 pt-2">
          Expected perf: {(perfExpected * 100).toFixed(0)}% · Actual: {(perfActual * 100).toFixed(0)}%
        </div>
      )}
    </div>
  )
}

function ResultBadge({ variant, children }: { variant: 'win' | 'loss' | 'draw'; children: React.ReactNode }) {
  const cls = variant === 'win'
    ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
    : variant === 'loss'
    ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
    : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  return (
    <span className={clsx('inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider', cls)}>
      {children}
    </span>
  )
}

function LevelChange({
  before,
  after,
  delta,
  unranked,
  align,
}: {
  before?: number
  after?: number
  delta?: number
  unranked?: boolean
  align?: 'right'
}) {
  if (unranked) return null
  if (before == null || after == null) return null
  const up = (delta ?? 0) >= 0
  return (
    <div className={clsx('text-xs font-mono tabular-nums text-slate-500 truncate', align === 'right' && 'text-right')}>
      {fmtLevel(before)} <span className="text-slate-400" aria-hidden>→</span> {fmtLevel(after)}
      {delta != null && (
        <span className={clsx('ml-1 font-semibold', up ? 'text-green-600' : 'text-red-600')}>
          {fmtDelta(delta)}
        </span>
      )}
    </div>
  )
}
