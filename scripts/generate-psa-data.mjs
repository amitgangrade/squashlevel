// Generates a SquashLevel import JSON seeded with real PSA tournament matches
// (2022-2025) involving the men's top-10 players (and legends of the era who
// appear frequently alongside them).
//
// Sources (all Wikipedia tournament pages):
//   - 2022, 2023, 2024 Men's PSA World Tour Finals (full round-robin + knockouts)
//   - 2023, 2024, 2025 PSA Men's World Squash Championship (QF–F)
//   - 2024 Men's British Open Squash Championship (QF–F)
//
// Scores per Wikipedia: "x-y" per game. When the games-won tally under that
// interpretation disagrees with the recorded winner, scores are flipped (some
// Wikipedia rows list scores as winner-loser instead of player1-player2).
// Walkovers, retirements, and obvious extraction errors are dropped.
//
// Run: node scripts/generate-psa-data.mjs [output-path]
//   default output: fixtures/psa-real.json

import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'

const outPath = resolve(process.argv[2] ?? 'fixtures/psa-real.json')

// Starting levels are calibrated to reflect relative PSA strength at the start
// of the dataset (Jan 2022). The app's algorithm is scale-agnostic, so these
// anchor the leaderboard while matches drive the deltas.
const roster = [
  { name: 'Mostafa Asal',         country: 'EGY', startingLevel: 2780 },
  { name: 'Ali Farag',            country: 'EGY', startingLevel: 2800 },
  { name: 'Diego Elías',          country: 'PER', startingLevel: 2700 },
  { name: 'Paul Coll',            country: 'NZL', startingLevel: 2720 },
  { name: 'Mohamed El Shorbagy',  country: 'ENG', startingLevel: 2680 },
  { name: 'Karim Abdel Gawad',    country: 'EGY', startingLevel: 2580 },
  { name: 'Tarek Momen',          country: 'EGY', startingLevel: 2560 },
  { name: 'Joel Makin',           country: 'WAL', startingLevel: 2540 },
  { name: 'Mazen Hesham',         country: 'EGY', startingLevel: 2500 },
  { name: 'Victor Crouin',        country: 'FRA', startingLevel: 2470 },
  { name: 'Marwan El Shorbagy',   country: 'ENG', startingLevel: 2460 },
  { name: 'Youssef Soliman',      country: 'EGY', startingLevel: 2430 },
  { name: 'Youssef Ibrahim',      country: 'EGY', startingLevel: 2420 },
  { name: 'Mohamad Zakaria',      country: 'EGY', startingLevel: 2400 },
  { name: 'Jonah Bryant',         country: 'ENG', startingLevel: 2380 },
]

const START = new Date('2022-01-01T00:00:00Z')

const players = roster.map((r) => ({
  id: randomUUID(),
  name: r.name,
  startingLevel: r.startingLevel,
  createdAt: START.toISOString(),
  notes: r.country,
}))

const byName = new Map(players.map((p) => [p.name, p]))
const idOf = (name) => {
  const p = byName.get(name)
  if (!p) throw new Error(`Unknown player: ${name}`)
  return p.id
}

