import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../state/store'
import { MATCH_TYPE_LABEL, type GameScore, type MatchType, type Player } from '../types'
import { updateLevels } from '../lib/rating/update'
import { fmtDelta, fmtLevel, todayIso } from '../lib/format'
import { PlayerSearch } from '../components/PlayerSearch'
import { TrashIcon } from '../components/Icons'
import { supabaseEnabled } from '../lib/supabase/client'

const MATCH_TYPES: MatchType[] = ['friendly', 'box', 'league', 'tournament']

export function LogMatchPage() {
  const { players, recomputed, settings, isAdmin, session, myPlayer, addMatch } = useStore()
  const navigate = useNavigate()

  const signedIn = !supabaseEnabled || !!session
  const canLog = !supabaseEnabled || isAdmin || !!myPlayer

  const [playerA, setPlayerA] = useState<Player | null>(myPlayer)
  const [playerB, setPlayerB] = useState<Player | null>(null)

  // If we just learned about myPlayer (post-onboarding), default Player A to it.
  useEffect(() => {
    if (!isAdmin && myPlayer && !playerA) setPlayerA(myPlayer)
  }, [myPlayer, isAdmin, playerA])

  const [date, setDate] = useState(todayIso())
  const [type, setType] = useState<MatchType>('friendly')
  const [notes, setNotes] = useState('')
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
  }, [levelA, levelB, scores, type, provisionalA, provisionalB, settings])

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
        notes: notes || undefined,
      })
      // Haptic feedback (Chrome Android etc; iOS Safari ignores it gracefully).
      if ('vibrate' in navigator) navigator.vibrate(40)
      navigate('/history')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!signedIn) {
    return (
      <div className="card text-center text-slate-500 space-y-2">
        <p>Sign in with Google to log a match.</p>
      </div>
    )
  }

  if (supabaseEnabled && !canLog) {
    return (
      <div className="card text-center text-slate-500">
        Finish setting up your profile to log matches.
      </div>
    )
  }

  if (!isAdmin && players.length < 1) {
    return (
      <div className="card text-center text-slate-500">No players available yet.</div>
    )
  }

  return (
    <div className="space-y-6">
      <h1>Log match</h1>
      <form onSubmit={onSubmit} className="card space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">{isAdmin ? 'Player A' : 'You'}</label>
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
            <label className="label">Opponent</label>
            <PlayerSearch
              value={playerB}
              onChange={setPlayerB}
              excludeId={playerA?.id}
              placeholder="Search opponent by name…"
            />
          </div>
          <div>
            <label className="label">Date</label>
            <input type="date" className="input w-full" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Match type</label>
            <select className="input w-full" value={type} onChange={(e) => setType(e.target.value as MatchType)}>
              {MATCH_TYPES.map((t) => (
                <option key={t} value={t}>{MATCH_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Game scores</label>
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
        </div>

        <div>
          <label className="label">Notes (optional)</label>
          <input className="input w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {preview && playerA && playerB && (
          <div className="rounded-md border border-brand-200 bg-brand-50 p-3 text-sm dark:border-brand-900/60 dark:bg-brand-900/20">
            <div className="font-medium mb-1">Preview</div>
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

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="flex gap-2">
          <button type="submit" className="btn-primary">Save match</button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
