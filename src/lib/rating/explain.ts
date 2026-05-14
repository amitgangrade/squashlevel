import { MATCH_TYPE_WEIGHT, type MatchType } from '../../types'

export interface ExplainInput {
  /** Both before-levels, so we can describe who the favourite was. */
  levelA: number
  levelB: number
  preview: {
    deltaA: number
    deltaB: number
    /** A-side share of expected performance, 0..1. */
    expected: number
    /** A-side share of actual performance, 0..1. */
    actual: number
  }
  matchType: MatchType
  provisionalA: boolean
  provisionalB: boolean
  playerAName: string
  playerBName: string
}

/**
 * Plain-English sentences explaining why a previewed match moves the
 * levels the way it does. Designed for the Log Match preview block —
 * each returned line is a short, self-contained fact so the UI can
 * render them as a stacked list.
 *
 * Always returns at least one line. Lines, in order:
 *   1. Outcome vs prediction (with the actual / expected percentages).
 *   2. Match-type weight (answers "why does this swing feel big/small").
 *   3. Provisional caveat — only when ONE side is provisional and the
 *      other is not (the asymmetric case where one level is locked).
 *
 * Mirrors the spec at `openspec/specs/rating/spec.md`. If the rating
 * rules change there, update this helper and its tests.
 */
export function explainPreview(input: ExplainInput): string[] {
  const { preview, matchType, provisionalA, provisionalB, playerAName, playerBName } = input
  const lines: string[] = []

  const expectedPct = Math.round(preview.expected * 100)
  const actualPct = Math.round(preview.actual * 100)
  // "No change" threshold of 0.5 mirrors what the UI rounds anyway (deltas
  // display as integers).
  const noChange = Math.abs(preview.deltaA) < 0.5 && Math.abs(preview.deltaB) < 0.5

  // 1. Outcome vs prediction.
  if (noChange) {
    lines.push(
      `Outcome matched the prediction (actual ${actualPct}% ≈ expected ${expectedPct}%). Neither level changes.`,
    )
  } else if (preview.actual > preview.expected) {
    lines.push(
      `${playerAName} won a larger share than the level gap predicted (${actualPct}% actual vs ${expectedPct}% expected), so ${playerAName}'s level rises and ${playerBName}'s falls by the same percentage.`,
    )
  } else {
    lines.push(
      `${playerAName} won a smaller share than the level gap predicted (${actualPct}% actual vs ${expectedPct}% expected), so ${playerAName}'s level falls and ${playerBName}'s rises.`,
    )
  }

  // 2. Match-type weight, expressed as a multiple of a friendly so the user
  //    has a familiar baseline.
  const w = MATCH_TYPE_WEIGHT[matchType]
  const friendlyW = MATCH_TYPE_WEIGHT.friendly
  const multiple = w / friendlyW
  if (matchType === 'friendly') {
    lines.push(
      `Friendly — the smallest weighting. A tournament with the same score would move levels about ${(MATCH_TYPE_WEIGHT.tournament / w).toFixed(1)}× as much.`,
    )
  } else if (matchType === 'tournament') {
    lines.push(
      `Tournament — counts about ${multiple.toFixed(1)}× a friendly, so the swing is the largest of the four match types.`,
    )
  } else if (matchType === 'league') {
    lines.push(`League — counts about ${multiple.toFixed(1)}× a friendly.`)
  } else if (matchType === 'box') {
    lines.push(`Box league — the baseline weight, about ${multiple.toFixed(1)}× a friendly.`)
  }

  // 3. Provisional asymmetry. Only mention when one side is locked — for
  //    both-or-neither cases the direction line above already explains
  //    everything.
  if (provisionalA && !provisionalB) {
    lines.push(
      `${playerAName} is provisional (fewer than 5 rated matches), so only their level changes in this match — ${playerBName}'s is shielded from rating noise until ${playerAName} settles.`,
    )
  } else if (!provisionalA && provisionalB) {
    lines.push(
      `${playerBName} is provisional (fewer than 5 rated matches), so only their level changes in this match — ${playerAName}'s is shielded from rating noise until ${playerBName} settles.`,
    )
  }

  return lines
}
