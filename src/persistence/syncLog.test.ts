import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn().mockResolvedValue('/config'),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }))

import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import {
  formatSyncLogLine,
  logSyncEvent,
  revealSyncLog,
  syncLogPath,
  trimSyncLog,
} from './syncLog'

const AT = new Date('2026-09-10T19:45:12.345Z')

beforeEach(() => {
  vi.mocked(exists).mockReset().mockResolvedValue(true)
  vi.mocked(mkdir).mockReset().mockResolvedValue(undefined)
  vi.mocked(readTextFile).mockReset().mockResolvedValue('')
  vi.mocked(writeTextFile).mockReset().mockResolvedValue(undefined)
  vi.mocked(revealItemInDir).mockReset().mockResolvedValue(undefined)
})

describe('formatSyncLogLine', () => {
  it('reads when / how bad / what', () => {
    expect(formatSyncLogLine('info', 'synchronisation terminée', undefined, AT)).toBe(
      '2026-09-10T19:45:12.345Z  INFO    synchronisation terminée\n'
    )
  })

  it('marks a failure as such, so a log can be skimmed', () => {
    expect(formatSyncLogLine('error', 'connexion refusée', undefined, AT)).toContain('ERREUR  connexion refusée')
  })

  it('carries the raw detail, status included, for the bug report', () => {
    const failure = Object.assign(new Error('Failed to fetch'), { name: 'ClientResponseError', status: 0 })
    expect(formatSyncLogLine('error', 'connexion', failure, AT)).toBe(
      '2026-09-10T19:45:12.345Z  ERREUR  connexion | ClientResponseError: Failed to fetch (status 0)\n'
    )
  })

  it('serialises a plain object detail, and never throws on a circular one', () => {
    expect(formatSyncLogLine('info', 'résultat', { pushed: 2, pulled: 1 }, AT)).toContain('{"pushed":2,"pulled":1}')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => formatSyncLogLine('info', 'résultat', circular, AT)).not.toThrow()
  })
})

describe('trimSyncLog', () => {
  it('leaves a short log alone', () => {
    expect(trimSyncLog('une ligne\n')).toBe('une ligne\n')
  })

  it('keeps the recent tail, at a line boundary, and says so', () => {
    const line = 'x'.repeat(99) + '\n'
    const trimmed = trimSyncLog(line.repeat(8000))

    expect(trimmed.startsWith('--- journal tronqué')).toBe(true)
    expect(trimmed.split('\n')[1]).toBe('x'.repeat(99)) // no half line at the seam
    expect(trimmed.length).toBeLessThan(256 * 1024 + 100)
  })
})

describe('logSyncEvent', () => {
  it('creates the config folder when it is missing, then writes the line', async () => {
    vi.mocked(exists).mockImplementation(async path => path !== '/config')

    await logSyncEvent('info', 'synchronisation demandée')

    expect(mkdir).toHaveBeenCalledWith('/config', { recursive: true })
    const [path, contents] = vi.mocked(writeTextFile).mock.calls[0]
    expect(path).toBe('/config/sync-debug.log')
    expect(contents).toContain('INFO    synchronisation demandée')
  })

  it('appends to what the file already holds', async () => {
    vi.mocked(readTextFile).mockResolvedValue('ligne précédente\n')

    await logSyncEvent('error', 'échec réseau')

    const contents = vi.mocked(writeTextFile).mock.calls[0][1] as string
    expect(contents.startsWith('ligne précédente\n')).toBe(true)
    expect(contents).toContain('ERREUR  échec réseau')
  })

  it('writes one line per file the batch failed on, so the detail is in the log', async () => {
    await logSyncEvent('error', 'synchronisation terminée avec des erreurs', {
      errors: [{ fileId: 'file-1', message: 'réseau coupé' }],
    })
    expect(vi.mocked(writeTextFile).mock.calls[0][1]).toContain('réseau coupé')
  })

  it('never throws when the log cannot be written — it documents failures, it must not cause one', async () => {
    vi.mocked(writeTextFile).mockRejectedValue(new Error('disque plein'))
    await expect(logSyncEvent('error', 'échec')).resolves.toBeUndefined()

    vi.mocked(mkdir).mockRejectedValue(new Error('permission denied'))
    vi.mocked(exists).mockResolvedValue(false)
    await expect(logSyncEvent('error', 'échec')).resolves.toBeUndefined()

    vi.mocked(readTextFile).mockRejectedValue(new Error('illisible'))
    vi.mocked(exists).mockResolvedValue(true)
    await expect(logSyncEvent('info', 'échec')).resolves.toBeUndefined()
  })
})

describe('revealSyncLog', () => {
  it('reveals the file once it exists', async () => {
    vi.mocked(exists).mockResolvedValue(true)

    expect(await revealSyncLog()).toBe('/config/sync-debug.log')
    expect(revealItemInDir).toHaveBeenCalledWith('/config/sync-debug.log')
  })

  it('reveals the folder on a first run, when there is no log yet', async () => {
    vi.mocked(exists).mockResolvedValue(false)

    expect(await revealSyncLog()).toBe('/config')
    expect(revealItemInDir).toHaveBeenCalledWith('/config')
  })

  it('propagates a failure to the caller, which can then say so', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(revealItemInDir).mockRejectedValue(new Error('explorateur indisponible'))

    await expect(revealSyncLog()).rejects.toThrow('explorateur indisponible')
  })
})

describe('syncLogPath', () => {
  it('sits next to the other app-internal files', async () => {
    expect(await syncLogPath()).toBe('/config/sync-debug.log')
  })
})
