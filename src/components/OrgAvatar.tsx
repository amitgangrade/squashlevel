import clsx from 'clsx'

/**
 * 2-letter coloured tile for an organisational entity (club, group). The
 * colour scheme distinguishes kinds at a glance: clubs use the brand palette,
 * groups use violet.
 *
 * Use for header tiles on club/group profile pages and the directory cards.
 * Uses initials from the entity's name (first two letters of first word
 * fall-back to the first two characters of the name).
 */
export function OrgAvatar({
  name,
  kind,
  size = 40,
  className,
}: {
  name: string
  kind: 'club' | 'group'
  size?: number
  className?: string
}) {
  const initials = (name || '?').slice(0, 2).toUpperCase()
  const style = { height: size, width: size, fontSize: Math.round(size * 0.4) }
  const palette =
    kind === 'club'
      ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
      : 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200'
  return (
    <span
      style={style}
      className={clsx(
        'grid place-items-center rounded-md font-semibold shrink-0',
        palette,
        className,
      )}
    >
      {initials}
    </span>
  )
}
