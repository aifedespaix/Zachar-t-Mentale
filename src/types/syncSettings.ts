export interface SyncSettings {
  serverUrl: string
  syncFolderPath: string | null
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = { serverUrl: '', syncFolderPath: null }
