import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { v4 as uuid } from 'uuid'
import type { Match, Player, Profile, Settings } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { backend } from '../lib/storage/backend'
import { recomputeAll, type RecomputeResult } from '../lib/rating/recompute'
import { supabase, supabaseEnabled } from '../lib/supabase/client'
import { fromMatchRow, type MatchRow } from '../lib/supabase/mappers'
import {
  createProfileAndPlayer,
  fetchPlayerForUser,
  fetchProfile,
  updateProfile as updateProfileApi,
  type OnboardingInput,
} from '../lib/supabase/profile'

interface StoreCtx {
  mode: 'local' | 'cloud'
  players: Player[]
  matches: Match[]
  settings: Settings
  recomputed: RecomputeResult
  loading: boolean
  session: Session | null
  profile: Profile | null
  myPlayer: Player | null
  isAdmin: boolean
  needsOnboarding: boolean
  /** Pending matches the current user can confirm or dispute. */
  pendingForMe: Match[]
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  completeOnboarding: (input: OnboardingInput) => Promise<void>
  saveProfile: (p: Profile) => Promise<void>
  addPlayer: (data: Omit<Player, 'id' | 'createdAt'>) => Promise<Player>
  updatePlayer: (p: Player) => Promise<void>
  removePlayer: (id: string) => Promise<void>
  addMatch: (data: Omit<Match, 'id'>) => Promise<Match>
  updateMatch: (m: Match) => Promise<void>
  removeMatch: (id: string) => Promise<void>
  confirmMatch: (id: string, dispute?: boolean) => Promise<void>
  /** Idempotent: confirm any pending match older than 3 days. Safe to call from clients. */
  runAutoConfirmAged: () => Promise<number>
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
  const [profile, setProfile] = useState<Profile | null>(null)
  const [myPlayer, setMyPlayer] = useState<Player | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)

  useEffect(() => {
    if (!supabaseEnabled) {
      setProfileLoaded(true)
      return
    }
    supabase!.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase!.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabaseEnabled) return
    const userId = session?.user?.id
    if (!userId) {
      setProfile(null)
      setMyPlayer(null)
      setProfileLoaded(true)
      return
    }
    setProfileLoaded(false)
    Promise.all([fetchProfile(userId), fetchPlayerForUser(userId)])
      .then(([p, pl]) => {
        setProfile(p)
        setMyPlayer(pl)
      })
      .catch((err) => console.error('profile load failed', err))
      .finally(() => setProfileLoaded(true))
  }, [session?.user?.id])

  const isAdmin = !supabaseEnabled || !!profile?.isAdmin
  const needsOnboarding = supabaseEnabled && !!session?.user && profileLoaded && !profile

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

  // Only confirmed matches affect ratings. Local-mode matches without a status
  // are treated as confirmed (legacy behaviour).
  const ratedMatches = useMemo(
    () => matches.filter((m) => !m.status || m.status === 'confirmed'),
    [matches],
  )

  const recomputed = useMemo(
    () => recomputeAll(players, ratedMatches, settings),
    [players, ratedMatches, settings],
  )

  // Pending matches awaiting MY action (I'm the opponent — i.e., not the recorder).
  const pendingForMe = useMemo(() => {
    if (!session?.user || !myPlayer) return []
    const myUserId = session.user.id
    return matches
      .filter((m) => m.status === 'pending')
      .filter((m) => m.playerAId === myPlayer.id || m.playerBId === myPlayer.id)
      .filter((m) => m.createdBy !== myUserId) // can't confirm matches you logged
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  }, [matches, myPlayer, session?.user])

  const requireAdmin = () => {
    if (!isAdmin) throw new Error('Admin only.')
  }
  const requireSignedIn = () => {
    if (supabaseEnabled && !session?.user) throw new Error('Sign in to make changes.')
  }

  const signInWithGoogle = async () => {
    if (!supabaseEnabled) return
    const redirectTo = window.location.origin + window.location.pathname
    const { error } = await supabase!.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (error) throw error
  }

  const signOut = async () => {
    if (supabaseEnabled) await supabase!.auth.signOut()
  }

  const completeOnboarding = async (input: OnboardingInput) => {
    if (!session?.user) throw new Error('Not signed in')
    const { profile: p, player } = await createProfileAndPlayer(session.user.id, input)
    setProfile(p)
    setMyPlayer(player)
    await refresh()
  }

  const saveProfile = async (p: Profile) => {
    const updated = await updateProfileApi(p)
    setProfile(updated)
  }

  const addPlayer: StoreCtx['addPlayer'] = async (data) => {
    requireAdmin()
    const player: Player = { ...data, id: uuid(), createdAt: new Date().toISOString() }
    await backend.putPlayer(player)
    setPlayers((prev) => [...prev, player])
    return player
  }

  const updatePlayer: StoreCtx['updatePlayer'] = async (p) => {
    if (!isAdmin && !(myPlayer && myPlayer.id === p.id)) throw new Error('You can only edit your own player.')
    await backend.putPlayer(p)
    setPlayers((prev) => prev.map((x) => (x.id === p.id ? p : x)))
    if (myPlayer && myPlayer.id === p.id) setMyPlayer(p)
  }

  const removePlayer: StoreCtx['removePlayer'] = async (id) => {
    requireAdmin()
    await backend.deletePlayer(id)
    setPlayers((prev) => prev.filter((p) => p.id !== id))
    setMatches((prev) => prev.filter((m) => m.playerAId !== id && m.playerBId !== id))
  }

  const addMatch: StoreCtx['addMatch'] = async (data) => {
    requireSignedIn()
    if (supabaseEnabled && !isAdmin) {
      const meId = myPlayer?.id
      if (!meId || (data.playerAId !== meId && data.playerBId !== meId)) {
        throw new Error('You can only log matches you played in.')
      }
    }
    const draft: Match = { ...data, id: uuid() }
    // The cloud backend returns the canonical row — including any
    // trigger-applied fields like status='confirmed' / auto_confirmed=true.
    const saved = await backend.putMatch(draft)
    setMatches((prev) => [...prev, saved])
    if (supabaseEnabled) {
      supabase!.functions
        .invoke('send-match-email', { body: { matchId: saved.id } })
        .catch((err) => console.warn('send-match-email failed:', err))
    }
    return saved
  }

  const updateMatch: StoreCtx['updateMatch'] = async (m) => {
    requireAdmin()
    await backend.putMatch(m)
    setMatches((prev) => prev.map((x) => (x.id === m.id ? m : x)))
  }

  const removeMatch: StoreCtx['removeMatch'] = async (id) => {
    requireAdmin()
    await backend.deleteMatch(id)
    setMatches((prev) => prev.filter((x) => x.id !== id))
  }

  const confirmMatch: StoreCtx['confirmMatch'] = async (id, dispute = false) => {
    if (!supabaseEnabled) throw new Error('Confirmation requires cloud sync.')
    const { data, error } = await supabase!.rpc('confirm_match', { target_id: id, dispute })
    if (error) throw error
    if (data) {
      const updated = fromMatchRow(data as MatchRow)
      setMatches((prev) => prev.map((m) => (m.id === id ? updated : m)))
    }
  }

  const runAutoConfirmAged: StoreCtx['runAutoConfirmAged'] = async () => {
    if (!supabaseEnabled) return 0
    const { data, error } = await supabase!.rpc('auto_confirm_aged_matches')
    if (error) {
      console.warn('auto_confirm_aged_matches failed:', error)
      return 0
    }
    return Number(data ?? 0)
  }

  const updateSettings: StoreCtx['updateSettings'] = async (s) => {
    requireAdmin()
    await backend.saveSettings(s)
    setSettings(s)
  }

  const resetAll: StoreCtx['resetAll'] = async () => {
    requireAdmin()
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
    profile,
    myPlayer,
    isAdmin,
    needsOnboarding,
    pendingForMe,
    signInWithGoogle,
    signOut,
    completeOnboarding,
    saveProfile,
    addPlayer,
    updatePlayer,
    removePlayer,
    addMatch,
    updateMatch,
    removeMatch,
    confirmMatch,
    runAutoConfirmAged,
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
