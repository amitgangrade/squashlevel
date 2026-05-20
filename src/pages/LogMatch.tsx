import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
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
import { gamesWonBy, isProvisional, winnerSide } from '../lib/rating/levels'
import { updateLevels } from '../lib/rating/update'
import { explainPreview } from '../lib/rating/explain'
import { fmtDate, fmtDelta, fmtLevel, todayIso } from '../lib/format'
import { COUNTRIES, distinctValues } from '../lib/places'
import { SIGNIN_EMAIL_ERROR, SIGNIN_EMAIL_HINT, isSupportedSigninEmail, parseProfileFields } from '../lib/profile-validation'
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
    // 'known' = recorder has a SquashLevels.com/LevelTech/coach number for
    // this player → seeded, no provisional. 'unknown' = default 1000 and
    // the player is provisional for their first N matches. Starts null so
    // the recorder must explicitly choose (provisional has real
    // consequences for the recorder's own rating swings — see the
    // settings.provisionalThreshold rules).
    ratingSource: 'known' | 'unknown' | null
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
      ratingSource: null,
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
    if (!isSupportedSigninEmail(unclaimedDraft.email)) {
      return setUnclaimedError(SIGNIN_EMAIL_ERROR)
    }
    if (!unclaimedDraft.ratingSource) {
      return setUnclaimedError('Pick whether you have a known rating for this player')
    }
    const seeded = unclaimedDraft.ratingSource === 'known'
    const lvl = seeded ? Number(unclaimedDraft.startingLevel) : 1000
    if (seeded && (!Number.isFinite(lvl) || lvl <= 0)) {
      return setUnclaimedError('Enter the player\'s known rating (a positive number)')
    }
    if (!unclaimedDraft.country.trim()) return setUnclaimedError('Country is required')
    if (!unclaimedDraft.city.trim()) return setUnclaimedError('City is required')
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
        seededRating: seeded,
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

  // String-valued so the input can be empty (placeholder shows "0")
  // instead of pre-filled with "0" the user has to delete first. Parsed
  // to numbers at the edges (preview, submit) via `parsedScores`.
  const [scores, setScores] = useState<Array<{ a: string; b: string }>>([
    { a: '', b: '' },
    { a: '', b: '' },
    { a: '', b: '' },
  ])
  const parsedScores: GameScore[] = useMemo(
    () => scores.map((g) => ({ a: Number(g.a) || 0, b: Number(g.b) || 0 })),
    [scores],
  )
  const [error, setError] = useState('')

  const levelA = playerA ? recomputed.states.get(playerA.id)?.currentLevel : undefined
  const levelB = playerB ? recomputed.states.get(playerB.id)?.currentLevel : undefined

  // Backdated-match guard rails (see openspec/specs/match-recording §Match
  // date validation). The server trigger is the authority; this is UX
  // courtesy so users see the constraint before submitting.
  const today = todayIso()
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
      if (entry.matchId === 'start') continue
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
  const provisionalA = playerA
    ? isProvisional(
        {
          matchesPlayed: recomputed.states.get(playerA.id)?.matchesPlayed ?? playerA.matchesPlayed,
          seededRating: playerA.seededRating,
        },
        settings,
      )
    : false
  const provisionalB = playerB
    ? isProvisional(
        {
          matchesPlayed: recomputed.states.get(playerB.id)?.matchesPlayed ?? playerB.matchesPlayed,
          seededRating: playerB.seededRating,
        },
        settings,
      )
    : false

  const preview = useMemo(() => {
    if (unranked) return null
    if (!levelA || !levelB) return null
    const clean = parsedScores.filter((g) => g.a > 0 || g.b > 0)
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
  }, [levelA, levelB, parsedScores, type, provisionalA, provisionalB, settings, unranked])

  // Game-tally summary, computed off the same "non-zero" filter the preview
  // uses so the displayed count matches what gets saved. Surfaces who's
  // winning so the user can sanity-check before saving (independent of
  // whether level data is loaded).
  const cleanGames = parsedScores.filter((g) => g.a > 0 || g.b > 0)
  const gamesA = gamesWonBy(cleanGames, 'a')
  const gamesB = gamesWonBy(cleanGames, 'b')
  const winner = cleanGames.length > 0 ? winnerSide(cleanGames) : null

  const setGame = (i: number, side: 'a' | 'b', val: string) => {
    // Strip non-digits, cap at 2 chars (squash scores never exceed 2 digits).
    // Keep the value as a string so an empty input stays empty (placeholder
    // "0" shows) instead of snapping back to the numeric 0.
    const cleaned = val.replace(/[^0-9]/g, '').slice(0, 2)
    setScores((prev) => prev.map((g, idx) => (idx === i ? { ...g, [side]: cleaned } : g)))
  }
  const addGame = () => setScores((prev) => [...prev, { a: '', b: '' }])
  const removeGame = (i: number) => setScores((prev) => prev.filter((_, idx) => idx !== i))

  // First name (or single word) for the score-column header. Truncated
  // with CSS truncate when longer than the cell, but most names fit.
  const shortName = (n?: string) => (n?.trim().split(/\s+/)[0] || '')

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!playerA || !playerB) return setError('Select both players')
    if (playerA.id === playerB.id) return setError('Players must be different')
    if (date > today) return setError('Match date is in the future')
    if (dateFloor && date < dateFloor) {
      return setError(
        `Match date precedes when one of the players joined Boast (${dateFloor}). ` +
          `Pick a date on or after ${dateFloor}.`,
      )
    }
    const clean = parsedScores.filter((g) => g.a > 0 || g.b > 0)
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
                placeholder="opponent@gmail.com"
                required
              />
              <p className="mt-1 text-xs text-slate-500">{SIGNIN_EMAIL_HINT}</p>
            </div>
            <div className="sm:col-span-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-900/20 space-y-2">
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                Starting rating
              </div>
              <p className="text-xs text-amber-800 dark:text-amber-200">
                If you DON'T know their rating, they'll be marked <em>provisional</em> for their
                first {settings.provisionalThreshold} matches — meaning their level moves but your
                level (and any other established player's level) is locked when playing them. If
                you DO know their SquashLevels.com / LevelTech number or have a confident
                coach-estimate, enter it now and they skip provisional from match 1.
              </p>
              <fieldset className="space-y-1.5">
                <legend className="sr-only">Does this player have a known rating?</legend>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="unclaimedRatingSource"
                    checked={unclaimedDraft.ratingSource === 'known'}
                    onChange={() => {
                      updateDraft('ratingSource', 'known')
                      if (unclaimedDraft.startingLevel === '1000') updateDraft('startingLevel', '')
                    }}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">I know their rating</span>
                    <span className="block text-xs text-slate-600 dark:text-slate-300">
                      SquashLevels.com / LevelTech / confident coach estimate. They skip provisional.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="unclaimedRatingSource"
                    checked={unclaimedDraft.ratingSource === 'unknown'}
                    onChange={() => {
                      updateDraft('ratingSource', 'unknown')
                      updateDraft('startingLevel', '1000')
                    }}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">I don't know their rating</span>
                    <span className="block text-xs text-slate-600 dark:text-slate-300">
                      Start them at 1000 and mark provisional for their first {settings.provisionalThreshold} matches.
                    </span>
                  </span>
                </label>
              </fieldset>
              {unclaimedDraft.ratingSource === 'known' && (
                <div>
                  <label className="label text-amber-900 dark:text-amber-100" htmlFor="unclaimed-level">
                    Their rating
                  </label>
                  <input
                    id="unclaimed-level"
                    className="input w-full"
                    inputMode="numeric"
                    value={unclaimedDraft.startingLevel}
                    onChange={(e) => updateDraft('startingLevel', e.target.value)}
                    placeholder="e.g. 1200"
                  />
                </div>
              )}
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
              <label className="label label-required">Country</label>
              <input
                list="newplayer-country-options"
                className="input w-full"
                value={unclaimedDraft.country}
                onChange={(e) => updateDraft('country', e.target.value)}
                autoComplete="country-name"
                required
              />
            </div>
            <div>
              <label className="label label-required">City</label>
              <input
                list="newplayer-city-options"
                className="input w-full"
                value={unclaimedDraft.city}
                onChange={(e) => updateDraft('city', e.target.value)}
                autoComplete="address-level2"
                required
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
                This is older than a more recent match — saving will reorder match history and levels
                will need rebuilding (admins see a banner).
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
            <label className="label">Match type</label>
            <div
              role="radiogroup"
              aria-label="Match type"
              className="grid grid-cols-4 gap-1 rounded-md border border-slate-200 bg-slate-50/60 p-1 dark:border-slate-800 dark:bg-slate-900/40"
            >
              {MATCH_TYPE_KEYS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={type === t}
                  onClick={() => setType(t)}
                  className={clsx(
                    'rounded px-1.5 py-2 text-xs font-medium transition-colors',
                    type === t
                      ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-800 dark:text-accent-300'
                      : 'text-slate-600 hover:bg-white/60 dark:text-slate-400 dark:hover:bg-slate-800/40',
                  )}
                >
                  {MATCH_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
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
          <div className="flex items-baseline justify-between mb-2 gap-2">
            <label className="label label-required mb-0">Game scores</label>
            {cleanGames.length > 0 && (
              <span
                className={clsx(
                  'font-mono text-sm tabular-nums truncate',
                  winner === null
                    ? 'text-slate-500'
                    : 'font-semibold text-green-700 dark:text-green-400',
                )}
              >
                {winner === null
                  ? `Tied ${gamesA}–${gamesB}`
                  : winner === 'a'
                    ? `${shortName(playerA?.name) || 'Player A'} ${gamesA}–${gamesB}`
                    : `${shortName(playerB?.name) || 'Player B'} ${gamesB}–${gamesA}`}
              </span>
            )}
          </div>

          {/* Column headers so the eye associates each input column with a
              player. On mobile the player cards are scrolled off-screen by
              the time the user reaches the score section, so this is the
              load-bearing label.

              Grid template uses minmax(0, 1fr) so the input columns can
              shrink below their content's intrinsic min-width. Without
              this, the <input>'s default (~150-200px from the size
              attribute) prevents shrinkage and the row overflows the
              card on narrow viewports. Pair with `w-full min-w-0` on
              the inputs so they actually fill the (smaller) cell. */}
          <div className="grid grid-cols-[20px_minmax(0,1fr)_auto_minmax(0,1fr)_32px] items-center gap-1.5 mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">
            <span />
            <span className="text-center truncate">{shortName(playerA?.name) || 'You'}</span>
            <span />
            <span className="text-center truncate">{shortName(playerB?.name) || 'Opp'}</span>
            <span />
          </div>

          <div className="space-y-2">
            {scores.map((g, i) => (
              <div
                key={i}
                className="grid grid-cols-[20px_minmax(0,1fr)_auto_minmax(0,1fr)_32px] items-center gap-1.5"
              >
                <span className="text-xs font-medium text-slate-400 text-center select-none tabular-nums">
                  {i + 1}
                </span>
                <input
                  className="input w-full min-w-0 h-14 px-1 text-center text-2xl font-bold tabular-nums"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={2}
                  value={g.a}
                  onChange={(e) => setGame(i, 'a', e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="0"
                  aria-label={`Game ${i + 1} ${playerA?.name || 'player A'} score`}
                />
                <span className="text-slate-300 text-xl select-none px-0.5">–</span>
                <input
                  className="input w-full min-w-0 h-14 px-1 text-center text-2xl font-bold tabular-nums"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={2}
                  value={g.b}
                  onChange={(e) => setGame(i, 'b', e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="0"
                  aria-label={`Game ${i + 1} ${playerB?.name || 'player B'} score`}
                />
                {scores.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Remove game ${i + 1}`}
                    className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:text-tin-600 hover:bg-tin-50 dark:hover:bg-tin-900/30"
                    onClick={() => removeGame(i)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
            <button type="button" className="btn-secondary w-full" onClick={addGame}>
              + Add game {scores.length + 1}
            </button>
          </div>
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
            {levelA != null && levelB != null && (
              <div className="mt-2 border-t border-brand-200/60 dark:border-brand-900/40 pt-2">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 mb-1">
                  Why these numbers?
                </div>
                <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1 list-disc pl-5">
                  {explainPreview({
                    levelA, levelB,
                    preview: {
                      deltaA: preview.deltaA,
                      deltaB: preview.deltaB,
                      expected: preview.expected,
                      actual: preview.actual,
                    },
                    matchType: type,
                    provisionalA, provisionalB,
                    playerAName: playerA.name,
                    playerBName: playerB.name,
                  }).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary px-4"
            onClick={() => navigate(-1)}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary flex-1 h-12 text-base sm:h-auto sm:flex-initial sm:text-sm"
          >
            Save match
          </button>
        </div>
      </form>
    </div>
  )
}
