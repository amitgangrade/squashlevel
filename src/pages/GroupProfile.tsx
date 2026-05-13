import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../state/store'
import { fmtLevel } from '../lib/format'
import { movingAverage } from '../lib/rating/recompute'
import { summarizeMatch } from '../lib/match-summary'
import { Alert } from '../components/Alert'
import { BackLink } from '../components/BackLink'
import { EmptyState } from '../components/EmptyState'
import { HistoryIcon, UsersIcon } from '../components/Icons'
import { MatchCard } from '../components/MatchCard'
import { OrgAvatar } from '../components/OrgAvatar'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { PlayerLink, PlayerMetaLinks } from '../components/PlayerLinks'
import { PlayerSearch } from '../components/PlayerSearch'
import { ProvisionalTag } from '../components/ProvisionalTag'
import { SkeletonMatchCard } from '../components/Skeleton'
import {
  addGroupMember,
  buildGroupShareUrl,
  deleteGroup,
  fetchGroupBySlug,
  listGroupMembers,
  removeGroupMember,
  telegramShareUrl,
  updateGroup,
  whatsappShareUrl,
} from '../lib/supabase/groups'
import { supabaseEnabled } from '../lib/supabase/client'
import type { Group, GroupMember, Player, Match } from '../types'

export function GroupProfilePage() {
  const params = useParams<{ slug: string }>()
  const slug = (params.slug || '').toLowerCase()
  const navigate = useNavigate()
  const { players, recomputed, settings, session, myPlayer, isAdmin, fetchRecentMatches, playerUrl } = useStore()

  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const refresh = () => {
    if (!supabaseEnabled) {
      setLoading(false)
      return
    }
    setLoading(true)
    fetchGroupBySlug(slug)
      .then(async (g) => {
        setGroup(g)
        if (g) {
          const ms = await listGroupMembers(g.id).catch(() => [])
          setMembers(ms)
        }
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const myMembership = useMemo(() => {
    if (!myPlayer) return null
    return members.find((m) => m.playerId === myPlayer.id) ?? null
  }, [members, myPlayer])

  const isGroupAdmin = isAdmin || !!myMembership?.isAdmin
  const isMember = !!myMembership

  const memberPlayers: Player[] = useMemo(() => {
    const byId = new Map(players.map((p) => [p.id, p]))
    return members
      .map((m) => byId.get(m.playerId))
      .filter((p): p is Player => !!p)
  }, [members, players])

  const memberIds = useMemo(() => new Set(memberPlayers.map((p) => p.id)), [memberPlayers])

  const rows = useMemo(() => {
    return memberPlayers
      .map((p) => {
        const s = recomputed.states.get(p.id)
        const level = s?.currentLevel ?? p.startingLevel
        const ranking = s ? movingAverage(s.history, settings.movingAverageWindow) : level
        const isAdminMember = members.find((m) => m.playerId === p.id)?.isAdmin ?? false
        // Match count comes from the server-maintained players.matches_played
        // column, falling back to the recomputed state if available. Using
        // recomputed.states alone breaks under cloud mode where the store's
        // matches array is lazy-loaded and `s` is undefined for everyone.
        const played = p.matchesPlayed ?? s?.matchesPlayed ?? 0
        return {
          id: p.id,
          player: p,
          level,
          ranking,
          played,
          provisional: played < settings.provisionalThreshold,
          isAdmin: isAdminMember,
        }
      })
      .sort((a, b) => b.ranking - a.ranking)
  }, [memberPlayers, members, recomputed.states, settings.movingAverageWindow, settings.provisionalThreshold])

  // Internal matches: both players are members. This is the "group league"
  // view — you only see what happened within the circle.
  const [groupMatches, setGroupMatches] = useState<Match[]>([])
  const [matchesLoading, setMatchesLoading] = useState(true)
  useEffect(() => {
    if (memberIds.size === 0) {
      setGroupMatches([])
      setMatchesLoading(false)
      return
    }
    setMatchesLoading(true)
    fetchRecentMatches(10000, Array.from(memberIds))
      .then(matches => {
        setGroupMatches(matches.filter(m => memberIds.has(m.playerAId) && memberIds.has(m.playerBId)))
      })
      .catch(console.error)
      .finally(() => setMatchesLoading(false))
  }, [memberIds, fetchRecentMatches])

  const recent = useMemo(() => {
    return groupMatches
      .slice()
      .sort((a, b) =>
        b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
      )
      .slice(0, 10)
  }, [groupMatches])

  // Quick stats: most active player + longest current win streak. These aren't
  // sciencey — just fun nudges to bring people back.
  const stats = useMemo(() => {
    if (memberIds.size === 0) return null
    if (groupMatches.length === 0) return null

    const counts = new Map<string, number>()
    for (const m of groupMatches) {
      counts.set(m.playerAId, (counts.get(m.playerAId) ?? 0) + 1)
      counts.set(m.playerBId, (counts.get(m.playerBId) ?? 0) + 1)
    }
    const mostActiveId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const mostActive = mostActiveId ? memberPlayers.find((p) => p.id === mostActiveId) : null

    // Compute current streak per player by walking matches in chronological
    // order and counting the trailing run of wins.
    const sorted = [...groupMatches].sort((a, b) => a.date.localeCompare(b.date))
    const streak = new Map<string, number>()
    for (const m of sorted) {
      const s = summarizeMatch(m, players)
      if (s.isDraw) continue
      const winner = s.winnerId!
      const loser = winner === m.playerAId ? m.playerBId : m.playerAId
      streak.set(winner, (streak.get(winner) ?? 0) + 1)
      streak.set(loser, 0)
    }
    const top = [...streak.entries()].sort((a, b) => b[1] - a[1])[0]
    const streakHolder = top && top[1] >= 2 ? memberPlayers.find((p) => p.id === top[0]) : null

    return {
      totalMatches: groupMatches.length,
      mostActive: mostActive ? { player: mostActive, count: counts.get(mostActive.id) ?? 0 } : null,
      streak: streakHolder && top ? { player: streakHolder, count: top[1] } : null,
    }
  }, [groupMatches, memberIds, memberPlayers, players])

  if (loading) {
    return (
      <div className="space-y-4">
        <BackLink fallback="/groups" />
        <div className="card space-y-3">
          <div className="flex items-center gap-3">
            <div className="skeleton h-14 w-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-5 w-1/2" />
              <div className="skeleton h-3 w-1/3" />
            </div>
          </div>
        </div>
        <SkeletonMatchCard />
      </div>
    )
  }

  if (err) {
    return (
      <div className="space-y-4">
        <BackLink fallback="/groups" />
        <Alert variant="error">{err}</Alert>
      </div>
    )
  }

  if (!group) {
    return (
      <div className="space-y-4">
        <BackLink fallback="/groups" />
        <EmptyState
          icon={<UsersIcon className="h-6 w-6" />}
          title="Group not found"
          description={isAdmin
            ? `No group at /${slug}. It may have been deleted, or the slug is wrong.`
            : 'Private groups are only visible to their members.'}
          ctaLabel="Browse groups"
          ctaTo="/groups"
        />
      </div>
    )
  }

  const onDelete = async () => {
    if (!confirm(`Delete "${group.name}"? Members and history of the group itself are removed; matches stay.`)) return
    try {
      await deleteGroup(group.id)
      navigate('/groups')
    } catch (e) {
      alert((e as Error).message)
    }
  }

  return (
    <div className="space-y-6">
      <BackLink fallback="/groups" />
      <section>
        <div className="card">
          <div className="flex items-start gap-4">
            <OrgAvatar name={group.name} kind="group" size={56} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="!mb-0 truncate">{group.name}</h1>
                {group.isPrivate && (
                  <span className="tag bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">private</span>
                )}
                {isMember && <span className="tag-brand">member</span>}
                {isGroupAdmin && <span className="tag-admin">admin</span>}
              </div>
              {group.description && (
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">{group.description}</p>
              )}
              <p className="text-xs text-slate-500 mt-1">
                {members.length} {members.length === 1 ? 'member' : 'members'}
              </p>
            </div>
          </div>
          <ShareRow group={group} />
        </div>
      </section>

      {stats && (
        <section className="grid sm:grid-cols-3 gap-3">
          <StatCard label="Internal matches" value={String(stats.totalMatches)} />
          {stats.mostActive ? (
            <StatCard
              label="Most active"
              value={
                <PlayerLink
                  id={stats.mostActive.player.id}
                  name={stats.mostActive.player.name}
                  className="font-semibold"
                />
              }
              hint={`${stats.mostActive.count} matches`}
            />
          ) : (
            <StatCard label="Most active" value="—" />
          )}
          {stats.streak ? (
            <StatCard
              label="Hot streak"
              value={
                <PlayerLink
                  id={stats.streak.player.id}
                  name={stats.streak.player.name}
                  className="font-semibold"
                />
              }
              hint={`${stats.streak.count} wins in a row`}
            />
          ) : (
            <StatCard label="Hot streak" value="—" />
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2">Group leaderboard</h2>
        {rows.length === 0 ? (
          <EmptyState
            icon={<UsersIcon className="h-6 w-6" />}
            title="No members yet"
            description={isGroupAdmin ? 'Add the first member from the Manage panel below.' : 'Members will appear here once admins add them.'}
          />
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Player</th>
                  <th className="px-3 py-2 text-right">Level</th>
                  <th className="px-3 py-2 text-right hidden sm:table-cell">4-match avg</th>
                  <th className="px-3 py-2 text-right">Matches</th>
                  {isGroupAdmin && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
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
                            {r.isAdmin && <span className="ml-2 tag-admin">admin</span>}
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
                    {isGroupAdmin && (
                      <td className="px-3 py-2 text-right">
                        <MemberRowControls
                          group={group}
                          memberPlayerId={r.id}
                          isAdminMember={r.isAdmin}
                          totalAdmins={members.filter((m) => m.isAdmin).length}
                          onChanged={refresh}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isGroupAdmin && (
        <section>
          <h2 className="mb-2">Manage</h2>
          <ManagePanel
            group={group}
            memberIds={memberIds}
            onChanged={refresh}
            onDelete={onDelete}
          />
        </section>
      )}

      <section>
        <h2 className="mb-2">Recent group matches</h2>
        {matchesLoading ? (
          <div className="space-y-2">
            <SkeletonMatchCard />
            <SkeletonMatchCard />
          </div>
        ) : recent.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon className="h-6 w-6" />}
            title="No internal matches yet"
            description="Once two members log a match against each other it'll appear here."
          />
        ) : (
          <div className="space-y-2">
            {recent.map((m) => (
              <MatchCard key={m.id} match={m} players={players} settings={settings} />
            ))}
          </div>
        )}
      </section>

      {!session && (
        <p className="text-xs text-slate-500">
          <Link to="/" className="text-brand-600 hover:underline">Sign in</Link> to start your own group.
        </p>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: React.ReactNode
  hint?: string
}) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-0.5">{hint}</div>}
    </div>
  )
}

function ShareRow({ group }: { group: Group }) {
  const [copied, setCopied] = useState(false)
  const url = buildGroupShareUrl(group.slug)
  const text = `Join ${group.name} on Boast — squash ratings & leaderboards`
  const wa = whatsappShareUrl(`${text}\n${url}`)
  const tg = telegramShareUrl(url, text)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs">
        Share on WhatsApp
      </a>
      <a href={tg} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs">
        Share on Telegram
      </a>
      <button onClick={copy} className="btn-secondary text-xs">
        {copied ? 'Copied!' : 'Copy link'}
      </button>
    </div>
  )
}

function MemberRowControls({
  group,
  memberPlayerId,
  isAdminMember,
  totalAdmins,
  onChanged,
}: {
  group: Group
  memberPlayerId: string
  isAdminMember: boolean
  totalAdmins: number
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)

  const togglePromote = async () => {
    if (isAdminMember && totalAdmins <= 1) {
      alert('Promote another admin first — a group needs at least one admin.')
      return
    }
    setBusy(true)
    try {
      await addGroupMember(group.id, memberPlayerId, !isAdminMember)
      onChanged()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm('Remove this member from the group?')) return
    setBusy(true)
    try {
      await removeGroupMember(group.id, memberPlayerId)
      onChanged()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button onClick={togglePromote} disabled={busy} className="btn-text text-xs">
        {isAdminMember ? 'Demote' : 'Promote'}
      </button>
      <button onClick={remove} disabled={busy} className="btn-text-danger text-xs">
        Remove
      </button>
    </div>
  )
}

function ManagePanel({
  group,
  memberIds,
  onChanged,
  onDelete,
}: {
  group: Group
  memberIds: Set<string>
  onChanged: () => void
  onDelete: () => void
}) {
  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description ?? '')
  const [isPrivate, setIsPrivate] = useState(group.isPrivate)
  const [savingMeta, setSavingMeta] = useState(false)
  const [metaErr, setMetaErr] = useState<string | null>(null)
  const [pickedPlayer, setPickedPlayer] = useState<Player | null>(null)
  const [adding, setAdding] = useState(false)
  const [addErr, setAddErr] = useState<string | null>(null)

  // Reset form when the group changes (e.g. after rename).
  useEffect(() => {
    setName(group.name)
    setDescription(group.description ?? '')
    setIsPrivate(group.isPrivate)
  }, [group.id, group.name, group.description, group.isPrivate])

  const saveMeta = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingMeta(true)
    setMetaErr(null)
    try {
      await updateGroup({
        id: group.id,
        name: name.trim() || group.name,
        description: description.trim() || undefined,
        isPrivate,
      })
      onChanged()
    } catch (e) {
      setMetaErr((e as Error).message)
    } finally {
      setSavingMeta(false)
    }
  }

  const addMember = async () => {
    if (!pickedPlayer) return
    if (memberIds.has(pickedPlayer.id)) {
      setAddErr('Already a member')
      return
    }
    setAdding(true)
    setAddErr(null)
    try {
      await addGroupMember(group.id, pickedPlayer.id, false)
      setPickedPlayer(null)
      onChanged()
    } catch (e) {
      setAddErr((e as Error).message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="card space-y-4">
      <form onSubmit={saveMeta} className="space-y-2">
        <div>
          <label className="text-xs text-slate-500">Name</label>
          <input
            className="input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">Description</label>
          <textarea
            className="input w-full"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          <span>Private (members only)</span>
        </label>
        {metaErr && <div className="text-sm text-red-600">{metaErr}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={savingMeta} className="btn-primary">
            {savingMeta ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" onClick={onDelete} className="btn-link-danger">
            Delete group
          </button>
        </div>
      </form>

      <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-2">
        <div className="text-sm font-medium">Add a member</div>
        <PlayerSearch
          value={pickedPlayer}
          onChange={setPickedPlayer}
          placeholder="Search players to add…"
        />
        {addErr && <div className="text-sm text-red-600">{addErr}</div>}
        {pickedPlayer && (
          <button onClick={addMember} disabled={adding} className="btn-secondary text-sm">
            {adding ? 'Adding…' : `Add ${pickedPlayer.name}`}
          </button>
        )}
      </div>
    </div>
  )
}
