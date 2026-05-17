/**
 * Tiny "stub" marker shown next to unclaimed-player names (rows where
 * `players.user_id IS NULL`). Slate-toned like the default `.tag` —
 * intentionally quieter than the amber Provisional badge because the
 * signal is informational ("this person hasn't signed up yet") rather
 * than a rating-system caveat.
 *
 * Two presentations mirroring ProvisionalTag:
 *  • `compact` (default) — short "stub" badge to fit beside a name in
 *    tables.
 *  • `full` — spelled out "Not yet signed up" for hero/profile headers.
 */
export function UnclaimedTag({ variant = 'compact' }: { variant?: 'compact' | 'full' }) {
  return (
    <span
      className="tag"
      title="This player was added by someone else and hasn't signed up to Boast yet"
    >
      {variant === 'full' ? 'Not yet signed up' : 'stub'}
    </span>
  )
}
