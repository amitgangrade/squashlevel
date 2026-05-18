/**
 * "Unregistered" marker shown next to unclaimed-player names (rows where
 * `players.user_id IS NULL`). Slate-toned like the default `.tag` —
 * intentionally quieter than the amber Provisional badge because the
 * signal is informational ("this person hasn't signed up yet") rather
 * than a rating-system caveat.
 *
 * The `variant` prop is kept for API parity with ProvisionalTag (callers
 * pass `"full"` on hero/profile headers) but renders the same label in
 * both modes — "Unregistered" is short enough to fit beside a name.
 */
export function UnclaimedTag({ variant: _variant = 'compact' }: { variant?: 'compact' | 'full' } = {}) {
  return (
    <span
      className="tag"
      title="Unregistered — this player was added by someone else and hasn't signed up to Boast yet"
    >
      Unregistered
    </span>
  )
}
