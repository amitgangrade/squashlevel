import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { fmtLevel, initialsFor } from '../lib/format'
import { isProvisional } from '../lib/rating/levels'
import { supabaseEnabled } from '../lib/supabase/client'
import { uploadAvatar } from '../lib/supabase/profile'
import { COUNTRIES, distinctValues } from '../lib/places'
import { parseProfileFields } from '../lib/profile-validation'
import { DOMINANT_HAND_LABEL, GENDER_LABEL, type DominantHand, type Gender } from '../types'
import { Alert } from '../components/Alert'
import { AvatarCropper } from '../components/AvatarCropper'

export function ProfilePage() {
  const { profile, myPlayer, recomputed, settings, saveProfile, isAdmin, players } = useStore()
  const cityOptions = useMemo(() => distinctValues(players, 'city'), [players])
  const clubOptions = useMemo(() => distinctValues(players, 'club'), [players])
  const [editing, setEditing] = useState(false)
  const [draftFullName, setDraftFullName] = useState(profile?.fullName ?? '')
  const [draftPhone, setDraftPhone] = useState(profile?.phone ?? '')
  const [draftCountry, setDraftCountry] = useState(profile?.country ?? '')
  const [draftCity, setDraftCity] = useState(profile?.city ?? '')
  const [draftClub, setDraftClub] = useState(profile?.club ?? '')
  const [draftBirthYear, setDraftBirthYear] = useState(profile?.birthYear ? String(profile.birthYear) : '')
  const [draftGender, setDraftGender] = useState<Gender | ''>(profile?.gender ?? '')
  const [draftHand, setDraftHand] = useState<DominantHand | ''>(profile?.dominantHand ?? '')
  const [draftLevel, setDraftLevel] = useState(String(profile?.startingLevel ?? 1000))
  // Admin-only field: lets a global admin toggle their own seeded_rating
  // flag from their own profile (the AdminEditProfileModal on /players/<id>
  // is gated by `!isMe`, so admins can't self-edit through that path). Per
  // openspec/specs/rating/spec.md, seeded_rating is set at onboarding or
  // amended by an admin — never self-set by non-admins.
  const [draftSeededRating, setDraftSeededRating] = useState<boolean>(profile?.seededRating ?? false)
  const [draftAvatarFile, setDraftAvatarFile] = useState<File | null>(null)
  const [draftAvatarPreview, setDraftAvatarPreview] = useState<string | null>(profile?.avatarUrl ?? null)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!editing) {
      setDraftFullName(profile?.fullName ?? '')
      setDraftPhone(profile?.phone ?? '')
      setDraftCountry(profile?.country ?? '')
      setDraftCity(profile?.city ?? '')
      setDraftClub(profile?.club ?? '')
      setDraftBirthYear(profile?.birthYear ? String(profile.birthYear) : '')
      setDraftGender(profile?.gender ?? '')
      setDraftHand(profile?.dominantHand ?? '')
      setDraftLevel(String(profile?.startingLevel ?? 1000))
      setDraftSeededRating(profile?.seededRating ?? false)
      setDraftAvatarPreview(profile?.avatarUrl ?? null)
      setDraftAvatarFile(null)
    }
  }, [editing, profile])

  useEffect(() => {
    if (!draftAvatarFile) return
    const url = URL.createObjectURL(draftAvatarFile)
    setDraftAvatarPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [draftAvatarFile])

  if (!supabaseEnabled) {
    return <div className="card text-slate-500">Profiles require cloud sync.</div>
  }
  if (!profile) {
    return <div className="card text-slate-500">Sign in to view your profile.</div>
  }

  const state = myPlayer ? recomputed.states.get(myPlayer.id) : undefined
  const currentLevel = state?.currentLevel ?? myPlayer?.startingLevel
  const matchesPlayed = state?.matchesPlayed ?? 0
  const provisional = isProvisional(
    { matchesPlayed, seededRating: myPlayer?.seededRating ?? profile.seededRating },
    settings,
  )

  const initials = initialsFor(profile.fullName)

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErr(null)
    const f = e.target.files?.[0]
    // Reset the input so re-picking the same file still triggers onChange.
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) return setErr('Photo must be an image file')
    if (f.size > 10 * 1024 * 1024) return setErr('Photo must be 10 MB or smaller')
    // Open the cropper instead of using the raw file. The user will scale and
    // position the crop window; we receive a 512×512 JPEG blob on confirm.
    setCropSrc(URL.createObjectURL(f))
  }

  const onCropConfirm = (blob: Blob) => {
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc(null)
    const cropped = new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
    setDraftAvatarFile(cropped)
  }

  const onCropCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc(null)
  }

  const onSave = async () => {
    setErr(null)
    const lvl = Number(draftLevel)
    if (!draftFullName.trim()) return setErr('Full name is required')
    if (!Number.isFinite(lvl) || lvl <= 0) return setErr('Rating must be positive')
    const parsed = parseProfileFields({ birthYear: draftBirthYear, country: draftCountry, city: draftCity })
    if (!parsed.ok) return setErr(parsed.error)
    setBusy(true)
    try {
      let avatarUrl = profile.avatarUrl
      if (draftAvatarFile) {
        avatarUrl = await uploadAvatar(profile.id, draftAvatarFile)
      }
      await saveProfile({
        ...profile,
        fullName: draftFullName.trim(),
        phone: draftPhone.trim() || undefined,
        country: parsed.values.country,
        city: parsed.values.city,
        club: draftClub.trim() || undefined,
        birthYear: parsed.values.birthYear,
        gender: draftGender || undefined,
        dominantHand: draftHand || undefined,
        avatarUrl,
        startingLevel: lvl,
        // Non-admin viewers don't see the toggle, so their draftSeededRating
        // is whatever the profile already had — round-trips unchanged. Admins
        // can flip it from this form.
        seededRating: isAdmin ? draftSeededRating : profile.seededRating,
      })
      setEditing(false)
      setMsg('Saved.')
      setTimeout(() => setMsg(''), 2000)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <section>
        <h1 className="mb-3">My profile</h1>
        <div className="card space-y-4">
          <div className="flex items-center gap-4">
            {editing ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-dashed border-slate-300 bg-slate-50 grid place-items-center text-slate-400 hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:hover:text-brand-400"
                aria-label={draftAvatarPreview ? 'Change photo' : 'Upload photo'}
              >
                {draftAvatarPreview ? (
                  <>
                    <img src={draftAvatarPreview} alt="" className="h-full w-full object-cover" />
                    <span className="absolute inset-0 grid place-items-center bg-slate-950/0 group-hover:bg-slate-950/40 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity">Change</span>
                  </>
                ) : (
                  <span className="flex flex-col items-center gap-0.5">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                    <span className="text-[10px]">Add photo</span>
                  </span>
                )}
              </button>
            ) : (
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-100 grid place-items-center text-xl font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800">
                {profile.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials || '👤'
                )}
              </div>
            )}
            <div className="min-w-0">
              <div className="font-semibold text-lg truncate">{profile.fullName}</div>
              <div className="text-sm text-slate-500">@{profile.username}</div>
              {(profile.isAdmin || isAdmin) && (
                <span className="inline-block mt-1 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">admin</span>
              )}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickFile}
          />

          {!editing ? (
            <div className="space-y-1 pt-1">
              <Field label="Email" value={profile.email} />
              <Field label="Phone" value={profile.phone || '—'} />
              <Field label="Country" value={profile.country || '—'} />
              <Field label="City" value={profile.city || '—'} />
              <Field label="Club" value={profile.club || '—'} />
              <Field label="Year of birth" value={profile.birthYear ? String(profile.birthYear) : '—'} />
              <Field label="Gender" value={profile.gender ? GENDER_LABEL[profile.gender] : '—'} />
              <Field label="Dominant hand" value={profile.dominantHand ? DOMINANT_HAND_LABEL[profile.dominantHand] : '—'} />
              <Field label="Starting rating" value={String(profile.startingLevel)} />
              <button className="btn-secondary mt-3" onClick={() => setEditing(true)}>Edit</button>
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              {draftAvatarFile && (
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
                  onClick={() => {
                    setDraftAvatarFile(null)
                    setDraftAvatarPreview(profile.avatarUrl ?? null)
                  }}
                >
                  Discard new photo
                </button>
              )}
              <div>
                <label className="label label-required">Full name</label>
                <input className="input w-full" value={draftFullName} onChange={(e) => setDraftFullName(e.target.value)} required />
              </div>
              <div>
                <label className="label">Phone</label>
                <input type="tel" className="input w-full" value={draftPhone} onChange={(e) => setDraftPhone(e.target.value)} placeholder="+65 9123 4567" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="label">Country</label>
                  <input list="profile-country-options" className="input w-full" value={draftCountry} onChange={(e) => setDraftCountry(e.target.value)} autoComplete="country-name" />
                </div>
                <div>
                  <label className="label">City</label>
                  <input list="profile-city-options" className="input w-full" value={draftCity} onChange={(e) => setDraftCity(e.target.value)} autoComplete="address-level2" />
                </div>
              </div>
              <div>
                <label className="label">Club</label>
                <input list="profile-club-options" className="input w-full" value={draftClub} onChange={(e) => setDraftClub(e.target.value)} />
                {clubOptions.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">Pick from the list if your club is already there.</p>
                )}
              </div>
              <datalist id="profile-country-options">
                {COUNTRIES.map((c) => <option key={c} value={c} />)}
              </datalist>
              <datalist id="profile-city-options">
                {cityOptions.map((c) => <option key={c} value={c} />)}
              </datalist>
              <datalist id="profile-club-options">
                {clubOptions.map((c) => <option key={c} value={c} />)}
              </datalist>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="label">Year of birth</label>
                  <input
                    inputMode="numeric"
                    className="input w-full"
                    value={draftBirthYear}
                    onChange={(e) => setDraftBirthYear(e.target.value)}
                    placeholder="1985"
                  />
                </div>
                <div>
                  <label className="label">Gender</label>
                  <select
                    className="input w-full"
                    value={draftGender}
                    onChange={(e) => setDraftGender(e.target.value as Gender | '')}
                  >
                    <option value="">Prefer not to say</option>
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
                  value={draftHand}
                  onChange={(e) => setDraftHand(e.target.value as DominantHand | '')}
                >
                  <option value="">—</option>
                  {(Object.keys(DOMINANT_HAND_LABEL) as DominantHand[]).map((h) => (
                    <option key={h} value={h}>{DOMINANT_HAND_LABEL[h]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Starting rating</label>
                <input inputMode="numeric" className="input w-full" value={draftLevel} onChange={(e) => setDraftLevel(e.target.value)} />
                <p className="mt-1 text-xs text-slate-500">Note: this is your seed/starting level. Your live level is computed from match history.</p>
              </div>
              {isAdmin && (
                <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50/60 p-3 text-sm dark:border-slate-800 dark:bg-slate-900/40 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draftSeededRating}
                    onChange={(e) => setDraftSeededRating(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">Seeded rating (skip provisional)</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Admin-only — tick when you came in with a real SquashLevels.com /
                      LevelTech rating. Seeded players bypass the "(P)" provisional badge
                      and the first-5-matches asymmetric lock. After flipping on an
                      already-played history, run <strong>Admin → Rebuild levels</strong>
                      so historical match flags re-derive.
                    </span>
                  </span>
                </label>
              )}
              {err && <Alert variant="error">{err}</Alert>}
              <div className="flex gap-2">
                <button className="btn-primary" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
                <button className="btn-secondary" onClick={() => { setEditing(false); setErr(null) }} disabled={busy}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </section>

      {myPlayer && (
        <section>
          <h2 className="mb-2">Stats</h2>
          <div className="card grid grid-cols-3 gap-3 text-center">
            <Stat label="Current level" value={fmtLevel(currentLevel) ?? '—'} sub={provisional ? 'provisional' : undefined} />
            <Stat label="Matches" value={String(matchesPlayed)} />
            <Stat label="Starting level" value={fmtLevel(myPlayer.startingLevel) ?? '—'} />
          </div>
        </section>
      )}

      {msg && <div className="text-sm text-green-600">{msg}</div>}

      {cropSrc && (
        <AvatarCropper src={cropSrc} onConfirm={onCropConfirm} onCancel={onCropCancel} />
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5 last:border-b-0 dark:border-slate-800">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-right truncate max-w-[55%]">{value}</span>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  )
}
