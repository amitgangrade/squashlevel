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
 * leaderboard. Mobile-first: the hero should fit one phone screen with
 * the first leaderboard row peeking, so visitors learn what Boast is
 * AND see that real data exists underneath.
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
      className="rounded-2xl bg-gradient-to-br from-brand-50 via-white to-brand-50/60 ring-1 ring-brand-100 p-5 sm:p-8 dark:from-brand-900/20 dark:via-slate-950 dark:to-brand-900/10 dark:ring-brand-900/30"
    >
      <h1 className="!mb-0 text-2xl sm:text-4xl font-bold tracking-tight leading-tight">
        Real squash ratings.<br className="sm:hidden" />{' '}
        <span className="text-brand-700 dark:text-brand-300">Free forever.</span>
      </h1>

      <p className="mt-3 text-base sm:text-lg text-slate-600 dark:text-slate-300 max-w-2xl">
        Log matches with friends or your club. Watch your level update with every game — same algorithm as SquashLevels.com, no subscription.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary text-base px-5 py-2.5"
          onClick={onSignIn}
          disabled={busy}
        >
          {busy ? 'Signing in…' : 'Sign in with Google'}
        </button>
        <button
          type="button"
          onClick={onLearnMore}
          className="text-sm font-medium text-slate-700 hover:text-brand-700 dark:text-slate-300 dark:hover:text-brand-300 underline-offset-4 hover:underline"
        >
          How does the rating work? ↓
        </button>
      </div>

      {err && (
        <div className="mt-3 max-w-md">
          <Alert variant="error">{err}</Alert>
        </div>
      )}

      <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 max-w-3xl">
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
        <p className="mt-5 text-xs text-slate-500 dark:text-slate-400">
          Live leaderboard below — {playerCount.toLocaleString()} {playerCount === 1 ? 'player' : 'players'} rated.
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
    <li className="flex items-start gap-3 rounded-lg bg-white/70 dark:bg-slate-900/40 ring-1 ring-slate-200/70 dark:ring-slate-800 px-3 py-2.5">
      <span aria-hidden className="text-xl shrink-0 leading-none mt-0.5">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
          {children}
        </div>
      </div>
    </li>
  )
}
