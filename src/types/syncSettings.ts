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
  /**
   * The last account used, kept so the form comes back filled in — and so the
   * app can sign in again by itself when the PocketBase session has expired.
   *
   * ⚠️ `password` is stored IN CLEAR, on purpose and at the user's request. The
   * file lives in the application's configuration folder (never in the synced
   * folder, never in the repository), next to `sync-auth.json`, which already
   * holds a session token that is exactly as powerful. Anyone who can read this
   * file can already read the user's cards.
   */
  username: string
  password: string
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  serverUrl: '',
  syncFolderPath: null,
  autoSyncOnLaunch: false,
  autoSyncIntervalMinutes: 0,
  verboseLog: false,
  username: '',
  password: '',
}
