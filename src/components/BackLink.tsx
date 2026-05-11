import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeftIcon } from './Icons'

interface Props {
  /** Where to go if there's no history to pop. Defaults to "/". */
  fallback?: string
  label?: string
}

/**
 * Compact back-arrow link rendered above detail-page headers. Pops one entry
 * off the history stack when possible (so users return to wherever they were —
 * leaderboard, club page, search results) and falls back to a stable route
 * when the page was opened directly (deep link, share, refresh).
 *
 * Important on iOS PWA installs: the system back-gesture is gone there, so
 * an in-app back affordance is the only way to leave a detail page without
 * re-using the bottom tab bar.
 */
export function BackLink({ fallback = '/', label = 'Back' }: Props) {
  const navigate = useNavigate()
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1

  if (canGoBack) {
    return (
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="-ml-2 mb-2 inline-flex items-center gap-1 px-2 py-1.5 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
        aria-label={label}
      >
        <ChevronLeftIcon className="h-4 w-4" />
        <span>{label}</span>
      </button>
    )
  }

  return (
    <Link
      to={fallback}
      className="-ml-2 mb-2 inline-flex items-center gap-1 px-2 py-1.5 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
    >
      <ChevronLeftIcon className="h-4 w-4" />
      <span>{label}</span>
    </Link>
  )
}
