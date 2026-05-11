import type { ReactNode } from 'react'
import clsx from 'clsx'
import { AlertCircleIcon } from './Icons'

interface Props {
  variant?: 'error' | 'info' | 'warn'
  children: ReactNode
  className?: string
  /** Optional dismiss handler — when provided, an × button is shown. Used
   *  for the rebuild-levels hint after a destructive admin action. */
  onDismiss?: () => void
}

const VARIANT_CLASS: Record<Required<Props>['variant'], string> = {
  error: 'alert-error',
  info: 'alert-info',
  warn: 'alert-warn',
}

/**
 * Inline alert with leading icon. Use for form/validation errors and
 * informational context blocks that need more weight than a slate paragraph.
 */
export function Alert({ variant = 'error', children, className, onDismiss }: Props) {
  return (
    <div
      role={variant === 'error' ? 'alert' : undefined}
      className={clsx(VARIANT_CLASS[variant], className)}
    >
      <AlertCircleIcon className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-1 grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
        >
          <span aria-hidden className="text-lg leading-none">×</span>
        </button>
      )}
    </div>
  )
}
