import { useState } from 'react'
import { useStore } from '../state/store'
import { Alert } from './Alert'

interface Props {
  /** Called when the user clicks "How does the rating work?". Caller is
   *  expected to open the existing LevelHelpPanel on the same page so the
   *  explainer lives in one place. */
  onLearnMore: () => void
  /** Number of players on the live leaderboard, shown as social proof. */
  playerCount: number
}

/**
 * Above-the-fold framing for first-time visitors. Only renders when the
 * user is signed out — returning/signed-in users go straight to the
 * leaderboard. Charcoal "court-floor" background with squash-ball-yellow
 * accents — leans into the brand identity defined in tailwind.config.js
 * (brand = charcoal, accent = pro double-yellow-dot ball, tin = court
 * tin red). Mobile-first: the hero should fit one phone screen with the
 * first leaderboard row peeking.
 */
export function SignedOutHero({ onLearnMore, playerCount }: Props) {
  const { signInWithGoogle } = useStore()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const onSignIn = async () => {
    setBusy(true)
    setErr(null)
    try {
      await signInWithGoogle()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label="What is Boast?"
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-700 to-brand-800 text-white p-5 sm:p-8 shadow-lg ring-1 ring-brand-600/40"
    >
      {/* Decorative pro double-yellow-dot squash ball, top-right corner.
          Hidden on small screens to keep the headline area uncluttered. */}
      <div aria-hidden className="hidden sm:flex absolute top-6 right-7 gap-1.5 opacity-80">
        <span className="h-2.5 w-2.5 rounded-full bg-accent-500 shadow-[0_0_12px_rgba(245,224,0,0.6)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-accent-500 shadow-[0_0_12px_rgba(245,224,0,0.6)]" />
      </div>

      <h1 className="!mb-0 text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05] text-white">
        Real squash ratings.<br className="sm:hidden" />{' '}
        <span className="text-accent-400">Free forever.</span>
      </h1>

      <p className="mt-3 sm:mt-4 text-base sm:text-lg text-slate-300 max-w-2xl">
        Log matches with friends or your club. Watch your level update with every game — same algorithm as SquashLevels.com, no subscription.
      </p>

      <div className="mt-5 sm:mt-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onSignIn}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-accent-500 hover:bg-accent-400 text-brand-900 font-semibold text-base px-5 py-2.5 shadow-md ring-1 ring-accent-600/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {busy ? 'Signing in…' : 'Sign in with Google'}
        </button>
        <button
          type="button"
          onClick={onLearnMore}
          className="text-sm font-medium text-slate-200 hover:text-accent-300 underline-offset-4 hover:underline"
        >
          How does the rating work? ↓
        </button>
      </div>

      {err && (
        <div className="mt-3 max-w-md">
          <Alert variant="error">{err}</Alert>
        </div>
      )}

      <ul className="mt-7 sm:mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 max-w-3xl">
        <FeatureTile icon="🏸" title="30-second match log">
          Pick your opponent, enter scores, done.
        </FeatureTile>
        <FeatureTile icon="📈" title="Live level updates">
          See exactly how each match moves your rating.
        </FeatureTile>
        <FeatureTile icon="👥" title="Clubs & private groups">
          Leaderboards for your court, league, or friend group.
        </FeatureTile>
        <FeatureTile icon="⚔️" title="Challenge friends">
          Send a challenge, log the match when it's done.
        </FeatureTile>
      </ul>

      {playerCount > 0 && (
        <p className="mt-6 text-xs text-slate-400 flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,0.7)] animate-pulse" />
          Live leaderboard below — <span className="text-slate-200 font-medium">{playerCount.toLocaleString()}</span> {playerCount === 1 ? 'player' : 'players'} rated.
        </p>
      )}
    </section>
  )
}

function FeatureTile({
  icon,
  title,
  children,
}: {
  icon: string
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-3 rounded-lg bg-brand-800/60 ring-1 ring-brand-600/40 px-3.5 py-3 transition-colors hover:bg-brand-800/80 hover:ring-accent-500/30">
      <span aria-hidden className="text-2xl shrink-0 leading-none mt-0.5">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-semibold text-sm text-white">{title}</div>
        <div className="text-xs text-slate-300 mt-0.5">
          {children}
        </div>
      </div>
    </li>
  )
}
