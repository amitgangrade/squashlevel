export function fmtLevel(n: number | undefined | null, digits = 0): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function fmtDelta(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return ''
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

export function todayIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function playerAge(birthYear: number | null | undefined): number | null {
  if (!birthYear) return null
  const age = new Date().getFullYear() - birthYear
  return age > 0 && age < 130 ? age : null
}

export function initialsFor(name: string | null | undefined, fallback = '?'): string {
  if (!name) return fallback
  const init = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')
  return init || fallback
}
