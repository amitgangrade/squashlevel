import { DEFAULT_SETTINGS, type Match, type Player, type Settings } from '../../types'
import { supabase } from '../supabase/client'
import {
  fromMatchRow,
  fromPlayerRow,
  toMatchRow,
  toPlayerRow,
  type MatchRow,
  type PlayerRow,
  type SettingsRow,
} from '../supabase/mappers'
import * as local from './db'

export interface Backend {
  mode: 'local' | 'cloud'
  getAll(): Promise<{ players: Player[]; matches: Match[]; settings: Settings }>
  putPlayer(p: Player): Promise<void>
  deletePlayer(id: string): Promise<void>
  /** Inserts/upserts a match. Returns the canonical row (with any trigger-applied
   *  fields like `status`/`confirmed_at`/`auto_confirmed`). */
  putMatch(m: Match): Promise<Match>
  deleteMatch(id: string): Promise<void>
  saveSettings(s: Settings): Promise<void>
  replaceAll(players: Player[], matches: Match[], settings: Settings): Promise<void>
  wipeAll(currentUserId?: string): Promise<void>
  subscribe?(onChange: () => void): () => void
}

const localBackend: Backend = {
  mode: 'local',
  async getAll() {
    const [players, matches, settings] = await Promise.all([
      local.getAllPlayers(),
      local.getAllMatches(),
      local.getSettings(),
    ])
    return { players, matches, settings }
  },
  putPlayer: local.putPlayer,
  deletePlayer: local.deletePlayer,
  async putMatch(m) {
    await local.putMatch(m)
    return m
  },
  deleteMatch: local.deleteMatch,
  saveSettings: local.saveSettings,
  replaceAll: local.replaceAll,
  wipeAll: local.wipeAll,
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const SUPABASE_BATCH = 500   // rows per insert; stays well under the 6 MB REST limit

// Set to true during replaceAll to silence Realtime events while batch-inserting.
// Without this, every 500-row insert fires onChange → getAll() → 600 parallel fetches.
let _importing = false

/** Supabase caps each query at 1 000 rows. This helper fetches all rows
 *  by first getting the total count, then firing parallel range requests. */
async function fetchAll<T>(
  table: string,
  order?: { column: string; ascending: boolean },
): Promise<T[]> {
  const PAGE = 1000
  const PARALLEL = 6  // concurrent requests to avoid overwhelming the server

  // 1. Get exact row count (head-only, no data transferred).
  const { count, error: cErr } = await supabase!
    .from(table)
    .select('*', { count: 'exact', head: true })
  if (cErr) throw cErr
  const total = count ?? 0
  if (total === 0) return []
  if (total <= PAGE) {
    // Fast path: single request.
    let q = supabase!.from(table).select('*')
    if (order) q = q.order(order.column, { ascending: order.ascending })
    const { data, error } = await q
    if (error) throw error
    return (data ?? []) as T[]
  }

  // 2. Build page descriptors [{ from, to }, …].
  const pages: { from: number; to: number }[] = []
  for (let from = 0; from < total; from += PAGE) {
    pages.push({ from, to: Math.min(from + PAGE - 1, total - 1) })
  }

  // 3. Fetch in parallel batches.
  const results: T[][] = new Array(pages.length)
  for (let i = 0; i < pages.length; i += PARALLEL) {
    const batch = pages.slice(i, i + PARALLEL)
    const batchResults = await Promise.all(
      batch.map(({ from, to }, bi) => {
        let q = supabase!.from(table).select('*').range(from, to)
        if (order) q = q.order(order.column, { ascending: order.ascending })
        return q.then(({ data, error }) => {
          if (error) throw error
          results[i + bi] = (data ?? []) as T[]
        })
      }),
    )
  }
  return results.flat()
}

const cloudBackend: Backend = {
  mode: 'cloud',
  async getAll() {
    const sb = supabase!
    const [players, matches, sRes] = await Promise.all([
      fetchAll<PlayerRow>('players'),
      fetchAll<MatchRow>('matches', { column: 'date', ascending: true }),
      sb.from('settings').select('*').eq('id', 'app').maybeSingle(),
    ])
    if (sRes.error) throw sRes.error
    const settings = (sRes.data as SettingsRow | null)?.data ?? DEFAULT_SETTINGS
    return {
      players: players.map(fromPlayerRow),
      matches: matches.map(fromMatchRow),
      settings,
    }
  },
  async putPlayer(p) {
    const { error } = await supabase!.from('players').upsert(toPlayerRow(p))
    if (error) throw error
  },
  async deletePlayer(id) {
    const { error } = await supabase!.from('players').delete().eq('id', id)
    if (error) throw error
  },
  async putMatch(m) {
    const { data, error } = await supabase!
      .from('matches')
      .upsert(toMatchRow(m))
      .select('*')
      .single()
    if (error) throw error
    return fromMatchRow(data as MatchRow)
  },
  async deleteMatch(id) {
    const { error } = await supabase!.from('matches').delete().eq('id', id)
    if (error) throw error
  },
  async saveSettings(s) {
    const { error } = await supabase!
      .from('settings')
      .upsert({ id: 'app', data: s, updated_at: new Date().toISOString() })
    if (error) throw error
  },
  async replaceAll(players, matches, settings) {
    _importing = true
    try {
      const sb = supabase!
      await sb.from('matches').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      await sb.from('players').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      await sb.from('settings').delete().neq('id', '_never_')
      for (const batch of chunkArray(players.map(toPlayerRow), SUPABASE_BATCH)) {
        const { error } = await sb.from('players').insert(batch)
        if (error) throw error
      }
      for (const batch of chunkArray(matches.map(toMatchRow), SUPABASE_BATCH)) {
        const { error } = await sb.from('matches').insert(batch)
        if (error) throw error
      }
      const { error } = await sb
        .from('settings')
        .insert({ id: 'app', data: settings, updated_at: new Date().toISOString() })
      if (error) throw error
    } finally {
      // Small delay lets any in-flight Realtime events drain before we re-enable
      // the debounced handler, so stray events from the last batch don't fire.
      await new Promise((r) => setTimeout(r, 1500))
      _importing = false
    }
  },
  async wipeAll(currentUserId?: string) {
    const sb = supabase!
    await sb.from('matches').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await sb.from('players').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await sb.from('settings').delete().neq('id', '_never_')
    // Also clear profiles so the Admins list doesn't show stale users.
    // Keep the current user's profile so they stay signed in as admin.
    if (currentUserId) {
      await sb.from('profiles').delete().neq('id', currentUserId)
    } else {
      await sb.from('profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    }
  },
  subscribe(onChange) {
    // Debounce: collapse rapid-fire events (e.g. back-to-back match inserts) into
    // one refresh. Also gates on _importing so bulk replaceAll doesn't trigger
    // hundreds of full-dataset fetches.
    let timer: ReturnType<typeof setTimeout> | null = null
    const debounced = () => {
      if (_importing) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(onChange, 600)
    }
    const ch = supabase!
      .channel('squashlevel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, debounced)
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase!.removeChannel(ch)
    }
  },
}

export const backend: Backend = supabase ? cloudBackend : localBackend
