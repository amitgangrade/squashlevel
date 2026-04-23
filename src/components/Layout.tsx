import { NavLink, Outlet } from 'react-router-dom'
import clsx from 'clsx'

const nav = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/roster', label: 'Players' },
  { to: '/log', label: 'Log match' },
  { to: '/history', label: 'History' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/settings', label: 'Settings' },
]

export function Layout() {
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
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 dark:border-slate-800 py-3 text-center text-xs text-slate-500">
        SquashLevel · local-first · your data stays in your browser
      </footer>
    </div>
  )
}
