import { useState } from 'react'
import { useStore } from '../state/store'
import { createChallenge } from '../lib/supabase/challenges'

interface Props {
  /** The player being challenged. */
  toPlayerId: string
  toPlayerName: string
}

/**
 * "Challenge this player" button. Opens an inline form for an optional
 * message, proposed date, and venue. Disables itself when the viewer can't
 * issue a challenge (signed out, no linked player, or self).
 */
export function ChallengeButton({ toPlayerId, toPlayerName }: Props) {
  const { session, myPlayer, refreshChallenges } = useStore()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const [message, setMessage] = useState('')
  const [proposedDate, setProposedDate] = useState('')
  const [venue, setVenue] = useState('')

  const disabledReason = !session
    ? 'Sign in to challenge'
    : !myPlayer
      ? 'Complete onboarding to challenge'
      : myPlayer.id === toPlayerId
        ? 'Cannot challenge yourself'
        : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      await createChallenge({
        toPlayerId,
        message: message.trim() || undefined,
        proposedDate: proposedDate || undefined,
        venue: venue.trim() || undefined,
      })
      // Pull the fresh row into the store so Activity reflects the send
      // immediately. Non-fatal if it fails — Activity page also refreshes on
      // mount.
      refreshChallenges().catch(() => {})
      setDone(true)
      setOpen(false)
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <span className="tag-won">
        Challenge sent
      </span>
    )
  }

  if (disabledReason) {
    return (
      <button className="btn-secondary shrink-0 opacity-50 cursor-not-allowed" disabled title={disabledReason}>
        Challenge
      </button>
    )
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary shrink-0">
        Challenge
      </button>
    )
  }

  return (
    <div className="card space-y-3 max-w-md">
      <div className="text-sm">
        Challenge <span className="font-semibold">{toPlayerName}</span> to a match.
      </div>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="ch-msg">Message <span className="text-slate-400">(optional)</span></label>
          <textarea
            id="ch-msg"
            className="input w-full"
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Saturday morning at the Cricket Club?"
            maxLength={500}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="ch-date">Proposed date</label>
            <input
              id="ch-date"
              type="date"
              className="input w-full"
              value={proposedDate}
              onChange={(e) => setProposedDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="ch-venue">Venue</label>
            <input
              id="ch-venue"
              className="input w-full"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="Cricket Club"
            />
          </div>
        </div>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Sending…' : 'Send challenge'}
          </button>
        </div>
      </form>
    </div>
  )
}
