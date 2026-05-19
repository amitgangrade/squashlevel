import clsx from 'clsx'

/**
 * Rank indicator for leaderboards (global, club, group). Top 3 get
 * medal-styled chips (gold/silver/bronze) so the eye can spot the
 * podium without reading numbers; rank 4+ falls back to a plain slate
 * number. Used everywhere we list a ranked roster for visual
 * consistency.
 *
 * Gold uses the brand accent (squash-ball yellow) — same colour family
 * as the hero CTA, so #1 reads as "the brand's top spot" rather than a
 * random Olympic-medal sprinkle.
 */
export function RankChip({ rank }: { rank: number }) {
  if (rank > 3) {
    return (
      <span className="inline-grid w-6 place-items-center text-sm font-semibold text-slate-400 tabular-nums">
        {rank}
      </span>
    )
  }
  const tone =
    rank === 1
      ? 'bg-accent-500 text-brand-900 ring-1 ring-accent-600/40 shadow-[0_0_8px_rgba(245,224,0,0.5)]'
      : rank === 2
        ? 'bg-slate-300 text-slate-900 ring-1 ring-slate-400/50 dark:bg-slate-400 dark:text-slate-900'
        : 'bg-amber-700 text-white ring-1 ring-amber-800/40 dark:bg-amber-600'
  return (
    <span
      className={clsx(
        'inline-grid h-6 w-6 place-items-center rounded-full text-xs font-bold tabular-nums',
        tone,
      )}
      aria-label={rank === 1 ? '1st place' : rank === 2 ? '2nd place' : '3rd place'}
    >
      {rank}
    </span>
  )
}
