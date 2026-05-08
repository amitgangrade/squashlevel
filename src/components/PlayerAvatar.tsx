import clsx from 'clsx'
import { initialsFor } from '../lib/format'

interface Props {
  name: string
  avatarUrl?: string | null
  size?: number
  className?: string
}

export function PlayerAvatar({ name, avatarUrl, size = 32, className }: Props) {
  const style = { height: size, width: size, fontSize: Math.round(size * 0.4) }
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        style={style}
        className={clsx('rounded-full object-cover shrink-0', className)}
      />
    )
  }
  return (
    <span
      style={style}
      className={clsx(
        'grid place-items-center rounded-full bg-slate-200 font-semibold text-slate-700 shrink-0 dark:bg-slate-700 dark:text-slate-200',
        className,
      )}
    >
      {initialsFor(name)}
    </span>
  )
}

/**
 * Comma-joined string of disambiguating attributes (country, age, club). Used
 * to help pick the right "John Doe" when several players share a name.
 */
export function playerSubtitle(p: {
  country?: string | null
  city?: string | null
  club?: string | null
  birthYear?: number | null
}): string {
  const parts: string[] = []
  if (p.club) parts.push(p.club)
  if (p.city || p.country) parts.push([p.city, p.country].filter(Boolean).join(', '))
  if (p.birthYear) {
    const age = new Date().getFullYear() - p.birthYear
    if (age > 0 && age < 130) parts.push(`age ${age}`)
  }
  return parts.join(' · ')
}
