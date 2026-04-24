import clsx from 'clsx'
import type { GameScore } from '../types'

export function GameScores({ games }: { games: GameScore[] }) {
  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-1 font-mono text-xs">
      {games.map((g, i) => {
        const aWon = g.a > g.b
        const bWon = g.b > g.a
        return (
          <span key={i} className="whitespace-nowrap">
            <span className={clsx(aWon && 'font-semibold text-green-700 dark:text-green-400', bWon && 'text-slate-400')}>
              {g.a}
            </span>
            <span className="text-slate-400">–</span>
            <span className={clsx(bWon && 'font-semibold text-green-700 dark:text-green-400', aWon && 'text-slate-400')}>
              {g.b}
            </span>
          </span>
        )
      })}
    </span>
  )
}
