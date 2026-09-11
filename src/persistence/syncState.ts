import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'

const STATE_FILE_NAME = 'sync-state.json'

export interface SyncStateEntry {
  lastSyncedModified: string
  lastSyncedUpdated: string
  /**
   * Le chemin RELATIF à la racine de synchronisation au dernier push ou pull.
   * Absent = inconnu (entrée migrée depuis la v1), pas « pas de chemin » : la
   * distinction décide si un chemin distant périmé doit être réparé.
   */
  lastSyncedPath?: string
  /** Absent = inconnu ; la détection de conflit retombe alors sur la révision. */
  lastSyncedContentHash?: string
}

export interface ServerSyncState {
  /** La racine avec laquelle `lastSyncedPath` a été construit — voir `sync`. */
  syncFolderPath: string | null
  entries: Record<string, SyncStateEntry>
  /** `file_id` dont la suppression distante reste à appliquer (plan « suppression »). */
  tombstones: string[]
}

export interface SyncState {
  version: 2
  servers: Record<string, ServerSyncState>
}

/** Le format v1 : un simple index `file_id → entrée`, sans notion de serveur. */
export type LegacySyncState = Record<string, SyncStateEntry>

export type LoadedSyncState =
  | { kind: 'v2'; state: SyncState }
  | { kind: 'legacy'; entries: LegacySyncState }
  | { kind: 'none' }

export function emptySyncState(): SyncState {
  return { version: 2, servers: {} }
}

export function emptyServerState(syncFolderPath: string | null): ServerSyncState {
  return { syncFolderPath, entries: {}, tombstones: [] }
}

/**
 * Le compartiment d'un serveur, créé EN PLACE s'il n'existe pas encore.
 *
 * La portée par serveur n'est pas un ornement : la suppression propagée repose
 * sur « un `file_id` que je connais et qui n'est plus dans la liste distante a
 * été supprimé ». Sans elle, changer d'URL dans les réglages ferait passer tous
 * les `file_id` pour supprimés.
 */
export function serverStateOf(state: SyncState, serverUrl: string, syncFolderPath: string | null): ServerSyncState {
  const existing = state.servers[serverUrl]
  if (existing !== undefined) return existing
  const created = emptyServerState(syncFolderPath)
  state.servers[serverUrl] = created
  return created
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSyncState(value: unknown): value is SyncState {
  return isRecord(value) && value.version === 2 && isRecord(value.servers)
}

export function migrateLegacyState(
  entries: LegacySyncState,
  serverUrl: string | null,
  syncFolderPath: string | null
): SyncState {
  const state = emptySyncState()
  // Sans serveur configuré, les entrées migrées n'ont aucun compartiment où
  // aller : c'est un cache, et le pire cas est une re-comparaison complète.
  if (serverUrl !== null && serverUrl !== '') {
    state.servers[serverUrl] = { syncFolderPath, entries, tombstones: [] }
  }
  return state
}

export function resolveSyncState(
  loaded: LoadedSyncState,
  serverUrl: string | null,
  syncFolderPath: string | null
): SyncState {
  if (loaded.kind === 'v2') return loaded.state
  if (loaded.kind === 'legacy') return migrateLegacyState(loaded.entries, serverUrl, syncFolderPath)
  return emptySyncState()
}

export async function loadSyncState(): Promise<LoadedSyncState> {
  try {
    const path = await stateFilePath()
    if (!(await exists(path))) return { kind: 'none' }
    const parsed: unknown = JSON.parse(await readTextFile(path))
    if (isSyncState(parsed)) return { kind: 'v2', state: parsed }
    if (isRecord(parsed)) return { kind: 'legacy', entries: parsed as LegacySyncState }
    return { kind: 'none' }
  } catch {
    return { kind: 'none' }
  }
}

/** Le document complet, résolu pour un serveur, avec son compartiment garanti. */
export async function loadServerSyncState(serverUrl: string, syncFolderPath: string | null): Promise<SyncState> {
  const state = resolveSyncState(await loadSyncState(), serverUrl, syncFolderPath)
  if (serverUrl !== '') serverStateOf(state, serverUrl, syncFolderPath)
  return state
}

async function stateFilePath(): Promise<string> {
  return join(await appConfigDir(), STATE_FILE_NAME)
}

export async function saveSyncState(state: SyncState): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const path = await stateFilePath()
  await writeTextFile(path, JSON.stringify(state, null, 2))
}
