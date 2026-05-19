import type { ReactNode } from 'react'
import clsx from 'clsx'
import { fmtDate, fmtDelta, fmtLevel } from '../lib/format'
import { actualPerformance, expectedPerformance, gamesWonBy, winnerSide } from '../lib/rating/levels'
import { explainPreview } from '../lib/rating/explain'
import { MATCH_TYPE_LABEL, type Match, type Player, type Settings } from '../types'
import { GameScores } from './MatchScores'
import { PlayerAvatar } from './PlayerAvatar'
import { PlayerLink, PlayerMetaLinks } from './PlayerLinks'
import { StatusPill } from './StatusPill'
import { UnrankedTag } from './UnrankedTag'

/**
 * Canonical match card. Used everywhere we list matches (player profile, club
 * profile, group profile, history, activity). Keeping every list visually
 * consistent removes a class of "this page styles its matches differently"
 * drift, and means future tweaks to match presentation only need to land in
 * one place.
 *
 * Layout — responsive flip at sm:
 *
 *   Mobile (< sm), stacked:
 *     [date · type · venue]                       [optional status pill]
 *     ┌──────────────────────────────────────┐
 *     │ avatar  name                  score  │
 *     │         before→after Δ        Won    │  ← subtle row tint
 *     ├──────────────────────────────────────┤
 *     │ avatar  name                  score  │
 *     │         before→after Δ        Lost   │
 *     └──────────────────────────────────────┘
 *     [per-game tiles band]
 *     [Expected · Actual · Why these numbers?]
 *     [optional action row]
 *
 *   Desktop (sm+), horizontal:
 *     [date stamp] [date · type · venue]          [optional status pill]
 *     [avatar  name]              [3 - 1]              [opp name  avatar]
 *     [before→after Δ]                                 [before→after Δ]
 *     [Won/Lost badge — only when viewerId is set]
 *     ─────────────────────────────────────────────────────────────
 *     [per-game tiles — colour-tinted by per-game winner, full-width row]
 *     ─────────────────────────────────────────────────────────────
 *     Expected perf: X% · Actual: Y%   (only when level data exists)
 *     [optional hint line]
 *     [optional action row — Confirm/Dispute/Delete buttons, etc.]
 *
 * Mobile rationale: at 390px a five-element horizontal row
 * (avatar | name | score | name | avatar) crushes names to "sacchi…".
 * Stacking lets each name take the full card width minus the avatar +
 * side score, so it wraps naturally instead of truncating. The big
 * centred score plate disappears on mobile — the per-side score number
 * already lives where the eye is looking (on the player's row).
 *
 * When `viewerId` is provided, that player is forced onto the LEFT side
 * and gets a Won/Lost/Drew badge in the desktop layout. This makes long
 * lists on a profile page easy to scan — your eye doesn't have to
 * figure out "which side am I" each card. On mobile the badge is shown
 * per row regardless (the stack already separates "you" from
 * "opponent" by position).
 *
 * When `viewerId` is omitted, player A goes on the left (no flipping),
 * and both names are clickable links.
 */
export interface MatchCardProps {
  match: Match
  players: Player[]
  settings: Settings
  /** When set, this player is shown on the left and gets a Won/Lost/Drew
   *  badge. Their name renders as plain text (no self-link). */
  viewerId?: string
  /** Optional pill rendered in the header (e.g. "pending", "disputed",
   *  "auto-confirmed"). Caller controls colours/labels. */
  statusBadge?: ReactNode
  /** Optional ring colour on the card edge for emphasis. */
  ring?: 'amber' | 'tin' | 'brand' | 'none'
  /** Optional small text rendered below the perf footer. */
  hint?: ReactNode
  /** Optional action row at the bottom (buttons). */
  actions?: ReactNode
  /** Optional class merged onto the outer card div. */
  className?: string
}

