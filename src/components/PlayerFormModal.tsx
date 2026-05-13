import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { COUNTRIES, distinctValues } from '../lib/places'
import { parseProfileFields } from '../lib/profile-validation'
import {
  DOMINANT_HAND_LABEL,
  GENDER_LABEL,
  type DominantHand,
  type Gender,
  type Player,
} from '../types'

interface Props {
  /** When set: edit mode for that player. When null: add mode. */
  player: Player | null
  /** Pre-fill the club field in add mode (the Club page passes its slug's
   *  canonical display name here). Ignored in edit mode. */
  defaultClub?: string
  onClose: () => void
  onSaved?: (saved: Player) => void
}

/**
 * Add-or-edit player modal. Used by the Club profile page so club admins can
 * curate their roster from the same screen they're already looking at.
 *
 * Honours store-level permission gates — `store.addPlayer` enforces that
 * non-globals can only add unclaimed players to a club they administer, and
 * `store.updatePlayer` enforces canWritePlayer. Errors thrown by either are
 * surfaced inline.
 *
 * Editing a CLAIMED player (`player.userId` set) is technically permitted by
 * the spec for club admins, but the `sync_player_from_profile` trigger
 * overwrites identity fields whenever the user themselves next saves their
 * own profile, so changes are non-durable. We show an inline warning in
 * that case rather than blocking, because the action is sometimes useful
 * (e.g. correcting a starting_level that the user can't undo themselves).
 */
export function PlayerFormModal({ player, defaultClub, onClose, onSaved }: Props) {
  const { players, addPlayer, updatePlayer } = useStore()
  const cityOptions = useMemo(() => distinctValues(players, 'city'), [players])
  const clubOptions = useMemo(() => distinctValues(players, 'club'), [players])

  const editing = !!player
  const [name, setName] = useState(player?.name ?? '')
  const [email, setEmail] = useState(player?.email ?? '')
  const [phone, setPhone] = useState(player?.phone ?? '')
  const [club, setClub] = useState(player?.club ?? defaultClub ?? '')
  const [country, setCountry] = useState(player?.country ?? '')
  const [city, setCity] = useState(player?.city ?? '')
  const [startingLevel, setStartingLevel] = useState(String(player?.startingLevel ?? 1000))
  const [birthYear, setBirthYear] = useState(player?.birthYear ? String(player.birthYear) : '')
  const [gender, setGender] = useState<Gender | ''>(player?.gender ?? '')
  const [dominantHand, setDominantHand] = useState<DominantHand | ''>(player?.dominantHand ?? '')
  const [notes, setNotes] = useState(player?.notes ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (!name.trim()) return setErr('Name is required')
    const lvl = Number(startingLevel)
    if (!Number.isFinite(lvl) || lvl <= 0) return setErr('Starting level must be a positive number')
    const trimmedEmail = email.trim()
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return setErr('Email looks invalid')
    }
    const parsed = parseProfileFields({ birthYear, country, city })
    if (!parsed.ok) return setErr(parsed.error)

    const data = {
      name: name.trim(),
      startingLevel: lvl,
      email: trimmedEmail || undefined,
      phone: phone.trim() || undefined,
      country: parsed.values.country,
      city: parsed.values.city,
      club: club.trim() || undefined,
      birthYear: parsed.values.birthYear,
      gender: gender || undefined,
      dominantHand: dominantHand || undefined,
      notes: notes.trim() || undefined,
    }

    setBusy(true)
    try {
      const saved = editing
        ? await (async () => {
            const merged: Player = { ...player!, ...data }
            await updatePlayer(merged)
            return merged
          })()
        : await addPlayer(data)
      onSaved?.(saved)
      onClose()
    } catch (e) {
      setErr((e as Error).message)
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
            <h2 className="text-xl sm:text-lg font-semibold">
              {editing ? 'Edit player' : 'Add player'}
            </h2>
            {editing && (
              <p className="text-sm text-slate-500 mt-0.5">
                Editing <span className="font-medium">{player?.name}</span>
              </p>
            )}
            {editing && player?.userId && (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                This player has a Boast account — identity-field edits (name, club,
                country, age, etc.) get overwritten the next time they save their
                own profile. Starting-level changes require <strong>Admin →
                Rebuild levels</strong> to take effect on history.
              </p>
            )}
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

        <form onSubmit={onSubmit} className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-3">
            <div>
              <label className="label" htmlFor="pf-name">Name</label>
              <input
                id="pf-name"
                className="input w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="pf-level">Starting level</label>
                <input
                  id="pf-level"
                  className="input w-full"
                  inputMode="numeric"
                  value={startingLevel}
                  onChange={(e) => setStartingLevel(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="pf-email">Email</label>
                <input
                  id="pf-email"
                  type="email"
                  className="input w-full"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="player@example.com"
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="pf-phone">Phone</label>
              <input
                id="pf-phone"
                type="tel"
                className="input w-full"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+65 9123 4567"
              />
            </div>

            <div>
              <label className="label" htmlFor="pf-club">Club</label>
              <input
                id="pf-club"
                list="pf-club-options"
                className="input w-full"
                value={club}
                onChange={(e) => setClub(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="pf-country">Country</label>
                <input
                  id="pf-country"
                  list="pf-country-options"
                  className="input w-full"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  autoComplete="country-name"
                />
              </div>
              <div>
                <label className="label" htmlFor="pf-city">City</label>
                <input
                  id="pf-city"
                  list="pf-city-options"
                  className="input w-full"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  autoComplete="address-level2"
                />
              </div>
            </div>
            <datalist id="pf-country-options">
              {COUNTRIES.map((c) => <option key={c} value={c} />)}
            </datalist>
            <datalist id="pf-city-options">
              {cityOptions.map((c) => <option key={c} value={c} />)}
            </datalist>
            <datalist id="pf-club-options">
              {clubOptions.map((c) => <option key={c} value={c} />)}
            </datalist>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="pf-year">Year of birth</label>
                <input
                  id="pf-year"
                  inputMode="numeric"
                  className="input w-full"
                  value={birthYear}
                  onChange={(e) => setBirthYear(e.target.value)}
                  placeholder="1985"
                />
              </div>
              <div>
                <label className="label" htmlFor="pf-gender">Gender</label>
                <select
                  id="pf-gender"
                  className="input w-full"
                  value={gender}
                  onChange={(e) => setGender(e.target.value as Gender | '')}
                >
                  <option value="">—</option>
                  {(Object.keys(GENDER_LABEL) as Gender[]).map((g) => (
                    <option key={g} value={g}>{GENDER_LABEL[g]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="pf-hand">Dominant hand</label>
              <select
                id="pf-hand"
                className="input w-full"
                value={dominantHand}
                onChange={(e) => setDominantHand(e.target.value as DominantHand | '')}
              >
                <option value="">—</option>
                {(Object.keys(DOMINANT_HAND_LABEL) as DominantHand[]).map((h) => (
                  <option key={h} value={h}>{DOMINANT_HAND_LABEL[h]}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="pf-notes">Notes</label>
              <input
                id="pf-notes"
                className="input w-full"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything you want to remember"
              />
            </div>

            {err && <div className="text-sm text-red-600">{err}</div>}
          </div>

          <div className="px-4 sm:px-6 py-3 border-t border-slate-200 dark:border-slate-800 shrink-0 flex items-center justify-end gap-2 pb-safe">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add player'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
