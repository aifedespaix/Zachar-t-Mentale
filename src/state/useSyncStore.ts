import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type PocketBase from 'pocketbase'
import type { UserRole, SyncUser } from '../types/card'
import { DEFAULT_SYNC_SETTINGS, type SyncSettings } from '../types/syncSettings'
import { loadSyncSettings, saveSyncSettings } from '../persistence/syncSettings'
import { loadServerSyncState, saveSyncState, serverStateOf } from '../persistence/syncState'
import { createPocketBaseClient } from '../persistence/pocketbaseClient'
import { loadSyncStatus, saveSyncStatus } from '../persistence/syncStatus'
import { logSyncEvent } from '../persistence/syncLog'
import { createSyncClient } from '../sync/pocketBaseAdapter'
import { surveySyncFolder, sync, type SyncResult } from '../sync/syncService'
import { syncResultLabel } from '../sync/syncResultLabel'

/** Who asked for a run: only a background one is allowed to stay quiet about a failure. */
export type SyncTrigger = 'manual' | 'auto'

export interface SyncTriggerOptions {
  trigger?: SyncTrigger
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
  /**
   * Maps under the sync folder with no sync identity at all. Kept apart from
   * `pendingCount` because they need a different gesture — publishing, not
   * syncing — and because "0 envoyé" without them is a mystery.
   */
  localOnlyCount: number | null
  /** The very files behind `localOnlyCount`, for the one-click bulk publish. */
  localOnlyPaths: string[]
  /** Where the run in flight has got to, or `null` when nothing is running. */
  progress: { done: number; total: number } | null
  /** Recomputes `pendingCount` — the one place that walks the sync folder for it. */
  refreshPendingCount: () => Promise<void>
  /** Asks the run in flight to stop; a no-op when nothing is running. */
  cancelSync: () => void
  /** Automatic sync, mirrored from the settings file and toggled from the panel. */
  autoSyncOnLaunch: boolean
  autoSyncIntervalMinutes: number
  verboseLog: boolean
  /** The last account used, kept so the form comes back filled in (see SyncSettings). */
  username: string
  password: string
  /**
   * What went wrong with the settings FILE — unreadable, or impossible to write.
   * The interface shows it, because a persistence failure the user cannot see is
   * a persistence failure they will report as "mes réglages ne sont pas gardés".
   */
  settingsProblem: string | null
  /** Merges into the persisted settings, and mirrors them in this store. */
  updateSettings: (patch: Partial<SyncSettings>) => Promise<void>
  init: () => Promise<void>
  setServerUrl: (url: string) => Promise<void>
  setSyncFolderPath: (path: string | null) => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  syncNow: (options?: SyncTriggerOptions) => Promise<void>
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
/** The same never-empty tail as elsewhere, for the settings file's own failures. */
function describeSettingsError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'erreur inconnue'
}

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

    /**
     * Records a failure — unless a BACKGROUND run is repeating, word for word,
     * the message already on screen. A server that is down for the night must
     * not put the same banner back every fifteen minutes; the journal keeps
     * every occurrence either way.
     */
    function reportFailure(message: string, trigger: SyncTrigger): void {
      if (trigger === 'auto' && get().error === message) return
      set({ error: message })
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
      localOnlyCount: null,
      localOnlyPaths: [],
      progress: null,
      autoSyncOnLaunch: DEFAULT_SYNC_SETTINGS.autoSyncOnLaunch,
      autoSyncIntervalMinutes: DEFAULT_SYNC_SETTINGS.autoSyncIntervalMinutes,
      verboseLog: DEFAULT_SYNC_SETTINGS.verboseLog,
      username: DEFAULT_SYNC_SETTINGS.username,
      password: DEFAULT_SYNC_SETTINGS.password,
      settingsProblem: null,

      updateSettings: async patch => {
        set(patch)
        const {
          serverUrl,
          syncFolderPath,
          autoSyncOnLaunch,
          autoSyncIntervalMinutes,
          verboseLog,
          username,
          password,
        } = get()
        try {
          await saveSyncSettings({
            serverUrl,
            syncFolderPath,
            autoSyncOnLaunch,
            autoSyncIntervalMinutes,
            verboseLog,
            username,
            password,
          })
          set({ settingsProblem: null })
        } catch (error) {
          // A save that fails IN SILENCE is the bug this reports: the user would
          // otherwise retype everything at the next launch and blame the app.
          const message = `Impossible d’enregistrer les réglages de synchronisation : ${describeSettingsError(error)}`
          set({ settingsProblem: message })
          await logSyncEvent('error', message, error)
        }
      },

      init: async () => {
        // NEVER throws, and reports what it could not read — see the loader's own
        // comment for why a corrupt file must not silently reset everything.
        const { settings, problem } = await loadSyncSettings()
        set({
          serverUrl: settings.serverUrl,
          syncFolderPath: settings.syncFolderPath,
          autoSyncOnLaunch: settings.autoSyncOnLaunch,
          autoSyncIntervalMinutes: settings.autoSyncIntervalMinutes,
          verboseLog: settings.verboseLog,
          username: settings.username,
          password: settings.password,
          settingsProblem: problem,
        })
        await logSyncEvent(
          problem === null ? 'info' : 'error',
          problem ?? `réglages chargés : ${settings.serverUrl || 'aucun serveur'}`
        )
        if (settings.serverUrl) set({ currentUser: userFromClient(clientFor(settings.serverUrl)) })
        // The interface's own memory, kept apart from the settings: it has to
        // survive a restart to answer « quand ai-je synchronisé la dernière fois ? ».
        const status = await loadSyncStatus()
        set({ lastSuccessAt: status.lastSuccessAt })
        // The count depends on the session and the folder that were just
        // restored, so it is computed once here rather than on every render.
        void get().refreshPendingCount()

        // Signed in by itself when the session is gone but the credentials were
        // kept: that is the whole point of storing them, and it is what makes the
        // morning sync happen without typing anything.
        const { currentUser, username, password } = get()
        if (currentUser === null && username !== '' && password !== '') {
          if (settings.serverUrl !== '') void get().login(username, password)
          else await logSyncEvent('info', 'identifiants enregistrés, mais aucun serveur configuré')
        }
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
          set({ pendingCount: null, localOnlyCount: null, localOnlyPaths: [] })
          return
        }
        try {
          const state = await loadServerSyncState(get().serverUrl, syncFolderPath)
          const survey = await surveySyncFolder({
            syncFolderPath,
            currentUser,
            entries: serverStateOf(state, get().serverUrl, syncFolderPath).entries,
          })
          set({
            pendingCount: survey.pending.length,
            localOnlyCount: survey.localOnly.length,
            localOnlyPaths: survey.localOnly,
          })
        } catch {
          // A sync folder that was moved or deleted: no badge beats a wrong one.
          set({ pendingCount: null, localOnlyCount: null, localOnlyPaths: [] })
        }
      },

      // Both go through `updateSettings`, which is the only place that knows the
      // whole shape of what gets written: adding a setting must not mean
      // remembering every setter.
      setServerUrl: async url => {
        set({ serverUrl: url, currentUser: null })
        await get().updateSettings({})
      },

      setSyncFolderPath: async path => {
        set({ syncFolderPath: path })
        await get().updateSettings({})
        await get().refreshPendingCount()
      },

      login: async (username, password) => {
        set({ status: 'connecting', error: null })
        try {
          const pb = clientFor(get().serverUrl)
          await pb.collection<RawUserRecord>('users').authWithPassword(username, password)
          const user = userFromClient(pb)
          // The username only — the password never reaches the log.
          await logSyncEvent('info', `connexion réussie : « ${user?.username ?? username} » sur ${get().serverUrl}`)
          set({ currentUser: user, status: 'idle' })
          // Kept for the next launch: the form comes back filled in, and the app
          // can sign in again when the PocketBase session has expired.
          await get().updateSettings({ username, password })
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
        set({ currentUser: null, pendingCount: null, localOnlyCount: null, localOnlyPaths: [] })
      },

      syncNow: async (options?: SyncTriggerOptions) => {
        const trigger: SyncTrigger = options?.trigger ?? 'manual'
        // Three callers reach this now — the sidebar's button, the settings
        // panel's, and the background timer — and a sync is a whole folder's
        // worth of network round-trips. Re-entering would push and pull the same
        // files twice in parallel for no benefit, so the later caller is
        // dropped rather than queued.
        if (get().status === 'syncing') return

        const { serverUrl, syncFolderPath, currentUser } = get()
        if (syncFolderPath === null || currentUser === null) {
          const message = 'Connectez-vous et choisissez un dossier de synchronisation avant de synchroniser.'
          reportFailure(message, trigger)
          // Logged rather than dropped: "I clicked and nothing happened" is the
          // report this line answers.
          await logSyncEvent('info', `synchronisation ignorée : ${message}`)
          return
        }
        const controller = new AbortController()
        runningSync = controller
        // A manual attempt starts from a clean slate — it is fresh news. A
        // BACKGROUND one leaves whatever is on screen alone: clearing it would
        // make the same failure flicker back every tick.
        set({ status: 'syncing', progress: null, ...(trigger === 'manual' ? { error: null } : {}) })
        // Written BEFORE the network work: if the app dies mid-sync, the log
        // still shows a run was under way.
        await logSyncEvent(
          'info',
          `synchronisation ${trigger === 'auto' ? 'automatique' : 'demandée'} par « ${currentUser.username} » sur ${serverUrl}`
        )
        try {
          const pb = clientFor(serverUrl)
          const state = await loadServerSyncState(serverUrl, syncFolderPath)
          let result: SyncResult
          try {
            result = await sync({
              client: createSyncClient(pb),
              currentUser: currentUser.username,
              currentRole: currentUser.role,
              serverUrl,
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
          if (get().verboseLog) {
            // The counters say how many; this says WHICH, which is the question
            // that follows as soon as something looks wrong.
            for (const moved of result.transferred) {
              await logSyncEvent(
                'debug',
                `${moved.direction === 'push' ? 'envoyé' : 'reçu'} « ${moved.path} »`,
                { fileId: moved.fileId }
              )
            }
          }
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
          reportFailure(message, trigger)
          set({ status: 'idle', progress: null })
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
