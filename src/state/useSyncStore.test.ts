import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../persistence/syncSettings', () => ({ loadSyncSettings: vi.fn(), saveSyncSettings: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../persistence/syncState', () => ({ loadSyncState: vi.fn(), saveSyncState: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../persistence/pocketbaseClient', () => ({ createPocketBaseClient: vi.fn() }))
vi.mock('../sync/pocketBaseAdapter', () => ({ createSyncClient: vi.fn().mockReturnValue({}) }))
vi.mock('../sync/syncService', () => ({ sync: vi.fn(), countPendingPushes: vi.fn() }))
vi.mock('../persistence/syncLog', () => ({ logSyncEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../persistence/syncStatus', () => ({ loadSyncStatus: vi.fn(), saveSyncStatus: vi.fn() }))

import { loadSyncSettings, saveSyncSettings } from '../persistence/syncSettings'
import { loadSyncState, saveSyncState } from '../persistence/syncState'
import { createPocketBaseClient } from '../persistence/pocketbaseClient'
import { countPendingPushes, sync } from '../sync/syncService'
import { logSyncEvent } from '../persistence/syncLog'
import { loadSyncStatus, saveSyncStatus } from '../persistence/syncStatus'
import { createSyncStore, type SyncStore } from './useSyncStore'

function fakePocketBase(authWithPassword: (username: string, password: string) => Promise<{ record: { username: string; role: string } }>) {
  let record: { username: string; role: string } | null = null
  return {
    collection: () => ({
      authWithPassword: async (username: string, password: string) => {
        const result = await authWithPassword(username, password)
        record = result.record
        return result
      },
    }),
    authStore: {
      get record() {
        return record
      },
      get isValid() {
        return record !== null
      },
      onChange: () => {},
      clear: () => {
        record = null
      },
    },
  }
}

describe('useSyncStore', () => {
  let store: SyncStore

  beforeEach(() => {
    vi.mocked(loadSyncSettings).mockReset().mockResolvedValue({ serverUrl: '', syncFolderPath: null })
    vi.mocked(saveSyncSettings).mockReset().mockResolvedValue(undefined)
    vi.mocked(loadSyncState).mockReset().mockResolvedValue({})
    vi.mocked(saveSyncState).mockReset().mockResolvedValue(undefined)
    vi.mocked(createPocketBaseClient).mockReset()
    vi.mocked(sync).mockReset()
    vi.mocked(logSyncEvent).mockReset().mockResolvedValue(undefined)
    vi.mocked(loadSyncStatus).mockReset().mockResolvedValue({ lastSuccessAt: null })
    vi.mocked(saveSyncStatus).mockReset().mockResolvedValue(undefined)
    vi.mocked(countPendingPushes).mockReset().mockResolvedValue(0)
    store = createSyncStore()
  })

  it('init() loads persisted settings', async () => {
    vi.mocked(loadSyncSettings).mockResolvedValue({ serverUrl: 'https://pi.local', syncFolderPath: '/cours' })
    await store.getState().init()
    expect(store.getState().serverUrl).toBe('https://pi.local')
    expect(store.getState().syncFolderPath).toBe('/cours')
  })

  it('init() restores when the last sync succeeded — it has to survive a restart', async () => {
    vi.mocked(loadSyncStatus).mockResolvedValue({ lastSuccessAt: '2026-09-10T19:00:00.000Z' })
    await store.getState().init()
    expect(store.getState().lastSuccessAt).toBe('2026-09-10T19:00:00.000Z')
  })

  it('refreshPendingCount() counts what a sync would push, for the account and the folder', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().setSyncFolderPath('/cours')
    await store.getState().login('aife', 'secret')
    vi.mocked(countPendingPushes).mockResolvedValue(3)

    await store.getState().refreshPendingCount()

    expect(store.getState().pendingCount).toBe(3)
    expect(countPendingPushes).toHaveBeenCalledWith(
      expect.objectContaining({ syncFolderPath: '/cours', currentUser: 'aife' })
    )
  })

  it('refreshPendingCount() answers "unknown", never a number, when it cannot know', async () => {
    await store.getState().refreshPendingCount()
    expect(store.getState().pendingCount).toBeNull()
    expect(countPendingPushes).not.toHaveBeenCalled()

    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().setSyncFolderPath('/cours')
    await store.getState().login('aife', 'secret')
    vi.mocked(countPendingPushes).mockRejectedValue(new Error('dossier disparu'))

    await store.getState().refreshPendingCount()
    expect(store.getState().pendingCount).toBeNull()
  })

  it('a successful sync records and persists when it finished', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    vi.mocked(sync).mockResolvedValue({ pushed: 1, pulled: 0, errors: [], cancelled: false, conflicts: [] })
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().setSyncFolderPath('/cours')
    await store.getState().login('aife', 'secret')

    await store.getState().syncNow()

    const recorded = store.getState().lastSuccessAt
    expect(recorded).not.toBeNull()
    expect(saveSyncStatus).toHaveBeenCalledWith({ lastSuccessAt: recorded })
    // And the footer's counter is refreshed from that same run.
    expect(countPendingPushes).toHaveBeenCalled()
  })

  it('a failed sync leaves the last success where it was', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    vi.mocked(sync).mockRejectedValue(Object.assign(new Error('Failed to fetch'), { status: 0 }))
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().setSyncFolderPath('/cours')
    await store.getState().login('aife', 'secret')

    await store.getState().syncNow()

    expect(store.getState().lastSuccessAt).toBeNull()
    expect(saveSyncStatus).not.toHaveBeenCalled()
  })

  it('picks up a session that resolves asynchronously via AsyncAuthStore onChange', async () => {
    let onChangeCallback: (() => void) | undefined
    let currentRecord: { username: string; role: string } | null = null
    const fakePb = {
      collection: () => ({ authWithPassword: vi.fn() }),
      authStore: {
        get record() {
          return currentRecord
        },
        get isValid() {
          return currentRecord !== null
        },
        onChange: (cb: () => void) => {
          onChangeCallback = cb
        },
        clear: () => {
          currentRecord = null
        },
      },
    }
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePb as any)
    vi.mocked(loadSyncSettings).mockResolvedValue({ serverUrl: 'https://pi.local', syncFolderPath: null })

    await store.getState().init()
    expect(store.getState().currentUser).toBeNull()

    currentRecord = { username: 'aife', role: 'prof' }
    onChangeCallback?.()

    expect(store.getState().currentUser).toEqual({ username: 'aife', role: 'prof' })
  })

  it('login() sets currentUser on success', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    await store.getState().setServerUrl('https://pi.local')

    await store.getState().login('aife', 'secret')

    expect(store.getState().currentUser).toEqual({ username: 'aife', role: 'prof' })
    expect(store.getState().status).toBe('idle')
  })

  it('login() falls back to a generic French message for a plain Error with no status (never the raw English text)', async () => {
    const authWithPassword = vi.fn().mockRejectedValue(new Error('Failed to authenticate.'))
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    await store.getState().setServerUrl('https://pi.local')

    await store.getState().login('aife', 'wrong')

    expect(store.getState().currentUser).toBeNull()
    expect(store.getState().error).toBe('Une erreur est survenue. Réessayez plus tard.')
  })

  it('login() reports an unreachable server in French for a status-0 ClientResponseError-shaped failure', async () => {
    const authWithPassword = vi.fn().mockRejectedValue(Object.assign(new Error('Failed to fetch'), { status: 0 }))
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    await store.getState().setServerUrl('https://pi.local')

    await store.getState().login('aife', 'wrong')

    expect(store.getState().error).toBe('Serveur injoignable. Vérifiez l’adresse et votre connexion.')
  })

  it('login() reports a wrong identifier/password in French for a status-400 ClientResponseError-shaped failure', async () => {
    const authWithPassword = vi.fn().mockRejectedValue(Object.assign(new Error('Failed to authenticate.'), { status: 400 }))
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    await store.getState().setServerUrl('https://pi.local')

    await store.getState().login('aife', 'wrong')

    expect(store.getState().error).toBe('Identifiant ou mot de passe incorrect.')
  })

  it('logout() clears currentUser', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().login('aife', 'secret')

    store.getState().logout()

    expect(store.getState().currentUser).toBeNull()
  })

  it('syncNow() refuses without a folder or a logged-in user, with a French message', async () => {
    await store.getState().syncNow()
    expect(store.getState().error).toContain('Connectez-vous')
    expect(sync).not.toHaveBeenCalled()
  })

  it('syncNow() runs the sync algorithm and stores the result', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    vi.mocked(sync).mockResolvedValue({ pushed: 2, pulled: 1, errors: [], cancelled: false, conflicts: [] })
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().setSyncFolderPath('/cours')
    await store.getState().login('aife', 'secret')

    await store.getState().syncNow()

    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({ currentUser: 'aife', syncFolderPath: '/cours' })
    )
    expect(store.getState().lastResult).toEqual({ pushed: 2, pulled: 1, errors: [], cancelled: false, conflicts: [] })
    expect(saveSyncState).toHaveBeenCalled()
  })

  it('syncNow() writes the run and its counters to the debug log', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    vi.mocked(sync).mockResolvedValue({ pushed: 2, pulled: 1, errors: [], cancelled: false, conflicts: [] })
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().setSyncFolderPath('/cours')
    await store.getState().login('aife', 'secret')
    vi.mocked(logSyncEvent).mockClear()

    await store.getState().syncNow()

    const lines = vi.mocked(logSyncEvent).mock.calls.map(call => `${call[0]} ${call[1]}`)
    expect(lines.some(line => line.startsWith('info') && line.includes('synchronisation demandée'))).toBe(true)
    expect(lines.some(line => line.includes('2 envoyé(s), 1 reçu(s)'))).toBe(true)
  })

  it('syncNow() logs the raw failure, status included, when the server is unreachable', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    const failure = Object.assign(new Error('Failed to fetch'), { name: 'ClientResponseError', status: 0 })
    vi.mocked(sync).mockRejectedValue(failure)
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().setSyncFolderPath('/cours')
    await store.getState().login('aife', 'secret')
    vi.mocked(logSyncEvent).mockClear()

    await store.getState().syncNow()

    expect(logSyncEvent).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('Serveur injoignable'),
      failure
    )
  })

  it('syncNow() logs the per-file failures of an otherwise successful batch', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    const errors = [{ fileId: 'file-1', message: 'réseau coupé' }]
    vi.mocked(sync).mockResolvedValue({ pushed: 1, pulled: 0, errors, cancelled: false, conflicts: [] })
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().setSyncFolderPath('/cours')
    await store.getState().login('aife', 'secret')
    vi.mocked(logSyncEvent).mockClear()

    await store.getState().syncNow()

    expect(logSyncEvent).toHaveBeenCalledWith('error', expect.stringContaining('fichiers en erreur'), errors)
  })

  it('login() logs the attempt that failed, with the raw error for the bug report', async () => {
    const authWithPassword = vi.fn().mockRejectedValue(Object.assign(new Error('Failed to fetch'), { status: 0 }))
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    await store.getState().setServerUrl('https://pi.local')

    await store.getState().login('aife', 'wrong')

    expect(logSyncEvent).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('« aife »'),
      expect.any(Error)
    )
  })

  it('publishes the progress of the run, and forgets it once the run is over', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    vi.mocked(sync).mockImplementation(async params => {
      params.onProgress?.(1, 2)
      params.onProgress?.(2, 2)
      return { pushed: 2, pulled: 0, errors: [], cancelled: false, conflicts: [] }
    })
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().setSyncFolderPath('/cours')
    await store.getState().login('aife', 'secret')
    const seen: Array<{ done: number; total: number } | null> = []
    const unsubscribe = store.subscribe(state => seen.push(state.progress))

    await store.getState().syncNow()
    unsubscribe()

    expect(seen).toContainEqual({ done: 1, total: 2 })
    expect(seen).toContainEqual({ done: 2, total: 2 })
    expect(store.getState().progress).toBeNull()
  })

  it('cancelSync() stops the run in flight, and an interrupted run is not a success', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    vi.mocked(sync).mockImplementation(async params => {
      // Stands in for the algorithm: resolves when the store aborts the signal
      // it handed us, exactly as a cancelled run would — including when it was
      // already aborted before this call, which is what a click on « Annuler »
      // during the few milliseconds of setup does.
      return new Promise(resolve => {
        const finish = () => resolve({ pushed: 1, pulled: 0, errors: [], cancelled: true, conflicts: [] })
        if (params.signal?.aborted === true) {
          finish()
          return
        }
        params.signal?.addEventListener('abort', finish)
      })
    })
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().setSyncFolderPath('/cours')
    await store.getState().login('aife', 'secret')

    const running = store.getState().syncNow()
    // `status` flips to 'syncing' synchronously, but the algorithm is only
    // reached a few awaits later — cancelling before that would abort a signal
    // nothing is listening to yet.
    await vi.waitFor(() => expect(sync).toHaveBeenCalled())
    store.getState().cancelSync()
    await running

    expect(store.getState().lastResult?.cancelled).toBe(true)
    // Nothing was fully synchronised, so the interface must not claim a date.
    expect(store.getState().lastSuccessAt).toBeNull()
    expect(saveSyncStatus).not.toHaveBeenCalled()
    expect(store.getState().status).toBe('idle')
    expect(store.getState().progress).toBeNull()
  })

  it('cancelSync() is a no-op when nothing is running', () => {
    expect(() => store.getState().cancelSync()).not.toThrow()
    expect(vi.mocked(sync)).not.toHaveBeenCalled()
  })

  it('syncNow() drops a second call while the first is still running', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    // Held open, so the store is observed in its 'syncing' state rather than
    // between two instantaneous runs.
    let releaseSync: (() => void) | undefined
    vi.mocked(sync).mockImplementation(
      () =>
        new Promise(resolve => {
          releaseSync = () => resolve({ pushed: 0, pulled: 0, errors: [], cancelled: false, conflicts: [] })
        })
    )
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().setSyncFolderPath('/cours')
    await store.getState().login('aife', 'secret')

    const first = store.getState().syncNow()
    expect(store.getState().status).toBe('syncing')
    // The second call returns without touching the algorithm at all. It MUST be
    // issued here, while the first run is parked inside `sync`.
    await store.getState().syncNow()

    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1))
    releaseSync?.()
    await first
    // The proof: had the guard not dropped it, the second call would have been
    // a second `sync` invocation once the first one completed.
    expect(sync).toHaveBeenCalledTimes(1)
    expect(store.getState().status).toBe('idle')
  })
})
