/**
 * Tiny "(P)" marker shown next to provisional players (those with fewer than
 * `settings.provisionalThreshold` rated matches). Their level is still
 * settling, and they only move their own level — opponents stay put.
 *
 * Two presentations:
 *  • `compact` (default) — single "P" badge to fit beside a name in tables.
 *  • `full` — spelled out "Provisional" for hero/profile headers.
 */
export function ProvisionalTag({ variant = 'compact' }: { variant?: 'compact' | 'full' }) {
  return (
    <span
      className="tag"
      title="Provisional — fewer than the configured number of rated matches"
    >
      {variant === 'full' ? 'Provisional' : 'P'}
    </span>
  )
}
