import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type PocketBase from 'pocketbase'
import type { UserRole } from '../types/card'
import { DEFAULT_SYNC_SETTINGS } from '../types/syncSettings'
import { loadSyncSettings, saveSyncSettings } from '../persistence/syncSettings'
import { loadSyncState, saveSyncState } from '../persistence/syncState'
import { createPocketBaseClient } from '../persistence/pocketbaseClient'
import { loadSyncStatus, saveSyncStatus } from '../persistence/syncStatus'
import { logSyncEvent } from '../persistence/syncLog'
import { createSyncClient } from '../sync/pocketBaseAdapter'
import { countPendingPushes, sync, type SyncResult } from '../sync/syncService'
import { syncResultLabel } from '../sync/syncResultLabel'

export interface SyncUser {
  username: string
  role: UserRole
}

interface SyncStoreState {
  serverUrl: string
  syncFolderPath: string | null
  currentUser: SyncUser | null
  status: 'idle' | 'connecting' | 'syncing'
  error: string | null
  lastResult: SyncResult | null
  /** When the last sync succeeded (ISO), remembered across runs — « il y a 12 min ». */
  lastSuccessAt: string | null
  /**
   * How many of the account's maps a sync would push right now, or `null` when
   * it cannot be known (nobody signed in, no folder, folder unreadable).
   */
  pendingCount: number | null
  /** Where the run in flight has got to, or `null` when nothing is running. */
  progress: { done: number; total: number } | null
  /** Recomputes `pendingCount` — the one place that walks the sync folder for it. */
  refreshPendingCount: () => Promise<void>
  /** Asks the run in flight to stop; a no-op when nothing is running. */
  cancelSync: () => void
  init: () => Promise<void>
  setServerUrl: (url: string) => Promise<void>
  setSyncFolderPath: (path: string | null) => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  syncNow: () => Promise<void>
}

export type SyncStore = UseBoundStore<StoreApi<SyncStoreState>>

interface RawUserRecord {
  username: string
  role: UserRole
}

/**
 * PocketBase's `ClientResponseError` carries English SDK text (e.g. "Failed
 * to authenticate.") that a French-speaking student would not understand —
 * unlike `useWorkspaceStore`'s `describeError`, this one never surfaces the
 * raw message. `status` is the SDK's own field (see `ClientResponseError` in
 * `pocketbase`'s type definitions): 0 means the request never reached the
 * server (network/DNS failure), 400 covers both bad-request payloads and a
 * failed `authWithPassword` — PocketBase uses the same code for wrong
 * username/password as for a malformed request.
 */
function describeSyncStoreError(error: unknown): string {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: unknown }).status
    if (status === 0) return 'Serveur injoignable. Vérifiez l’adresse et votre connexion.'
    if (status === 400) return 'Identifiant ou mot de passe incorrect.'
  }
  return 'Une erreur est survenue. Réessayez plus tard.'
}

