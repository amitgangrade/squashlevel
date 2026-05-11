import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { useStore } from '../state/store'
import { respondToChallenge } from '../lib/supabase/challenges'
import { fmtDate } from '../lib/format'
import { CHALLENGE_STATUS_LABEL, MATCH_STATUS_LABEL, type Challenge, type ChallengeStatus, type Player } from '../types'
import { Alert } from '../components/Alert'
import { EmptyState } from '../components/EmptyState'
import { InboxIcon, UserIcon } from '../components/Icons'
import { MatchCard } from '../components/MatchCard'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { PlayerLink } from '../components/PlayerLinks'
import { StatusPill } from '../components/StatusPill'

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

  // Admin oversight queue: every pending match in the system that the admin
  // isn't already a participant in. Participant cases land in pendingForMe
  // (matches awaiting MY confirmation) or myPendingMatches (matches I
  // recorded that need my opponent), so excluding them here prevents the
  // same match showing up twice.
  //
  // SQL allows global admins to confirm any pending match (see
  // confirm_match in schema.sql) — the UI just needs to surface them.
  // This was previously gated to "unclaimed-player matches only" since
  // those need admin to break the deadlock; now admins can also expedite
  // a claimed-vs-claimed pending if e.g. a tournament needs a result
  // posted before the 3-day auto-confirm fires.
  const adminPending = useMemo(() => {
    if (!isAdmin) return []
    return matches
      .filter((m) => m.status === 'pending')
      .filter((m) => {
        if (!myPlayer) return true
        return m.playerAId !== myPlayer.id && m.playerBId !== myPlayer.id
      })
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  }, [isAdmin, matches, myPlayer])

  // Personal action count drives the bottom-nav badge — admin oversight
  // intentionally NOT included since "you have 47 pending matches across
  // the platform" would constantly nag without being a personal todo.
  const actionCount = pendingForMe.length + incomingChallenges.length
  const waitingCount = myPendingMatches.length + outgoingChallenges.length
  const empty =
    actionCount === 0 &&
    waitingCount === 0 &&
    pastChallenges.length === 0 &&
    disputed.length === 0 &&
    adminPending.length === 0

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
    return (
      <EmptyState
        icon={<UserIcon className="h-6 w-6" />}
        title="Sign in to see your activity"
        description="Activity shows challenges, confirmations, and matches that need your response."
      />
    )
  }
  if (!myPlayer) {
    return (
      <EmptyState
        icon={<UserIcon className="h-6 w-6" />}
        title="Finish setting up your profile"
        description="Complete onboarding so you can receive challenges and confirm matches."
        ctaLabel="Open my profile"
        ctaTo="/profile"
      />
    )
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

      {err && <Alert variant="error">{err}</Alert>}

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
                statusBadge={<StatusPill variant="pending">{MATCH_STATUS_LABEL.pending}</StatusPill>}
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
                      className="btn bg-tin-100 text-tin-800 hover:bg-tin-200 active:bg-tin-300 dark:bg-tin-900/30 dark:text-tin-200 dark:hover:bg-tin-900/50 flex-1 sm:flex-none"
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

      {adminPending.length > 0 && (
        <section>
          <h2 className="mb-2">Admin: pending matches ({adminPending.length})</h2>
          <p className="text-xs text-slate-500 mb-2">
            Pending matches where you're not a participant. Most resolve on their own —
            opponents confirm or the 3-day timer auto-confirms — but you can step in to
            expedite or to break a deadlock when a player is unclaimed.
          </p>
          <div className="space-y-2">
            {adminPending.map((m) => {
              const a = playerById.get(m.playerAId)
              const b = playerById.get(m.playerBId)
              const hasUnclaimed = (a && !a.userId) || (b && !b.userId)
              const created = m.createdAt ? Date.parse(m.createdAt) : Date.now()
              const remainingDays = Math.max(
                0,
                TIMEOUT_DAYS - Math.floor((Date.now() - created) / DAY_MS),
              )
              const hint = hasUnclaimed ? (
                <>
                  <strong>One player is unclaimed</strong> — auto-confirm won't fire,
                  so this needs an admin to resolve. Confirm only if you trust the
                  recorder's report.
                </>
              ) : remainingDays > 0 ? (
                <>Awaiting opponent. Auto-confirms in {remainingDays} {remainingDays === 1 ? 'day' : 'days'}.</>
              ) : (
                <>Auto-confirming any moment now.</>
              )
              return (
                <MatchCard
                  key={m.id}
                  match={m}
                  players={players}
                  settings={settings}
                  ring="amber"
                  statusBadge={<StatusPill variant="pending">{MATCH_STATUS_LABEL.pending}</StatusPill>}
                  hint={hint}
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
                        className="btn bg-tin-100 text-tin-800 hover:bg-tin-200 active:bg-tin-300 dark:bg-tin-900/30 dark:text-tin-200 dark:hover:bg-tin-900/50 flex-1 sm:flex-none"
                        onClick={() => onConfirm(m.id, true)}
                        disabled={busy !== null}
                      >
                        {busy === m.id + ':d' ? 'Reporting…' : 'Dispute'}
                      </button>
                    </>
                  }
                />
              )
            })}
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
                  statusBadge={<StatusPill variant="pending">{MATCH_STATUS_LABEL.pending}</StatusPill>}
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
                statusBadge={<StatusPill variant="disputed">{MATCH_STATUS_LABEL.disputed}</StatusPill>}
              />
            ))}
          </div>
        </section>
      )}

      {empty && (
        <EmptyState
          icon={<InboxIcon className="h-6 w-6" />}
          title="All caught up"
          description="No challenges or confirmations waiting. New activity will show here."
        />
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
          {!isPast && <StatusPill variant="brand">Challenge</StatusPill>}
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
  const variant: 'win' | 'neutral' | 'pending' =
    status === 'accepted' ? 'win'
    : status === 'declined' || status === 'cancelled' ? 'neutral'
    : 'pending'
  return (
    <StatusPill variant={variant} case="lower">
      {CHALLENGE_STATUS_LABEL[status].toLowerCase()}
    </StatusPill>
  )
}
