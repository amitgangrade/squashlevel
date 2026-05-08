import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { suggestUsername } from '../lib/supabase/profile'
import { DOMINANT_HAND_LABEL, GENDER_LABEL, type DominantHand, type Gender } from '../types'

const MAX_AVATAR_BYTES = 5 * 1024 * 1024

export function OnboardingModal() {
  const { session, completeOnboarding } = useStore()
  const initialName =
    (session?.user?.user_metadata as { full_name?: string; name?: string } | null)?.full_name ??
    (session?.user?.user_metadata as { name?: string } | null)?.name ??
    ''
  const initialEmail = session?.user?.email ?? ''
  const initialAvatar =
    (session?.user?.user_metadata as { avatar_url?: string; picture?: string } | null)?.avatar_url ??
    (session?.user?.user_metadata as { picture?: string } | null)?.picture ??
    null

  const [fullName, setFullName] = useState(initialName)
  const [email, setEmail] = useState(initialEmail)
  const [phone, setPhone] = useState('')
  const [country, setCountry] = useState('')
  const [city, setCity] = useState('')
  const [club, setClub] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [gender, setGender] = useState<Gender | ''>('')
  const [dominantHand, setDominantHand] = useState<DominantHand | ''>('')
  const [startingLevel, setStartingLevel] = useState('1000')

  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(initialAvatar)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!avatarFile) return
    const url = URL.createObjectURL(avatarFile)
    setAvatarPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [avatarFile])

  const previewUsername = fullName.trim() ? suggestUsername(fullName) : ''

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErr(null)
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > MAX_AVATAR_BYTES) return setErr('Photo must be 5 MB or smaller')
    if (!f.type.startsWith('image/')) return setErr('Photo must be an image file')
    setAvatarFile(f)
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    const lvl = Number(startingLevel)
    if (!fullName.trim()) return setErr('Full name is required')
    if (!email.trim()) return setErr('Email is required')
    if (!Number.isFinite(lvl) || lvl <= 0) return setErr('Starting rating must be a positive number')
    let parsedYear: number | undefined
    if (birthYear.trim()) {
      const y = Number(birthYear)
      const thisYear = new Date().getFullYear()
      if (!Number.isInteger(y) || y < 1900 || y > thisYear) {
        return setErr(`Year of birth must be between 1900 and ${thisYear}`)
      }
      parsedYear = y
    }
    setBusy(true)
    try {
      await completeOnboarding({
        fullName: fullName.trim(),
        email: email.trim(),
        startingLevel: lvl,
        phone: phone.trim() || undefined,
        country: country.trim() || undefined,
        city: city.trim() || undefined,
        club: club.trim() || undefined,
        birthYear: parsedYear,
        gender: gender || undefined,
        dominantHand: dominantHand || undefined,
        avatarFile,
      })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-slate-950 sm:bg-slate-950/60 sm:dark:bg-slate-950/80 sm:grid sm:place-items-center sm:p-4 overflow-hidden">
      <div className="flex h-full sm:h-auto sm:max-h-[90vh] w-full sm:max-w-md flex-col bg-white dark:bg-slate-950 sm:rounded-lg sm:border sm:border-slate-200 sm:dark:border-slate-800 sm:shadow-2xl">
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pt-safe shrink-0">
          <h2 className="text-xl sm:text-lg font-semibold">Welcome to Boast</h2>
          <p className="text-sm text-slate-500">A few details to set up your profile. Boast is free, forever.</p>
        </div>

        <form onSubmit={onSubmit} className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
            {/* Avatar picker */}
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-dashed border-slate-300 bg-slate-50 grid place-items-center text-xs text-slate-400 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900"
                aria-label="Upload photo"
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span>Add photo</span>
                )}
              </button>
              <div className="text-sm text-slate-500 flex-1">
                <div className="font-medium text-slate-700 dark:text-slate-200">Profile photo</div>
                <div className="text-xs">Optional · max 5 MB.</div>
                {avatarFile && (
                  <button
                    type="button"
                    className="text-red-600 hover:underline text-xs mt-1"
                    onClick={() => {
                      setAvatarFile(null)
                      setAvatarPreview(initialAvatar)
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPickFile}
              />
            </div>

            {/* Required */}
            <div>
              <label className="label" htmlFor="fullName">Full name</label>
              <input id="fullName" className="input w-full" value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
              {previewUsername && (
                <p className="mt-1 text-xs text-slate-500">
                  Username: <span className="font-mono">@{previewUsername}</span>
                </p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input w-full" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="level">Starting rating</label>
              <input id="level" inputMode="numeric" className="input w-full" value={startingLevel} onChange={(e) => setStartingLevel(e.target.value)} />
              <p className="mt-1 text-xs text-slate-500">If you have a SquashLevels.com rating, use it (e.g. 1200). Otherwise leave at 1000 — we'll calibrate as you log matches.</p>
            </div>

            {/* Optional section */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-3">About you (optional)</p>
              <div className="space-y-3">
                <div>
                  <label className="label" htmlFor="phone">Phone</label>
                  <input id="phone" type="tel" className="input w-full" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+65 9123 4567" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="country">Country</label>
                    <input id="country" className="input w-full" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Singapore" />
                  </div>
                  <div>
                    <label className="label" htmlFor="city">City</label>
                    <input id="city" className="input w-full" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Singapore" />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="club">Club</label>
                  <input id="club" className="input w-full" value={club} onChange={(e) => setClub(e.target.value)} placeholder="Your home club" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="birthYear">Year of birth</label>
                    <input id="birthYear" inputMode="numeric" className="input w-full" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} placeholder="1985" />
                  </div>
                  <div>
                    <label className="label" htmlFor="gender">Gender</label>
                    <select id="gender" className="input w-full" value={gender} onChange={(e) => setGender(e.target.value as Gender | '')}>
                      <option value="">Prefer not to say</option>
                      {(Object.keys(GENDER_LABEL) as Gender[]).map((g) => (
                        <option key={g} value={g}>{GENDER_LABEL[g]}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="dominantHand">Dominant hand</label>
                  <select id="dominantHand" className="input w-full" value={dominantHand} onChange={(e) => setDominantHand(e.target.value as DominantHand | '')}>
                    <option value="">—</option>
                    {(Object.keys(DOMINANT_HAND_LABEL) as DominantHand[]).map((h) => (
                      <option key={h} value={h}>{DOMINANT_HAND_LABEL[h]}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {err && <div className="text-sm text-red-600">{err}</div>}
          </div>

          {/* Sticky CTA */}
          <div className="shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 sm:px-6 py-3 pb-safe">
            <button className="btn-primary w-full" type="submit" disabled={busy}>
              {busy ? 'Creating profile…' : 'Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
