import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { updateProfile } from '../lib/supabase/profile'
import { COUNTRIES, distinctValues } from '../lib/places'
import { parseProfileFields } from '../lib/profile-validation'
import {
  DOMINANT_HAND_LABEL,
  GENDER_LABEL,
  type DominantHand,
  type Gender,
  type Profile,
} from '../types'

interface Props {
  /** The target user's profile snapshot. Owner of the modal is responsible
   *  for fetching this (via `fetchProfile(userId)`) before opening. */
  target: Profile
  onClose: () => void
  onSaved?: (updated: Profile) => void
}

/**
 * Admin-only modal for editing another user's profile.
 *
 * Deliberately scoped: full_name, phone, country, city, club, birth_year,
 * gender, dominant_hand, starting_level, and seeded_rating (the
 * skip-provisional flag). Username / email / avatar / is_admin are
 * intentionally NOT exposed here — see
 * openspec/specs/auth-permissions/spec.md §Profile RLS for the rationale.
 *
 * Calls `updateProfile(...)` directly rather than going through
 * `store.saveProfile`, because the latter mutates the signed-in user's own
 * profile/myPlayer state — which would be wrong when the admin is editing
 * someone else. After save we kick `store.refresh()` so cached views
 * (leaderboard, club/group profiles) pick up the new club/country/name; the
 * server-side `profiles_sync_player` trigger has already mirrored the change
 * onto the target's linked player row.
 */
