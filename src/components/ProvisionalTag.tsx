import { useStore } from '../state/store'

/**
 * Tiny "(P)" marker shown next to provisional players (those with fewer than
 * `settings.provisionalThreshold` rated matches). Their level is still
 * settling, and they only move their own level — opponents stay put.
 *
 * The tooltip surfaces the actual threshold from settings so admins who've
 * tuned it see the real number, not a generic phrase.
 *
 * Two presentations:
 *  • `compact` (default) — single "P" badge to fit beside a name in tables.
 *  • `full` — spelled out "Provisional" for hero/profile headers.
 */
export function ProvisionalTag({ variant = 'compact' }: { variant?: 'compact' | 'full' }) {
  const { settings } = useStore()
  const threshold = settings.provisionalThreshold
  return (
    <span
      className="tag-pending"
      title={`Provisional — level is still settling for the first ${threshold} rated ${threshold === 1 ? 'match' : 'matches'}. Provisional players only move their own level; opponents are unaffected.`}
    >
      {variant === 'full' ? 'Provisional' : 'P'}
    </span>
  )
}
