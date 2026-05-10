import {
  DEFAULT_SETTINGS,
  type Challenge,
  type Club,
  type ClubAdmin,
  type Group,
  type GroupMember,
  type Match,
  type Player,
  type Profile,
  type Settings,
} from '../../types'
import { supabase } from '../supabase/client'
import {
  fromChallengeRow,
  fromClubAdminRow,
  fromClubRow,
  fromGroupMemberRow,
  fromGroupRow,
  fromMatchRow,
  fromPlayerRow,
  fromProfileRow,
  toChallengeRow,
  toClubAdminInsertRow,
  toClubRow,
  toGroupMemberRow,
  toGroupRow,
  toMatchRow,
  toPlayerRow,
  toProfileRow,
  type ChallengeRow,
  type ClubAdminRow,
  type ClubRow,
  type GroupMemberRow,
  type GroupRow,
  type MatchRow,
  type PlayerRow,
  type ProfileRow,
  type SettingsRow,
} from '../supabase/mappers'
import { recomputeAll } from '../rating/recompute'
import * as local from './db'

/**
 * Progress event fired by getEverything as it walks through each table.
 * `percent` is null while the total is unknown (e.g. before the matches
 * count comes back); otherwise 0-100.
 */
export interface ExportProgress {
  message: string
  percent: number | null
}

/**
 * Snapshot of every table that the backup/restore flow round-trips. Cloud
 * backend's getEverything returns this; replaceEverything writes it back.
 * Local backend stubs aux fields to empty arrays.
 */
