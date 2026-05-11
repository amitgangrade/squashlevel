import type { ReactNode } from 'react'
import clsx from 'clsx'
import { AlertCircleIcon } from './Icons'

interface Props {
  variant?: 'error' | 'info'
  children: ReactNode
  className?: string
}

/**
 * Inline alert with leading icon. Use for form/validation errors and
 * informational context blocks that need more weight than a slate paragraph.
 */
export function Alert({ variant = 'error', children, className }: Props) {
  return (
    <div role={variant === 'error' ? 'alert' : undefined} className={clsx(variant === 'error' ? 'alert-error' : 'alert-info', className)}>
      <AlertCircleIcon className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
