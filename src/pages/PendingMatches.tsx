import { useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../state/store'
import { fmtDate, fmtDelta, fmtLevel } from '../lib/format'
import { MATCH_TYPE_LABEL, MATCH_STATUS_LABEL } from '../types'
import { GameScores } from '../components/MatchScores'
import { summarizeMatch } from '../lib/match-summary'

const DAY_MS = 24 * 60 * 60 * 1000
const TIMEOUT_DAYS = 3

export function PendingMatchesPage() {
  const { pendingForMe, players, matches, isAdmin, confirmMatch, session, myPlayer } = useStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Admin secondary view: any disputed matches (cleanup workflow).
  const disputed = matches.filter((m) => m.status === 'disputed')
  // Pending matches the current user *recorded* (no action available — informational).
  const myPending = !session?.user || !myPlayer
    ? []
    : matches
        .filter((m) => m.status === 'pending' && m.createdBy === session.user.id)
        .filter((m) => m.playerAId === myPlayer.id || m.playerBId === myPlayer.id)
        .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))

  const act = async (id: string, dispute: boolean) => {
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

  if (!session) {
    return <div className="card text-slate-500 text-center">Sign in to see matches awaiting your confirmation.</div>
  }

  const empty = pendingForMe.length === 0 && myPending.length === 0 && disputed.length === 0

  return (
    <div className="space-y-6">
      <header>
        <h1>Match confirmations</h1>
        <p className="text-sm text-slate-500 mt-1">
          When someone logs a match against you, you have <strong>{TIMEOUT_DAYS} days</strong> to confirm or dispute it. After that it auto-confirms.
        </p>
      </header>

      {empty && (
        <div className="card text-center text-slate-500">All caught up — nothing pending.</div>
      )}

      {pendingForMe.length > 0 && (
        <section>
          <h2 className="mb-2">Awaiting your confirmation ({pendingForMe.length})</h2>
          <div className="space-y-2">
            {pendingForMe.map((m) => (
              <PendingCard
                key={m.id}
                m={m}
                players={players}
                disabled={busy !== null}
                actingConfirm={busy === m.id + ':c'}
                actingDispute={busy === m.id + ':d'}
                onConfirm={() => act(m.id, false)}
                onDispute={() => act(m.id, true)}
              />
            ))}
          </div>
        </section>
      )}

      {myPending.length > 0 && (
        <section>
          <h2 className="mb-2">Waiting on your opponent ({myPending.length})</h2>
          <div className="space-y-2">
            {myPending.map((m) => {
              const created = m.createdAt ? Date.parse(m.createdAt) : Date.now()
              const remainingDays = Math.max(0, TIMEOUT_DAYS - Math.floor((Date.now() - created) / DAY_MS))
              return (
                <InformationalCard
                  key={m.id}
                  m={m}
                  players={players}
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

      {isAdmin && disputed.length > 0 && (
        <section>
          <h2 className="mb-2">Disputed (admin) ({disputed.length})</h2>
          <p className="text-xs text-slate-500 mb-2">Disputed matches don't affect ratings. Edit or delete from the History page.</p>
          <div className="space-y-2">
            {disputed.map((m) => (
              <InformationalCard key={m.id} m={m} players={players} variant="disputed" />
            ))}
          </div>
        </section>
      )}

      {err && <div className="text-sm text-red-600">{err}</div>}
    </div>
  )
}

function PendingCard({
  m, players, onConfirm, onDispute, disabled, actingConfirm, actingDispute,
}: {
  m: Parameters<typeof summarizeMatch>[0]
  players: Parameters<typeof summarizeMatch>[1]
  onConfirm: () => void
  onDispute: () => void
  disabled: boolean
  actingConfirm: boolean
  actingDispute: boolean
}) {
  const s = summarizeMatch(m, players)
  return (
    <div className="card space-y-3 ring-1 ring-amber-200 dark:ring-amber-900/40">
      <MatchHeader m={m} s={s} statusBadge="pending" />
      <div className="text-xs"><GameScores games={m.games} /></div>
      {m.notes && <div className="text-xs text-slate-500 italic">{m.notes}</div>}
      <div className="flex gap-2 pt-1">
        <button
          className="btn-primary flex-1 sm:flex-none"
          onClick={onConfirm}
          disabled={disabled}
        >
          {actingConfirm ? 'Confirming…' : 'Confirm'}
        </button>
        <button
          className="btn bg-tin-100 text-tin-700 hover:bg-tin-200 dark:bg-tin-900/30 dark:text-tin-200 flex-1 sm:flex-none"
          onClick={onDispute}
          disabled={disabled}
        >
          {actingDispute ? 'Reporting…' : 'Dispute'}
        </button>
      </div>
    </div>
  )
}

function InformationalCard({
  m, players, hint, variant = 'pending',
}: {
  m: Parameters<typeof summarizeMatch>[0]
  players: Parameters<typeof summarizeMatch>[1]
  hint?: string
  variant?: 'pending' | 'disputed'
}) {
  const s = summarizeMatch(m, players)
  return (
    <div className={clsx('card space-y-2', variant === 'disputed' && 'ring-1 ring-tin-300 dark:ring-tin-900/50')}>
      <MatchHeader m={m} s={s} statusBadge={variant} />
      <div className="text-xs"><GameScores games={m.games} /></div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

function MatchHeader({
  m, s, statusBadge,
}: {
  m: Parameters<typeof summarizeMatch>[0]
  s: ReturnType<typeof summarizeMatch>
  statusBadge: 'pending' | 'disputed'
}) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={clsx('font-semibold', !s.isDraw && s.winnerId === m.playerAId ? 'text-green-700 dark:text-green-400' : 'text-slate-500')}>
          {s.aName}
        </span>
        <span className="font-mono">
          <span className={!s.isDraw && s.winnerId === m.playerAId ? 'font-bold' : ''}>{s.aGames}</span>
          <span className="text-slate-400 mx-1">–</span>
          <span className={!s.isDraw && s.winnerId === m.playerBId ? 'font-bold' : ''}>{s.bGames}</span>
        </span>
        <span className={clsx('font-semibold', !s.isDraw && s.winnerId === m.playerBId ? 'text-green-700 dark:text-green-400' : 'text-slate-500')}>
          {s.bName}
        </span>
        <span className={clsx(
          'ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
          statusBadge === 'pending' && 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
          statusBadge === 'disputed' && 'bg-tin-100 text-tin-800 dark:bg-tin-900/40 dark:text-tin-200',
        )}>
          {MATCH_STATUS_LABEL[statusBadge]}
        </span>
      </div>
      <div className="text-xs text-slate-500">
        {fmtDate(m.date)} · {MATCH_TYPE_LABEL[m.type]}
        {m.deltaA != null && m.deltaB != null && (
          <>
            {' · '}
            <span className={(m.deltaA ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtDelta(m.deltaA)}</span>{' / '}
            <span className={(m.deltaB ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtDelta(m.deltaB)}</span>
            {' (preview)'}
          </>
        )}
        {m.levelABefore != null && (
          <>
            {' · '}{fmtLevel(m.levelABefore)} / {fmtLevel(m.levelBBefore)}
          </>
        )}
      </div>
    </div>
  )
}
