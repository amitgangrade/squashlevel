import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseEnabled } from '../lib/supabase/client'

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!supabaseEnabled) {
      setReady(true)
      return
    }
    supabase!.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase!.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!ready) {
    return <div className="min-h-full grid place-items-center text-slate-500">Loading…</div>
  }

  if (!supabaseEnabled || session) {
    return <>{children}</>
  }

  return <SignIn />
}

function SignIn() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    try {
      const redirectTo = window.location.origin + window.location.pathname
      const { error } = await supabase!.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo },
      })
      if (error) throw error
      setSent(true)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-full grid place-items-center p-6">
      <div className="card w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-brand-600 text-white grid place-items-center font-bold">S</div>
          <h1 className="text-xl">SquashLevel</h1>
        </div>
        {sent ? (
          <div className="text-sm">
            <p className="mb-2">Check your inbox — we sent a magic link to <span className="font-medium">{email}</span>.</p>
            <p className="text-slate-500">Click it to sign in. You can close this tab.</p>
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
              <p className="mt-1 text-xs text-slate-500">We'll email you a link. No password.</p>
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
