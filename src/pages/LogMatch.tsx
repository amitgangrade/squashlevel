import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../state/store'
import {
  DOMINANT_HAND_LABEL,
  GENDER_LABEL,
  MATCH_TYPE_KEYS,
  MATCH_TYPE_LABEL,
  type DominantHand,
  type GameScore,
  type Gender,
  type MatchType,
  type Player,
} from '../types'
import { gamesWonBy, winnerSide } from '../lib/rating/levels'
import { updateLevels } from '../lib/rating/update'
import { fmtDelta, fmtLevel, todayIso } from '../lib/format'
import { COUNTRIES, distinctValues } from '../lib/places'
import { parseProfileFields } from '../lib/profile-validation'
import { Alert } from '../components/Alert'
import { EmptyState } from '../components/EmptyState'
import { PlayerSearch } from '../components/PlayerSearch'
import { TrashIcon, UserIcon } from '../components/Icons'
import { supabaseEnabled } from '../lib/supabase/client'
import { createUnclaimedPlayer } from '../lib/supabase/profile'

export function LogMatchPage() {
  const { players, recomputed, settings, isAdmin, session, myPlayer, addMatch, refresh } = useStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const signedIn = !supabaseEnabled || !!session
  const canLog = !supabaseEnabled || isAdmin || !!myPlayer

  const [playerA, setPlayerA] = useState<Player | null>(myPlayer)
  const [playerB, setPlayerB] = useState<Player | null>(null)

  // If we just learned about myPlayer (post-onboarding), default Player A to it.
  useEffect(() => {
    if (!isAdmin && myPlayer && !playerA) setPlayerA(myPlayer)
  }, [myPlayer, isAdmin, playerA])

  const [date, setDate] = useState(searchParams.get('date') || todayIso())
  const [type, setType] = useState<MatchType>('friendly')
  const [venue, setVenue] = useState(searchParams.get('venue') || '')
  const [notes, setNotes] = useState('')
  const [unranked, setUnranked] = useState(false)

  // Pre-fill opponent from ?opponent=<id> (e.g. coming from an accepted challenge).
  useEffect(() => {
    const oppId = searchParams.get('opponent')
    if (!oppId || playerB) return
    const found = players.find((p) => p.id === oppId)
    if (found) setPlayerB(found)
  }, [searchParams, players, playerB])

  // Inline "add new player" form, opened from PlayerSearch's "+ Add" CTA.
  // Captures the full identity field set so the future claimer (when this
  // person signs up) sees their data pre-filled in onboarding instead of
  // starting from scratch. Email is REQUIRED at the server — keep that in
  // mind when editing this form.
  interface UnclaimedDraft {
    name: string
    email: string
    phone: string
    club: string
    city: string
    country: string
    birthYear: string
    gender: Gender | ''
    dominantHand: DominantHand | ''
    startingLevel: string
  }
  const [unclaimedDraft, setUnclaimedDraft] = useState<UnclaimedDraft | null>(null)
  const [unclaimedError, setUnclaimedError] = useState<string | null>(null)
  const [savingUnclaimed, setSavingUnclaimed] = useState(false)
  const cityOptions = useMemo(() => distinctValues(players, 'city'), [players])
  const clubOptions = useMemo(() => distinctValues(players, 'club'), [players])

  const onCreateUnclaimed = (name: string) => {
    setUnclaimedDraft({
      name,
      email: '',
      phone: '',
      club: myPlayer?.club ?? '',
      city: myPlayer?.city ?? '',
      country: myPlayer?.country ?? '',
      birthYear: '',
      gender: '',
      dominantHand: '',
      startingLevel: '1000',
    })
    setUnclaimedError(null)
  }
  const updateDraft = <K extends keyof UnclaimedDraft>(k: K, v: UnclaimedDraft[K]) =>
    setUnclaimedDraft((d) => (d ? { ...d, [k]: v } : d))

  const submitUnclaimed = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!unclaimedDraft) return
    setUnclaimedError(null)
    if (!unclaimedDraft.name.trim()) return setUnclaimedError('Name is required')
    if (!unclaimedDraft.email.trim()) return setUnclaimedError('Email is required (used to link the account when they sign up)')
    const lvl = Number(unclaimedDraft.startingLevel)
    if (!Number.isFinite(lvl) || lvl <= 0) return setUnclaimedError('Starting level must be a positive number')
    const parsed = parseProfileFields({
      birthYear: unclaimedDraft.birthYear,
      country: unclaimedDraft.country,
      city: unclaimedDraft.city,
    })
    if (!parsed.ok) return setUnclaimedError(parsed.error)
    setSavingUnclaimed(true)
    try {
      const created = await createUnclaimedPlayer({
        name: unclaimedDraft.name.trim(),
        email: unclaimedDraft.email.trim(),
        startingLevel: lvl,
        club: unclaimedDraft.club.trim() || undefined,
        city: parsed.values.city,
        country: parsed.values.country,
        phone: unclaimedDraft.phone.trim() || undefined,
        birthYear: parsed.values.birthYear,
        gender: unclaimedDraft.gender || undefined,
        dominantHand: unclaimedDraft.dominantHand || undefined,
      })
      setPlayerB(created)
      setUnclaimedDraft(null)
      refresh().catch(() => {})
    } catch (ex) {
      setUnclaimedError((ex as Error).message)
    } finally {
      setSavingUnclaimed(false)
    }
  }

  const [scores, setScores] = useState<GameScore[]>([
    { a: 0, b: 0 },
    { a: 0, b: 0 },
    { a: 0, b: 0 },
  ])
  const [error, setError] = useState('')

  const levelA = playerA ? recomputed.states.get(playerA.id)?.currentLevel : undefined
  const levelB = playerB ? recomputed.states.get(playerB.id)?.currentLevel : undefined
  const provisionalA = playerA
    ? (recomputed.states.get(playerA.id)?.matchesPlayed ?? 0) < settings.provisionalThreshold
    : false
  const provisionalB = playerB
    ? (recomputed.states.get(playerB.id)?.matchesPlayed ?? 0) < settings.provisionalThreshold
    : false

  const preview = useMemo(() => {
    if (unranked) return null
    if (!levelA || !levelB) return null
    const clean = scores.filter((g) => g.a > 0 || g.b > 0)
    if (clean.length === 0) return null
    try {
      return updateLevels({
        levelA,
        levelB,
        games: clean,
        matchType: type,
        provisionalA,
        provisionalB,
        settings,
      })
    } catch {
      return null
    }
  }, [levelA, levelB, scores, type, provisionalA, provisionalB, settings, unranked])

  // Game-tally summary, computed off the same "non-zero" filter the preview
  // uses so the displayed count matches what gets saved. Surfaces who's
  // winning so the user can sanity-check before saving (independent of
  // whether level data is loaded).
  const cleanGames = scores.filter((g) => g.a > 0 || g.b > 0)
  const gamesA = gamesWonBy(cleanGames, 'a')
  const gamesB = gamesWonBy(cleanGames, 'b')
  const winner = cleanGames.length > 0 ? winnerSide(cleanGames) : null

  const setGame = (i: number, side: 'a' | 'b', val: string) => {
    const n = Math.max(0, Math.floor(Number(val) || 0))
    setScores((prev) => prev.map((g, idx) => (idx === i ? { ...g, [side]: n } : g)))
  }
  const addGame = () => setScores((prev) => [...prev, { a: 0, b: 0 }])
  const removeGame = (i: number) => setScores((prev) => prev.filter((_, idx) => idx !== i))

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!playerA || !playerB) return setError('Select both players')
    if (playerA.id === playerB.id) return setError('Players must be different')
    const clean = scores.filter((g) => g.a > 0 || g.b > 0)
    if (clean.length === 0) return setError('Enter at least one game score')
    try {
      await addMatch({
        date,
        playerAId: playerA.id,
        playerBId: playerB.id,
        games: clean,
        type,
        venue: venue.trim() || undefined,
        notes: notes || undefined,
        unranked: unranked || undefined,
      })
      // Haptic feedback (Chrome Android etc; iOS Safari ignores it gracefully).
      if ('vibrate' in navigator) navigator.vibrate(40)
      navigate('/')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!signedIn) {
    return (
      <EmptyState
        icon={<UserIcon className="h-6 w-6" />}
        title="Sign in to log a match"
        description="Use the sign-in button at the top right (Google account)."
      />
    )
  }

  if (supabaseEnabled && !canLog) {
    return (
      <EmptyState
        icon={<UserIcon className="h-6 w-6" />}
        title="Finish setting up your profile"
        description="You need a player profile before you can log matches."
        ctaLabel="Open my profile"
        ctaTo="/profile"
      />
    )
  }

  if (!isAdmin && players.length < 1) {
    return (
      <EmptyState
        title="No players available yet"
        description="Once an admin adds players you'll be able to log matches against them."
      />
    )
  }

  return (
    <div className="space-y-6">
      <h1>Log match</h1>
      {unclaimedDraft && (
        <form onSubmit={submitUnclaimed} className="card space-y-3">
          <div>
            <div className="font-semibold">Add a new player</div>
            <p className="text-xs text-slate-500">
              We'll create a placeholder for <span className="font-medium">{unclaimedDraft.name}</span>.
              When they sign up to Boast with the same <strong>email</strong>, this record is
              auto-claimed — they keep this match and their info, no re-entry needed.
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              Heads up — the match you log against this player goes to a global admin for
              confirmation before it counts toward levels (since the new player can't confirm it
              themselves yet).
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="label label-required">Name</label>
              <input
                className="input w-full"
                value={unclaimedDraft.name}
                onChange={(e) => updateDraft('name', e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label label-required">Email</label>
              <input
                type="email"
                className="input w-full"
                value={unclaimedDraft.email}
                onChange={(e) => updateDraft('email', e.target.value)}
                placeholder="opponent@email.com"
                required
              />
            </div>
            <div>
              <label className="label">Starting level</label>
              <input
                className="input w-full"
                inputMode="numeric"
                value={unclaimedDraft.startingLevel}
                onChange={(e) => updateDraft('startingLevel', e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">
                Their SquashLevels.com rating if you know it (e.g. 1200). Otherwise leave at 1000 — they
                can fix it when they sign up.
              </p>
            </div>
            <div>
              <label className="label">Phone <span className="text-slate-400">(optional)</span></label>
              <input
                type="tel"
                className="input w-full"
                value={unclaimedDraft.phone}
                onChange={(e) => updateDraft('phone', e.target.value)}
                placeholder="+65 9123 4567"
              />
            </div>
            <div>
              <label className="label">Club <span className="text-slate-400">(optional)</span></label>
              <input
                list="newplayer-club-options"
                className="input w-full"
                value={unclaimedDraft.club}
                onChange={(e) => updateDraft('club', e.target.value)}
                placeholder="Their home club"
              />
            </div>
            <div>
              <label className="label">Country <span className="text-slate-400">(optional)</span></label>
              <input
                list="newplayer-country-options"
                className="input w-full"
                value={unclaimedDraft.country}
                onChange={(e) => updateDraft('country', e.target.value)}
                autoComplete="country-name"
              />
            </div>
            <div>
              <label className="label">City <span className="text-slate-400">(optional)</span></label>
              <input
                list="newplayer-city-options"
                className="input w-full"
                value={unclaimedDraft.city}
                onChange={(e) => updateDraft('city', e.target.value)}
                autoComplete="address-level2"
              />
            </div>
            <div>
              <label className="label">Year of birth <span className="text-slate-400">(optional)</span></label>
              <input
                inputMode="numeric"
                className="input w-full"
                value={unclaimedDraft.birthYear}
                onChange={(e) => updateDraft('birthYear', e.target.value)}
                placeholder="1985"
              />
            </div>
            <div>
              <label className="label">Gender <span className="text-slate-400">(optional)</span></label>
              <select
                className="input w-full"
                value={unclaimedDraft.gender}
                onChange={(e) => updateDraft('gender', e.target.value as Gender | '')}
              >
                <option value="">—</option>
                {(Object.keys(GENDER_LABEL) as Gender[]).map((g) => (
                  <option key={g} value={g}>{GENDER_LABEL[g]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Dominant hand <span className="text-slate-400">(optional)</span></label>
              <select
                className="input w-full"
                value={unclaimedDraft.dominantHand}
                onChange={(e) => updateDraft('dominantHand', e.target.value as DominantHand | '')}
              >
                <option value="">—</option>
                {(Object.keys(DOMINANT_HAND_LABEL) as DominantHand[]).map((h) => (
                  <option key={h} value={h}>{DOMINANT_HAND_LABEL[h]}</option>
                ))}
              </select>
            </div>
          </div>
          <datalist id="newplayer-country-options">
            {COUNTRIES.map((c) => <option key={c} value={c} />)}
          </datalist>
          <datalist id="newplayer-city-options">
            {cityOptions.map((c) => <option key={c} value={c} />)}
          </datalist>
          <datalist id="newplayer-club-options">
            {clubOptions.map((c) => <option key={c} value={c} />)}
          </datalist>
          {unclaimedError && <Alert variant="error">{unclaimedError}</Alert>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setUnclaimedDraft(null)}>Cancel</button>
            <button
              type="submit"
              className="btn-primary"
              disabled={savingUnclaimed || !unclaimedDraft.name.trim() || !unclaimedDraft.email.trim()}
            >
              {savingUnclaimed ? 'Adding…' : 'Add player'}
            </button>
          </div>
        </form>
      )}
      <form onSubmit={onSubmit} className="card space-y-4">
        <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
          <div>
            <label className="label label-required">{isAdmin ? 'Player A' : 'You'}</label>
            {isAdmin ? (
              <PlayerSearch
                value={playerA}
                onChange={setPlayerA}
                excludeId={playerB?.id}
                placeholder="Search Player A…"
              />
            ) : (
              <div className="rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                {playerA?.name ?? '—'}
                {playerA && (
                  <span className="ml-2 text-xs text-slate-500">
                    Lvl {fmtLevel(levelA ?? playerA.startingLevel)}
                  </span>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="label label-required">Opponent</label>
            <PlayerSearch
              value={playerB}
              onChange={setPlayerB}
              excludeId={playerA?.id}
              placeholder="Search opponent by name…"
              onCreateUnclaimed={supabaseEnabled ? onCreateUnclaimed : undefined}
            />
            <p className="mt-1 text-xs text-slate-500">
              Opponent not on Boast yet? Type their name and pick "Add new player" — they can claim the row when they sign up.
            </p>
          </div>
          <div>
            <label className="label label-required">Date</label>
            <input type="date" className="input w-full" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <label className="label">Match type</label>
            <select className="input w-full" value={type} onChange={(e) => setType(e.target.value as MatchType)}>
              {MATCH_TYPE_KEYS.map((t) => (
                <option key={t} value={t}>{MATCH_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="venue">Venue</label>
            <input
              id="venue"
              className="input w-full"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="e.g. Singapore Cricket Club, Court 2"
            />
          </div>
        </div>

        <div>
          <label className="label label-required">Game scores</label>
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
            <button type="button" className="btn-secondary w-full sm:w-auto" onClick={addGame}>+ Add game</button>
          </div>
          {playerA && playerB && cleanGames.length > 0 && (
            <div className="mt-2 text-sm">
              {winner === null ? (
                <span className="text-slate-500">Tied {gamesA}–{gamesB}</span>
              ) : winner === 'a' ? (
                <span className="text-green-700 dark:text-green-400 font-medium">
                  {playerA.name} wins {gamesA}–{gamesB}
                </span>
              ) : (
                <span className="text-green-700 dark:text-green-400 font-medium">
                  {playerB.name} wins {gamesB}–{gamesA}
                </span>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="label">Notes (optional)</label>
          <input className="input w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50/60 p-3 text-sm dark:border-slate-800 dark:bg-slate-900/40 cursor-pointer">
          <input
            type="checkbox"
            checked={unranked}
            onChange={(e) => setUnranked(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Don't count toward Level</span>
            <span className="block text-xs text-slate-500 mt-0.5">
              Both players agreed this match is just for fun. The score is recorded and visible
              everywhere, but levels won't change.
            </span>
          </span>
        </label>

        {unranked && playerA && playerB && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-900/40">
            <div className="font-medium">Won't change levels</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {playerA.name} stays at {fmtLevel(levelA)} · {playerB.name} stays at {fmtLevel(levelB)}.
            </div>
          </div>
        )}

        {preview && playerA && playerB && (
          <div className="rounded-md border border-brand-200 bg-brand-50 p-3 text-sm dark:border-brand-900/60 dark:bg-brand-900/20">
            <div className="flex items-baseline justify-between mb-1 gap-2">
              <div className="font-medium">Preview</div>
              <div className="text-sm">
                {winner === null ? (
                  <span className="text-slate-600 dark:text-slate-300">Tied {gamesA}–{gamesB}</span>
                ) : (
                  <span className="font-semibold text-green-700 dark:text-green-400">
                    {(winner === 'a' ? playerA.name : playerB.name)} wins{' '}
                    {winner === 'a' ? `${gamesA}–${gamesB}` : `${gamesB}–${gamesA}`}
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:gap-6">
              <div>
                <div className="text-slate-600 dark:text-slate-300">{playerA.name}</div>
                <div>{fmtLevel(levelA)} → <span className="font-semibold">{fmtLevel(preview.levelAAfter)}</span></div>
                <div className={preview.deltaA >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtDelta(preview.deltaA)}</div>
                {provisionalA && <div className="text-xs text-slate-500">provisional</div>}
              </div>
              <div>
                <div className="text-slate-600 dark:text-slate-300">{playerB.name}</div>
                <div>{fmtLevel(levelB)} → <span className="font-semibold">{fmtLevel(preview.levelBAfter)}</span></div>
                <div className={preview.deltaB >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtDelta(preview.deltaB)}</div>
                {provisionalB && <div className="text-xs text-slate-500">provisional</div>}
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Expected perf: {(preview.expected * 100).toFixed(0)}% · Actual: {(preview.actual * 100).toFixed(0)}%
            </div>
          </div>
        )}

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex gap-2">
          <button type="submit" className="btn-primary">Save match</button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
