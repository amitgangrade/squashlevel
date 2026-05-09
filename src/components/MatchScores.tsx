import clsx from 'clsx'
import type { GameScore } from '../types'

/**
 * Renders per-game scores.
 *
 * - `viewerSide` (default 'a'): when 'b', flips each pair so the page
 *   owner's score reads first. Used on profile-style cards.
 * - `size` (default 'xs'): text size class.
 * - `colorize` (default true): when false, both sides render in the same
 *   neutral colour. Use this when an outer Won/Lost badge already conveys
 *   the result and per-game colouring would be redundant.
 */
export function GameScores({
  games,
  viewerSide = 'a',
  size = 'xs',
  colorize = true,
}: {
  games: GameScore[]
  viewerSide?: 'a' | 'b'
  size?: 'xs' | 'sm' | 'base'
  colorize?: boolean
}) {
  const sizeCls = size === 'sm' ? 'text-sm' : size === 'base' ? 'text-base' : 'text-xs'
  return (
    <span className={clsx('inline-flex flex-wrap gap-x-2 gap-y-1 font-mono', sizeCls)}>
      {games.map((g, i) => {
        const my = viewerSide === 'a' ? g.a : g.b
        const opp = viewerSide === 'a' ? g.b : g.a
        const myWon = my > opp
        const oppWon = opp > my
        return (
          <span key={i} className="whitespace-nowrap">
            <span className={clsx(colorize && myWon && 'font-semibold text-green-700 dark:text-green-400', colorize && oppWon && 'text-slate-400')}>
              {my}
            </span>
            <span className="text-slate-400">–</span>
            <span className={clsx(colorize && oppWon && 'font-semibold text-green-700 dark:text-green-400', colorize && myWon && 'text-slate-400')}>
              {opp}
            </span>
          </span>
        )
      })}
    </span>
  )
}
