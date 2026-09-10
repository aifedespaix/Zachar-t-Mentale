import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'
import type { SyncSettings } from '../types/syncSettings'
import { DEFAULT_SYNC_SETTINGS } from '../types/syncSettings'

const SETTINGS_FILE_NAME = 'sync-settings.json'

async function settingsFilePath(): Promise<string> {
  return join(await appConfigDir(), SETTINGS_FILE_NAME)
}

export interface LoadedSyncSettings {
  settings: SyncSettings
  /**
   * Why the stored settings could NOT be used, when they could not — a corrupt
   * file, an empty one, a read the filesystem refused. The defaults are then in
   * force, and the caller is expected to SAY SO: silently starting from scratch
   * is exactly how "mes réglages ne sont jamais sauvegardés" happens.
   */
  problem: string | null
}

/**
 * Reads the settings file, and NEVER throws.
 *
 * A settings file is written whole every time, so a process killed mid-write
 * leaves a truncated one — and a truncated JSON used to make this reject, which
 * took the whole `init()` down with it and reset the screen to the defaults on
 * every launch, without a word. Losing the settings is bad; losing them in
 * silence is worse.
 */
export async function loadSyncSettings(): Promise<LoadedSyncSettings> {
  let path: string
  try {
    path = await settingsFilePath()
    if (!(await exists(path))) return { settings: DEFAULT_SYNC_SETTINGS, problem: null }
  } catch (error) {
    return {
      settings: DEFAULT_SYNC_SETTINGS,
      problem: `Emplacement des réglages introuvable (${describeError(error)}).`,
    }
  }

  try {
    const json = await readTextFile(path)
    const parsed = JSON.parse(json) as Partial<SyncSettings>
    if (parsed === null || typeof parsed !== 'object') throw new Error('contenu inattendu')
    return { settings: { ...DEFAULT_SYNC_SETTINGS, ...parsed }, problem: null }
  } catch (error) {
    return {
      settings: DEFAULT_SYNC_SETTINGS,
      problem: `Réglages enregistrés illisibles, réinitialisés (${describeError(error)}).`,
    }
  }
}

/** Human-readable tail for an error message, never an empty string. */
function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'erreur inconnue'
}

export async function saveSyncSettings(settings: SyncSettings): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const path = await settingsFilePath()
  await writeTextFile(path, JSON.stringify(settings, null, 2))
}
