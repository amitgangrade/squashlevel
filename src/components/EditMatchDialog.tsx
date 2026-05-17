import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { MATCH_TYPE_KEYS, MATCH_TYPE_LABEL, type GameScore, type Match, type MatchType, type Player } from '../types'
import { fmtDate } from '../lib/format'
import { TrashIcon } from './Icons'

export interface EditMatchDialogProps {
  match: Match
  players: Player[]
  onClose: () => void
  /** Called after a successful save with the updated match. */
  onSaved?: (m: Match) => void
}

/**
 * Admin-only dialog for editing an existing match. Mirrors the score input
 * shape used in LogMatchPage. Player IDs are immutable here — those edits
 * would invalidate the rating history graph in subtle ways. After saving,
 * the caller should remind the admin to run "Rebuild levels" since the
 * matches_after_levels trigger only fires on INSERT and status transitions,
 * not on score edits.
 */
export function EditMatchDialog({ match, players, onClose, onSaved }: EditMatchDialogProps) {
  const { updateMatch, recomputed } = useStore()

  const [date, setDate] = useState(match.date)
  const [type, setType] = useState<MatchType>(match.type)
  const [venue, setVenue] = useState(match.venue ?? '')
  const [notes, setNotes] = useState(match.notes ?? '')
  const [unranked, setUnranked] = useState(!!match.unranked)
  const [scores, setScores] = useState<GameScore[]>(
    match.games.length > 0 ? match.games.map((g) => ({ ...g })) : [{ a: 0, b: 0 }],
  )

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Esc-to-close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const playerA = players.find((p) => p.id === match.playerAId) ?? null
  const playerB = players.find((p) => p.id === match.playerBId) ?? null

  // Date guard rails — server trigger is the authority, this is UX courtesy.
  // See openspec/specs/match-recording §Match date validation.
  const today = new Date().toISOString().slice(0, 10)
  const floorOwner = (() => {
    const a = playerA?.createdAt?.slice(0, 10)
    const b = playerB?.createdAt?.slice(0, 10)
    if (a && b) {
      if (a === b) return 'both' as const
      return a > b ? 'a' : 'b'
    }
    if (a) return 'a'
    if (b) return 'b'
    return null
  })()
  const dateFloor = (() => {
    const a = playerA?.createdAt?.slice(0, 10)
    const b = playerB?.createdAt?.slice(0, 10)
    if (a && b) return a > b ? a : b
    return a ?? b ?? undefined
  })()
  const lastMatchDateFor = (p: Player | null): string | undefined => {
    if (!p) return undefined
    const hist = recomputed.states.get(p.id)?.history ?? []
    let latest: string | undefined
    for (const entry of hist) {
      if (entry.matchId === 'start' || entry.matchId === match.id) continue
      if (!latest || entry.date > latest) latest = entry.date
    }
    return latest
  }
  const lastA = lastMatchDateFor(playerA)
  const lastB = lastMatchDateFor(playerB)
  const willReorderHistory =
    !!(lastA && date < lastA) || !!(lastB && date < lastB)
  const dateOutOfRange =
    (!!dateFloor && date < dateFloor) || date > today

  const setGame = (i: number, side: 'a' | 'b', val: string) => {
    const n = Math.max(0, Math.floor(Number(val) || 0))
    setScores((prev) => prev.map((g, idx) => (idx === i ? { ...g, [side]: n } : g)))
  }
  const addGame = () => setScores((prev) => [...prev, { a: 0, b: 0 }])
  const removeGame = (i: number) => setScores((prev) => prev.filter((_, idx) => idx !== i))

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (date > today) { setErr('Match date is in the future'); return }
    if (dateFloor && date < dateFloor) {
      setErr(
        `Match date precedes when one of the players joined Boast (${dateFloor}). ` +
          `Pick a date on or after ${dateFloor}.`,
      )
      return
    }
    const clean = scores.filter((g) => g.a > 0 || g.b > 0)
    if (clean.length === 0) { setErr('Enter at least one game score'); return }

    const updated: Match = {
      ...match,
      date,
      type,
      venue: venue.trim() || undefined,
      notes: notes.trim() || undefined,
      unranked: unranked || undefined,
      games: clean,
    }

    setBusy(true)
    try {
      await updateMatch(updated)
      onSaved?.(updated)
      onClose()
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-white dark:bg-slate-950 sm:bg-slate-950/60 sm:dark:bg-slate-950/80 sm:grid sm:place-items-center sm:p-4 overflow-hidden"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex h-full sm:h-auto sm:max-h-[90vh] w-full sm:max-w-lg flex-col bg-white dark:bg-slate-950 sm:rounded-lg sm:border sm:border-slate-200 sm:dark:border-slate-800 sm:shadow-2xl">
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pt-safe shrink-0 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-lg font-semibold">Edit match</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {playerA?.name ?? 'Unknown'} <span className="text-slate-400">vs</span> {playerB?.name ?? 'Unknown'}
            </p>
          </div>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xl leading-none px-2"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Date</label>
              <input
                type="date"
                className="input w-full"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={dateFloor}
                max={today}
                required
              />
              {dateOutOfRange ? (
                <p className="mt-1 text-xs text-red-600">
                  {date > today
                    ? 'Match date is in the future.'
                    : `Match date precedes when one of the players joined Boast (${dateFloor}).`}
                </p>
              ) : willReorderHistory ? (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                  Older than a more recent match — saving will reorder match history; admin should
                  run Rebuild levels afterwards.
                </p>
              ) : dateFloor ? (
                <p className="mt-1 text-xs text-slate-500">
                  Earliest: {fmtDate(dateFloor)} ({
                    floorOwner === 'both'
                      ? 'when both players joined Boast'
                      : floorOwner === 'a'
                        ? `when ${playerA?.name} joined Boast`
                        : `when ${playerB?.name} joined Boast`
                  })
                </p>
              ) : null}
            </div>
            <div>
              <label className="label">Type</label>
              <select
                className="input w-full"
                value={type}
                onChange={(e) => setType(e.target.value as MatchType)}
              >
                {MATCH_TYPE_KEYS.map((t) => (
                  <option key={t} value={t}>{MATCH_TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Venue</label>
            <input
              className="input w-full"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea
              className="input w-full"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={unranked}
              onChange={(e) => setUnranked(e.target.checked)}
            />
            Unranked (don't affect levels)
          </label>

          <div>
            <label className="label">
              Game scores
              <span className="text-xs text-slate-500 font-normal ml-2">
                {playerA?.name ?? 'A'} – {playerB?.name ?? 'B'}
              </span>
            </label>
            <div className="space-y-2">
              {scores.map((g, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40"
                >
                  <span className="text-xs font-medium text-slate-500 w-14 shrink-0">Game {i + 1}</span>
                  <div className="flex-1 flex items-center justify-center gap-2">
                    <input
                      className="input w-20 text-center text-lg font-semibold"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={g.a}
                      onChange={(e) => setGame(i, 'a', e.target.value)}
                      aria-label={`Game ${i + 1} player A`}
                    />
                    <span className="text-slate-400 text-lg select-none">–</span>
                    <input
                      className="input w-20 text-center text-lg font-semibold"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={g.b}
                      onChange={(e) => setGame(i, 'b', e.target.value)}
                      aria-label={`Game ${i + 1} player B`}
                    />
                  </div>
                  {scores.length > 1 ? (
                    <button
                      type="button"
                      aria-label={`Remove game ${i + 1}`}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                      onClick={() => removeGame(i)}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  ) : (
                    <span className="w-10 shrink-0" />
                  )}
                </div>
              ))}
              <button type="button" className="btn-secondary w-full sm:w-auto" onClick={addGame}>
                + Add game
              </button>
            </div>
          </div>

          {err && <div className="text-sm text-red-600">{err}</div>}
        </form>

        <div className="px-4 sm:px-6 py-3 border-t border-slate-200 dark:border-slate-800 shrink-0 flex items-center justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onSubmit}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
