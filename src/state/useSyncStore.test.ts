import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../persistence/syncSettings', () => ({ loadSyncSettings: vi.fn(), saveSyncSettings: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../persistence/syncState', () => ({ loadSyncState: vi.fn(), saveSyncState: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../persistence/pocketbaseClient', () => ({ createPocketBaseClient: vi.fn() }))
vi.mock('../sync/pocketBaseAdapter', () => ({ createSyncClient: vi.fn().mockReturnValue({}) }))
vi.mock('../sync/syncService', () => ({ sync: vi.fn() }))

import { loadSyncSettings, saveSyncSettings } from '../persistence/syncSettings'
import { loadSyncState, saveSyncState } from '../persistence/syncState'
import { createPocketBaseClient } from '../persistence/pocketbaseClient'
import { sync } from '../sync/syncService'
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
    store = createSyncStore()
  })

  it('init() loads persisted settings', async () => {
    vi.mocked(loadSyncSettings).mockResolvedValue({ serverUrl: 'https://pi.local', syncFolderPath: '/cours' })
    await store.getState().init()
    expect(store.getState().serverUrl).toBe('https://pi.local')
    expect(store.getState().syncFolderPath).toBe('/cours')
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

  it('login() sets a French error and no user on failure', async () => {
    const authWithPassword = vi.fn().mockRejectedValue(new Error('mot de passe invalide'))
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    await store.getState().setServerUrl('https://pi.local')

    await store.getState().login('aife', 'wrong')

    expect(store.getState().currentUser).toBeNull()
    expect(store.getState().error).toBe('mot de passe invalide')
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
    vi.mocked(sync).mockResolvedValue({ pushed: 2, pulled: 1, errors: [] })
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().setSyncFolderPath('/cours')
    await store.getState().login('aife', 'secret')

    await store.getState().syncNow()

    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({ currentUser: 'aife', syncFolderPath: '/cours' })
    )
    expect(store.getState().lastResult).toEqual({ pushed: 2, pulled: 1, errors: [] })
    expect(saveSyncState).toHaveBeenCalled()
  })
})
