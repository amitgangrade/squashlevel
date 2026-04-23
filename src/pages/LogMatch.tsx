import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../state/store'
import { MATCH_TYPE_LABEL, type GameScore, type MatchType } from '../types'
import { updateLevels } from '../lib/rating/update'
import { fmtDelta, fmtLevel, todayIso } from '../lib/format'

const MATCH_TYPES: MatchType[] = ['friendly', 'box', 'league', 'tournament']

export function LogMatchPage() {
  const { players, recomputed, settings, addMatch } = useStore()
  const navigate = useNavigate()

  const [playerAId, setPlayerAId] = useState('')
  const [playerBId, setPlayerBId] = useState('')
  const [date, setDate] = useState(todayIso())
  const [type, setType] = useState<MatchType>('friendly')
  const [notes, setNotes] = useState('')
  const [scores, setScores] = useState<GameScore[]>([
    { a: 0, b: 0 },
    { a: 0, b: 0 },
    { a: 0, b: 0 },
  ])
  const [error, setError] = useState('')

  const levelA = recomputed.states.get(playerAId)?.currentLevel
  const levelB = recomputed.states.get(playerBId)?.currentLevel
  const provisionalA =
    (recomputed.states.get(playerAId)?.matchesPlayed ?? 0) < settings.provisionalThreshold
  const provisionalB =
    (recomputed.states.get(playerBId)?.matchesPlayed ?? 0) < settings.provisionalThreshold

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
    if (!playerAId || !playerBId) return setError('Select both players')
    if (playerAId === playerBId) return setError('Players must be different')
    const clean = scores.filter((g) => g.a > 0 || g.b > 0)
    if (clean.length === 0) return setError('Enter at least one game score')
    await addMatch({
      date,
      playerAId,
      playerBId,
      games: clean,
      type,
      notes: notes || undefined,
    })
    navigate('/history')
  }

  const aName = players.find((p) => p.id === playerAId)?.name
  const bName = players.find((p) => p.id === playerBId)?.name

  if (players.length < 2) {
    return (
      <div className="card text-center text-slate-500">
        You need at least 2 players to log a match. <a href="#/roster" className="text-brand-600 underline">Add players</a>.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1>Log match</h1>
      <form onSubmit={onSubmit} className="card space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Player A</label>
            <select className="input w-full" value={playerAId} onChange={(e) => setPlayerAId(e.target.value)}>
              <option value="">Select…</option>
              {players.map((p) => (
                <option key={p.id} value={p.id} disabled={p.id === playerBId}>
                  {p.name} ({fmtLevel(recomputed.states.get(p.id)?.currentLevel)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Player B</label>
            <select className="input w-full" value={playerBId} onChange={(e) => setPlayerBId(e.target.value)}>
              <option value="">Select…</option>
              {players.map((p) => (
                <option key={p.id} value={p.id} disabled={p.id === playerAId}>
                  {p.name} ({fmtLevel(recomputed.states.get(p.id)?.currentLevel)})
                </option>
              ))}
            </select>
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
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-slate-500 w-12">Game {i + 1}</span>
                <input
                  className="input w-20 text-center"
                  inputMode="numeric"
                  value={g.a}
                  onChange={(e) => setGame(i, 'a', e.target.value)}
                />
                <span className="text-slate-400">–</span>
                <input
                  className="input w-20 text-center"
                  inputMode="numeric"
                  value={g.b}
                  onChange={(e) => setGame(i, 'b', e.target.value)}
                />
                {scores.length > 1 && (
                  <button type="button" className="text-xs text-red-600 ml-2" onClick={() => removeGame(i)}>
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="btn-secondary" onClick={addGame}>+ Add game</button>
          </div>
        </div>

        <div>
          <label className="label">Notes (optional)</label>
          <input className="input w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {preview && aName && bName && (
          <div className="rounded-md border border-brand-200 bg-brand-50 p-3 text-sm dark:border-brand-900/60 dark:bg-brand-900/20">
            <div className="font-medium mb-1">Preview</div>
            <div className="grid grid-cols-2 gap-2 sm:gap-6">
              <div>
                <div className="text-slate-600 dark:text-slate-300">{aName}</div>
                <div>{fmtLevel(levelA)} → <span className="font-semibold">{fmtLevel(preview.levelAAfter)}</span></div>
                <div className={preview.deltaA >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtDelta(preview.deltaA)}</div>
                {provisionalA && <div className="text-xs text-slate-500">provisional</div>}
              </div>
              <div>
                <div className="text-slate-600 dark:text-slate-300">{bName}</div>
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
