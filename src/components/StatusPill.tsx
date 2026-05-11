import type { ReactNode } from 'react'
import clsx from 'clsx'

/**
 * Rounded-pill status badge — uppercase, tracking-wide, ~10px text. Visually
 * distinct from `.tag` (which is rectangular and used for role/identity
 * markers) so users can read "this is a state" at a glance.
 *
 * Variants are semantic, not color names: callers say `pending` not `amber`,
 * so the centralised palette can shift later without touching call sites.
 */
type Variant = 'pending' | 'disputed' | 'confirmed' | 'auto' | 'win' | 'loss' | 'draw' | 'neutral' | 'success' | 'brand'

const VARIANT_CLASS: Record<Variant, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  disputed: 'bg-tin-100 text-tin-800 dark:bg-tin-900/40 dark:text-tin-200',
  confirmed: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  // "auto-confirmed" reads as informational, not a positive achievement —
  // muted slate keeps it visually quieter than a pending or confirmed state.
  auto: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  win: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  loss: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  draw: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
  // "brand" labels the object type itself ("CHALLENGE", "DRAFT") rather
  // than a status — same shape, brand color so it doesn't read as a state.
  brand: 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200',
}

interface Props {
  variant: Variant
  /** Override the default label-casing. `lower` is used for challenge state
   *  ("accepted"), `upper` for match state ("PENDING", default). */
  case?: 'upper' | 'lower'
  className?: string
  title?: string
  children: ReactNode
}

export function StatusPill({ variant, case: caseStyle = 'upper', className, title, children }: Props) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide',
        caseStyle === 'upper' ? 'uppercase' : 'lowercase',
        VARIANT_CLASS[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