export function MatchCard({
  match: m,
  players,
  settings,
  viewerId,
  statusBadge,
  ring = 'none',
  hint,
  actions,
  className,
}: MatchCardProps) {
  // viewerIsA = the viewer is in slot A and should be shown on the left.
  // When viewerId is unset OR refers to someone not in this match (e.g. the
  // signed-in user viewing other players' games on the History page), we
  // treat A as "left" and skip the result badge.
  const viewerInMatch = !!viewerId && (m.playerAId === viewerId || m.playerBId === viewerId)
  const viewerIsA = viewerInMatch ? m.playerAId === viewerId : true
  const leftId = viewerIsA ? m.playerAId : m.playerBId
  const rightId = viewerIsA ? m.playerBId : m.playerAId
  const left = players.find((p) => p.id === leftId) ?? null
  const right = players.find((p) => p.id === rightId) ?? null
  const leftName = left?.name ?? 'Unknown'
  const rightName = right?.name ?? 'Unknown'

  const leftSide: 'a' | 'b' = viewerIsA ? 'a' : 'b'
  const rightSide: 'a' | 'b' = viewerIsA ? 'b' : 'a'
  const leftGames = gamesWonBy(m.games, leftSide)
  const rightGames = gamesWonBy(m.games, rightSide)
  const winner = winnerSide(m.games)
  const drew = winner === null
  const leftWon = !drew && winner === leftSide
  const rightWon = !drew && winner === rightSide

  const leftBefore = viewerIsA ? m.levelABefore : m.levelBBefore
  const leftAfter = viewerIsA ? m.levelAAfter : m.levelBAfter
  const leftDelta = viewerIsA ? m.deltaA : m.deltaB
  const rightBefore = viewerIsA ? m.levelBBefore : m.levelABefore
  const rightAfter = viewerIsA ? m.levelBAfter : m.levelAAfter
  const rightDelta = viewerIsA ? m.deltaB : m.deltaA

  // Performance percentages from the LEFT side's perspective. expected/actual
  // are returned in player-A-share terms; flip when the viewer was B.
  let perfExpected: number | null = null
  let perfActual: number | null = null
  // A-side perspective values for the collapsible explanation. Kept separate
  // from perfExpected/perfActual which are already viewer-flipped.
  let aSideExpected: number | null = null
  let aSideActual: number | null = null
  if (!m.unranked && m.levelABefore != null && m.levelBBefore != null) {
    aSideExpected = expectedPerformance(m.levelABefore, m.levelBBefore, settings)
    aSideActual = actualPerformance(m.games, settings)
    perfExpected = viewerIsA ? aSideExpected : 1 - aSideExpected
    perfActual = viewerIsA ? aSideActual : 1 - aSideActual
  }
  // Plain-English explanation lines, built once when all the inputs are
  // available. Rendered inside a `<details>` so the card stays tidy by
  // default but every match offers the "why" on one click.
  const explainLines = (() => {
    if (m.unranked) return null
    if (m.levelABefore == null || m.levelBBefore == null) return null
    if (m.deltaA == null || m.deltaB == null) return null
    if (aSideExpected == null || aSideActual == null) return null
    const playerAByMatch = players.find((p) => p.id === m.playerAId)
    const playerBByMatch = players.find((p) => p.id === m.playerBId)
    if (!playerAByMatch || !playerBByMatch) return null
    return explainPreview({
      levelA: m.levelABefore,
      levelB: m.levelBBefore,
      preview: {
        deltaA: m.deltaA,
        deltaB: m.deltaB,
        expected: aSideExpected,
        actual: aSideActual,
      },
      matchType: m.type,
      provisionalA: m.provisionalA ?? false,
      provisionalB: m.provisionalB ?? false,
      playerAName: playerAByMatch.name,
      playerBName: playerBByMatch.name,
    })
  })()

  const ringClass =
    ring === 'amber' ? 'ring-1 ring-amber-200 dark:ring-amber-900/40'
    : ring === 'tin' ? 'ring-1 ring-tin-300 dark:ring-tin-900/50'
    : ring === 'brand' ? 'ring-1 ring-brand-200/60 dark:ring-brand-900/40'
    : ''

  // Result stripe on the card's left edge — only when the viewer is in
  // this match (otherwise "win" / "loss" isn't a meaningful direction
  // and we'd be picking a side at random). Lets the eye scan a long
  // list of matches on a profile page and see the W/L rhythm at the
  // card edge without reading scores. leftWon == viewer won because
  // the viewer is forced into the left slot when viewerInMatch.
  const resultStripe =
    viewerInMatch && !drew
      ? leftWon
        ? 'border-l-4 border-l-green-500 dark:border-l-green-400'
        : 'border-l-4 border-l-tin-500 dark:border-l-tin-400'
      : ''

  // Score-plate tint conveys "did the left side win" at a glance. Subtle
  // 50/20-level backgrounds — strong enough to register peripherally when
  // scrolling, light enough that the per-game tiles and level deltas
  // (which carry the same signal in finer detail) don't fight it.
  const plateTone =
    drew ? 'bg-slate-50 border-slate-200 dark:bg-slate-800/60 dark:border-slate-700'
    : leftWon ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-900/40'
    : rightWon ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-900/40'
    : 'bg-slate-50 border-slate-200 dark:bg-slate-800/60 dark:border-slate-700'

  return (
    <div className={clsx('card', ringClass, resultStripe, className)}>
      {/* Outer two-column layout: date stamp on the left (desktop only),
          everything else in the right column. Mirrors the visual structure
          of a tear-off calendar — the stamp anchors the eye when scanning
          a list of matches. Hidden on mobile because at 390px viewport it
          would steal 60px from the content column and force aggressive
          name truncation. */}
      <div className="flex items-start gap-3 sm:gap-4">
        <DateStamp iso={m.date} className="hidden sm:block" />

        <div className="flex-1 min-w-0 space-y-3">
          {/* Header row: date · type · venue (date inline on mobile only,
              since the DateStamp above is desktop-only). */}
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="truncate">
              <span className="sm:hidden font-medium text-slate-700 dark:text-slate-300">
                {fmtDate(m.date)}
              </span>
              <span className="sm:hidden"> · </span>
              {MATCH_TYPE_LABEL[m.type]}
              {m.venue && <> · {m.venue}</>}
            </span>
            {m.unranked && <UnrankedTag />}
            {statusBadge && <span className="ml-auto shrink-0">{statusBadge}</span>}
          </div>

          {/* MOBILE: stacked player rows. Each player gets a full-width row
              with avatar + name + level change on the left, side score +
              Won/Lost on the right. Subtle row tint by win/loss. Names wrap
              instead of truncating because the row has room. */}
          <div className="sm:hidden space-y-2">
            <MobilePlayerRow
              player={left}
              name={leftName}
              isViewer={viewerInMatch && leftId === viewerId}
              before={leftBefore}
              after={leftAfter}
              delta={leftDelta}
              gamesWon={leftGames}
              outcome={drew ? 'draw' : leftWon ? 'win' : 'loss'}
              unranked={m.unranked}
            />
            <MobilePlayerRow
              player={right}
              name={rightName}
              isViewer={viewerInMatch && rightId === viewerId}
              before={rightBefore}
              after={rightAfter}
              delta={rightDelta}
              gamesWon={rightGames}
              outcome={drew ? 'draw' : rightWon ? 'win' : 'loss'}
              unranked={m.unranked}
            />
          </div>

          {/* DESKTOP: horizontal layout — kept from prior version, with
              name wrapping (break-words instead of truncate), a smaller
              score plate (text-2xl instead of text-3xl), and a divider
              between this row and the per-game tile band so they don't
              visually collide. */}
          <div className="hidden sm:flex items-start gap-4">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              {left && <PlayerAvatar name={left.name} avatarUrl={left.avatarUrl} size={40} />}
              <div className="min-w-0 space-y-1">
                <div className="font-semibold text-slate-900 dark:text-slate-100 break-words">
                  {viewerInMatch && leftId === viewerId ? (
                    leftName
                  ) : (
                    <PlayerLink id={leftId} name={leftName} />
                  )}
                </div>
                {left && <PlayerMetaLinks player={left} />}
                <LevelChange before={leftBefore} after={leftAfter} delta={leftDelta} unranked={m.unranked} />
                {viewerInMatch && (
                  <div>
                    {drew ? (
                      <ResultBadge variant="draw">Drew</ResultBadge>
                    ) : leftWon ? (
                      <ResultBadge variant="win">Won</ResultBadge>
                    ) : (
                      <ResultBadge variant="loss">Lost</ResultBadge>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div
              className={clsx(
                'shrink-0 rounded-md border px-3 py-1.5 font-mono text-2xl leading-none tabular-nums self-center',
                plateTone,
              )}
            >
              <span className={clsx(leftWon && 'font-bold')}>{leftGames}</span>
              <span className="text-slate-400 mx-1.5">–</span>
              <span className={clsx(rightWon && 'font-bold')}>{rightGames}</span>
            </div>

            <div className="flex items-start gap-3 flex-1 min-w-0 justify-end">
              <div className="min-w-0 text-right space-y-1">
                <div className="font-medium text-slate-600 dark:text-slate-400 break-words">
                  <PlayerLink id={rightId} name={rightName} />
                </div>
                {right && (
                  <div className="flex justify-end">
                    <PlayerMetaLinks player={right} />
                  </div>
                )}
                <LevelChange
                  before={rightBefore}
                  after={rightAfter}
                  delta={rightDelta}
                  unranked={m.unranked}
                  align="right"
                />
              </div>
              {right && <PlayerAvatar name={right.name} avatarUrl={right.avatarUrl} size={40} />}
            </div>
          </div>

          {/* Per-game tiles — its own band with a top divider so the
              aggregate score (above) and the per-game breakdown (here)
              feel like distinct pieces of information rather than one
              cramped block. Tints green/red/slate by per-game winner so
              the eye can scan game rhythm at a glance. */}
          {m.games.length > 0 && (
            <div className="flex justify-center border-t border-slate-100 dark:border-slate-800 pt-3">
              <GameScores games={m.games} viewerSide={leftSide} size="sm" />
            </div>
          )}

          {m.notes && <div className="text-xs text-slate-500 italic">{m.notes}</div>}

          {(perfExpected != null && perfActual != null) || hint ? (
            <div className="text-xs text-slate-500 border-t border-slate-100 dark:border-slate-800 pt-2 space-y-1">
              {perfExpected != null && perfActual != null && (
                <div>
                  Expected perf: {(perfExpected * 100).toFixed(0)}% · Actual: {(perfActual * 100).toFixed(0)}%
                </div>
              )}
              {hint && <div>{hint}</div>}
              {explainLines && explainLines.length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 inline-flex items-center gap-1">
                    Why these numbers?
                    <span aria-hidden className="text-slate-400 group-open:hidden">▸</span>
                    <span aria-hidden className="text-slate-400 hidden group-open:inline">▾</span>
                  </summary>
                  <ul className="mt-1.5 space-y-1 list-disc pl-5 text-slate-600 dark:text-slate-300">
                    {explainLines.map((line, i) => <li key={i}>{line}</li>)}
                  </ul>
                </details>
              )}
            </div>
          ) : null}

          {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
        </div>
      </div>
    </div>
  )
}

function ResultBadge({ variant, children }: { variant: 'win' | 'loss' | 'draw'; children: ReactNode }) {
  return <StatusPill variant={variant}>{children}</StatusPill>
}

/**
 * Mobile-only stacked player row. Avatar + name + level change on the
 * left, big side score + Won/Lost pill on the right. Subtle background
 * tint by outcome — green for the winner row, red for the loser, slate
 * for a draw — gives at-a-glance scanability that the old centred score
 * plate was trying to do but lost in the cramming.
 */
function MobilePlayerRow({
  player,
  name,
  isViewer,
  before,
  after,
  delta,
  gamesWon,
  outcome,
  unranked,
}: {
  player: Player | null
  name: string
  isViewer: boolean
  before?: number
  after?: number
  delta?: number
  gamesWon: number
  outcome: 'win' | 'loss' | 'draw'
  unranked?: boolean
}) {
  const tone =
    outcome === 'win'
      ? 'bg-green-50/70 border-green-200/60 dark:bg-green-900/15 dark:border-green-900/30'
      : outcome === 'loss'
        ? 'bg-red-50/70 border-red-200/60 dark:bg-red-900/15 dark:border-red-900/30'
        : 'bg-slate-50/70 border-slate-200/60 dark:bg-slate-900/30 dark:border-slate-800'
  return (
    <div
      className={clsx(
        'flex items-center gap-2.5 rounded-md border px-2.5 py-2',
        tone,
      )}
    >
      {player && <PlayerAvatar name={player.name} avatarUrl={player.avatarUrl} size={36} />}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="font-semibold text-slate-900 dark:text-slate-100 break-words leading-tight">
          {isViewer ? name : <PlayerLink id={player?.id ?? ''} name={name} />}
        </div>
        <LevelChange before={before} after={after} delta={delta} unranked={unranked} />
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        <div
          className={clsx(
            'font-mono text-2xl leading-none tabular-nums',
            outcome === 'win' && 'font-bold text-green-700 dark:text-green-300',
            outcome === 'loss' && 'text-slate-500',
          )}
        >
          {gamesWon}
        </div>
        {!unranked && outcome !== 'draw' && (
          <ResultBadge variant={outcome === 'win' ? 'win' : 'loss'}>
            {outcome === 'win' ? 'Won' : 'Lost'}
          </ResultBadge>
        )}
        {!unranked && outcome === 'draw' && <ResultBadge variant="draw">Drew</ResultBadge>}
      </div>
    </div>
  )
}

/**
 * Tear-off-calendar style date stamp. Three stacked bands — month, day,
 * year — in a small rounded block. Used at the leading edge of each
 * match card on desktop so a list of matches reads as "a stack of dated
 * tickets" rather than a wall of text. Compact (56px wide) but visually
 * distinct from the rest of the card content.
 */
function DateStamp({ iso, className }: { iso: string; className?: string }) {
  let month = ''
  let day = ''
  let year = ''
  try {
    const d = new Date(iso)
    month = d.toLocaleDateString(undefined, { month: 'short' })
    day = String(d.getDate())
    year = String(d.getFullYear())
  } catch {
    // Fall back to showing the raw ISO if parsing fails — preferable to
    // throwing inside a list item that should still render.
    month = iso.slice(5, 7)
    day = iso.slice(8, 10)
    year = iso.slice(0, 4)
  }
  return (
    <div
      className={clsx(
        'shrink-0 w-14 overflow-hidden rounded-md border border-slate-200 bg-white text-center leading-none',
        'dark:border-slate-700 dark:bg-slate-900',
        className,
      )}
      aria-hidden
    >
      <div className="bg-slate-800 px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-white dark:bg-slate-700">
        {month}
      </div>
      <div className="px-1 py-1.5 text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
        {day}
      </div>
      <div className="bg-slate-50 px-1 py-0.5 text-[10px] tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        {year}
      </div>
    </div>
  )
}

function LevelChange({
  before, after, delta, unranked, align,
}: {
  before?: number
  after?: number
  delta?: number
  unranked?: boolean
  align?: 'right'
}) {
  if (unranked) return null
  if (before == null || after == null) return null
  const up = (delta ?? 0) >= 0
  // Flex-wrap so "4,265 → 4,038" stays intact as a unit, and the delta
  // (+227 / −227) sits next to it on roomy viewports but wraps to its
  // own line when the column is too narrow. Previously the whole thing
  // was a single truncating <div> and we'd cut to "4,265 → 4,0..." on
  // mobile — losing the actual after-value the reader cares about.
  return (
    <div
      className={clsx(
        'text-xs font-mono tabular-nums text-slate-500 flex flex-wrap gap-x-1',
        align === 'right' && 'justify-end',
      )}
    >
      <span className="whitespace-nowrap">
        {fmtLevel(before)} <span className="text-slate-400" aria-hidden>→</span> {fmtLevel(after)}
      </span>
      {delta != null && (
        <span className={clsx('font-semibold whitespace-nowrap', up ? 'text-green-600' : 'text-red-600')}>
          {fmtDelta(delta)}
        </span>
      )}
    </div>
  )
}
