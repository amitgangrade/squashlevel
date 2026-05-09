import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { useStore } from '../state/store'
import { fetchChallenges, respondToChallenge } from '../lib/supabase/challenges'
import { fmtDate } from '../lib/format'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { PlayerLink } from '../components/PlayerLinks'
import type { Challenge } from '../types'

export function ChallengesPage() {
  const { myPlayer, players, session } = useStore()
  const navigate = useNavigate()
  const [items, setItems] = useState<Challenge[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = async () => {
    if (!myPlayer) return
    setErr(null)
    try {
      setItems(await fetchChallenges())
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPlayer?.id])

  const incoming = useMemo(
    () => (items ?? []).filter((c) => c.toPlayerId === myPlayer?.id && c.status === 'pending'),
    [items, myPlayer?.id],
  )
  const outgoing = useMemo(
    () => (items ?? []).filter((c) => c.fromPlayerId === myPlayer?.id && c.status === 'pending'),
    [items, myPlayer?.id],
  )
  const past = useMemo(
    () =>
      (items ?? [])
        .filter(
          (c) =>
            (c.toPlayerId === myPlayer?.id || c.fromPlayerId === myPlayer?.id) &&
            c.status !== 'pending',
        )
        .slice(0, 20),
    [items, myPlayer?.id],
  )

  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])

  const respond = async (
    id: string,
    response: 'accepted' | 'declined' | 'cancelled',
    challenge: Challenge,
  ) => {
    setBusyId(id)
    setErr(null)
    try {
      await respondToChallenge(id, response)
      await refresh()
      if (response === 'accepted') {
        // Pre-fill the log-match flow with this opponent.
        const oppId = challenge.fromPlayerId === myPlayer?.id ? challenge.toPlayerId : challenge.fromPlayerId
        navigate(`/log?opponent=${oppId}${challenge.proposedDate ? `&date=${challenge.proposedDate}` : ''}${challenge.venue ? `&venue=${encodeURIComponent(challenge.venue)}` : ''}`)
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  if (!session) {
    return <div className="card text-center text-slate-500">Sign in to view your challenges.</div>
  }
  if (!myPlayer) {
    return <div className="card text-center text-slate-500">Complete onboarding to send and receive challenges.</div>
  }

  return (
    <div className="space-y-6">
      <h1>Challenges</h1>
      {err && <div className="text-sm text-red-600">{err}</div>}

      <Section title="Incoming" empty="No pending challenges. Quiet day on court.">
        {incoming.map((c) => {
          const from = playerById.get(c.fromPlayerId)
          return (
            <ChallengeRow
              key={c.id}
              challenge={c}
              other={from}
              direction="incoming"
              busy={busyId === c.id}
              onAccept={() => respond(c.id, 'accepted', c)}
              onDecline={() => respond(c.id, 'declined', c)}
            />
          )
        })}
      </Section>

      <Section title="Sent" empty="No outstanding challenges from you.">
        {outgoing.map((c) => {
          const to = playerById.get(c.toPlayerId)
          return (
            <ChallengeRow
              key={c.id}
              challenge={c}
              other={to}
              direction="outgoing"
              busy={busyId === c.id}
              onCancel={() => respond(c.id, 'cancelled', c)}
            />
          )
        })}
      </Section>

      {past.length > 0 && (
        <Section title="Past" empty="">
          {past.map((c) => {
            const otherId = c.fromPlayerId === myPlayer.id ? c.toPlayerId : c.fromPlayerId
            const other = playerById.get(otherId)
            return (
              <div key={c.id} className="card flex items-center gap-3">
                <PlayerAvatar name={other?.name ?? '?'} avatarUrl={other?.avatarUrl} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm">
                    <PlayerLink id={otherId} name={other?.name ?? 'Unknown'} className="font-medium" />
                    <span className="ml-2 text-xs text-slate-500">{fmtDate(c.respondedAt ?? c.createdAt)}</span>
                  </div>
                </div>
                <span className={clsx('tag', c.status === 'accepted' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600')}>
                  {c.status}
                </span>
              </div>
            )
          })}
        </Section>
      )}
    </div>
  )
}

function Section({
  title, empty, children,
}: { title: string; empty: string; children: React.ReactNode }) {
  // Empty children -> render the empty state. Children present -> render them.
  const arr = Array.isArray(children) ? children : children ? [children] : []
  return (
    <section>
      <h2 className="mb-2">{title}</h2>
      {arr.length === 0 ? (
        empty ? <div className="card text-center text-slate-500">{empty}</div> : null
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  )
}

function ChallengeRow({
  challenge, other, direction, busy, onAccept, onDecline, onCancel,
}: {
  challenge: Challenge
  other?: { id: string; name: string; avatarUrl?: string }
  direction: 'incoming' | 'outgoing'
  busy: boolean
  onAccept?: () => void
  onDecline?: () => void
  onCancel?: () => void
}) {
  return (
    <div className="card flex items-start gap-3">
      <PlayerAvatar name={other?.name ?? '?'} avatarUrl={other?.avatarUrl} size={40} />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="text-sm">
          {direction === 'incoming' ? (
            <><PlayerLink id={other?.id} name={other?.name ?? 'Someone'} className="font-medium" /> challenged you</>
          ) : (
            <>You challenged <PlayerLink id={other?.id} name={other?.name ?? 'Someone'} className="font-medium" /></>
          )}
        </div>
        <div className="text-xs text-slate-500">
          {fmtDate(challenge.createdAt)}
          {challenge.proposedDate && <> · proposed {fmtDate(challenge.proposedDate)}</>}
          {challenge.venue && <> · {challenge.venue}</>}
        </div>
        {challenge.message && (
          <p className="text-sm text-slate-700 dark:text-slate-300 italic">"{challenge.message}"</p>
        )}
      </div>
      <div className="flex flex-col gap-2 shrink-0">
        {direction === 'incoming' && (
          <>
            <button onClick={onAccept} disabled={busy} className="btn-primary text-xs">
              {busy ? '…' : 'Accept'}
            </button>
            <button onClick={onDecline} disabled={busy} className="btn-secondary text-xs">
              Decline
            </button>
          </>
        )}
        {direction === 'outgoing' && (
          <button onClick={onCancel} disabled={busy} className="btn-secondary text-xs">
            {busy ? '…' : 'Cancel'}
          </button>
        )}
      </div>
    </div>
  )
}

// Small helper so other pages can render a "View challenges" link.
export function ChallengesLink({ count }: { count: number }) {
  return (
    <Link to="/challenges" className="text-sm text-brand-600 hover:underline">
      Challenges{count > 0 && ` (${count})`}
    </Link>
  )
}
