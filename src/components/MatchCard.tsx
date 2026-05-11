import type { ReactNode } from 'react'
import clsx from 'clsx'
import { fmtDate, fmtDelta, fmtLevel } from '../lib/format'
import { actualPerformance, expectedPerformance, gamesWonBy, winnerSide } from '../lib/rating/levels'
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
 * Layout:
 *   [date · type · venue]                       [optional status pill]
 *   [avatar  name]              [3 - 1]              [opp name  avatar]
 *   [before→after Δ]                                 [before→after Δ]
 *   [Won/Lost badge — only when viewerId is set]
 *   [per-game tiles — colour-tinted by per-game winner, full-width row]
 *   ─────────────────────────────────────────────────────────────
 *   Expected perf: X% · Actual: Y%   (only when level data exists)
 *   [optional hint line]
 *   [optional action row — Confirm/Dispute/Delete buttons, etc.]
 *
 * When `viewerId` is provided, that player is forced onto the LEFT side and
 * gets a Won/Lost/Drew badge. This makes long lists on a profile page easy to
 * scan — your eye doesn't have to figure out "which side am I" each card.
 *
 * When `viewerId` is omitted, player A goes on the left (no flipping), no
 * Won/Lost badge appears, and both names are clickable links.
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
  if (!m.unranked && leftBefore != null && rightBefore != null) {
    const expA = expectedPerformance(
      viewerIsA ? leftBefore : rightBefore,
      viewerIsA ? rightBefore : leftBefore,
      settings,
    )
    const actA = actualPerformance(m.games, settings)
    perfExpected = viewerIsA ? expA : 1 - expA
    perfActual = viewerIsA ? actA : 1 - actA
  }

  const ringClass =
    ring === 'amber' ? 'ring-1 ring-amber-200 dark:ring-amber-900/40'
    : ring === 'tin' ? 'ring-1 ring-tin-300 dark:ring-tin-900/50'
    : ring === 'brand' ? 'ring-1 ring-brand-200/60 dark:ring-brand-900/40'
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
    <div className={clsx('card', ringClass, className)}>
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

          {/* Player row: left identity · score plate · right identity. The
              per-game tiles get their own full-width row below — squeezing
              them into the centre column on a 375px phone forced them to
              wrap into a multi-line stack and made the whole card lopsided.

              Player meta chips (club · city · country) are hidden on mobile.
              On a 390px phone with a 3-col layout each side gets ~95px of
              inner space, which is not enough for "Singapore Cricket Club ·
              Singapore · Singapore · age 45" — it wrapped to 4-5 lines and
              made the card grotesquely tall. The name links to the full
              profile where all that info lives. */}
          <div className="flex items-center gap-1.5 sm:gap-3">
            <div className="flex items-start gap-2 flex-1 min-w-0">
              {left && <PlayerAvatar name={left.name} avatarUrl={left.avatarUrl} size={36} />}
              <div className="min-w-0 space-y-1">
                <div className="font-semibold truncate text-slate-900 dark:text-slate-100">
                  {viewerInMatch && leftId === viewerId ? (
                    leftName
                  ) : (
                    <PlayerLink id={leftId} name={leftName} />
                  )}
                </div>
                {left && <PlayerMetaLinks player={left} className="hidden sm:inline" />}
                <LevelChange before={leftBefore} after={leftAfter} delta={leftDelta} unranked={m.unranked} />
                {viewerInMatch && !m.unranked && (
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
                'shrink-0 rounded-md border px-2 sm:px-3 py-1 sm:py-1.5 font-mono text-xl sm:text-3xl leading-none tabular-nums',
                plateTone,
              )}
            >
              <span className={clsx(leftWon && 'font-bold')}>{leftGames}</span>
              <span className="text-slate-400 mx-1 sm:mx-1.5">–</span>
              <span className={clsx(rightWon && 'font-bold')}>{rightGames}</span>
            </div>

            <div className="flex items-start gap-2 flex-1 min-w-0 justify-end">
              <div className="min-w-0 text-right space-y-1">
                <div className="font-medium truncate text-slate-600 dark:text-slate-400">
                  <PlayerLink id={rightId} name={rightName} />
                </div>
                {right && (
                  <div className="hidden sm:flex justify-end">
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
              {right && <PlayerAvatar name={right.name} avatarUrl={right.avatarUrl} size={36} />}
            </div>
          </div>

          {/* Per-game tiles — full-width row from the left side's perspective.
              Tints green/red/slate by per-game winner so the eye can scan game
              rhythm at a glance. Hidden when there's only one "game" with a
              0-0 score (rare, but possible mid-edit). */}
          {m.games.length > 0 && (
            <div className="flex justify-center">
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
