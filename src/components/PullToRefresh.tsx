import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'

interface Props {
  onRefresh: () => Promise<void> | void
  children: ReactNode
  /** Pixels the user must drag before the refresh fires. */
  threshold?: number
  /** Disable on screens above this width (px). Defaults to 640 (Tailwind sm). */
  desktopBreakpoint?: number
}

/**
 * Lightweight pull-to-refresh wrapper. Active only when the page is scrolled to
 * the very top and only on touch screens. Renders an inline indicator that
 * grows as the user pulls; on release past `threshold` it calls `onRefresh`.
 *
 * Intentionally minimal — no momentum, no fancy curves. The aim is "feels
 * native enough" without adding a dependency.
 */
export function PullToRefresh({ onRefresh, children, threshold = 70, desktopBreakpoint = 640 }: Props) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const enabled = useRef(false)

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (window.innerWidth >= desktopBreakpoint) return
      if (window.scrollY > 0) return
      enabled.current = true
      startY.current = e.touches[0]?.clientY ?? null
    }
    const onMove = (e: TouchEvent) => {
      if (!enabled.current || startY.current == null || refreshing) return
      const dy = (e.touches[0]?.clientY ?? 0) - startY.current
      if (dy <= 0) {
        setPull(0)
        return
      }
      // Resistance curve — feels less rubber-bandy.
      setPull(Math.min(dy / 1.6, threshold * 1.6))
    }
    const onEnd = async () => {
      if (!enabled.current) return
      enabled.current = false
      const dy = pull
      if (dy >= threshold && !refreshing) {
        setRefreshing(true)
        try {
          await onRefresh()
        } finally {
          setRefreshing(false)
        }
      }
      setPull(0)
      startY.current = null
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [pull, threshold, desktopBreakpoint, onRefresh, refreshing])

  const showIndicator = pull > 0 || refreshing
  const triggered = pull >= threshold

  return (
    <div className="relative">
      {showIndicator && (
        <div
          className="absolute left-0 right-0 -top-1 flex justify-center pointer-events-none"
          style={{ transform: `translateY(${refreshing ? threshold : pull}px)` }}
        >
          <div
            className={clsx(
              'h-7 w-7 rounded-full border-2 border-slate-300 dark:border-slate-700 transition-colors',
              (triggered || refreshing) && 'border-t-brand-600 animate-spin',
            )}
          />
        </div>
      )}
      <div
        style={refreshing ? { transform: `translateY(${threshold}px)`, transition: 'transform 0.2s' } : pull > 0 ? { transform: `translateY(${pull}px)` } : undefined}
      >
        {children}
      </div>
    </div>
  )
}
