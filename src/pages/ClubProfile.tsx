import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { useStore } from '../state/store'
import { fmtDate, fmtLevel } from '../lib/format'
import { movingAverage } from '../lib/rating/recompute'
import { summarizeMatch } from '../lib/match-summary'
import { GameScores } from '../components/MatchScores'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { PlayerLink, PlayerMetaLinks } from '../components/PlayerLinks'
import { clubSlug } from '../lib/supabase/clubs'

export function ClubProfilePage() {
  const params = useParams<{ slug: string }>()
  const slug = (params.slug || '').toLowerCase()
  const {
    players, recomputed, settings, session, profile, isAdmin, myPlayer,
    saveProfile, myClubAdminSlugs,
  } = useStore()

  const members = useMemo(
    () => players.filter((p) => clubSlug(p.club) === slug),
    [players, slug],
  )
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members])

  const clubName = members[0]?.club ?? ''
  const isMember = !!myPlayer && memberIds.has(myPlayer.id)
  const isClubAdmin = isAdmin || myClubAdminSlugs.includes(slug)

  const [joinErr, setJoinErr] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  // Auto-clear stale errors when membership changes (after a successful join).
  useEffect(() => {
    if (isMember) setJoinErr(null)
  }, [isMember])

  const joinClub = async () => {
    if (!profile || !clubName) return
    setJoinErr(null)
    setJoining(true)
    try {
      await saveProfile({ ...profile, club: clubName })
    } catch (e) {
      setJoinErr((e as Error).message)
    } finally {
      setJoining(false)
    }
  }

  const rows = useMemo(() => {
    return members
      .map((p) => {
        const s = recomputed.states.get(p.id)
        const level = s?.currentLevel ?? p.startingLevel
        const ranking = s ? movingAverage(s.history, settings.movingAverageWindow) : level
        return {
          id: p.id,
          player: p,
          level,
          ranking,
          played: s?.matchesPlayed ?? 0,
          provisional: (s?.matchesPlayed ?? 0) < settings.provisionalThreshold,
        }
      })
      .sort((a, b) => b.ranking - a.ranking)
  }, [members, recomputed.states, settings.movingAverageWindow, settings.provisionalThreshold])

  const recent = useMemo(() => {
    return recomputed.matches
      .filter((m) => memberIds.has(m.playerAId) || memberIds.has(m.playerBId))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)
  }, [recomputed.matches, memberIds])

  if (members.length === 0) {
    return (
      <div className="space-y-4">
        <div className="card text-center text-slate-500 space-y-2">
          <p>No club found at <span className="font-mono">/{slug}</span>.</p>
          <Link className="btn-secondary" to="/clubs">Browse clubs</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="card">
          <div className="flex items-start gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-brand-100 text-brand-700 text-xl font-bold dark:bg-brand-900/40 dark:text-brand-200">
              {clubName.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="!mb-0 truncate">{clubName}</h1>
                {isMember && <span className="tag bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">member</span>}
                {isClubAdmin && <span className="tag bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">admin</span>}
              </div>
              <p className="text-sm text-slate-500 mt-1">
                {members.length} {members.length === 1 ? 'member' : 'members'}
              </p>
            </div>
            {session && profile && !isMember && (
              <button onClick={joinClub} disabled={joining} className="btn-primary shrink-0">
                {joining ? 'Joining…' : 'Join this club'}
              </button>
            )}
          </div>
          {joinErr && <div className="text-sm text-red-600 mt-2">{joinErr}</div>}
          {!session && (
            <p className="mt-3 text-xs text-slate-500">
              <Link to="/" className="text-brand-600 hover:underline">Sign in</Link> to join this club.
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2">Leaderboard</h2>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Player</th>
                <th className="px-3 py-2 text-right">Level</th>
                <th className="px-3 py-2 text-right hidden sm:table-cell">4-match avg</th>
                <th className="px-3 py-2 text-right">Matches</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <Link to={`/players/${r.id}`} aria-label={`View ${r.player.name}'s profile`}>
                        <PlayerAvatar name={r.player.name} avatarUrl={r.player.avatarUrl} size={28} />
                      </Link>
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          <PlayerLink id={r.id} name={r.player.name} />
                          {r.provisional && <span className="ml-2 tag">P</span>}
                        </div>
                        <div className="truncate">
                          <PlayerMetaLinks player={r.player} />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{fmtLevel(r.level)}</td>
                  <td className="px-3 py-2 text-right hidden sm:table-cell">{fmtLevel(r.ranking)}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{r.played}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2">Recent matches</h2>
        {recent.length === 0 ? (
          <div className="card text-center text-slate-500">No matches yet for this club.</div>
        ) : (
          <div className="space-y-2">
            {recent.map((m) => {
              const s = summarizeMatch(m, players)
              const aIsWinner = !s.isDraw && s.winnerId === m.playerAId
              const bIsWinner = !s.isDraw && s.winnerId === m.playerBId
              const a = players.find((p) => p.id === m.playerAId)
              const b = players.find((p) => p.id === m.playerBId)
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
