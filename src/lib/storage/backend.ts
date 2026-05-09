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
   *  Used to correct drift after edits/deletes/disputes. */
  rebuildLevels(): Promise<{ matchesUpdated: number; playersUpdated: number }>
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
  async rebuildLevels() {
    const players = await local.getAllPlayers()
    const matches = await local.getAllMatches()
    const settings = await local.getSettings()
    const result = recomputeAll(players, matches, settings)
    for (const m of result.matches) await local.putMatch(m)
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
  async rebuildLevels() {
    // Admin-only. Loads everything, runs the canonical rating algorithm, and
    // bulk-writes corrected level fields back to matches + players. The
    // matches AFTER trigger fires for each updated row but updates with
    // unchanged-status are no-ops on the players table; we explicitly set
    // current_level / matches_played afterwards from the recompute result.
    const sb = supabase!
    const [players, matchRows, sRes] = await Promise.all([
      fetchAll<PlayerRow>('players'),
      fetchAll<MatchRow>('matches', { column: 'date', ascending: true }),
      sb.from('settings').select('*').eq('id', 'app').maybeSingle(),
    ])
    if (sRes.error) throw sRes.error
    const settings = (sRes.data as SettingsRow | null)?.data ?? DEFAULT_SETTINGS
    const playerObjs = players.map(fromPlayerRow)
    const matchObjs = matchRows.map(fromMatchRow)
    // Filter to the rated set used by recomputeAll (mirrors the store).
    const ratedMatches = matchObjs.filter((m) => !m.status || m.status === 'confirmed')
    const result = recomputeAll(playerObjs, ratedMatches, settings)

    // Per-row UPDATE — can't use upsert here because that runs INSERT first,
    // which would trip NOT NULL on date/player_a_id/etc. since our payload
    // only carries the level fields. Patches in parallel batches.
    const matchUpdates = result.matches.map((m) => ({
      id: m.id,
      patch: {
        level_a_before: m.levelABefore ?? null,
        level_a_after:  m.levelAAfter  ?? null,
        level_b_before: m.levelBBefore ?? null,
        level_b_after:  m.levelBAfter  ?? null,
        delta_a: m.deltaA ?? null,
        delta_b: m.deltaB ?? null,
        provisional_a: m.provisionalA ?? null,
        provisional_b: m.provisionalB ?? null,
      },
    }))
    let matchesUpdated = 0
    const M_PARALLEL = 8
    for (let i = 0; i < matchUpdates.length; i += M_PARALLEL) {
      const batch = matchUpdates.slice(i, i + M_PARALLEL)
      await Promise.all(
        batch.map((u) =>
          sb.from('matches').update(u.patch).eq('id', u.id).then(({ error }) => {
            if (error) throw error
            matchesUpdated += 1
          }),
        ),
      )
    }

    // Now reset players' current_level / matches_played from the recompute
    // states. We update one at a time since there's no bulk patch in REST.
    let playersUpdated = 0
    const updates: Array<{ id: string; current_level: number | null; matches_played: number }> = []
    for (const p of playerObjs) {
      const s = result.states.get(p.id)
      updates.push({
        id: p.id,
        current_level: s?.currentLevel ?? null,
        matches_played: s?.matchesPlayed ?? 0,
      })
    }
    // Patch in parallel batches.
    const PARALLEL = 6
    for (let i = 0; i < updates.length; i += PARALLEL) {
      const batch = updates.slice(i, i + PARALLEL)
      await Promise.all(
        batch.map((u) =>
          sb.from('players')
            .update({ current_level: u.current_level, matches_played: u.matches_played })
            .eq('id', u.id)
            .then(({ error }) => {
              if (error) throw error
              playersUpdated += 1
            }),
        ),
      )
    }
    return { matchesUpdated, playersUpdated }
  },
}

export const backend: Backend = supabase ? cloudBackend : localBackend
