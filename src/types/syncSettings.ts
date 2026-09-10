export interface SyncSettings {
  serverUrl: string
  syncFolderPath: string | null
  /**
   * Automatic sync, OFF by default: a sync is a network round-trip over the
   * user's content, so it happens on its own only once they asked for it.
   */
  autoSyncOnLaunch: boolean
  /** Minutes between two background syncs; 0 (the default) means never. */
  autoSyncIntervalMinutes: number
  /** Writes one journal line per file actually transferred, not just the summary. */
  verboseLog: boolean
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  serverUrl: '',
  syncFolderPath: null,
  autoSyncOnLaunch: false,
  autoSyncIntervalMinutes: 0,
  verboseLog: false,
}
