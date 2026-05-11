import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { supabaseEnabled } from '../lib/supabase/client'
import { useStore } from '../state/store'
import { OnboardingModal } from './OnboardingModal'
import { IOSInstallHint } from './IOSInstallHint'
import { PlayerAvatar } from './PlayerAvatar'
import {
  CloseIcon,
  CogIcon,
  HistoryIcon,
  HomeIcon,
  LogoutIcon,
  MoreIcon,
  PlusIcon,
  UserIcon,
  UsersIcon,
} from './Icons'

const desktopNav = [
  { to: '/', label: 'Leaderboard', end: true },
  { to: '/clubs', label: 'Clubs' },
  { to: '/groups', label: 'Groups' },
  { to: '/history', label: 'History' },
  { to: '/log', label: 'Log match' },
]

export function Layout() {
  const { mode, session, profile, isAdmin, needsOnboarding, pendingForMe, incomingChallengeCount, signInWithGoogle, signOut } = useStore()
  // Combined "needs your action" count: matches awaiting your confirmation +
  // challenges incoming to you. Drives the Activity tab badge and the mobile
  // More-sheet button badge so a single number reflects everything in flight.
  const pendingCount = pendingForMe.length + incomingChallengeCount
  const [signInErr, setSignInErr] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()

  // Close the More sheet whenever the route changes.
  useEffect(() => setMoreOpen(false), [location.pathname])

  const onGoogle = async () => {
    setSignInErr(null)
    try {
      await signInWithGoogle()
    } catch (e) {
      setSignInErr((e as Error).message)
    }
  }

  const showFab = !!session && location.pathname !== '/log'

  return (
    <div className="min-h-full flex flex-col">
      {/* ============ Header ============ */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 pt-safe">
        <div className="mx-auto max-w-5xl flex items-center gap-2 px-3 sm:gap-4 sm:px-4 py-2 sm:py-3">
          <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="Boast home">
            <BoastMark />
            <div className="hidden sm:flex flex-col leading-tight">
              <span className="font-semibold text-sm tracking-tight">Boast</span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">Squash · Free forever</span>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden sm:flex flex-1 gap-1 overflow-x-auto -mx-1 px-1">
            {desktopNav.map((n) => (
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
            {session && (
              <NavLink
                to="/activity"
                className={({ isActive }) =>
                  clsx(
                    'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5',
                    isActive
                      ? 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                  )
                }
              >
                Activity
                {pendingCount > 0 && (
                  <span className="grid min-w-[18px] h-[18px] px-1 place-items-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            )}
            {isAdmin && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  clsx(
                    'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                  )
                }
              >
                Admin
              </NavLink>
            )}
          </nav>

          {/* Mobile spacer */}
          <div className="flex-1 sm:flex-none" />

          {/* Right side: user state */}
          {supabaseEnabled && (session ? (
            <UserPill profile={profile} email={session.user.email ?? ''} isAdmin={isAdmin} onMore={() => setMoreOpen(true)} />
          ) : (
            <button onClick={onGoogle} className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs sm:text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap min-h-[40px]">
              <GoogleGlyph />
              <span className="hidden xs:inline sm:inline">Sign in with Google</span>
              <span className="xs:hidden sm:hidden">Sign in</span>
            </button>
          ))}
        </div>
        {signInErr && <div className="mx-auto max-w-5xl px-4 pb-2 text-xs text-red-600">{signInErr}</div>}
      </header>

      {/* ============ Main content ============ */}
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-4 sm:py-6 pb-24 sm:pb-6">
        <Outlet />
      </main>

      {/* ============ Desktop footer ============ */}
      <footer className="hidden sm:block border-t border-slate-200 dark:border-slate-800 py-3 text-center text-xs text-slate-500">
        <span className="font-semibold text-slate-700 dark:text-slate-300">Boast</span>
        {' · '}Squash ratings, free forever
        {mode === 'local' && <span className="text-slate-400"> · running offline (local data only)</span>}
      </footer>

      {/* ============ Mobile bottom tab bar ============ */}
      {/* Rendered for everyone — signed-out phone users still need fast
          access to public views (Clubs / Groups / History) via the More
          sheet. The sheet itself adapts to signed-in/out state. */}
      <nav className="fixed inset-x-0 bottom-0 z-20 sm:hidden border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 pb-safe">
        <div className="mx-auto flex max-w-5xl items-stretch justify-around">
          <TabLink to="/" end icon={<HomeIcon className="h-5 w-5" />}>Home</TabLink>
          <TabLink to="/clubs" icon={<UsersIcon className="h-5 w-5" />}>Clubs</TabLink>
          <TabLink to="/groups" icon={<UsersIcon className="h-5 w-5" />}>Groups</TabLink>
          <button
            onClick={() => setMoreOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-1 py-2 text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 min-h-[56px] relative"
          >
            <span className="relative">
              <MoreIcon className="h-5 w-5" />
              {pendingCount > 0 && (
                <span className="absolute -top-1 -right-2 grid min-w-[16px] h-4 px-1 place-items-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                  {pendingCount}
                </span>
              )}
            </span>
            <span>More</span>
          </button>
        </div>
      </nav>

      {/* ============ Floating Action Button (Log match) ============ */}
      {showFab && (
        <Link
          to="/log"
          aria-label="Log match"
          className="fixed right-4 z-30 sm:hidden h-14 w-14 rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 grid place-items-center hover:bg-brand-700 active:scale-95 transition-transform"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 4.5rem)' }}
        >
          <PlusIcon className="h-7 w-7" />
        </Link>
      )}

      {/* ============ More sheet (mobile) ============ */}
      {moreOpen && (
        <MoreSheet
          signedIn={!!session}
          isAdmin={isAdmin}
          fullName={profile?.fullName}
          email={session?.user.email}
          pendingCount={pendingCount}
          onClose={() => setMoreOpen(false)}
          onSignIn={onGoogle}
          onSignOut={signOut}
        />
      )}

      {needsOnboarding && <OnboardingModal />}
      <IOSInstallHint />
    </div>
  )
}

function TabLink({ to, end, icon, children }: { to: string; end?: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          'flex-1 flex flex-col items-center justify-center gap-1 py-2 text-[11px] min-h-[56px] transition-colors',
          isActive ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100',
        )
      }
    >
      {icon}
      <span>{children}</span>
    </NavLink>
  )
}

function UserPill({
  profile,
  email,
  isAdmin,
  onMore,
}: {
  profile: { avatarUrl?: string; fullName?: string; username?: string } | null
  email: string
  isAdmin: boolean
  onMore: () => void
}) {
  return (
    <button
      onClick={onMore}
      className="flex items-center gap-2 rounded-full sm:rounded-md p-0.5 sm:px-2 sm:py-1 sm:border sm:border-slate-300 sm:hover:bg-slate-50 sm:dark:border-slate-700 sm:dark:hover:bg-slate-800"
      aria-label="Open user menu"
    >
      <div className="relative">
        <PlayerAvatar
          name={profile?.fullName ?? email}
          avatarUrl={profile?.avatarUrl}
          size={32}
        />
        {isAdmin && (
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-amber-400 dark:border-slate-950" aria-label="admin" />
        )}
      </div>
      <span className="hidden sm:inline text-xs">{profile?.fullName ?? email}</span>
      {isAdmin && <span className="hidden sm:inline rounded bg-amber-200 px-1 text-[10px] text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">admin</span>}
    </button>
  )
}

function MoreSheet({
  signedIn,
  isAdmin,
  fullName,
  email,
  pendingCount,
  onClose,
  onSignIn,
  onSignOut,
}: {
  signedIn: boolean
  isAdmin: boolean
  fullName?: string
  email?: string
  pendingCount: number
  onClose: () => void
  onSignIn: () => Promise<void>
  onSignOut: () => Promise<void>
}) {
  return (
    <div className="fixed inset-0 z-40" role="dialog">
      <button onClick={onClose} aria-label="Close menu" className="absolute inset-0 bg-slate-950/40" />
      <div className="absolute inset-x-0 bottom-0 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-80 bg-white dark:bg-slate-950 rounded-t-2xl sm:rounded-none border-t border-slate-200 dark:border-slate-800 pb-safe">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <div className="min-w-0">
            {signedIn ? (
              <>
                <div className="font-semibold truncate">{fullName ?? 'Account'}</div>
                {email && <div className="text-xs text-slate-500 truncate">{email}</div>}
              </>
            ) : (
              <>
                <div className="font-semibold">Browse Boast</div>
                <div className="text-xs text-slate-500">Sign in to log matches and track your level.</div>
              </>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <ul className="py-2">
          {!signedIn && (
            <li>
              <button
                onClick={onSignIn}
                className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-brand-700 dark:text-brand-300 hover:bg-slate-50 dark:hover:bg-slate-800 min-h-[48px]"
              >
                <span className="grid h-5 w-5 place-items-center"><GoogleGlyph /></span>
                Sign in with Google
              </button>
            </li>
          )}
          {signedIn && <SheetLink to="/profile" icon={<UserIcon className="h-5 w-5" />} label="My profile" />}
          {signedIn && (
            <SheetLink
              to="/activity"
              icon={<HistoryIcon className="h-5 w-5" />}
              label="Activity"
              badge={pendingCount > 0 ? pendingCount : undefined}
            />
          )}
          <SheetLink to="/clubs" icon={<UsersIcon className="h-5 w-5" />} label="Clubs" />
          <SheetLink to="/groups" icon={<UsersIcon className="h-5 w-5" />} label="Groups" />
          <SheetLink to="/history" icon={<HistoryIcon className="h-5 w-5" />} label="History" />
          {isAdmin && <SheetLink to="/admin" icon={<CogIcon className="h-5 w-5" />} label="Admin" />}
          {signedIn && (
            <li>
              <button
                onClick={onSignOut}
                className="flex w-full items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 min-h-[48px]"
              >
                <LogoutIcon className="h-5 w-5 text-slate-500" />
                Sign out
              </button>
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}

function SheetLink({ to, icon, label, badge }: { to: string; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <li>
      <NavLink to={to} className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 px-4 py-3 text-sm min-h-[48px]',
          isActive ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-200' : 'hover:bg-slate-50 dark:hover:bg-slate-800',
        )
      }>
        <span className="text-slate-500">{icon}</span>
        <span className="flex-1">{label}</span>
        {badge !== undefined && (
          <span className="grid min-w-[20px] h-5 px-1.5 place-items-center rounded-full bg-amber-500 text-[11px] font-bold text-white">
            {badge}
          </span>
        )}
      </NavLink>
    </li>
  )
}

function BoastMark() {
  // Charcoal tile · pro double-yellow-dot squash ball · "B" wordmark · tin strip.
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8 rounded-md shadow-sm" aria-hidden>
      <rect width="32" height="32" rx="6" fill="#111827" />
      <circle cx="23" cy="10" r="4" fill="#f5e000" />
      <circle cx="21.8" cy="9.2" r="0.5" fill="#111827" />
      <circle cx="24" cy="9.2" r="0.5" fill="#111827" />
      <text x="50%" y="24"
            textAnchor="middle"
            fontFamily="Inter, system-ui, -apple-system, sans-serif"
            fontWeight="900"
            fontSize="20"
            fill="#ffffff"
            letterSpacing="-1">
        B
      </text>
      <rect x="4" y="28" width="24" height="1.5" rx="0.75" fill="#e03a3a" />
    </svg>
  )
}

function GoogleGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 5.1 29.3 3 24 3 16.3 3 9.7 7.4 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.5-5.2l-6.2-5.3C29.2 35.9 26.7 37 24 37c-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.6 40.6 16.3 45 24 45z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.7 2.1-2.1 3.9-3.9 5.2l6.2 5.3C40.8 35 45 30 45 24c0-1.2-.1-2.4-.4-3.5z" />
    </svg>
  )
}
