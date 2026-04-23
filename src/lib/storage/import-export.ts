import { ExportSchema, type ExportData, type Match, type Player, type Settings } from '../../types'
import { getAllMatches, getAllPlayers, getSettings, replaceAll } from './db'

export async function buildExport(): Promise<ExportData> {
  const [players, matches, settings] = await Promise.all([
    getAllPlayers(),
    getAllMatches(),
    getSettings(),
  ])
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    players,
    matches,
    settings,
  }
}

export async function downloadExport(): Promise<void> {
  const data = await buildExport()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `squashlevel-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export interface ImportResult {
  players: Player[]
  matches: Match[]
  settings: Settings
}

export function parseImport(json: string): ImportResult {
  const raw = JSON.parse(json)
  const parsed = ExportSchema.parse(raw)
  return {
    players: parsed.players,
    matches: parsed.matches,
    settings: parsed.settings,
  }
}

export async function restoreFromJson(json: string): Promise<ImportResult> {
  const data = parseImport(json)
  await replaceAll(data.players, data.matches, data.settings)
  return data
}
