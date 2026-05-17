import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStore } from '../state/store'
import { fmtLevel } from '../lib/format'
import type { Match, Player } from '../types'
import { movingAverage } from '../lib/rating/recompute'
import { isProvisional } from '../lib/rating/levels'
import { BackLink } from '../components/BackLink'
import { EditMatchDialog } from '../components/EditMatchDialog'
import { EmptyState } from '../components/EmptyState'
import { HistoryIcon, InfoIcon, UsersIcon } from '../components/Icons'
import { LevelHelpPanel } from '../components/LevelHelpPanel'
import { MatchCard } from '../components/MatchCard'
import { OrgAvatar } from '../components/OrgAvatar'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { PlayerFormModal } from '../components/PlayerFormModal'
import { PlayerLink, PlayerMetaLinks } from '../components/PlayerLinks'
import { ProvisionalTag } from '../components/ProvisionalTag'
import { SkeletonMatchCard, SkeletonTableRow } from '../components/Skeleton'
import { clubSlug, listClubAdminUserIds } from '../lib/supabase/clubs'

export function ClubProfilePage() {
  const params = useParams<{ slug: string }>()
  const slug = (params.slug || '').toLowerCase()
  const {
    players, recomputed, settings, myPlayer, isAdmin, myClubAdminSlugs,
    canWriteMatch, removeMatch,
    fetchRecentMatches, playerUrl,
  } = useStore()
  // True when the viewer can curate this club's roster + matches. Either
  // they're a global admin, or they're listed in club_admins for this slug.
  const iAdminThisClub = isAdmin || (!!slug && myClubAdminSlugs.includes(slug))

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
  const [levelHelpOpen, setLevelHelpOpen] = useState(false)
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
          provisional: isProvisional({ matchesPlayed: played, seededRating: p.seededRating }, settings),
        }
      })
      .sort((a, b) => b.ranking - a.ranking)
  }, [members, recomputed.states, settings.movingAverageWindow, settings.provisionalThreshold])

  // Modal state for the curate-the-club admin actions.
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null)
  const [addingPlayer, setAddingPlayer] = useState(false)
  const [editingMatch, setEditingMatch] = useState<Match | null>(null)
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null)
  const [adminError, setAdminError] = useState<string | null>(null)

  const [clubMatches, setClubMatches] = useState<Match[]>([])
  const [matchesLoading, setMatchesLoading] = useState(true)
  const reloadMatches = useMemo(() => async () => {
    if (memberIds.size === 0) {
      setClubMatches([])
      setMatchesLoading(false)
      return
    }
    setMatchesLoading(true)
    try {
      const ms = await fetchRecentMatches(10000, Array.from(memberIds))
      setClubMatches(ms.filter(m => memberIds.has(m.playerAId) || memberIds.has(m.playerBId)))
    } catch (e) {
      console.error(e)
    } finally {
      setMatchesLoading(false)
    }
  }, [memberIds, fetchRecentMatches])
  useEffect(() => { reloadMatches() }, [reloadMatches])

  const onDeleteMatch = async (m: Match) => {
    if (!window.confirm('Delete this match? Levels will be stale until you run Admin → Rebuild levels.')) return
    setAdminError(null)
    setBusyMatchId(m.id)
    try {
      await removeMatch(m.id)
      await reloadMatches()
    } catch (e) {
      setAdminError((e as Error).message)
    } finally {
      setBusyMatchId(null)
    }
  }

  const recent = useMemo(() => {
    return clubMatches
      .slice()
      .sort((a, b) =>
        b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
      )
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
                {isMember && <span className="tag-brand">member</span>}
              </div>
              <p className="text-sm text-slate-500 mt-1">
                {members.length} {members.length === 1 ? 'member' : 'members'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {iAdminThisClub && (
        <section>
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-900/20 p-4 space-y-2">
            <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              You administer this club
            </div>
            <ul className="text-xs text-amber-800 dark:text-amber-200 list-disc pl-5 space-y-0.5">
              <li>Add new players to <span className="font-medium">{clubName}</span>.</li>
              <li>Edit any member's player record (name, starting level, contact, etc.).</li>
              <li>Edit or delete matches where at least one side is a club member — including the scoreline.</li>
            </ul>
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              After editing or deleting a match, run <strong>Admin → Rebuild levels</strong> so opponents' levels reflect the change.
            </p>
          </div>
          {adminError && <div className="mt-2 text-sm text-red-600">{adminError}</div>}
        </section>
      )}

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
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <h2 className="!mb-0">Leaderboard</h2>
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
          {iAdminThisClub && (
            <button className="btn-secondary text-xs" onClick={() => setAddingPlayer(true)}>
              + Add player
            </button>
          )}
        </div>
        {levelHelpOpen && <LevelHelpPanel onClose={() => setLevelHelpOpen(false)} />}
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Player</th>
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
                <th className="px-3 py-2 text-right hidden sm:table-cell">4-match avg</th>
                <th className="px-3 py-2 text-right">Matches</th>
                {iAdminThisClub && <th className="px-3 py-2" />}
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
                  {iAdminThisClub && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button className="btn-link text-xs" onClick={() => setEditingPlayer(r.player)}>
                        Edit
                      </button>
                    </td>
                  )}
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
            {recent.map((m) => {
              const canEdit = canWriteMatch(m)
              const actions = canEdit ? (
                <>
                  <button
                    className="btn-link text-xs ml-auto"
                    onClick={() => setEditingMatch(m)}
                    disabled={busyMatchId === m.id}
                  >
                    Edit
                  </button>
                  <button
                    className="btn-link-danger text-xs"
                    onClick={() => onDeleteMatch(m)}
                    disabled={busyMatchId === m.id}
                  >
                    {busyMatchId === m.id ? 'Deleting…' : 'Delete'}
                  </button>
                </>
              ) : null
              return (
                <MatchCard
                  key={m.id}
                  match={m}
                  players={players}
                  settings={settings}
                  actions={actions}
                />
              )
            })}
          </div>
        )}
      </section>

      {addingPlayer && (
        <PlayerFormModal
          player={null}
          defaultClub={clubName}
          onClose={() => setAddingPlayer(false)}
        />
      )}
      {editingPlayer && (
        <PlayerFormModal
          player={editingPlayer}
          onClose={() => setEditingPlayer(null)}
        />
      )}
      {editingMatch && (
        <EditMatchDialog
          match={editingMatch}
          players={players}
          onClose={() => setEditingMatch(null)}
          onSaved={() => { reloadMatches() }}
        />
      )}
    </div>
  )
}
