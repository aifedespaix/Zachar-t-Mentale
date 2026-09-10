import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type PocketBase from 'pocketbase'
import type { UserRole } from '../types/card'
import { DEFAULT_SYNC_SETTINGS } from '../types/syncSettings'
import { loadSyncSettings, saveSyncSettings } from '../persistence/syncSettings'
import { loadSyncState, saveSyncState } from '../persistence/syncState'
import { createPocketBaseClient } from '../persistence/pocketbaseClient'
import { createSyncClient } from '../sync/pocketBaseAdapter'
import { sync, type SyncResult } from '../sync/syncService'

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

      init: async () => {
        const settings = await loadSyncSettings()
        set({ serverUrl: settings.serverUrl, syncFolderPath: settings.syncFolderPath })
        if (settings.serverUrl) set({ currentUser: userFromClient(clientFor(settings.serverUrl)) })
      },

      setServerUrl: async url => {
        set({ serverUrl: url, currentUser: null })
        await saveSyncSettings({ serverUrl: url, syncFolderPath: get().syncFolderPath })
      },

      setSyncFolderPath: async path => {
        set({ syncFolderPath: path })
        await saveSyncSettings({ serverUrl: get().serverUrl, syncFolderPath: path })
      },

      login: async (username, password) => {
        set({ status: 'connecting', error: null })
        try {
          const pb = clientFor(get().serverUrl)
          await pb.collection<RawUserRecord>('users').authWithPassword(username, password)
          set({ currentUser: userFromClient(pb), status: 'idle' })
        } catch (error) {
          set({ status: 'idle', error: describeSyncStoreError(error), currentUser: null })
        }
      },

      logout: () => {
        clientFor(get().serverUrl).authStore.clear()
        set({ currentUser: null })
      },

      syncNow: async () => {
        const { serverUrl, syncFolderPath, currentUser } = get()
        if (syncFolderPath === null || currentUser === null) {
          set({ error: 'Connectez-vous et choisissez un dossier de synchronisation avant de synchroniser.' })
          return
        }
        set({ status: 'syncing', error: null })
        try {
          const pb = clientFor(serverUrl)
          const state = await loadSyncState()
          const result = await sync({
            client: createSyncClient(pb),
            currentUser: currentUser.username,
            syncFolderPath,
            state,
          })
          await saveSyncState(state)
          set({ status: 'idle', lastResult: result })
        } catch (error) {
          set({ status: 'idle', error: describeSyncStoreError(error) })
        }
      },
    }
  })
}

export const useSyncStore = createSyncStore()
