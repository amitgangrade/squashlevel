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
  wipeAll(): Promise<void>
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

const cloudBackend: Backend = {
  mode: 'cloud',
  async getAll() {
    const sb = supabase!
    const [pRes, mRes, sRes] = await Promise.all([
      sb.from('players').select('*'),
      sb.from('matches').select('*').order('date', { ascending: true }),
      sb.from('settings').select('*').eq('id', 'app').maybeSingle(),
    ])
    if (pRes.error) throw pRes.error
    if (mRes.error) throw mRes.error
    if (sRes.error) throw sRes.error
    const players = (pRes.data as PlayerRow[] | null ?? []).map(fromPlayerRow)
    const matches = (mRes.data as MatchRow[] | null ?? []).map(fromMatchRow)
    const settings = (sRes.data as SettingsRow | null)?.data ?? DEFAULT_SETTINGS
    return { players, matches, settings }
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
  },
  async wipeAll() {
    const sb = supabase!
    await sb.from('matches').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await sb.from('players').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await sb.from('settings').delete().neq('id', '_never_')
  },
  subscribe(onChange) {
    const ch = supabase!
      .channel('squashlevel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, onChange)
      .subscribe()
    return () => {
      supabase!.removeChannel(ch)
    }
  },
}

export const backend: Backend = supabase ? cloudBackend : localBackend
