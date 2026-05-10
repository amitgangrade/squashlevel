/**
 * Whitespace-tokenised, case-insensitive substring filter. Every token in
 * `query` must appear somewhere in the haystack returned by `getHay(item)`.
 *
 * Used by every page that does client-side typeahead filtering of an
 * already-loaded list (leaderboard, roster, admin search, club/group
 * directories, etc). Empty/whitespace queries return the input unchanged.
 */
export function filterByTokens<T>(
  items: readonly T[],
  query: string,
  getHay: (item: T) => string,
): T[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return items.slice()
  return items.filter((item) => {
    const hay = getHay(item).toLowerCase()
    return tokens.every((t) => hay.includes(t))
  })
}

/** Convenience: join a list of optional strings with spaces, dropping falsy. */
export function joinHay(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
