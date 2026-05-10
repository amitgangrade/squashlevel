import { ExportSchema, type ExportData } from '../../types'
import { backend, type ExportProgress, type FullBackup } from './backend'

export type { ExportProgress } from './backend'

/**
 * Builds a v2 export — full backup of every table that the import flow can
 * round-trip. Cloud mode includes profiles / challenges / clubs /
 * club_admins / groups / group_members. Local mode only has players,
 * matches, settings; aux arrays are present but empty.
 */
export async function buildExport(onProgress?: (event: ExportProgress) => void): Promise<ExportData> {
  const data = await backend.getEverything(onProgress)
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    players: data.players,
    matches: data.matches,
    settings: data.settings,
    profiles: data.profiles,
    challenges: data.challenges,
    clubs: data.clubs,
    clubAdmins: data.clubAdmins,
    groups: data.groups,
    groupMembers: data.groupMembers,
  }
}

export async function downloadExport(onProgress?: (event: ExportProgress) => void): Promise<void> {
  const data = await buildExport(onProgress)
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `boast-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export type ImportResult = FullBackup

/**
 * Parse an export file. Accepts both v1 (players + matches + settings only)
 * and v2 (full backup). v1 files restore correctly because the auxiliary
 * tables on the schema simply default to whatever was already there at
 * import time — except they're wiped first, so they end up empty after a
 * v1 import. That's not a regression: v1 export couldn't capture aux
 * tables anyway.
 */
export function parseImport(json: string): ImportResult {
  const raw = JSON.parse(json)
  const parsed = ExportSchema.parse(raw)
  return {
    players: parsed.players,
    matches: parsed.matches,
    settings: parsed.settings,
    profiles: parsed.profiles ?? [],
    challenges: parsed.challenges ?? [],
    clubs: parsed.clubs ?? [],
    clubAdmins: parsed.clubAdmins ?? [],
    groups: parsed.groups ?? [],
    groupMembers: parsed.groupMembers ?? [],
  }
}

export async function restoreFromJson(json: string): Promise<ImportResult> {
  const data = parseImport(json)
  await backend.replaceEverything(data)
  return data
}
