import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { v4 as uuid } from 'uuid'
import type { Match, Player, Settings } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import {
  deleteMatch as dbDeleteMatch,
  deletePlayer as dbDeletePlayer,
  getAllMatches,
  getAllPlayers,
  getSettings,
  putMatch,
  putPlayer,
  saveSettings,
  wipeAll,
} from '../lib/storage/db'
import { recomputeAll, type RecomputeResult } from '../lib/rating/recompute'

interface StoreCtx {
  players: Player[]
  matches: Match[]
  settings: Settings
  recomputed: RecomputeResult
  loading: boolean
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

  const refresh = useCallback(async () => {
    const [p, m, s] = await Promise.all([getAllPlayers(), getAllMatches(), getSettings()])
    setPlayers(p)
    setMatches(m)
    setSettings(s)
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  const recomputed = useMemo(
    () => recomputeAll(players, matches, settings),
    [players, matches, settings],
  )

  const addPlayer: StoreCtx['addPlayer'] = async (data) => {
    const player: Player = { ...data, id: uuid(), createdAt: new Date().toISOString() }
    await putPlayer(player)
    setPlayers((prev) => [...prev, player])
    return player
  }

  const updatePlayer: StoreCtx['updatePlayer'] = async (p) => {
    await putPlayer(p)
    setPlayers((prev) => prev.map((x) => (x.id === p.id ? p : x)))
  }

  const removePlayer: StoreCtx['removePlayer'] = async (id) => {
    await dbDeletePlayer(id)
    setPlayers((prev) => prev.filter((p) => p.id !== id))
  }

  const addMatch: StoreCtx['addMatch'] = async (data) => {
    const match: Match = { ...data, id: uuid() }
    await putMatch(match)
    setMatches((prev) => [...prev, match])
    return match
  }

  const updateMatch: StoreCtx['updateMatch'] = async (m) => {
    await putMatch(m)
    setMatches((prev) => prev.map((x) => (x.id === m.id ? m : x)))
  }

  const removeMatch: StoreCtx['removeMatch'] = async (id) => {
    await dbDeleteMatch(id)
    setMatches((prev) => prev.filter((x) => x.id !== id))
  }

  const updateSettings: StoreCtx['updateSettings'] = async (s) => {
    await saveSettings(s)
    setSettings(s)
  }

  const resetAll: StoreCtx['resetAll'] = async () => {
    await wipeAll()
    setPlayers([])
    setMatches([])
    setSettings(DEFAULT_SETTINGS)
  }

  const value: StoreCtx = {
    players,
    matches,
    settings,
    recomputed,
    loading,
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
