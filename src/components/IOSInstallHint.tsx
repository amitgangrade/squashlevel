import { useEffect, useState } from 'react'
import { CloseIcon, ShareIcon } from './Icons'

const STORAGE_KEY = 'sl_ios_install_dismissed_at'
const REPROMPT_AFTER_DAYS = 30

function isIOSSafari(): boolean {
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document)
  if (!isIOS) return false
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
  return isSafari
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  // iOS Safari uses the legacy navigator.standalone; everywhere else uses display-mode.
  const navAny = window.navigator as Navigator & { standalone?: boolean }
  if (navAny.standalone) return true
  return window.matchMedia?.('(display-mode: standalone)').matches ?? false
}

export function IOSInstallHint() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!isIOSSafari() || isStandalone()) return
    const dismissed = Number(localStorage.getItem(STORAGE_KEY) || 0)
    const cutoff = Date.now() - REPROMPT_AFTER_DAYS * 24 * 60 * 60 * 1000
    if (dismissed && dismissed > cutoff) return
    // Slight delay so it doesn't slam the user the moment they land.
    const t = setTimeout(() => setShow(true), 2000)
    return () => clearTimeout(t)
  }, [])

  if (!show) return null

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now()))
    setShow(false)
  }

  return (
    <div className="fixed left-3 right-3 z-30 sm:hidden bottom-safe" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5.5rem)' }}>
      <div className="card flex items-start gap-3 shadow-lg">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200 shrink-0">
          <ShareIcon className="h-5 w-5" />
        </div>
        <div className="flex-1 text-sm">
          <div className="font-medium">Add to Home Screen</div>
          <div className="text-xs text-slate-500 mt-0.5">
            Tap <ShareIcon className="inline h-3.5 w-3.5 -mt-0.5" /> Share, then <span className="font-medium">Add to Home Screen</span> for an app-like experience.
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="-m-1 grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