export interface FullBackup {
  players: Player[]
  matches: Match[]
  settings: Settings
  profiles: Profile[]
  challenges: Challenge[]
  clubs: Club[]
  clubAdmins: ClubAdmin[]
  groups: Group[]
  groupMembers: GroupMember[]
}

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
  /** Fetch every table that participates in the full backup (cloud only —
   *  local mode returns players/matches/settings and empty aux arrays).
   *  `onProgress` fires repeatedly as work advances so the UI can render a
   *  progress bar. */
  getEverything(onProgress?: (event: ExportProgress) => void): Promise<FullBackup>
  /** Wipe and re-insert every table in the full backup. Profiles are upserted
   *  rather than deleted (they're tied to auth.users which we don't manage),
   *  so any signed-in user keeps their session. */
  replaceEverything(data: FullBackup): Promise<void>
  wipeAll(currentUserId?: string): Promise<void>
  subscribe?(onChange: () => void): () => void
  fetchMatchesPage(page: number, pageSize: number, playerId?: string): Promise<{ data: Match[]; count: number }>
  fetchRecentMatches(limit: number, playerIds?: string[]): Promise<Match[]>
  /** Lazy-load only the matches that need the signed-in user's attention:
   *  every pending match they're a participant in (whether they're the
   *  recorder waiting on an opponent, or the opponent who needs to confirm
   *  / dispute), plus every disputed match (all if `isAdmin`, else just
   *  their own). The store keeps the result in `matches` so the Activity
   *  page's pendingForMe / myPendingMatches / disputed selectors all read
   *  the right rows under cloud mode (where the full matches table isn't
   *  loaded). */
  fetchActionableMatches(myPlayerId: string, isAdmin: boolean): Promise<Match[]>
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
  // Local mode has no auxiliary tables — those are cloud-only constructs.
  // Round-trip the players/matches/settings; aux arrays are empty.
  async getEverything(onProgress) {
    onProgress?.({ message: 'Loading local data…', percent: 0 })
    const [players, matches, settings] = await Promise.all([
      local.getAllPlayers(),
      local.getAllMatches(),
      local.getSettings(),
    ])
    onProgress?.({ message: 'Done.', percent: 100 })
    return {
      players, matches, settings,
      profiles: [], challenges: [], clubs: [], clubAdmins: [], groups: [], groupMembers: [],
    }
  },
  async replaceEverything(data) {
    await local.replaceAll(data.players, data.matches, data.settings)
  },
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
  async fetchActionableMatches(myPlayerId, isAdmin) {
    // Local mode already loads the entire matches table on startup, so this
    // is just a filter — no extra round-trip.
    const all = await local.getAllMatches()
    const involvesMe = (m: Match) => m.playerAId === myPlayerId || m.playerBId === myPlayerId
    return all.filter((m) => {
      if (m.status === 'pending') return involvesMe(m)
      if (m.status === 'disputed') return isAdmin || involvesMe(m)
      return false
    })
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
 *  by first getting the total count, then firing parallel range requests.
 *  Optional `onProgress(done, total)` is called as each page lands so
 *  long-running fetches (e.g. exporting 300K matches) can show a real
 *  progress bar in the UI. */
async function fetchAll<T>(
  table: string,
  order?: { column: string; ascending: boolean },
  onProgress?: (rowsDone: number, totalRows: number) => void,
): Promise<T[]> {
  const PAGE = 1000
  const PARALLEL = 6  // concurrent requests to avoid overwhelming the server

  // 1. Get exact row count (head-only, no data transferred).
  const { count, error: cErr } = await supabase!
    .from(table)
    .select('*', { count: 'exact', head: true })
  if (cErr) throw cErr
  const total = count ?? 0
  if (total === 0) {
    onProgress?.(0, 0)
    return []
  }
  if (total <= PAGE) {
    // Fast path: single request.
    let q = supabase!.from(table).select('*')
    if (order) q = q.order(order.column, { ascending: order.ascending })
    const { data, error } = await q
    if (error) throw error
    const rows = (data ?? []) as T[]
    onProgress?.(rows.length, total)
    return rows
  }

  // 2. Build page descriptors [{ from, to }, …].
  const pages: { from: number; to: number }[] = []
  for (let from = 0; from < total; from += PAGE) {
    pages.push({ from, to: Math.min(from + PAGE - 1, total - 1) })
  }

  // 3. Fetch in parallel batches.
  const results: T[][] = new Array(pages.length)
  let rowsDone = 0
  for (let i = 0; i < pages.length; i += PARALLEL) {
    const batch = pages.slice(i, i + PARALLEL)
    await Promise.all(
      batch.map(({ from, to }, bi) => {
        let q = supabase!.from(table).select('*').range(from, to)
        if (order) q = q.order(order.column, { ascending: order.ascending })
        return q.then(({ data, error }) => {
          if (error) throw error
          const chunk = (data ?? []) as T[]
          results[i + bi] = chunk
          rowsDone += chunk.length
          onProgress?.(rowsDone, total)
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
  async getEverything(onProgress) {
    const sb = supabase!
    const report = (event: ExportProgress) => { try { onProgress?.(event) } catch {} }

    // Budget: small tables get the first 15% of the bar; matches occupy
    // 15-95%; final mapping/serialise gets the last 5%.
    const SMALL_TABLES_END = 15
    const MATCHES_END = 95

    // Fetch the small tables in parallel — they're fast.
    report({ message: 'Fetching players, profiles, settings, clubs, challenges, group memberships…', percent: 1 })
    const [players, profiles, sRes, clubs, clubAdmins, groups, groupMembers, challenges] = await Promise.all([
      fetchAll<PlayerRow>('players'),
      fetchAll<ProfileRow>('profiles'),
      sb.from('settings').select('*').eq('id', 'app').maybeSingle(),
      fetchAll<ClubRow>('clubs'),
      // club_admins doesn't include join columns by default — full_name and
      // email are absent on the bare row. We fill them in from the matched
      // profile so the export contains complete data for re-rendering.
      fetchAll<{ user_id: string; club_slug: string; granted_at: string; granted_by: string | null }>('club_admins'),
      fetchAll<GroupRow>('groups'),
      fetchAll<GroupMemberRow>('group_members'),
      fetchAll<ChallengeRow>('challenges'),
    ])
    if (sRes.error) throw sRes.error
    const settings = (sRes.data as SettingsRow | null)?.data ?? DEFAULT_SETTINGS
    report({ message: 'Small tables loaded.', percent: SMALL_TABLES_END })

    // Matches is the heavy one (100K+ rows for established projects). Fetch
    // separately with a per-page progress callback so the bar advances
    // smoothly while the long fetch is running.
    const { count: matchCount } = await sb.from('matches').select('*', { count: 'exact', head: true })
    const matches = await fetchAll<MatchRow>('matches', undefined, (rowsDone, totalRows) => {
      const fraction = totalRows > 0 ? rowsDone / totalRows : 1
      const percent = SMALL_TABLES_END + Math.round(fraction * (MATCHES_END - SMALL_TABLES_END))
      report({
        message: totalRows > 0
          ? `Fetching matches… ${rowsDone.toLocaleString()} / ${totalRows.toLocaleString()}`
          : 'Fetching matches…',
        percent,
      })
    })
    if (matchCount === 0) {
      report({ message: 'No matches to fetch.', percent: MATCHES_END })
    }
    report({ message: 'Building backup file…', percent: MATCHES_END + 2 })

    const profilesMapped = profiles.map(fromProfileRow)
    const profileById = new Map(profilesMapped.map((p) => [p.id, p]))

    const result: FullBackup = {
      players: players.map(fromPlayerRow),
      matches: matches.map(fromMatchRow),
      settings,
      profiles: profilesMapped,
      challenges: challenges.map(fromChallengeRow),
      clubs: clubs.map(fromClubRow),
      clubAdmins: clubAdmins.map((r) => fromClubAdminRow({
        user_id: r.user_id,
        club_slug: r.club_slug,
        granted_at: r.granted_at,
        // Fill from profile if available so the export self-describes.
        full_name: profileById.get(r.user_id)?.fullName ?? '',
        email: profileById.get(r.user_id)?.email ?? '',
      } as ClubAdminRow)),
      groups: groups.map(fromGroupRow),
      groupMembers: groupMembers.map(fromGroupMemberRow),
    }
    report({ message: 'Done.', percent: 100 })
    return result
  },
  /**
   * Wipe and re-insert every backed-up table. Order matters:
   *
   *   Delete (children → parents, FK-safe even without cascade):
   *     matches → group_members → groups → challenges → club_admins
   *     → players → clubs → settings
   *
   *   Insert (parents → children):
   *     settings → clubs → players → profiles (upsert) → club_admins
   *     → groups → group_members → challenges
   *
   * Profiles are upserted (not deleted) because they FK to auth.users which
   * we don't manage — deleting them risks signing the current user out.
   * Inserting players BEFORE profiles guarantees the
   * `ensure_player_for_profile` trigger on profile insert sees an existing
   * player row for that user_id and no-ops.
   */
  async replaceEverything(data) {
    _importing = true
    try {
      const sb = supabase!

      // ---- Wipe everything in one shot via server-side TRUNCATE ---------
      // Per-table client DELETEs hit PostgREST's default 8s statement_timeout
      // once matches grows to tens of thousands of rows. The RPC runs as
      // security definer with statement_timeout = 60s and TRUNCATEs every
      // import-managed table in a single statement.
      {
        const { error } = await sb.rpc('import_wipe_all')
        if (error) throw new Error(`wipe: ${error.message}`)
      }

      // ---- Insert in parent→child order ---------------------------------
      // 1. settings
      {
        const { error } = await sb
          .from('settings')
          .insert({ id: 'app', data: data.settings, updated_at: new Date().toISOString() })
        if (error) throw new Error(`insert settings: ${error.message}`)
      }

      // 2. clubs
      if (data.clubs.length > 0) {
        for (const batch of chunkArray(data.clubs.map(toClubRow), SUPABASE_BATCH)) {
          const { error } = await sb.from('clubs').insert(batch)
          if (error) throw new Error(`insert clubs: ${error.message}`)
        }
      }

      // 3. players
      for (const batch of chunkArray(data.players.map(toPlayerRow), SUPABASE_BATCH)) {
        const { error } = await sb.from('players').insert(batch)
        if (error) throw new Error(`insert players: ${error.message}`)
      }

      // 4. profiles — UPSERT to restore snapshot fields without disturbing the
      //    current user's auth.users row. The ensure_player_for_profile trigger
      //    sees players already exist (step 3) and no-ops on insert path; the
      //    sync_player_from_profile trigger fires on the update path and
      //    overwrites player identity fields with profile values, which is
      //    fine because both came from the same backup.
      if (data.profiles.length > 0) {
        for (const batch of chunkArray(data.profiles.map(toProfileRow), SUPABASE_BATCH)) {
          const { error } = await sb.from('profiles').upsert(batch, { onConflict: 'id' })
          if (error) throw new Error(`upsert profiles: ${error.message}`)
        }
      }

      // 5. club_admins
      if (data.clubAdmins.length > 0) {
        for (const batch of chunkArray(data.clubAdmins.map(toClubAdminInsertRow), SUPABASE_BATCH)) {
          const { error } = await sb.from('club_admins').insert(batch)
          if (error) throw new Error(`insert club_admins: ${error.message}`)
        }
      }

      // 6. groups
      if (data.groups.length > 0) {
        for (const batch of chunkArray(data.groups.map(toGroupRow), SUPABASE_BATCH)) {
          const { error } = await sb.from('groups').insert(batch)
          if (error) throw new Error(`insert groups: ${error.message}`)
        }
      }

      // 7. group_members
      if (data.groupMembers.length > 0) {
        for (const batch of chunkArray(data.groupMembers.map(toGroupMemberRow), SUPABASE_BATCH)) {
          const { error } = await sb.from('group_members').insert(batch)
          if (error) throw new Error(`insert group_members: ${error.message}`)
        }
      }

      // 8. matches — must come AFTER players so player FKs resolve.
      for (const batch of chunkArray(data.matches.map(toMatchRow), SUPABASE_BATCH)) {
        const { error } = await sb.from('matches').insert(batch)
        if (error) throw new Error(`insert matches: ${error.message}`)
      }

      // 9. challenges — last, so player FKs resolve.
      if (data.challenges.length > 0) {
        for (const batch of chunkArray(data.challenges.map(toChallengeRow), SUPABASE_BATCH)) {
          const { error } = await sb.from('challenges').insert(batch)
          if (error) throw new Error(`insert challenges: ${error.message}`)
        }
      }
    } finally {
      // Small delay lets any in-flight Realtime events drain before we
      // re-enable the debounced handler.
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
  async fetchActionableMatches(myPlayerId, isAdmin) {
    // Two parallel targeted queries: pending-where-I'm-a-participant, plus
    // disputed (all for admin, mine-only for everyone else). PostgREST can't
    // express the compound `(status='pending' AND mine) OR (status='disputed'
    // AND admin)` in one filter cleanly, and the row counts here are tiny
    // (handful at most) so a second round-trip is cheap.
    const sb = supabase!
    const meFilter = `player_a_id.eq.${myPlayerId},player_b_id.eq.${myPlayerId}`
    const pendingQ = sb.from('matches').select('*').eq('status', 'pending').or(meFilter)
    const disputedQ = isAdmin
      ? sb.from('matches').select('*').eq('status', 'disputed')
      : sb.from('matches').select('*').eq('status', 'disputed').or(meFilter)
    const [pendingRes, disputedRes] = await Promise.all([pendingQ, disputedQ])
    if (pendingRes.error) throw pendingRes.error
    if (disputedRes.error) throw disputedRes.error
    const rows = [
      ...((pendingRes.data ?? []) as MatchRow[]),
      ...((disputedRes.data ?? []) as MatchRow[]),
    ]
    return rows.map(fromMatchRow)
  },
  async rebuildLevels(onProgress) {
    // Admin-only. Chunked server-side rebuild: math in plpgsql, but split
    // across many short RPC calls so no individual call hits the edge proxy
    // timeout (~100 s on Supabase). State (in-progress player levels) lives
    // in level_rebuild_state between chunks. See supabase/schema.sql for the
    // three RPCs that drive this: _start, _chunk, _finalize.
    const sb = supabase!
    const report = (msg: string) => { try { onProgress?.(msg) } catch { /* ignore */ } }

    // Best-effort row count for a useful progress label.
    let totalMatches: number | null = null
    try {
      const { count } = await sb
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .or('status.is.null,status.eq.confirmed')
      totalMatches = count ?? null
    } catch {
      // Non-fatal — will fall back to "X processed" if count fails.
    }

    // Network-blip retry helper. Each individual RPC is idempotent enough
    // that retrying is safe: _start truncates, _chunk advances by cursor (so
    // re-running the same cursor re-applies the same updates), _finalize is
    // an UPDATE … FROM that converges.
    const ATTEMPTS = 4
    const isRetryable = (e: unknown): boolean => {
      if (e instanceof TypeError) return /failed to fetch|network|aborted/i.test(e.message)
      const err = e as { message?: string; code?: string; status?: number }
      if (typeof err?.status === 'number' && err.status >= 500) return true
      if (err?.code && /^08/.test(String(err.code))) return true
      return false
    }
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const callRpc = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
      let lastErr: unknown
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
          const { data, error } = await sb.rpc(name, args)
          if (error) throw error
          return data as T
        } catch (e) {
          lastErr = e
          if (attempt === ATTEMPTS || !isRetryable(e)) throw e
          const delay = Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 250)
          report(`Transient error in ${name}, retrying in ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1}/${ATTEMPTS})…`)
          await sleep(delay)
        }
      }
      throw lastErr ?? new Error(`${name} failed`)
    }

    report('Initializing rebuild…')
    await callRpc<unknown>('rebuild_levels_start')

    // Chunk size is a tradeoff: bigger = fewer round-trips but each chunk
    // takes longer (risking the per-chunk statement_timeout). 10K matches at
    // typical rebuild speed (~2K-5K/s in plpgsql) is comfortably under a
    // minute even on a slow tier.
    const CHUNK = 10_000
    let cursor: { p_after_date: string | null; p_after_id: string | null } = {
      p_after_date: null,
      p_after_id: null,
    }
    let processed = 0
    type ChunkRow = { processed: number; next_after_date: string | null; next_after_id: string | null; done: boolean }
    while (true) {
      const data = await callRpc<ChunkRow | ChunkRow[]>('rebuild_levels_chunk', {
        ...cursor,
        p_limit: CHUNK,
      })
      const row = Array.isArray(data) ? data[0] : data
      processed += Number(row?.processed ?? 0)
      const pct = totalMatches && totalMatches > 0
        ? Math.min(100, Math.round((processed / totalMatches) * 100))
        : null
      report(
        totalMatches != null
          ? `Replaying matches… ${processed.toLocaleString()} / ${totalMatches.toLocaleString()}${pct != null ? ` (${pct}%)` : ''}`
          : `Replaying matches… ${processed.toLocaleString()} processed`,
      )
      if (row?.done) break
      cursor = {
        p_after_date: row?.next_after_date ?? null,
        p_after_id: row?.next_after_id ?? null,
      }
      // Defensive: if the cursor didn't advance, bail to avoid an infinite
      // loop. Means there's nothing left to do.
      if (Number(row?.processed ?? 0) === 0) break
    }

    report('Finalizing player levels…')
    const playersUpdated = await callRpc<number>('rebuild_levels_finalize')

    report('Done.')
    return {
      matchesUpdated: processed,
      playersUpdated: Number(playersUpdated ?? 0),
    }
  },
}

export const backend: Backend = supabase ? cloudBackend : localBackend
