import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'
import type { SyncSettings } from '../types/syncSettings'
import { DEFAULT_SYNC_SETTINGS } from '../types/syncSettings'

const SETTINGS_FILE_NAME = 'sync-settings.json'

async function settingsFilePath(): Promise<string> {
  return join(await appConfigDir(), SETTINGS_FILE_NAME)
}

export async function loadSyncSettings(): Promise<SyncSettings> {
  const path = await settingsFilePath()
  if (!(await exists(path))) return DEFAULT_SYNC_SETTINGS
  const json = await readTextFile(path)
  return { ...DEFAULT_SYNC_SETTINGS, ...(JSON.parse(json) as Partial<SyncSettings>) }
}

export async function saveSyncSettings(settings: SyncSettings): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const path = await settingsFilePath()
  await writeTextFile(path, JSON.stringify(settings, null, 2))
}
