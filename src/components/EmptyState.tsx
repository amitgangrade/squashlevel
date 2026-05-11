import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import clsx from 'clsx'

interface Props {
  /** Optional icon — typically one of the SVGs from Icons.tsx, sized h-8 w-8. */
  icon?: ReactNode
  /** Headline. Short noun phrase ("No matches yet"). */
  title: string
  /** One sentence explaining what the user could do next. */
  description?: string
  /** Optional CTA. Pass either `to` (router link) or `onClick` (button). */
  ctaLabel?: string
  ctaTo?: string
  ctaOnClick?: () => void
  className?: string
}

/**
 * Empty-state card. Replaces the various "No matches yet" / "No players match"
 * one-liners scattered around the app with a consistent visual: muted icon,
 * heading, helper text, and an optional next-step CTA.
 */
export function EmptyState({ icon, title, description, ctaLabel, ctaTo, ctaOnClick, className }: Props) {
  return (
    <div className={clsx('card flex flex-col items-center text-center py-8 px-4', className)}>
      {icon && (
        <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {icon}
        </div>
      )}
      <div className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</div>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {ctaLabel && ctaTo && (
        <Link to={ctaTo} className="btn-primary mt-4">{ctaLabel}</Link>
      )}
      {ctaLabel && !ctaTo && ctaOnClick && (
        <button type="button" onClick={ctaOnClick} className="btn-primary mt-4">{ctaLabel}</button>
      )}
    </div>
  )
}
