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

/** Cursor-paginated fetch of every match. Used by rebuildLevels at scale —
 *  the unranged "select all + order by date" hits Supabase's 8s
 *  statement_timeout once the table is non-trivial, and offset-based pagination
 *  gets quadratic past a few thousand rows. Cursor on (date, id) is O(1) per
 *  page provided matches_date_idx exists (it does). Pages are deliberately
 *  small so each query finishes well under the timeout even on a busy DB. */
async function fetchAllMatchesByCursor(onProgress?: (loaded: number) => void): Promise<MatchRow[]> {
  const PAGE = 500
  const ATTEMPTS = 5
  const all: MatchRow[] = []
  let lastDate: string | null = null
  let lastId: string | null = null
  const isNetErr = (e: unknown) => e instanceof TypeError && /failed to fetch|network|aborted/i.test(e.message)
  // Hard ceiling on iterations as a paranoia stop in case something keeps
  // returning the same row (shouldn't happen with strict (date,id) cursor).
  for (let iter = 0; iter < 100_000; iter++) {
    let attempt = 0
    let pageData: MatchRow[] | null = null
    while (attempt < ATTEMPTS) {
      attempt++
      try {
        let q = supabase!
          .from('matches')
          .select('*')
          .order('date', { ascending: true })
          .order('id', { ascending: true })
          .limit(PAGE)
        if (lastDate !== null && lastId !== null) {
          q = q.or(`date.gt.${lastDate},and(date.eq.${lastDate},id.gt.${lastId})`)
        }
        const { data, error } = await q
        if (error) throw error
        pageData = (data ?? []) as MatchRow[]
        break
      } catch (e) {
        if (attempt >= ATTEMPTS || !isNetErr(e)) throw e
        const delay = Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 250)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
    if (!pageData || pageData.length === 0) break
    all.push(...pageData)
    onProgress?.(all.length)
    if (pageData.length < PAGE) break
    const last = pageData[pageData.length - 1]
    lastDate = last.date
    lastId = last.id
  }
  return all
}

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
    // Admin-only. Loads everything, runs the canonical rating algorithm, and
    // bulk-writes corrected level fields via two Postgres RPCs that accept
    // a JSON array and do the UPDATE in a single SQL statement. ~5–10 sec on
    // 300K matches; replaces the previous per-row UPDATE which was 30+ min.
    const sb = supabase!
    const report = (msg: string) => { try { onProgress?.(msg) } catch { /* ignore */ } }
    // Wrap each phase so callers can pinpoint which step failed; bare 500s
    // from PostgREST often have empty error bodies that decode to {}.
    const phase = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      try { return await fn() } catch (e) {
        const err = e as Record<string, unknown>
        const detail = (err && (err.message || err.details || err.hint || err.code))
          ? `${err.message ?? ''}${err.details ? ` — ${err.details}` : ''}${err.hint ? ` (hint: ${err.hint})` : ''}${err.code ? ` [code ${err.code}]` : ''}`
          : (() => { try { return JSON.stringify(err) } catch { return String(err) } })()
        const wrapped = new Error(`[${label}] ${detail || 'no detail'}`)
        // Attach the original for upstream consumers that read .message/.details.
        Object.assign(wrapped, err ?? {})
        throw wrapped
      }
    }
    report('Loading players, matches and settings…')
    const [players, matchRows, sRes] = await Promise.all([
      phase('fetchAll players', () => fetchAll<PlayerRow>('players')),
      phase('fetchAll matches (cursor)', () => fetchAllMatchesByCursor((n) => report(`Fetching matches… ${n.toLocaleString()} loaded`))),
      phase('fetch settings', async () => sb.from('settings').select('*').eq('id', 'app').maybeSingle()),
    ])
    if (sRes.error) throw sRes.error
    const settings = (sRes.data as SettingsRow | null)?.data ?? DEFAULT_SETTINGS
    report(`Loaded ${players.length.toLocaleString()} players and ${matchRows.length.toLocaleString()} matches. Computing levels…`)
    const playerObjs = players.map(fromPlayerRow)
    const matchObjs = matchRows.map(fromMatchRow)
    // Filter to the rated set used by recomputeAll (mirrors the store).
    const ratedMatches = matchObjs.filter((m) => !m.status || m.status === 'confirmed')
    const result = recomputeAll(playerObjs, ratedMatches, settings)

    // Pack into compact JSON (short keys to fit more rows under the 6 MB
    // request body limit). Field names match the RPC's jsonb_to_recordset
    // column list.
    const matchUpdates = result.matches.map((m) => ({
      id: m.id,
      lab: m.levelABefore ?? null,
      laa: m.levelAAfter  ?? null,
      lbb: m.levelBBefore ?? null,
      lba: m.levelBAfter  ?? null,
      da:  m.deltaA ?? null,
      db:  m.deltaB ?? null,
      pa:  m.provisionalA ?? null,
      pb:  m.provisionalB ?? null,
    }))
    const playerUpdates = playerObjs.map((p) => {
      const s = result.states.get(p.id)
      return {
        id: p.id,
        cl: s?.currentLevel ?? null,
        mp: s?.matchesPlayed ?? 0,
      }
    })

    // ~200 B/row × 1500 ≈ 300 KB; well under the 6 MB body limit and small
    // enough that each bulk UPDATE finishes comfortably under the function's
    // statement_timeout even on a loaded DB.
    const RPC_BATCH = 1500
    const RPC_PARALLEL = 4

    // Network blips on long-running rebuilds (proxy idle timeouts, transient
    // DNS/TLS hiccups) surface as TypeError: Failed to fetch. Each RPC batch
    // is idempotent — same input produces same DB state — so retry safely.
    const ATTEMPTS = 5
    const isRetryable = (e: unknown): boolean => {
      if (e instanceof TypeError) return /failed to fetch|network|aborted/i.test(e.message)
      const err = e as { message?: string; code?: string; status?: number }
      // Retry on PostgREST 5xx and Postgres connection-related codes.
      if (typeof err?.status === 'number' && err.status >= 500) return true
      if (err?.code && /^08/.test(String(err.code))) return true // SQLSTATE class 08 — connection exception
      return false
    }
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const callRpcWithRetry = async <U>(rpcName: 'apply_match_level_updates' | 'apply_player_level_updates', batch: U[], idx: number) => {
      let lastErr: unknown
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
          const { data, error } = await sb.rpc(rpcName, { updates: batch })
          if (error) throw error
          return Number(data ?? 0)
        } catch (e) {
          lastErr = e
          if (attempt === ATTEMPTS || !isRetryable(e)) throw e
          const delay = Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 250)
          report(`Batch ${idx} hit a transient error, retrying in ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1}/${ATTEMPTS})…`)
          await sleep(delay)
        }
      }
      throw lastErr
    }

    const runBatches = async <T>(
      rows: T[],
      rpc: 'apply_match_level_updates' | 'apply_player_level_updates',
      noun: string,
    ) => {
      let updated = 0
      const batches: T[][] = []
      for (let i = 0; i < rows.length; i += RPC_BATCH) batches.push(rows.slice(i, i + RPC_BATCH))
      const total = rows.length
      report(`Applying ${noun} updates… 0 / ${total.toLocaleString()}`)
      for (let bi = 0; bi < batches.length; bi += RPC_PARALLEL) {
        const slice = batches.slice(bi, bi + RPC_PARALLEL)
        await phase(`${rpc} batches ${bi}-${bi + slice.length - 1}`, () =>
          Promise.all(
            slice.map((batch, sliceIdx) =>
              callRpcWithRetry(rpc, batch, bi + sliceIdx).then((n) => { updated += n }),
            ),
          ),
        )
        const pct = total > 0 ? Math.round((updated / total) * 100) : 100
        report(`Applying ${noun} updates… ${updated.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`)
      }
      return updated
    }

    const matchesUpdated = await runBatches(matchUpdates, 'apply_match_level_updates', 'match')
    const playersUpdated = await runBatches(playerUpdates, 'apply_player_level_updates', 'player')
    report('Done.')
    return { matchesUpdated, playersUpdated }
  },
}

export const backend: Backend = supabase ? cloudBackend : localBackend