export function createSyncStore(): SyncStore {
  // Recreated only when the server URL actually changes — the auth session
  // is tied to one server, and switching servers must never carry a stale
  // one over. Tracked in a closure var rather than read off the client
  // instance, since the SDK does not guarantee a stable public property name
  // for it.
  let client: PocketBase | null = null
  let clientServerUrl: string | null = null
  // The run in flight, so `cancelSync` has something to abort. Cleared at the
  // end of every run, which is what keeps a finished one from being cancelled.
  let runningSync: AbortController | null = null

  return create<SyncStoreState>((set, get) => {
    function clientFor(serverUrl: string): PocketBase {
      if (client === null || clientServerUrl !== serverUrl) {
        client = createPocketBaseClient(serverUrl)
        clientServerUrl = serverUrl
        // Session restore from AsyncAuthStore's persisted file resolves
        // asynchronously (after this function returns) — this keeps
        // currentUser in sync once that resolves, instead of only checking
        // once, synchronously, before it possibly has.
        client?.authStore.onChange(() => {
          set({ currentUser: userFromClient(client!) })
        })
      }
      return client
    }

    function userFromClient(pb: PocketBase | null | undefined): SyncUser | null {
      if (!pb) return null
      const record = pb.authStore.record as RawUserRecord | null
      if (record === null || !pb.authStore.isValid) return null
      return { username: record.username, role: record.role }
    }

    return {
      serverUrl: DEFAULT_SYNC_SETTINGS.serverUrl,
      syncFolderPath: DEFAULT_SYNC_SETTINGS.syncFolderPath,
      currentUser: null,
      status: 'idle',
      error: null,
      lastResult: null,
      lastSuccessAt: null,
      pendingCount: null,
      progress: null,

      init: async () => {
        const settings = await loadSyncSettings()
        set({ serverUrl: settings.serverUrl, syncFolderPath: settings.syncFolderPath })
        if (settings.serverUrl) set({ currentUser: userFromClient(clientFor(settings.serverUrl)) })
        // The interface's own memory, kept apart from the settings: it has to
        // survive a restart to answer « quand ai-je synchronisé la dernière fois ? ».
        const status = await loadSyncStatus()
        set({ lastSuccessAt: status.lastSuccessAt })
        // The count depends on the session and the folder that were just
        // restored, so it is computed once here rather than on every render.
        void get().refreshPendingCount()
      },

      cancelSync: () => {
        // Only the run in flight can be stopped: a stale controller (from a
        // finished run) must never abort the next one.
        if (get().status !== 'syncing') return
        runningSync?.abort()
      },

      refreshPendingCount: async () => {
        const { syncFolderPath, currentUser } = get()
        if (syncFolderPath === null || currentUser === null) {
          set({ pendingCount: null })
          return
        }
        try {
          const state = await loadSyncState()
          const pending = await countPendingPushes({
            syncFolderPath,
            currentUser: currentUser.username,
            state,
          })
          set({ pendingCount: pending })
        } catch {
          // A sync folder that was moved or deleted: no badge beats a wrong one.
          set({ pendingCount: null })
        }
      },

      setServerUrl: async url => {
        set({ serverUrl: url, currentUser: null })
        await saveSyncSettings({ serverUrl: url, syncFolderPath: get().syncFolderPath })
      },

      setSyncFolderPath: async path => {
        set({ syncFolderPath: path })
        await saveSyncSettings({ serverUrl: get().serverUrl, syncFolderPath: path })
        await get().refreshPendingCount()
      },

      login: async (username, password) => {
        set({ status: 'connecting', error: null })
        try {
          const pb = clientFor(get().serverUrl)
          await pb.collection<RawUserRecord>('users').authWithPassword(username, password)
          const user = userFromClient(pb)
          // The username only — never the password, which is not even read here.
          await logSyncEvent('info', `connexion réussie : « ${user?.username ?? username} » sur ${get().serverUrl}`)
          set({ currentUser: user, status: 'idle' })
          // Signing in is what makes the count answerable at all.
          await get().refreshPendingCount()
        } catch (error) {
          const message = describeSyncStoreError(error)
          // The French message is for the user, the raw error for whoever reads
          // the log afterwards.
          await logSyncEvent(
            'error',
            `connexion échouée pour « ${username} » sur ${get().serverUrl} : ${message}`,
            error
          )
          set({ status: 'idle', error: message, currentUser: null })
        }
      },

      logout: () => {
        clientFor(get().serverUrl).authStore.clear()
        // Nothing to send on behalf of nobody: the badge goes away with the session.
        set({ currentUser: null, pendingCount: null })
      },

      syncNow: async () => {
        // Two callers now reach this — the button in the sidebar footer and the
        // one in the settings panel — and a manual sync is a whole folder's
        // worth of network round-trips. Re-entering would push and pull the same
        // files twice in parallel for no benefit, so the second caller is
        // dropped rather than queued.
        if (get().status === 'syncing') return

        const { serverUrl, syncFolderPath, currentUser } = get()
        if (syncFolderPath === null || currentUser === null) {
          const message = 'Connectez-vous et choisissez un dossier de synchronisation avant de synchroniser.'
          set({ error: message })
          // Logged rather than dropped: "I clicked and nothing happened" is the
          // report this line answers.
          await logSyncEvent('info', `synchronisation ignorée : ${message}`)
          return
        }
        const controller = new AbortController()
        runningSync = controller
        set({ status: 'syncing', error: null, progress: null })
        // Written BEFORE the network work: if the app dies mid-sync, the log
        // still shows a run was under way.
        await logSyncEvent(
          'info',
          `synchronisation demandée par « ${currentUser.username} » sur ${serverUrl}`
        )
        try {
          const pb = clientFor(serverUrl)
          const state = await loadSyncState()
          let result: SyncResult
          try {
            result = await sync({
              client: createSyncClient(pb),
              currentUser: currentUser.username,
              syncFolderPath,
              state,
              signal: controller.signal,
              onProgress: (done, total) => set({ progress: { done, total } }),
            })
          } finally {
            // Whatever ended the run — completion, cancellation or a hard
            // failure — the per-file cache must keep what did get through, or
            // the next run would send it all over again.
            await saveSyncState(state)
          }

          await logSyncEvent('info', `synchronisation : ${syncResultLabel(result)}`)
          if (result.errors.length > 0) {
            // The per-file detail, which is what a bug report actually needs.
            await logSyncEvent('error', 'fichiers en erreur pendant la synchronisation', result.errors)
          }
          if (result.cancelled) {
            // An interrupted run is not a success: « dernière synchro » must not
            // claim a moment when only part of the folder went through.
            set({ status: 'idle', lastResult: result, progress: null })
          } else {
            const finishedAt = new Date().toISOString()
            // The state update comes first: the button must come back to life
            // before the two disk writes and the folder walk below.
            set({ status: 'idle', lastResult: result, lastSuccessAt: finishedAt, progress: null })
            await saveSyncStatus({ lastSuccessAt: finishedAt })
          }
          await get().refreshPendingCount()
        } catch (error) {
          const message = describeSyncStoreError(error)
          await logSyncEvent('error', `synchronisation échouée : ${message}`, error)
          set({ status: 'idle', error: message, progress: null })
        } finally {
          // Cleared only if it is still OURS: a run that finished must not
          // disarm the controller of the one that replaced it.
          if (runningSync === controller) runningSync = null
        }
      },
    }
  })
}

export const useSyncStore = createSyncStore()
