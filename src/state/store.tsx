import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { v4 as uuid } from 'uuid'
import type { Match, Player, Settings } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { backend } from '../lib/storage/backend'
import { recomputeAll, type RecomputeResult } from '../lib/rating/recompute'
import { OWNER_EMAIL, supabase, supabaseEnabled } from '../lib/supabase/client'

interface StoreCtx {
  mode: 'local' | 'cloud'
  players: Player[]
  matches: Match[]
  settings: Settings
  recomputed: RecomputeResult
  loading: boolean
  session: Session | null
  canEdit: boolean
  signInWithEmail: (email: string) => Promise<void>
  signOut: () => Promise<void>
  addPlayer: (data: Omit<Player, 'id' | 'createdAt'>) => Promise<Player>
  updatePlayer: (p: Player) => Promise<void>
  removePlayer: (id: string) => Promise<void>
  addMatch: (data: Omit<Match, 'id'>) => Promise<Match>
  updateMatch: (m: Match) => Promise<void>
  removeMatch: (id: string) => Promise<void>
  updateSettings: (s: Settings) => Promise<void>
  refresh: () => Promise<void>
  resetAll: () => Promise<void>
}

const Ctx = createContext<StoreCtx | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [players, setPlayers] = useState<Player[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    if (!supabaseEnabled) return
    supabase!.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase!.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const canEdit = !supabaseEnabled || session?.user?.email === OWNER_EMAIL

  const refresh = useCallback(async () => {
    const { players, matches, settings } = await backend.getAll()
    setPlayers(players)
    setMatches(matches)
    setSettings(settings)
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
    if (!backend.subscribe) return
    const unsub = backend.subscribe(() => {
      refresh().catch(console.error)
    })
    return unsub
  }, [refresh])

  const recomputed = useMemo(
    () => recomputeAll(players, matches, settings),
    [players, matches, settings],
  )

  const requireEdit = () => {
    if (!canEdit) throw new Error('Read-only: sign in as the owner to make changes.')
  }

  const signInWithEmail = async (email: string) => {
    if (!supabaseEnabled) return
    const redirectTo = window.location.origin + window.location.pathname
    const { error } = await supabase!.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    })
    if (error) throw error
  }

  const signOut = async () => {
    if (supabaseEnabled) await supabase!.auth.signOut()
  }

  const addPlayer: StoreCtx['addPlayer'] = async (data) => {
    requireEdit()
    const player: Player = { ...data, id: uuid(), createdAt: new Date().toISOString() }
    await backend.putPlayer(player)
    setPlayers((prev) => [...prev, player])
    return player
  }

  const updatePlayer: StoreCtx['updatePlayer'] = async (p) => {
    requireEdit()
    await backend.putPlayer(p)
    setPlayers((prev) => prev.map((x) => (x.id === p.id ? p : x)))
  }

  const removePlayer: StoreCtx['removePlayer'] = async (id) => {
    requireEdit()
    await backend.deletePlayer(id)
    setPlayers((prev) => prev.filter((p) => p.id !== id))
    setMatches((prev) => prev.filter((m) => m.playerAId !== id && m.playerBId !== id))
  }

  const addMatch: StoreCtx['addMatch'] = async (data) => {
    requireEdit()
    const match: Match = { ...data, id: uuid() }
    await backend.putMatch(match)
    setMatches((prev) => [...prev, match])
    return match
  }

  const updateMatch: StoreCtx['updateMatch'] = async (m) => {
    requireEdit()
    await backend.putMatch(m)
    setMatches((prev) => prev.map((x) => (x.id === m.id ? m : x)))
  }

  const removeMatch: StoreCtx['removeMatch'] = async (id) => {
    requireEdit()
    await backend.deleteMatch(id)
    setMatches((prev) => prev.filter((x) => x.id !== id))
  }

  const updateSettings: StoreCtx['updateSettings'] = async (s) => {
    requireEdit()
    await backend.saveSettings(s)
    setSettings(s)
  }

  const resetAll: StoreCtx['resetAll'] = async () => {
    requireEdit()
    await backend.wipeAll()
    setPlayers([])
    setMatches([])
    setSettings(DEFAULT_SETTINGS)
  }

  const value: StoreCtx = {
    mode: backend.mode,
    players,
    matches,
    settings,
    recomputed,
    loading,
    session,
    canEdit,
    signInWithEmail,
    signOut,
    addPlayer,
    updatePlayer,
    removePlayer,
    addMatch,
    updateMatch,
    removeMatch,
    updateSettings,
    refresh,
    resetAll,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): StoreCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
