import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { Player } from '../types'
import { useStore } from '../state/store'
import { searchPlayers } from '../lib/supabase/profile'
import { supabaseEnabled } from '../lib/supabase/client'
import { fmtLevel } from '../lib/format'
import { CloseIcon } from './Icons'
import { PlayerAvatar, playerSubtitle } from './PlayerAvatar'

interface Props {
  value: Player | null
  onChange: (p: Player | null) => void
  excludeId?: string
  placeholder?: string
  autoFocus?: boolean
  /**
   * Optional: when the typed query yields no results, render a "+ Add new
   * opponent" call-to-action that fires this callback with the typed name.
   * Used by the Log Match flow to create an unclaimed player on the fly.
   */
  onCreateUnclaimed?: (name: string) => void
  /**
   * Optional whitelist of player IDs the search is restricted to. When set,
   * server-side search results are filtered down to this set, and the local
   * fallback only considers these players. Used by the head-to-head picker
   * to limit choices to past opponents.
   */
  restrictToIds?: ReadonlySet<string>
}

/**
 * Typeahead opponent picker.
 * - Mobile: tapping the input opens a full-screen bottom sheet of results.
 * - Desktop: classic absolute-positioned dropdown directly under the input.
 *
 * Server-side ilike search when cloud is configured; falls back to client-side
 * filtering of the locally loaded roster otherwise. Result rows show avatar,
 * country, age and club so admins can pick the right same-named player.
 */
export function PlayerSearch({ value, onChange, excludeId, placeholder = 'Search by name…', autoFocus, onCreateUnclaimed, restrictToIds }: Props) {
  const { players, recomputed } = useStore()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Player[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 639px)').matches : false,
  )
  const wrapperRef = useRef<HTMLDivElement>(null)
  const sheetInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const onChange = () => setIsMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(async () => {
      // restrictToIds narrows the search to a known set (e.g. past opponents
      // in head-to-head). With restriction we do a local-only search since
      // the server doesn't know the set; we have all players in memory
      // anyway because the restriction implies a small bounded set.
      if (restrictToIds) {
        const ql = q.trim().toLowerCase()
        const tokens = ql.split(/\s+/).filter(Boolean)
        const filtered = players
          .filter((p) => p.id !== excludeId && restrictToIds.has(p.id))
          .filter((p) => tokens.length === 0 || tokens.every((t) => p.name.toLowerCase().includes(t)))
          .slice(0, 25)
        setResults(filtered)
      } else if (supabaseEnabled) {
        try {
          const r = await searchPlayers(q, 25)
          setResults(r.filter((p) => p.id !== excludeId))
        } catch (err) {
          console.error('player search failed', err)
        }
      } else {
        const ql = q.trim().toLowerCase()
        const tokens = ql.split(/\s+/).filter(Boolean)
        const filtered = players
          .filter((p) => p.id !== excludeId)
          .filter((p) => tokens.every((t) => p.name.toLowerCase().includes(t)))
          .slice(0, 25)
        setResults(filtered)
      }
      setHighlight(0)
    }, 150)
    return () => clearTimeout(t)
  }, [q, open, players, excludeId, restrictToIds])

  useEffect(() => {
    if (isMobile) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [isMobile])

  useEffect(() => {
    if (!open || !isMobile) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    sheetInputRef.current?.focus()
    return () => {
      document.body.style.overflow = prev
    }
  }, [open, isMobile])

  const choose = (p: Player) => {
    onChange(p)
    setQ('')
    setOpen(false)
  }

  // Selected display
  if (value) {
    const lvl = recomputed.states.get(value.id)?.currentLevel
    const sub = playerSubtitle(value)
    return (
      <div className="flex items-center gap-3 rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700">
        <PlayerAvatar name={value.name} avatarUrl={value.avatarUrl} size={36} />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{value.name}</div>
          <div className="text-xs text-slate-500 truncate">
            Lvl {fmtLevel(lvl ?? value.startingLevel)}
            {sub && <span className="ml-1">· {sub}</span>}
          </div>
        </div>
        <button type="button" className="btn-link" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    )
  }

  // Mobile sheet
  if (isMobile) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="input w-full text-left text-slate-500"
        >
          {placeholder}
        </button>
        {open && (
          <div className="fixed inset-0 z-40 flex flex-col bg-white dark:bg-slate-950">
            <div className="border-b border-slate-200 dark:border-slate-800 pt-safe">
              <div className="flex items-center gap-2 p-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="grid h-10 w-10 place-items-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <CloseIcon className="h-5 w-5" />
                </button>
                <input
                  ref={sheetInputRef}
                  className="input flex-1"
                  value={q}
                  placeholder={placeholder}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto pb-safe">
              {results.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500 space-y-2">
                  <div>{q.trim() ? 'No matches.' : 'Start typing a name…'}</div>
                  {onCreateUnclaimed && q.trim().length >= 2 && (
                    <button
                      type="button"
                      onClick={() => { onCreateUnclaimed(q.trim()); setOpen(false) }}
                      className="btn-secondary text-sm"
                    >
                      + Add "{q.trim()}" as a new player
                    </button>
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {results.map((p) => {
                    const lvl = recomputed.states.get(p.id)?.currentLevel ?? p.startingLevel
                    const sub = playerSubtitle(p)
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => choose(p)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 min-h-[60px]"
                        >
                          <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} size={40} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{p.name}</div>
                            {sub && <div className="text-xs text-slate-500 truncate">{sub}</div>}
                          </div>
                          <span className="text-sm text-slate-500 shrink-0">Lvl {fmtLevel(lvl)}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </>
    )
  }

  // Desktop dropdown
  return (
    <div ref={wrapperRef} className="relative">
      <input
        className="input w-full"
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlight((h) => Math.min(h + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const r = results[highlight]
            if (r) choose(r)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {results.map((p, i) => {
            const lvl = recomputed.states.get(p.id)?.currentLevel ?? p.startingLevel
            const sub = playerSubtitle(p)
            return (
              <li
                key={p.id}
                className={clsx(
                  'cursor-pointer px-3 py-2 text-sm flex items-center gap-3',
                  i === highlight ? 'bg-brand-100 dark:bg-brand-900/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800',
                )}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(p)
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{p.name}</div>
                  {sub && <div className="text-xs text-slate-500 truncate">{sub}</div>}
                </div>
                <span className="text-xs text-slate-500 shrink-0">Lvl {fmtLevel(lvl)}</span>
              </li>
            )
          })}
        </ul>
      )}
      {open && q.trim() && results.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-500 shadow dark:border-slate-700 dark:bg-slate-900 space-y-2">
          <div>No matches.</div>
          {onCreateUnclaimed && q.trim().length >= 2 && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onCreateUnclaimed(q.trim()); setOpen(false) }}
              className="btn-secondary text-sm w-full"
            >
              + Add "{q.trim()}" as a new player
            </button>
          )}
        </div>
      )}
    </div>
  )
}
