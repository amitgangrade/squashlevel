// Generates a SquashLevel import/export JSON file with fake matches between
// Amit, Bharat, Rochit, Sanchit over the last 12 months, shaped to hit the
// win-rate targets the user specified.
//
// Run: node scripts/generate-fake-data.mjs [output-path]
//   default output: fixtures/squashlevel-fake.json

import { writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

const outPath = resolve(process.argv[2] ?? 'fixtures/squashlevel-fake.json')

// Players (placeholder emails — replace in the app after import).
const players = [
  { name: 'Amit',    startingLevel: 1100, email: 'amit@example.com' },
  { name: 'Bharat',  startingLevel: 1000, email: 'bharat@example.com' },
  { name: 'Rochit',  startingLevel: 1000, email: 'rochit@example.com' },
  { name: 'Sanchit', startingLevel: 900,  email: 'sanchit@example.com' },
].map((p) => ({
  id: randomUUID(),
  name: p.name,
  startingLevel: p.startingLevel,
  email: p.email,
  createdAt: daysAgo(365).toISOString(),
}))

const id = (name) => players.find((p) => p.name === name).id

// Probability that player A beats player B in a match.
const matchups = [
  { a: 'Amit',   b: 'Sanchit', pA: 0.90, count: 10 },
  { a: 'Amit',   b: 'Bharat',  pA: 0.70, count: 12 },
  { a: 'Amit',   b: 'Rochit',  pA: 0.60, count: 10 },
  { a: 'Bharat', b: 'Sanchit', pA: 0.55, count: 8  },
  { a: 'Bharat', b: 'Rochit',  pA: 0.60, count: 10 }, // Rochit wins 40%
  { a: 'Rochit', b: 'Sanchit', pA: 0.70, count: 10 },
]

const TYPES = [
  { t: 'friendly',   w: 0.60 },
  { t: 'box',        w: 0.25 },
  { t: 'league',     w: 0.10 },
  { t: 'tournament', w: 0.05 },
]

const matches = []

for (const mu of matchups) {
  // Spread `count` matches across ~365 days with some jitter so dates aren't uniform.
  const days = evenlySpacedDaysAgo(mu.count, 365)
  for (const d of days) {
    const aWins = Math.random() < mu.pA
    const winnerName = aWins ? mu.a : mu.b
    const loserName  = aWins ? mu.b : mu.a
    // Dominance shapes the 3-X distribution. Closer match rate -> more 3-2.
    const dominance = Math.abs(mu.pA - 0.5) * 2 // 0 = coin flip, 1 = guaranteed
    const loserGames = pickLoserGames(dominance, aWins ? mu.pA : 1 - mu.pA)
    const games = generateGames(loserGames, aWins ? 'A' : 'B')
    matches.push({
      id: randomUUID(),
      date: d.toISOString().slice(0, 10),
      playerAId: id(mu.a),
      playerBId: id(mu.b),
      games,
      type: pickType(),
      notes: undefined,
    })
    void winnerName; void loserName
  }
}

// Sort by date for readability.
matches.sort((x, y) => x.date.localeCompare(y.date))

const settings = {
  dampingK: 0.12,
  pointsWeight: 0.5,
  pointsExponent: 2,
  gamesExponent: 5,
  provisionalThreshold: 5,
  movingAverageWindow: 4,
}

const exportData = {
  version: 1,
  exportedAt: new Date().toISOString(),
  players,
  matches,
  settings,
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(exportData, null, 2))
console.log(`Wrote ${matches.length} matches for ${players.length} players → ${outPath}`)

// ---------- helpers ----------

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(12, 0, 0, 0)
  return d
}

function evenlySpacedDaysAgo(count, totalDays) {
  const out = []
  const step = totalDays / count
  for (let i = 0; i < count; i++) {
    const base = totalDays - step * (i + 0.5)
    const jitter = (Math.random() - 0.5) * step * 0.8
    out.push(daysAgo(Math.max(0, Math.round(base + jitter))))
  }
  return out.sort((a, b) => a - b)
}

function pickLoserGames(dominance, winnerProb) {
  // Dominance 0 (coin flip) → heavy 3-2 / 3-1 mix.
  // Dominance 1 (very one-sided) → mostly 3-0 / 3-1.
  // Map to [P(3-0), P(3-1), P(3-2)].
  const p30 = 0.15 + dominance * 0.55   // 0.15 → 0.70
  const p31 = 0.35 + (1 - dominance) * 0.10
  // remainder goes to 3-2
  const total = p30 + p31
  const p32 = Math.max(0, 1 - total)
  // Underdog wins: reduce 3-0 likelihood (upset wins tend to be closer).
  if (winnerProb < 0.5) {
    const r = Math.random()
    if (r < 0.15) return 0
    if (r < 0.55) return 1
    return 2
  }
  const r = Math.random()
  if (r < p30) return 0
  if (r < p30 + p31) return 1
  void p32
  return 2
}

function generateGames(loserGames, winnerSide /* 'A' | 'B' */) {
  // winner wins 3 games, loser wins `loserGames`.
  const pattern = interleave(3, loserGames)
  return pattern.map((winOfGame) => {
    const [high, low] = validGameScore()
    if (winOfGame === 'W') {
      return winnerSide === 'A' ? { a: high, b: low } : { a: low, b: high }
    } else {
      return winnerSide === 'A' ? { a: low, b: high } : { a: high, b: low }
    }
  })
}

function interleave(winCount, loseCount) {
  // Random valid sequence ending on winner's 3rd win.
  const seq = []
  let w = 0
  let l = 0
  while (w < winCount) {
    if (l >= loseCount) {
      seq.push('W'); w++
      continue
    }
    // Bias slightly toward winner winning each game.
    if (Math.random() < 0.55) {
      seq.push('W'); w++
    } else {
      seq.push('L'); l++
    }
  }
  // Add any remaining loser games if we ended early (shouldn't happen with above).
  while (l < loseCount) { seq.push('L'); l++ }
  // Move a trailing 'L' in front of the final 'W' if needed so the match ends on winner's 3rd W.
  // In squash the match ends when one side reaches 3, so forcibly drop any post-final-W games.
  const trimmed = []
  let wins = 0
  for (const s of seq) {
    trimmed.push(s)
    if (s === 'W') wins++
    if (wins === winCount) break
  }
  return trimmed
}

function validGameScore() {
  // Returns [winnerScore, loserScore] for a standard 11-point, win-by-2 game.
  const r = Math.random()
  if (r < 0.75) {
    // 11-x where x ∈ 0..9
    const s = Math.random()
    if (s < 0.15) return [11, rand(0, 3)]
    if (s < 0.55) return [11, rand(4, 7)]
    return [11, rand(8, 9)]
  }
  if (r < 0.9) return [12, 10]
  if (r < 0.97) return [13, 11]
  return [14, 12]
}

function rand(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

function pickType() {
  const r = Math.random()
  let acc = 0
  for (const { t, w } of TYPES) {
    acc += w
    if (r < acc) return t
  }
  return 'friendly'
}
