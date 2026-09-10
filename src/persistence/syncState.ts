import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'

const STATE_FILE_NAME = 'sync-state.json'

export interface SyncStateEntry {
  lastSyncedModified: string
  lastSyncedUpdated: string
}

export type SyncState = Record<string, SyncStateEntry>

async function stateFilePath(): Promise<string> {
  return join(await appConfigDir(), STATE_FILE_NAME)
}

/**
 * Discarded rather than surfaced on corruption: like `mindMapFormatCache`,
 * this holds nothing the user authored — worst case, the next sync
 * re-compares every file instead of skipping the ones already up to date.
 */
export async function loadSyncState(): Promise<SyncState> {
  try {
    const path = await stateFilePath()
    if (!(await exists(path))) return {}
    const json = await readTextFile(path)
    return JSON.parse(json) as SyncState
  } catch {
    return {}
  }
}

export async function saveSyncState(state: SyncState): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const path = await stateFilePath()
  await writeTextFile(path, JSON.stringify(state, null, 2))
}
