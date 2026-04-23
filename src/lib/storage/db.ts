import { openDB, type IDBPDatabase } from 'idb'
import type { Match, Player, Settings } from '../../types'
import { DEFAULT_SETTINGS } from '../../types'

const DB_NAME = 'squashlevel'
const DB_VERSION = 1

interface Schema {
  players: { key: string; value: Player }
  matches: { key: string; value: Match }
  settings: { key: string; value: Settings }
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null

export function getDb(): Promise<IDBPDatabase<Schema>> {
  if (!dbPromise) {
    dbPromise = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('players')) {
          db.createObjectStore('players', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('matches')) {
          db.createObjectStore('matches', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings')
        }
      },
    })
  }
  return dbPromise
}

export async function getAllPlayers(): Promise<Player[]> {
  const db = await getDb()
  return db.getAll('players')
}

export async function getAllMatches(): Promise<Match[]> {
  const db = await getDb()
  return db.getAll('matches')
}

export async function putPlayer(p: Player): Promise<void> {
  const db = await getDb()
  await db.put('players', p)
}

export async function deletePlayer(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('players', id)
}

export async function putMatch(m: Match): Promise<void> {
  const db = await getDb()
  await db.put('matches', m)
}

export async function deleteMatch(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('matches', id)
}

export async function getSettings(): Promise<Settings> {
  const db = await getDb()
  const s = (await db.get('settings', 'app')) as Settings | undefined
  return s ?? DEFAULT_SETTINGS
}

export async function saveSettings(s: Settings): Promise<void> {
  const db = await getDb()
  await db.put('settings', s, 'app')
}

export async function wipeAll(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['players', 'matches', 'settings'], 'readwrite')
  await Promise.all([
    tx.objectStore('players').clear(),
    tx.objectStore('matches').clear(),
    tx.objectStore('settings').clear(),
  ])
  await tx.done
}

export async function replaceAll(
  players: Player[],
  matches: Match[],
  settings: Settings,
): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['players', 'matches', 'settings'], 'readwrite')
  await tx.objectStore('players').clear()
  await tx.objectStore('matches').clear()
  await tx.objectStore('settings').clear()
  for (const p of players) await tx.objectStore('players').put(p)
  for (const m of matches) await tx.objectStore('matches').put(m)
  await tx.objectStore('settings').put(settings, 'app')
  await tx.done
}
