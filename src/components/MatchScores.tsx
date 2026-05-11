import clsx from 'clsx'
import type { GameScore } from '../types'

/**
 * Renders per-game scores as a row of colored tiles.
 *
 * Each game becomes a small rounded chip with the viewer's score on the
 * left and the opponent's on the right. Background tint indicates who won
 * that game (green = viewer, red = opponent, slate = tied). The winning
 * number within the tile is bolded, the losing one is muted.
 *
 * Why tiles instead of an inline `11-9 9-11 11-7` strip: with 3-5 games
 * crammed together on a phone, the dashes blur and readers have to
 * compare every pair to figure out who won each game. Tiles give visual
 * rhythm — three green tiles with one red instantly reads as "won 3-1,
 * lost the second game" without any number-crunching.
 *
 * - `viewerSide` (default 'a'): when 'b', flips each pair so the viewer's
 *   score always reads first.
 * - `size` (default 'xs'): text size class.
 * - `colorize` (default true): when false, all tiles render in neutral
 *   slate. Use when the colour is already carried elsewhere (e.g. a
 *   single-tile preview where the outer container already has a tint).
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
    <span className={clsx('inline-flex flex-wrap justify-center gap-1 font-mono', sizeCls)}>
      {games.map((g, i) => {
        const my = viewerSide === 'a' ? g.a : g.b
        const opp = viewerSide === 'a' ? g.b : g.a
        const myWon = my > opp
        const oppWon = opp > my
        const tileCls = !colorize
          ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
          : myWon
            ? 'bg-green-50 text-green-900 dark:bg-green-900/20 dark:text-green-200'
            : oppWon
              ? 'bg-red-50 text-red-900 dark:bg-red-900/20 dark:text-red-200'
              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
        return (
          <span
            key={i}
            aria-label={`Game ${i + 1}: ${my}-${opp}`}
            className={clsx(
              'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 tabular-nums whitespace-nowrap',
              tileCls,
            )}
          >
            <span className={clsx('min-w-[1.25rem] text-right', myWon && 'font-bold')}>{my}</span>
            <span className="opacity-50">–</span>
            <span className={clsx('min-w-[1.25rem] text-left', oppWon && 'font-bold')}>{opp}</span>
          </span>
        )
      })}
    </span>
  )
}
