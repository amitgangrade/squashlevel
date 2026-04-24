// Generates a SquashLevel import/export JSON file with fake matches between
// seven players (Amit, Bharat, Rochit, Sanchit, Veybhav, Satch, Puneet) from
// 2021-01-01 through today, at roughly 50 matches per player per year.
//
// Run: node scripts/generate-fake-data.mjs [output-path]
//   default output: fixtures/squashlevel-fake.json

import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'

const outPath = resolve(process.argv[2] ?? 'fixtures/squashlevel-fake.json')

const START = new Date('2021-01-01T12:00:00Z')
const END = new Date()
const DAYS_SPAN = Math.floor((END - START) / (1000 * 60 * 60 * 24))
const YEARS = DAYS_SPAN / 365.25

// Players (placeholder @example.com emails — swap in real emails in the app).
const players = [
  { name: 'Amit',    startingLevel: 1100, email: 'amit@example.com' },
  { name: 'Bharat',  startingLevel: 1000, email: 'bharat@example.com' },
  { name: 'Rochit',  startingLevel: 1000, email: 'rochit@example.com' },
  { name: 'Sanchit', startingLevel: 900,  email: 'sanchit@example.com' },
  { name: 'Veybhav', startingLevel: 700,  email: 'veybhav@example.com' },
  { name: 'Satch',   startingLevel: 900,  email: 'satch@example.com' },
  { name: 'Puneet',  startingLevel: 850,  email: 'puneet@example.com' },
].map((p) => ({
  id: randomUUID(),
  name: p.name,
  startingLevel: p.startingLevel,
  email: p.email,
  createdAt: START.toISOString(),
}))

const id = (name) => players.find((p) => p.name === name).id

// Each matchup has `a`, `b`, pA (probability a beats b), and `perYear` match count.
// Targeting ≈50 matches per player per year across their total pairings.
const matchups = [
  // Core four — roughly 6 per pair per year (→ 44-59 per player from this group).
  { a: 'Amit',   b: 'Bharat',  pA: 0.70, perYear: 6 },
  { a: 'Amit',   b: 'Rochit',  pA: 0.60, perYear: 6 },
  { a: 'Amit',   b: 'Sanchit', pA: 0.90, perYear: 6 },
  { a: 'Bharat', b: 'Rochit',  pA: 0.60, perYear: 6 }, // Rochit wins 40%
  { a: 'Bharat', b: 'Sanchit', pA: 0.55, perYear: 6 },
  { a: 'Rochit', b: 'Sanchit', pA: 0.70, perYear: 6 },

  // Veybhav — only plays Amit/Rochit/Sanchit, wins 10%.
  { a: 'Amit',    b: 'Veybhav', pA: 0.90, perYear: 15 },
  { a: 'Rochit',  b: 'Veybhav', pA: 0.90, perYear: 15 },
  { a: 'Sanchit', b: 'Veybhav', pA: 0.90, perYear: 15 },

  // Satch — 30% vs Amit/Rochit/Bharat, 50% vs Sanchit.
  { a: 'Amit',    b: 'Satch',   pA: 0.70, perYear: 13 },
  { a: 'Rochit',  b: 'Satch',   pA: 0.70, perYear: 13 },
  { a: 'Bharat',  b: 'Satch',   pA: 0.70, perYear: 13 },
  { a: 'Sanchit', b: 'Satch',   pA: 0.50, perYear: 13 },

  // Puneet — 30% vs Amit/Rochit, 50% vs Sanchit, 40% vs Bharat.
  { a: 'Amit',    b: 'Puneet',  pA: 0.70, perYear: 13 },
  { a: 'Rochit',  b: 'Puneet',  pA: 0.70, perYear: 13 },
  { a: 'Sanchit', b: 'Puneet',  pA: 0.50, perYear: 13 },
  { a: 'Bharat',  b: 'Puneet',  pA: 0.60, perYear: 13 },
]

const TYPES = [
  { t: 'friendly',   w: 0.60 },
  { t: 'box',        w: 0.25 },
  { t: 'league',     w: 0.10 },
  { t: 'tournament', w: 0.05 },
]

const matches = []

for (const mu of matchups) {
  const count = Math.max(1, Math.round(mu.perYear * YEARS))
  const dates = evenlySpacedDates(count, START, END)
  for (const d of dates) {
    const aWins = Math.random() < mu.pA
    const dominance = Math.abs(mu.pA - 0.5) * 2 // 0 = coin flip, 1 = guaranteed
    const winnerProb = aWins ? mu.pA : 1 - mu.pA
    const loserGames = pickLoserGames(dominance, winnerProb)
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
  }
}

// Sort chronologically.
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

// Print summary.
const perPlayer = Object.fromEntries(players.map((p) => [p.name, 0]))
for (const m of matches) {
  perPlayer[nameFor(m.playerAId)]++
  perPlayer[nameFor(m.playerBId)]++
}
console.log(`Wrote ${matches.length} matches (${players.length} players, ${YEARS.toFixed(2)} years) → ${outPath}`)
console.log('Matches per player:')
for (const [name, n] of Object.entries(perPlayer)) {
  console.log(`  ${name.padEnd(8)} ${n}  (${(n / YEARS).toFixed(1)}/year)`)
}

function nameFor(pid) {
  return players.find((p) => p.id === pid)?.name ?? '?'
}

// ---------- helpers ----------

function evenlySpacedDates(count, start, end) {
  const totalMs = end - start
  const step = totalMs / count
  const out = []
  for (let i = 0; i < count; i++) {
    const base = start.getTime() + step * (i + 0.5)
    const jitter = (Math.random() - 0.5) * step * 0.8
    const d = new Date(base + jitter)
    d.setUTCHours(12, 0, 0, 0)
    if (d < start) d.setTime(start.getTime())
    if (d > end) d.setTime(end.getTime())
    out.push(d)
  }
  return out.sort((a, b) => a - b)
}

function pickLoserGames(dominance, winnerProb) {
  const p30 = 0.15 + dominance * 0.55
  const p31 = 0.35 + (1 - dominance) * 0.10
  if (winnerProb < 0.5) {
    const r = Math.random()
    if (r < 0.15) return 0
    if (r < 0.55) return 1
    return 2
  }
  const r = Math.random()
  if (r < p30) return 0
  if (r < p30 + p31) return 1
  return 2
}

function generateGames(loserGames, winnerSide /* 'A' | 'B' */) {
  const pattern = interleave(3, loserGames)
  return pattern.map((winOfGame) => {
    const [high, low] = validGameScore()
    if (winOfGame === 'W') {
      return winnerSide === 'A' ? { a: high, b: low } : { a: low, b: high }
    }
    return winnerSide === 'A' ? { a: low, b: high } : { a: high, b: low }
  })
}

function interleave(winCount, loseCount) {
  const seq = []
  let w = 0
  let l = 0
  while (w < winCount) {
    if (l >= loseCount) { seq.push('W'); w++; continue }
    if (Math.random() < 0.55) { seq.push('W'); w++ }
    else { seq.push('L'); l++ }
  }
  while (l < loseCount) { seq.push('L'); l++ }
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
  const r = Math.random()
  if (r < 0.75) {
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
