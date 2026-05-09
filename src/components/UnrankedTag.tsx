/**
 * Visual marker shown on every match that opted out of rating calculations.
 * Kept text-explicit ("not rated") so casual readers don't have to learn a
 * symbol. Used wherever match rows are listed.
 */
export function UnrankedTag({ className = '' }: { className?: string }) {
  return (
    <span
      className={`rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 dark:bg-slate-800 dark:text-slate-300 ${className}`}
      title="Friendly knockabout — recorded for history but excluded from level calculations"
    >
      friendly · not rated
    </span>
  )
}
