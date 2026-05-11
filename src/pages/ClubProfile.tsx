import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStore } from '../state/store'
import { fmtLevel } from '../lib/format'
import type { Match } from '../types'
import { movingAverage } from '../lib/rating/recompute'
import { BackLink } from '../components/BackLink'
import { EmptyState } from '../components/EmptyState'
import { HistoryIcon, UsersIcon } from '../components/Icons'
import { MatchCard } from '../components/MatchCard'
import { OrgAvatar } from '../components/OrgAvatar'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { PlayerLink, PlayerMetaLinks } from '../components/PlayerLinks'
import { ProvisionalTag } from '../components/ProvisionalTag'
import { SkeletonMatchCard, SkeletonTableRow } from '../components/Skeleton'
import { clubSlug, listClubAdminUserIds } from '../lib/supabase/clubs'

export function ClubProfilePage() {
  const params = useParams<{ slug: string }>()
  const slug = (params.slug || '').toLowerCase()
  const {
    players, recomputed, settings, myPlayer, fetchRecentMatches, playerUrl,
  } = useStore()

  const members = useMemo(
    () => players.filter((p) => clubSlug(p.club) === slug),
    [players, slug],
  )
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members])

  const clubName = members[0]?.club ?? ''
  const isMember = !!myPlayer && memberIds.has(myPlayer.id)

  // Admins for THIS club (not the viewer). Each is a player who admins this
  // club via club_admins (joined to players via user_id).
  const [adminUserIds, setAdminUserIds] = useState<string[]>([])
  useEffect(() => {
    if (!slug) { setAdminUserIds([]); return }
    listClubAdminUserIds(slug).then(setAdminUserIds).catch((err) => {
      console.warn('club admin list fetch failed', err)
    })
  }, [slug])
  const clubAdmins = useMemo(() => {
    if (adminUserIds.length === 0) return []
    const set = new Set(adminUserIds)
    return players
      .filter((p) => p.userId && set.has(p.userId))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [adminUserIds, players])

  const rows = useMemo(() => {
    return members
      .map((p) => {
        // Prefer server-truth fields (cloud mode, where the in-memory match
        // array is lazy-loaded and the recompute can't see history).
        const s = recomputed.states.get(p.id)
        const level = p.currentLevel ?? s?.currentLevel ?? p.startingLevel
        const played = p.matchesPlayed ?? s?.matchesPlayed ?? 0
        const ranking = s && s.history.length > 1
          ? movingAverage(s.history, settings.movingAverageWindow)
          : level
        return {
          id: p.id,
          player: p,
          level,
          ranking,
          played,
          provisional: played < settings.provisionalThreshold,
        }
      })
      .sort((a, b) => b.ranking - a.ranking)
  }, [members, recomputed.states, settings.movingAverageWindow, settings.provisionalThreshold])

  const [clubMatches, setClubMatches] = useState<Match[]>([])
  const [matchesLoading, setMatchesLoading] = useState(true)
  useEffect(() => {
    if (memberIds.size === 0) {
      setClubMatches([])
      setMatchesLoading(false)
      return
    }
    setMatchesLoading(true)
    fetchRecentMatches(10000, Array.from(memberIds))
      .then(matches => {
        setClubMatches(matches.filter(m => memberIds.has(m.playerAId) || memberIds.has(m.playerBId)))
      })
      .catch(console.error)
      .finally(() => setMatchesLoading(false))
  }, [memberIds, fetchRecentMatches])

  const recent = useMemo(() => {
    return clubMatches
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)
  }, [clubMatches])

  if (members.length === 0) {
    return (
      <div className="space-y-4">
        <BackLink fallback="/clubs" />
        <EmptyState
          icon={<UsersIcon className="h-6 w-6" />}
          title="Club not found"
          description={`No club registered at /${slug}. The link may be stale or the club name was edited.`}
          ctaLabel="Browse clubs"
          ctaTo="/clubs"
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <BackLink fallback="/clubs" />
      <section>
        <div className="card">
          <div className="flex items-start gap-4">
            <OrgAvatar name={clubName} kind="club" size={56} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="!mb-0 truncate">{clubName}</h1>
                {isMember && <span className="tag bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">member</span>}
              </div>
              <p className="text-sm text-slate-500 mt-1">
                {members.length} {members.length === 1 ? 'member' : 'members'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {clubAdmins.length > 0 && (
        <section>
          <h2 className="mb-2">Club admins</h2>
          <div className="card">
            <ul className="flex flex-wrap gap-2">
              {clubAdmins.map((p) => (
                <li key={p.id}>
                  <Link
                    to={playerUrl(p.id)}
                    className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:bg-slate-800 px-2 py-1 text-sm transition-colors"
                  >
                    <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} size={24} />
                    <span className="font-medium">{p.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

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
              {rows.length === 0 && (
                <>
                  <SkeletonTableRow />
                  <SkeletonTableRow />
                  <SkeletonTableRow />
                </>
              )}
              {rows.map((r, i) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <Link to={playerUrl(r.id)} aria-label={`View ${r.player.name}'s profile`}>
                        <PlayerAvatar name={r.player.name} avatarUrl={r.player.avatarUrl} size={28} />
                      </Link>
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          <PlayerLink id={r.id} name={r.player.name} />
                          {r.provisional && <span className="ml-2 inline-block"><ProvisionalTag /></span>}
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
        {matchesLoading ? (
          <div className="space-y-2">
            <SkeletonMatchCard />
            <SkeletonMatchCard />
          </div>
        ) : recent.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon className="h-6 w-6" />}
            title="No matches yet for this club"
            description="Matches between members of this club will appear here."
          />
        ) : (
          <div className="space-y-2">
            {recent.map((m) => (
              <MatchCard key={m.id} match={m} players={players} settings={settings} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