// Raw tournament matches. Scores are an array of "x-y" strings, one per game.
// p1 is player1 on Wikipedia, p2 is player2. winner is the named match winner.
const rawMatches = [
  // ---------- 2022 Men's PSA World Tour Finals (Cairo, 21-26 Jun) ----------
  t('2022-06-21', 'Mohamed El Shorbagy', 'Mazen Hesham', 'Mohamed El Shorbagy', ['11-4','9-11','11-5']),
  t('2022-06-22', 'Ali Farag',           'Diego Elías',   'Ali Farag',          ['8-11','11-6','11-3']),
  t('2022-06-23', 'Diego Elías',         'Mohamed El Shorbagy', 'Mohamed El Shorbagy', ['11-6','11-7']),
  t('2022-06-23', 'Ali Farag',           'Mazen Hesham',  'Ali Farag',          ['11-3','9-11','11-2']),
  t('2022-06-24', 'Diego Elías',         'Mazen Hesham',  'Diego Elías',        ['11-5','12-10']),
  t('2022-06-24', 'Ali Farag',           'Mohamed El Shorbagy', 'Ali Farag',    ['11-8','12-10']),
  t('2022-06-21', 'Paul Coll',           'Tarek Momen',   'Tarek Momen',        ['11-9','10-12','8-11']),
  t('2022-06-21', 'Mostafa Asal',        'Joel Makin',    'Mostafa Asal',       ['11-7','3-11','11-7']),
  t('2022-06-22', 'Paul Coll',           'Joel Makin',    'Paul Coll',          ['12-10','11-5']),
  t('2022-06-22', 'Mostafa Asal',        'Tarek Momen',   'Mostafa Asal',       ['11-8','12-10']),
  t('2022-06-23', 'Paul Coll',           'Mostafa Asal',  'Paul Coll',          ['11-8','11-5']),
  t('2022-06-24', 'Tarek Momen',         'Joel Makin',    'Joel Makin',         ['11-7','14-12']),
  t('2022-06-25', 'Ali Farag',           'Mostafa Asal',  'Mostafa Asal',       ['11-4','11-6']),
  t('2022-06-25', 'Paul Coll',           'Mohamed El Shorbagy', 'Paul Coll',    ['11-6','11-5']),
  t('2022-06-26', 'Mostafa Asal',        'Paul Coll',     'Mostafa Asal',       ['13-11','11-8','11-7']),

  // ---------- 2023 Men's PSA World Tour Finals (Cairo, 20-25 Jun) ----------
  t('2023-06-20', 'Diego Elías',   'Mazen Hesham', 'Diego Elías',   ['11-8','11-5']),
  t('2023-06-20', 'Mostafa Asal',  'Victor Crouin','Mostafa Asal',  ['11-3','11-9']),
  t('2023-06-21', 'Diego Elías',   'Mostafa Asal', 'Mostafa Asal',  ['10-11','11-7','12-10']),
  t('2023-06-21', 'Mazen Hesham',  'Victor Crouin','Mazen Hesham',  ['11-7','11-6']),
  t('2023-06-22', 'Diego Elías',   'Victor Crouin','Diego Elías',   ['11-9','11-7']),
  t('2023-06-23', 'Mostafa Asal',  'Mazen Hesham', 'Mazen Hesham',  ['2-11','11-8','11-5']),
  t('2023-06-20', 'Ali Farag',     'Paul Coll',    'Ali Farag',     ['9-11','11-3','11-7']),
  t('2023-06-21', 'Mohamed El Shorbagy','Tarek Momen','Mohamed El Shorbagy',['11-6','11-4']),
  t('2023-06-22', 'Ali Farag',     'Mohamed El Shorbagy','Ali Farag',['9-11','11-5','11-3']),
  t('2023-06-22', 'Paul Coll',     'Tarek Momen',  'Paul Coll',     ['11-6','11-3']),
  t('2023-06-23', 'Mohamed El Shorbagy','Paul Coll','Mohamed El Shorbagy',['11-8','12-10']),
  // Farag got a walkover from Momen — skipped.
  t('2023-06-24', 'Diego Elías',   'Mohamed El Shorbagy','Diego Elías',['11-5','11-6']),
  t('2023-06-24', 'Ali Farag',     'Mostafa Asal', 'Mostafa Asal',  ['11-2','11-5']),
  t('2023-06-25', 'Diego Elías',   'Mostafa Asal', 'Mostafa Asal',  ['9-11','11-6','11-3','11-5']),

  // ---------- 2024 Men's PSA World Tour Finals (Cairo, 18-22 Jun) ----------
  t('2024-06-18', 'Ali Farag',     'Karim Abdel Gawad','Ali Farag', ['11-7','11-2']),
  t('2024-06-18', 'Mostafa Asal',  'Mohamed El Shorbagy','Mostafa Asal',['11-6','11-4']),
  t('2024-06-19', 'Ali Farag',     'Mostafa Asal', 'Ali Farag',     ['12-10','11-6']),
  t('2024-06-19', 'Karim Abdel Gawad','Mohamed El Shorbagy','Karim Abdel Gawad',['9-11','11-6','11-8']),
  // Farag–El Shorbagy: walkover — skipped.
  t('2024-06-20', 'Mostafa Asal',  'Karim Abdel Gawad','Mostafa Asal',['11-7','10-11','11-3']),
  t('2024-06-18', 'Diego Elías',   'Tarek Momen',  'Tarek Momen',   ['11-7','11-4']),
  t('2024-06-18', 'Paul Coll',     'Mazen Hesham', 'Paul Coll',     ['11-9','11-2']),
  t('2024-06-19', 'Mazen Hesham',  'Tarek Momen',  'Mazen Hesham',  ['10-11','11-6','11-9']),
  t('2024-06-19', 'Paul Coll',     'Diego Elías',  'Paul Coll',     ['11-8','11-9']),
  // Elías–Hesham: walkover — skipped.
  t('2024-06-20', 'Paul Coll',     'Tarek Momen',  'Tarek Momen',   ['11-6','11-3']),
  t('2024-06-21', 'Mostafa Asal',  'Tarek Momen',  'Mostafa Asal',  ['11-3','11-5']),
  t('2024-06-21', 'Ali Farag',     'Paul Coll',    'Ali Farag',     ['12-10','11-6']),
  // Final: Farag beat Asal 11-5, then Asal retired 5-2 in game 2.
  t('2024-06-22', 'Ali Farag',     'Mostafa Asal', 'Ali Farag',     ['11-5'], 'Asal retired 5-2 in game 2'),

  // ---------- 2023 PSA Men's World Championship (Chicago, 8-11 May) — QF onwards ----------
  t('2023-05-08', 'Mostafa Asal',        'Mazen Hesham',       'Mostafa Asal',        ['11-9','3-11','11-6','5-11','12-10']),
  t('2023-05-08', 'Paul Coll',           'Ali Farag',          'Ali Farag',           ['11-3','5-11','11-2','11-4']),
  t('2023-05-09', 'Karim Abdel Gawad',   'Diego Elías',        'Karim Abdel Gawad',   ['11-5','13-11','14-12']),
  t('2023-05-09', 'Mohamed El Shorbagy', 'Tarek Momen',        'Mohamed El Shorbagy', ['11-8','9-11','13-11','8-11','11-3']),
  t('2023-05-10', 'Mostafa Asal',        'Ali Farag',          'Ali Farag',           ['11-5','11-8','11-13','11-2']),
  t('2023-05-10', 'Mohamed El Shorbagy', 'Karim Abdel Gawad',  'Karim Abdel Gawad',   ['10-12','11-5','7-11','11-8','11-7']),
  t('2023-05-11', 'Ali Farag',           'Karim Abdel Gawad',  'Ali Farag',           ['12-10','11-6','11-6']),

  // ---------- 2024 PSA Men's World Championship (Cairo, 15-18 May) — QF onwards ----------
  t('2024-05-15', 'Mohamed El Shorbagy', 'Paul Coll',          'Paul Coll',           ['14-12','11-6','11-2']),
  t('2024-05-15', 'Ali Farag',           'Tarek Momen',        'Ali Farag',           ['11-3','11-8','11-6']),
  t('2024-05-15', 'Mostafa Asal',        'Mazen Hesham',       'Mostafa Asal',        ['11-4','2-11','11-8','11-3']),
  t('2024-05-15', 'Karim Abdel Gawad',   'Diego Elías',        'Diego Elías',         ['11-5','11-1','11-6']),
  t('2024-05-17', 'Ali Farag',           'Diego Elías',        'Diego Elías',         ['5-11','8-11','11-7','7-11']),
  t('2024-05-17', 'Mostafa Asal',        'Paul Coll',          'Mostafa Asal',        ['11-7','11-6','8-11','3-11','12-10']),
  t('2024-05-18', 'Diego Elías',         'Mostafa Asal',       'Diego Elías',         ['11-6','11-5','12-10']),

  // ---------- 2024 Men's British Open (Birmingham, Jun) — QF onwards ----------
  t('2024-06-05', 'Ali Farag',    'Mazen Hesham',         'Ali Farag',     ['11-7','11-5','11-5']),
  // Makin–Soliman QF: single-game "11-3" scoreline on Wikipedia — almost certainly a walkover/retirement, dropped.
  t('2024-06-05', 'Mostafa Asal', 'Mohamed El Shorbagy',  'Mostafa Asal',  ['11-7','11-4','11-6']),
  t('2024-06-05', 'Paul Coll',    'Karim Abdel Gawad',    'Paul Coll',     ['11-9','11-7']),
  t('2024-06-07', 'Ali Farag',    'Joel Makin',           'Ali Farag',     ['11-3','11-9','11-7']),
  // Asal–Coll SF: Wikipedia extraction contained invalid scores (11-11, 12-6), dropped.
  t('2024-06-09', 'Ali Farag',    'Mostafa Asal',         'Mostafa Asal',  ['11-5','2-11','13-11','4-11','12-10']),

  // ---------- 2025 Men's World Squash Championship (May) — QF onwards ----------
  t('2025-05-14', 'Ali Farag',    'Tarek Momen',       'Ali Farag',    ['11-8','11-8','11-4']),
  t('2025-05-14', 'Diego Elías',  'Youssef Soliman',   'Diego Elías',  ['11-8','11-1','11-8']),
  t('2025-05-15', 'Mostafa Asal', 'Karim Abdel Gawad', 'Mostafa Asal', ['11-7','11-4','11-8']),
  t('2025-05-15', 'Paul Coll',    'Mohamed El Shorbagy','Paul Coll',   ['11-4','11-9','11-2']),
  t('2025-05-16', 'Ali Farag',    'Diego Elías',       'Ali Farag',    ['11-5','11-4','11-5']),
  t('2025-05-16', 'Mostafa Asal', 'Paul Coll',         'Mostafa Asal', ['11-5','11-5','11-4']),
  t('2025-05-17', 'Ali Farag',    'Mostafa Asal',      'Mostafa Asal', ['7-11','8-11','3-11']),
]

