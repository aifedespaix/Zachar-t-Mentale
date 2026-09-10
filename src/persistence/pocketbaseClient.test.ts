import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(false),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  remove: vi.fn(),
  mkdir: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn().mockResolvedValue('/config'),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

import { writeTextFile, exists } from '@tauri-apps/plugin-fs'
import { createPocketBaseClient } from './pocketbaseClient'

describe('createPocketBaseClient', () => {
  beforeEach(() => {
    vi.mocked(writeTextFile).mockReset()
    vi.mocked(exists).mockReset().mockResolvedValue(false)
  })

  it('creates a client pointed at the given server URL', () => {
    const pb = createPocketBaseClient('https://pi.local')
    // `buildURL` is the SDK's own documented way to read back the configured
    // base URL — an instance property name for it is not documented/stable.
    expect(pb.buildURL('/api/health')).toBe('https://pi.local/api/health')
  })

  it('persists auth changes to a file under appConfigDir', async () => {
    const pb = createPocketBaseClient('https://pi.local')
    pb.authStore.save('token-123', { id: 'u1', collectionId: 'users', collectionName: 'users', username: 'aife', role: 'prof' })
    // AsyncAuthStore queues the save behind its own `initial` promise
    // resolution — poll instead of guessing a fixed microtask depth.
    await vi.waitFor(() => {
      expect(writeTextFile).toHaveBeenCalledWith('/config/sync-auth.json', expect.stringContaining('token-123'))
    })
  })
})
