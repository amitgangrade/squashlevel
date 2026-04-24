import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import clsx from 'clsx'
import { supabaseEnabled } from '../lib/supabase/client'
import { useStore } from '../state/store'

const nav = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/roster', label: 'Players' },
  { to: '/log', label: 'Log match' },
  { to: '/history', label: 'History' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/settings', label: 'Settings' },
]

export function Layout() {
  const { mode, session, canEdit, signInWithEmail, signOut } = useStore()
  const [showSignIn, setShowSignIn] = useState(false)

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-brand-600 text-white grid place-items-center font-bold">S</div>
            <span className="font-semibold hidden sm:inline">SquashLevel</span>
          </div>
          <nav className="flex gap-1 overflow-x-auto flex-1 -mx-1 px-1">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  clsx(
                    'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          {supabaseEnabled && !canEdit && (
            <span className="hidden sm:inline text-xs rounded-md bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300 whitespace-nowrap">
              Read only
            </span>
          )}
          {supabaseEnabled && (
            session ? (
              <button onClick={signOut} className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap">
                Sign out
              </button>
            ) : (
              <button onClick={() => setShowSignIn(true)} className="text-xs rounded-md border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap">
                Sign in
              </button>
            )
          )}
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 dark:border-slate-800 py-3 text-center text-xs text-slate-500">
        SquashLevel · {mode === 'cloud' ? 'synced across your group' : 'local-first · your data stays in your browser'}
      </footer>
      {showSignIn && <SignInDialog onClose={() => setShowSignIn(false)} signIn={signInWithEmail} />}
    </div>
  )
}

function SignInDialog({
  onClose,
  signIn,
}: {
  onClose: () => void
  signIn: (email: string) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    try {
      await signIn(email)
      setSent(true)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-slate-950/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Owner sign in</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">×</button>
        </div>
        {sent ? (
          <div className="text-sm">
            <p className="mb-2">Magic link sent to <span className="font-medium">{email}</span>.</p>
            <p className="text-slate-500">Open it on this device to sign in.</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                className="input w-full"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
              <p className="mt-1 text-xs text-slate-500">We'll email you a link. Only the owner email can make changes.</p>
            </div>
            {err && <div className="text-sm text-red-600">{err}</div>}
            <button className="btn-primary w-full" disabled={loading} type="submit">
              {loading ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