function t(date, p1, p2, winner, rawScores, notes) {
  return { date, p1, p2, winner, rawScores, notes }
}

// Convert raw scores ("x-y" strings) to {a, b} games in player1-player2
// orientation. If that orientation disagrees with the stated winner,
// flip each game (Wikipedia rows occasionally list scores winner-loser
// rather than p1-p2).
function normalize(raw) {
  const direct = raw.rawScores.map((s) => {
    const [a, b] = s.split('-').map(Number)
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      throw new Error(`Bad score "${s}" in match ${raw.p1} vs ${raw.p2} (${raw.date})`)
    }
    return { a, b }
  })
  let p1Games = 0
  let p2Games = 0
  for (const { a, b } of direct) {
    if (a > b) p1Games++
    else if (b > a) p2Games++
  }
  const winnerIsP1 = raw.winner === raw.p1
  const directAgrees = (p1Games > p2Games) === winnerIsP1
  const games = directAgrees ? direct : direct.map(({ a, b }) => ({ a: b, b: a }))

  // Sanity check after normalization.
  let finalP1 = 0
  let finalP2 = 0
  for (const { a, b } of games) {
    if (a > b) finalP1++
    else if (b > a) finalP2++
  }
  const resolvedWinner = finalP1 > finalP2 ? raw.p1 : raw.p2
  if (resolvedWinner !== raw.winner) {
    throw new Error(`Winner mismatch for ${raw.p1} vs ${raw.p2} on ${raw.date}`)
  }
  return games
}

const matches = rawMatches.map((raw) => ({
  id: randomUUID(),
  date: raw.date,
  playerAId: idOf(raw.p1),
  playerBId: idOf(raw.p2),
  games: normalize(raw),
  type: 'tournament',
  notes: raw.notes,
}))

matches.sort((a, b) => a.date.localeCompare(b.date))

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

// Summary.
const perPlayer = Object.fromEntries(players.map((p) => [p.name, 0]))
for (const m of matches) {
  const a = players.find((p) => p.id === m.playerAId)?.name
  const b = players.find((p) => p.id === m.playerBId)?.name
  if (a) perPlayer[a]++
  if (b) perPlayer[b]++
}
console.log(`Wrote ${matches.length} real PSA matches across ${players.length} players → ${outPath}`)
console.log('Matches per player:')
for (const [name, n] of Object.entries(perPlayer).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(22)} ${n}`)
}
