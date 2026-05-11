import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { useStore } from '../state/store'
import { respondToChallenge } from '../lib/supabase/challenges'
import { fmtDate } from '../lib/format'
import { CHALLENGE_STATUS_LABEL, MATCH_STATUS_LABEL, type Challenge, type ChallengeStatus, type Player } from '../types'
import { MatchCard } from '../components/MatchCard'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { PlayerLink } from '../components/PlayerLinks'

const DAY_MS = 24 * 60 * 60 * 1000
const TIMEOUT_DAYS = 3

/**
 * Activity — the user's match-flow inbox. Combines:
 *   • Incoming challenges someone sent me
 *   • Matches awaiting my confirmation
 *   • Outgoing challenges I sent
 *   • Matches I logged that are awaiting opponent confirmation
 *   • Past challenges (declined/cancelled/expired/accepted)
 *   • Disputed matches (admin only)
 *
 * The split axis is "who owes whom action," not "is this a Challenge or a
 * Match" — the user shouldn't have to think about object types.
 */
export function ActivityPage() {
  const {
    players, matches, isAdmin, session, myPlayer, settings,
    pendingForMe, confirmMatch,
    challenges, refreshChallenges,
  } = useStore()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Belt-and-braces refresh on mount: store keeps challenges fresh on auth
  // changes, but a user landing here after sending one from another page
  // should always see the latest state.
  useEffect(() => {
    refreshChallenges()
  }, [refreshChallenges])

  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])

  // Pending matches the current user *recorded* — informational, no action.
  const myPendingMatches = useMemo(() => {
    if (!session?.user || !myPlayer) return []
    return matches
      .filter((m) => m.status === 'pending' && m.createdBy === session.user.id)
      .filter((m) => m.playerAId === myPlayer.id || m.playerBId === myPlayer.id)
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  }, [matches, myPlayer, session?.user])

  const incomingChallenges = useMemo(
    () => challenges.filter((c) => c.toPlayerId === myPlayer?.id && c.status === 'pending'),
    [challenges, myPlayer?.id],
  )
  const outgoingChallenges = useMemo(
    () => challenges.filter((c) => c.fromPlayerId === myPlayer?.id && c.status === 'pending'),
    [challenges, myPlayer?.id],
  )
  const pastChallenges = useMemo(
    () =>
      challenges
        .filter(
          (c) =>
            (c.toPlayerId === myPlayer?.id || c.fromPlayerId === myPlayer?.id) &&
            c.status !== 'pending',
        )
        .slice(0, 20),
    [challenges, myPlayer?.id],
  )

  const disputed = isAdmin ? matches.filter((m) => m.status === 'disputed') : []

  // Admin-only queue: pending matches where at least one participant is an
  // unclaimed player. These can't be confirmed by the opponent (no account
  // to act from), and the 3-day aged auto-confirm intentionally skips them,
  // so a global admin has to step in via confirm_match.
  // Exclude any rows that are already in pendingForMe (admin who is a
  // participant) — they show up there with the same confirm UI.
  const adminPendingUnclaimed = useMemo(() => {
    if (!isAdmin) return []
    const playerById = new Map(players.map((p) => [p.id, p]))
    const pendingForMeIds = new Set(pendingForMe.map((m) => m.id))
    return matches
      .filter((m) => m.status === 'pending' && !pendingForMeIds.has(m.id))
      .filter((m) => {
        const a = playerById.get(m.playerAId)
        const b = playerById.get(m.playerBId)
        return (a && !a.userId) || (b && !b.userId)
      })
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  }, [isAdmin, matches, players, pendingForMe])

  const actionCount = pendingForMe.length + incomingChallenges.length + adminPendingUnclaimed.length
  const waitingCount = myPendingMatches.length + outgoingChallenges.length
  const empty = actionCount === 0 && waitingCount === 0 && pastChallenges.length === 0 && disputed.length === 0

  const onConfirm = async (id: string, dispute: boolean) => {
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

  const onChallengeRespond = async (
    c: Challenge,
    response: 'accepted' | 'declined' | 'cancelled',
  ) => {
    setErr(null)
    setBusy(c.id + ':' + response)
    try {
      await respondToChallenge(c.id, response)
      await refreshChallenges()
      if (response === 'accepted') {
        // Drop the user straight into Log Match with opponent / date / venue prefilled.
        const oppId = c.fromPlayerId === myPlayer?.id ? c.toPlayerId : c.fromPlayerId
        const params = new URLSearchParams({ opponent: oppId })
        if (c.proposedDate) params.set('date', c.proposedDate)
        if (c.venue) params.set('venue', c.venue)
        navigate(`/log?${params.toString()}`)
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!session) {
    return <div className="card text-center text-slate-500">Sign in to see your activity.</div>
  }
  if (!myPlayer) {
    return <div className="card text-center text-slate-500">Complete onboarding to see your activity.</div>
  }

  return (
    <div className="space-y-6">
      <header>
        <h1>Activity</h1>
        <p className="text-sm text-slate-500 mt-1">
          {empty
            ? 'All caught up — no challenges or confirmations waiting.'
            : actionCount > 0
              ? `${actionCount} ${actionCount === 1 ? 'item needs' : 'items need'} your response.`
              : 'Nothing needs your action right now.'}
          {' '}When someone logs a match against you, you have <strong>{TIMEOUT_DAYS} days</strong> to confirm or dispute it before it auto-confirms.
        </p>
      </header>

      {err && <div className="text-sm text-red-600">{err}</div>}

      {actionCount > 0 && (
        <section>
          <h2 className="mb-2">Action needed ({actionCount})</h2>
          <div className="space-y-2">
            {incomingChallenges.map((c) => (
              <ChallengeCard
                key={c.id}
                challenge={c}
                other={playerById.get(c.fromPlayerId)}
                direction="incoming"
                busy={busy?.startsWith(c.id) ?? false}
                onAccept={() => onChallengeRespond(c, 'accepted')}
                onDecline={() => onChallengeRespond(c, 'declined')}
              />
            ))}
            {pendingForMe.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                players={players}
                settings={settings}
                viewerId={myPlayer?.id}
                ring="amber"
                statusBadge={<StatusPill status="pending" />}
                actions={
                  <>
                    <button
                      className="btn-primary flex-1 sm:flex-none"
                      onClick={() => onConfirm(m.id, false)}
                      disabled={busy !== null}
                    >
                      {busy === m.id + ':c' ? 'Confirming…' : 'Confirm'}
                    </button>
                    <button
                      className="btn bg-tin-100 text-tin-700 hover:bg-tin-200 dark:bg-tin-900/30 dark:text-tin-200 flex-1 sm:flex-none"
                      onClick={() => onConfirm(m.id, true)}
                      disabled={busy !== null}
                    >
                      {busy === m.id + ':d' ? 'Reporting…' : 'Dispute'}
                    </button>
                  </>
                }
              />
            ))}
            {adminPendingUnclaimed.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                players={players}
                settings={settings}
                ring="amber"
                statusBadge={<StatusPill status="pending" />}
                hint={
                  <>
                    <strong>Awaiting admin confirmation</strong> — one of the
                    players is unclaimed, so they can't confirm themselves.
                    Confirm only if you trust the recorder's report.
                  </>
                }
                actions={
                  <>
                    <button
                      className="btn-primary flex-1 sm:flex-none"
                      onClick={() => onConfirm(m.id, false)}
                      disabled={busy !== null}
                    >
                      {busy === m.id + ':c' ? 'Confirming…' : 'Confirm'}
                    </button>
                    <button
                      className="btn bg-tin-100 text-tin-700 hover:bg-tin-200 dark:bg-tin-900/30 dark:text-tin-200 flex-1 sm:flex-none"
                      onClick={() => onConfirm(m.id, true)}
                      disabled={busy !== null}
                    >
                      {busy === m.id + ':d' ? 'Reporting…' : 'Dispute'}
                    </button>
                  </>
                }
              />
            ))}
          </div>
        </section>
      )}

      {waitingCount > 0 && (
        <section>
          <h2 className="mb-2">Waiting on others ({waitingCount})</h2>
          <div className="space-y-2">
            {outgoingChallenges.map((c) => (
              <ChallengeCard
                key={c.id}
                challenge={c}
                other={playerById.get(c.toPlayerId)}
                direction="outgoing"
                busy={busy?.startsWith(c.id) ?? false}
                onCancel={() => onChallengeRespond(c, 'cancelled')}
              />
            ))}
            {myPendingMatches.map((m) => {
              const created = m.createdAt ? Date.parse(m.createdAt) : Date.now()
              const remainingDays = Math.max(0, TIMEOUT_DAYS - Math.floor((Date.now() - created) / DAY_MS))
              return (
                <MatchCard
                  key={m.id}
                  match={m}
                  players={players}
                  settings={settings}
                  viewerId={myPlayer?.id}
                  statusBadge={<StatusPill status="pending" />}
                  hint={
                    remainingDays > 0
                      ? `Auto-confirms in ${remainingDays} ${remainingDays === 1 ? 'day' : 'days'} if no response.`
                      : 'Auto-confirming any moment now.'
                  }
                />
              )
            })}
          </div>
        </section>
      )}

      {pastChallenges.length > 0 && (
        <section>
          <h2 className="mb-2">Recent challenges</h2>
          <div className="space-y-2">
            {pastChallenges.map((c) => {
              const otherId = c.fromPlayerId === myPlayer.id ? c.toPlayerId : c.fromPlayerId
              const other = playerById.get(otherId)
              const direction = c.fromPlayerId === myPlayer.id ? 'outgoing' : 'incoming'
              return (
                <ChallengeCard
                  key={c.id}
                  challenge={c}
                  other={other}
                  direction={direction}
                  mode="past"
                />
              )
            })}
          </div>
        </section>
      )}

      {isAdmin && disputed.length > 0 && (
        <section>
          <h2 className="mb-2">Disputed (admin) ({disputed.length})</h2>
          <p className="text-xs text-slate-500 mb-2">Disputed matches don't affect ratings. Edit or delete from the History page.</p>
          <div className="space-y-2">
            {disputed.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                players={players}
                settings={settings}
                ring="tin"
                statusBadge={<StatusPill status="disputed" />}
              />
            ))}
          </div>
        </section>
      )}

      {empty && (
        <div className="card text-center text-slate-500">All caught up.</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Challenge cards
// ---------------------------------------------------------------------------

/**
 * Renders a challenge as a card. The body (lead text, meta line, message) is
 * the same regardless of state — so rich detail (proposed date, venue,
 * message) shows after a challenge has been accepted/declined too. Pending
 * challenges get action buttons; past challenges get a status badge.
 */
function ChallengeCard({
  challenge, other, direction, mode = 'pending', busy = false,
  onAccept, onDecline, onCancel,
}: {
  challenge: Challenge
  other?: Player
  /** Was this challenge sent TO me ('incoming') or BY me ('outgoing')? */
  direction: 'incoming' | 'outgoing'
  /** 'pending' shows action buttons; 'past' shows a status badge. */
  mode?: 'pending' | 'past'
  busy?: boolean
  onAccept?: () => void
  onDecline?: () => void
  onCancel?: () => void
}) {
  const isPast = mode === 'past'
  return (
    <div className={clsx(
      'card flex items-start gap-3',
      !isPast && 'ring-1 ring-brand-200/60 dark:ring-brand-900/40',
    )}>
      <PlayerAvatar name={other?.name ?? '?'} avatarUrl={other?.avatarUrl} size={40} />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm">
            {direction === 'incoming' ? (
              <><PlayerLink id={other?.id} name={other?.name ?? 'Someone'} className="font-medium" /> challenged you</>
            ) : (
              <>You challenged <PlayerLink id={other?.id} name={other?.name ?? 'Someone'} className="font-medium" /></>
            )}
          </span>
          {!isPast && (
            <span className="rounded-full bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              Challenge
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500">
          {fmtDate(challenge.createdAt)}
          {challenge.proposedDate && <> · proposed {fmtDate(challenge.proposedDate)}</>}
          {challenge.venue && <> · {challenge.venue}</>}
          {isPast && challenge.respondedAt && challenge.respondedAt !== challenge.createdAt && (
            <> · {challenge.status} {fmtDate(challenge.respondedAt)}</>
          )}
        </div>
        {challenge.message && (
          <p className="text-sm text-slate-700 dark:text-slate-300 italic">"{challenge.message}"</p>
        )}
      </div>
      <div className="flex flex-col gap-2 shrink-0">
        {!isPast && direction === 'incoming' && (
          <>
            <button onClick={onAccept} disabled={busy} className="btn-primary text-xs">
              {busy ? '…' : 'Accept'}
            </button>
            <button onClick={onDecline} disabled={busy} className="btn-secondary text-xs">
              Decline
            </button>
          </>
        )}
        {!isPast && direction === 'outgoing' && (
          <button onClick={onCancel} disabled={busy} className="btn-secondary text-xs">
            {busy ? '…' : 'Cancel'}
          </button>
        )}
        {isPast && <ChallengeStatusBadge status={challenge.status} />}
      </div>
    </div>
  )
}

function ChallengeStatusBadge({ status }: { status: ChallengeStatus }) {
  const cls =
    status === 'accepted'
      ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
      : status === 'declined' || status === 'cancelled'
        ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
        : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
  return (
    <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold lowercase', cls)}>
      {CHALLENGE_STATUS_LABEL[status].toLowerCase()}
    </span>
  )
}

function StatusPill({ status }: { status: 'pending' | 'disputed' }) {
  return (
    <span className={clsx(
      'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
      status === 'pending' && 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
      status === 'disputed' && 'bg-tin-100 text-tin-800 dark:bg-tin-900/40 dark:text-tin-200',
    )}>
      {MATCH_STATUS_LABEL[status]}
    </span>
  )
}
