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
import { recomputeAll } from '../rating/recompute'
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
  fetchMatchesPage(page: number, pageSize: number, playerId?: string): Promise<{ data: Match[]; count: number }>
  fetchRecentMatches(limit: number, playerIds?: string[]): Promise<Match[]>
  /** Re-runs the rating algorithm over every rated match in date order, then
   *  bulk-writes the corrected level fields onto matches and players. Admin-only.
   *  Used to correct drift after edits/deletes/disputes.
   *  `onProgress` is called whenever a phase advances (counts, RPC batches),
   *  so the caller can render live status. */
  rebuildLevels(onProgress?: (msg: string) => void): Promise<{ matchesUpdated: number; playersUpdated: number }>
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
  async fetchMatchesPage(page, pageSize, playerId) {
    let all = await local.getAllMatches()
    if (playerId) {
      all = all.filter(m => m.playerAId === playerId || m.playerBId === playerId)
    }
    all.sort((a, b) => b.date.localeCompare(a.date))
    return { data: all.slice(page * pageSize, (page + 1) * pageSize), count: all.length }
  },
  async fetchRecentMatches(limit, playerIds) {
    let all = await local.getAllMatches()
    if (playerIds && playerIds.length > 0) {
      all = all.filter(m => playerIds.includes(m.playerAId) || playerIds.includes(m.playerBId))
    }
    all.sort((a, b) => b.date.localeCompare(a.date))
    return all.slice(0, limit)
  },
  async rebuildLevels(onProgress) {
    onProgress?.('Loading data…')
    const players = await local.getAllPlayers()
    const matches = await local.getAllMatches()
    const settings = await local.getSettings()
    onProgress?.(`Computing levels for ${matches.length.toLocaleString()} matches…`)
    const result = recomputeAll(players, matches, settings)
    let done = 0
    for (const m of result.matches) {
      await local.putMatch(m)
      done++
      if (done % 50 === 0) onProgress?.(`Writing match updates… ${done.toLocaleString()} / ${result.matches.length.toLocaleString()}`)
    }
    onProgress?.('Done.')
    return { matchesUpdated: result.matches.length, playersUpdated: players.length }
  },
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
    await Promise.all(
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
    const [players, sRes] = await Promise.all([
      fetchAll<PlayerRow>('players'),
      sb.from('settings').select('*').eq('id', 'app').maybeSingle(),
    ])
    if (sRes.error) throw sRes.error
    const settings = (sRes.data as SettingsRow | null)?.data ?? DEFAULT_SETTINGS
    return {
      players: players.map(fromPlayerRow),
      matches: [], // Lazy load matches instead of loading all 300K
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
  async fetchMatchesPage(page, pageSize, playerId) {
    let q = supabase!.from('matches').select('*', { count: 'exact' })
    if (playerId) {
      q = q.or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
    }
    const from = page * pageSize
    const to = from + pageSize - 1
    const { data, count, error } = await q.order('date', { ascending: false }).range(from, to)
    if (error) throw error
    return { data: (data as MatchRow[]).map(fromMatchRow), count: count ?? 0 }
  },
  async fetchRecentMatches(limit, playerIds) {
    let q = supabase!.from('matches').select('*')
    if (playerIds && playerIds.length > 0) {
      const qs = playerIds.map(id => `player_a_id.eq.${id},player_b_id.eq.${id}`).join(',')
      q = q.or(qs)
    }
    const { data, error } = await q.order('date', { ascending: false }).limit(limit)
    if (error) throw error
    return (data as MatchRow[]).map(fromMatchRow)
  },
  async rebuildLevels(onProgress) {
    // Admin-only. The rebuild now runs entirely server-side via the
    // rebuild_all_levels() RPC: math is in plpgsql, no per-row HTTP traffic,
    // single transaction, no statement timeout. The client just kicks it off
    // and waits.
    const sb = supabase!
    const report = (msg: string) => { try { onProgress?.(msg) } catch { /* ignore */ } }

    // Quick row count up front so we can show a useful "X matches" estimate.
    // head:true on a covered table is fast even at 300K+.
    let totalMatches: number | null = null
    try {
      const { count } = await sb.from('matches').select('*', { count: 'exact', head: true })
      totalMatches = count ?? null
    } catch {
      // Non-fatal — we'll fall back to a generic message.
    }
    const eta = totalMatches != null ? `, ~${Math.max(5, Math.ceil(totalMatches / 15_000))}s` : ''
    report(
      totalMatches != null
        ? `Rebuilding levels for ${totalMatches.toLocaleString()} matches${eta}…`
        : 'Rebuilding levels server-side…',
    )

    // The RPC owns retry semantics implicitly — it's a single statement and
    // either completes or rolls back. Network-level failures (proxy drop,
    // browser timeout) DO need handling though: the server may have committed
    // even though the client didn't see the response. Idempotent on retry.
    const ATTEMPTS = 3
    const isRetryable = (e: unknown): boolean => {
      if (e instanceof TypeError) return /failed to fetch|network|aborted/i.test(e.message)
      const err = e as { message?: string; code?: string; status?: number }
      if (typeof err?.status === 'number' && err.status >= 500) return true
      if (err?.code && /^08/.test(String(err.code))) return true
      return false
    }
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    let result: { matches_updated: number; players_updated: number } | null = null
    let lastErr: unknown
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const { data, error } = await sb.rpc('rebuild_all_levels')
        if (error) throw error
        // RPC returns a single-row table; supabase-js unwraps to an array.
        const row = Array.isArray(data) ? data[0] : data
        result = row as { matches_updated: number; players_updated: number }
        break
      } catch (e) {
        lastErr = e
        if (attempt === ATTEMPTS || !isRetryable(e)) throw e
        const delay = Math.min(2000 * 2 ** (attempt - 1), 10_000)
        report(`Transient error during rebuild, retrying in ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1}/${ATTEMPTS})…`)
        await sleep(delay)
      }
    }
    if (!result) throw lastErr ?? new Error('rebuild failed')

    report('Done.')
    return {
      matchesUpdated: Number(result.matches_updated ?? 0),
      playersUpdated: Number(result.players_updated ?? 0),
    }
  },
}

export const backend: Backend = supabase ? cloudBackend : localBackend
