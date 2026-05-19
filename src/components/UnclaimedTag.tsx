/**
 * "Unregistered" marker shown next to unclaimed-player names (rows where
 * `players.user_id IS NULL`). Soft-blue (`.tag-info`) — informational,
 * distinct from amber `.tag-pending` (provisional, a rating-system
 * caveat) so the two don't blur together when both appear next to a
 * name.
 *
 * The `variant` prop is kept for API parity with ProvisionalTag (callers
 * pass `"full"` on hero/profile headers) but renders the same label in
 * both modes — "Unregistered" is short enough to fit beside a name.
 */
export function UnclaimedTag({ variant: _variant = 'compact' }: { variant?: 'compact' | 'full' } = {}) {
  return (
    <span
      className="tag-info"
      title="Unregistered — this player was added by someone else and hasn't signed up to Boast yet"
    >
      Unregistered
    </span>
  )
}