export function AdminEditProfileModal({ target, onClose, onSaved }: Props) {
  const { players, refresh } = useStore()
  const cityOptions = useMemo(() => distinctValues(players, 'city'), [players])
  const clubOptions = useMemo(() => distinctValues(players, 'club'), [players])

  const [fullName, setFullName] = useState(target.fullName)
  const [phone, setPhone] = useState(target.phone ?? '')
  const [country, setCountry] = useState(target.country ?? '')
  const [city, setCity] = useState(target.city ?? '')
  const [club, setClub] = useState(target.club ?? '')
  const [birthYear, setBirthYear] = useState(target.birthYear ? String(target.birthYear) : '')
  const [gender, setGender] = useState<Gender | ''>(target.gender ?? '')
  const [dominantHand, setDominantHand] = useState<DominantHand | ''>(target.dominantHand ?? '')
  const [startingLevel, setStartingLevel] = useState(String(target.startingLevel))
  const [seededRating, setSeededRating] = useState<boolean>(target.seededRating ?? false)
  const [acknowledgedSeededImpact, setAcknowledgedSeededImpact] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // seeded_rating is read as the current flag during rebuild and applied
  // uniformly to every historical match — so toggling it on a player with
  // existing match history rewrites past provisional flags on next rebuild.
  // See openspec/specs/rating §Provisional players.
  const linkedPlayer = useMemo(
    () => players.find((p) => p.userId === target.id) ?? null,
    [players, target.id],
  )
  const matchesPlayed = linkedPlayer?.matchesPlayed ?? 0
  const seededChanged = seededRating !== (target.seededRating ?? false)
  const needsSeededAck = seededChanged && matchesPlayed > 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onSave = async () => {
    setErr(null)
    if (!fullName.trim()) return setErr('Full name is required')
    const lvl = Number(startingLevel)
    if (!Number.isFinite(lvl) || lvl <= 0) return setErr('Starting level must be a positive number')
    if (needsSeededAck && !acknowledgedSeededImpact) {
      return setErr(
        `Toggling Seeded rating on a player with ${matchesPlayed} confirmed match${
          matchesPlayed === 1 ? '' : 'es'
        } will rewrite historical provisional flags on the next rebuild. ` +
          `Tick the acknowledgement box below to proceed.`,
      )
    }
    const parsed = parseProfileFields({ birthYear, country, city })
    if (!parsed.ok) return setErr(parsed.error)
    setBusy(true)
    try {
      const updated = await updateProfile({
        ...target,
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
        country: parsed.values.country,
        city: parsed.values.city,
        club: club.trim() || undefined,
        birthYear: parsed.values.birthYear,
        gender: gender || undefined,
        dominantHand: dominantHand || undefined,
        startingLevel: lvl,
        seededRating,
        // Untouchable fields: keep the originals so the same UPDATE statement
        // doesn't silently zero them out.
        // username, email, avatarUrl, isAdmin are preserved by the spread above.
      })
      onSaved?.(updated)
      // Server already mirrored to players via profiles_sync_player trigger;
      // refresh the store so cached lists (leaderboard etc.) reflect the new
      // identity fields.
      refresh().catch(() => {})
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
            <h2 className="text-xl sm:text-lg font-semibold">Edit profile (admin)</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Editing <span className="font-medium">{target.fullName}</span>
              <span className="text-slate-400"> · @{target.username}</span>
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Username, email, photo, and admin flag aren't editable here — those have
              dedicated paths or are owner-only by design.
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

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-3">
          <div>
            <label className="label">Full name</label>
            <input
              className="input w-full"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label">Phone</label>
            <input
              type="tel"
              className="input w-full"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+65 9123 4567"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Country</label>
              <input
                list="admin-edit-country-options"
                className="input w-full"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                autoComplete="country-name"
              />
            </div>
            <div>
              <label className="label">City</label>
              <input
                list="admin-edit-city-options"
                className="input w-full"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                autoComplete="address-level2"
              />
            </div>
          </div>
          <div>
            <label className="label">Club</label>
            <input
              list="admin-edit-club-options"
              className="input w-full"
              value={club}
              onChange={(e) => setClub(e.target.value)}
            />
          </div>
          <datalist id="admin-edit-country-options">
            {COUNTRIES.map((c) => <option key={c} value={c} />)}
          </datalist>
          <datalist id="admin-edit-city-options">
            {cityOptions.map((c) => <option key={c} value={c} />)}
          </datalist>
          <datalist id="admin-edit-club-options">
            {clubOptions.map((c) => <option key={c} value={c} />)}
          </datalist>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Year of birth</label>
              <input
                inputMode="numeric"
                className="input w-full"
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
                placeholder="1985"
              />
            </div>
            <div>
              <label className="label">Gender</label>
              <select
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
            <label className="label">Dominant hand</label>
            <select
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
            <label className="label">Starting level</label>
            <input
              inputMode="numeric"
              className="input w-full"
              value={startingLevel}
              onChange={(e) => setStartingLevel(e.target.value)}
            />
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              Heads up — changing the starting level after matches have been
              played requires <strong>Admin → Rebuild levels</strong> to keep
              the live level consistent with history.
            </p>
          </div>

          <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50/60 p-3 text-sm dark:border-slate-800 dark:bg-slate-900/40 cursor-pointer">
            <input
              type="checkbox"
              checked={seededRating}
              onChange={(e) => {
                setSeededRating(e.target.checked)
                setAcknowledgedSeededImpact(false)
              }}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Seeded rating (skip provisional)</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Tick when the player came in with a real SquashLevels.com / LevelTech
                rating. Seeded players bypass the "(P)" provisional badge and the
                first-5-matches asymmetric lock. Toggling this on an already-played
                history needs <strong>Admin → Rebuild levels</strong> to re-derive
                historical match flags.
              </span>
            </span>
          </label>

          {needsSeededAck && (
            <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200 cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledgedSeededImpact}
                onChange={(e) => setAcknowledgedSeededImpact(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">I understand this rewrites history.</span>
                <span className="block text-xs mt-0.5">
                  This player has {matchesPlayed} confirmed match{matchesPlayed === 1 ? '' : 'es'}.
                  On the next <strong>Admin → Rebuild levels</strong>, every one of those matches'
                  provisional flags will be re-derived against the new Seeded rating value.
                </span>
              </span>
            </label>
          )}

          {err && <div className="text-sm text-red-600">{err}</div>}
        </div>

        <div className="px-4 sm:px-6 py-3 border-t border-slate-200 dark:border-slate-800 shrink-0 flex items-center justify-end gap-2 pb-safe">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={onSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
