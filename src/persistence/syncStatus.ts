import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'

const STATUS_FILE_NAME = 'sync-status.json'

/**
 * What the app remembers BETWEEN runs about sync — as opposed to
 * `sync-settings.json` (what the user configured) and `sync-state.json` (the
 * per-file cache the algorithm needs): this is only what the interface shows.
 */
export interface SyncStatus {
  /** When the last sync finished successfully, or `null` for "never on this install". */
  lastSuccessAt: string | null
}

export const DEFAULT_SYNC_STATUS: SyncStatus = { lastSuccessAt: null }

async function statusFilePath(): Promise<string> {
  return join(await appConfigDir(), STATUS_FILE_NAME)
}

/** Discarded rather than surfaced on corruption: like the other caches, the worst case is a missing "il y a …". */
export async function loadSyncStatus(): Promise<SyncStatus> {
  try {
    const path = await statusFilePath()
    if (!(await exists(path))) return DEFAULT_SYNC_STATUS
    const parsed = JSON.parse(await readTextFile(path)) as Partial<SyncStatus>
    return { lastSuccessAt: typeof parsed.lastSuccessAt === 'string' ? parsed.lastSuccessAt : null }
  } catch {
    return DEFAULT_SYNC_STATUS
  }
}

export async function saveSyncStatus(status: SyncStatus): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  await writeTextFile(await statusFilePath(), JSON.stringify(status, null, 2))
}
