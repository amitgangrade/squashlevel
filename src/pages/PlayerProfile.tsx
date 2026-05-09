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
import { gamesWonBy, winnerSide } from '../lib/rating/levels'
import { summarizeMatch } from '../lib/match-summary'
import { GameScores } from '../components/MatchScores'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { PlayerLink, PlayerMetaLinks } from '../components/PlayerLinks'
import { ChallengeButton } from '../components/ChallengeButton'
import { ShareButton } from '../components/ShareButton'
import { UnrankedTag } from '../components/UnrankedTag'
import { DOMINANT_HAND_LABEL, GENDER_LABEL } from '../types'

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

  const currentLevel = state?.currentLevel ?? player.startingLevel
  const matchesPlayed = state?.matchesPlayed ?? 0
  const provisional = matchesPlayed < settings.provisionalThreshold
  const ranking = state ? movingAverage(state.history, settings.movingAverageWindow) : currentLevel
  const isMe = myPlayer?.id === player.id
  const age = playerAge(player.birthYear)
  const recent = stats?.matches.slice(0, 10) ?? []
  
  // Note: we might want a loading state here if matches takes a second to load
  // But for now it will just show 0 matches until loaded

  const chartData = useMemo(() => {
    if (!state) return []
    return state.history.map((h) => ({
      date: h.date,
      level: Math.round(h.level),
    }))
  }, [state])

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
          <h2>Recent matches</h2>
          {stats && stats.total > recent.length && (
            <Link to="/history" className="text-sm text-brand-600 active:text-brand-700">
              View all →
            </Link>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="card text-center text-slate-500">No matches yet.</div>
        ) : (
          <div className="space-y-2">
            {recent.map((m) => {
              const s = summarizeMatch(m, players)
              const aIsWinner = !s.isDraw && s.winnerId === m.playerAId
              const bIsWinner = !s.isDraw && s.winnerId === m.playerBId
              const myDelta = m.playerAId === player.id ? m.deltaA : m.deltaB
              return (
                <div key={m.id} className="card space-y-1">
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
                    {m.unranked ? (
                      <span className="ml-auto"><UnrankedTag /></span>
                    ) : myDelta != null ? (
                      <span className={clsx('ml-auto text-xs font-semibold', myDelta >= 0 ? 'text-green-600' : 'text-red-600')}>
                        {fmtDelta(myDelta)}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-slate-500">
                    {fmtDate(m.date)} · {m.type}
                    {m.venue && <> · {m.venue}</>}
                  </div>
                  <GameScores games={m.games} />
                </div>
              )
            })}
          </div>
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
