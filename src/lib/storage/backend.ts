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
  putMatch(m: Match): Promise<void>
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
  putMatch: local.putMatch,
  deleteMatch: local.deleteMatch,
  saveSettings: local.saveSettings,
  replaceAll: local.replaceAll,
  wipeAll: local.wipeAll,
}

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
    const { error } = await supabase!.from('matches').upsert(toMatchRow(m))
    if (error) throw error
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
    if (players.length) {
      const { error } = await sb.from('players').insert(players.map(toPlayerRow))
      if (error) throw error
    }
    if (matches.length) {
      const { error } = await sb.from('matches').insert(matches.map(toMatchRow))
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
