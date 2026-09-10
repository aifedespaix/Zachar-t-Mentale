import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  loadMindMap,
  saveMindMap,
  loadMindMapMeta,
  stampMindMapSyncMeta,
  stripMindMapSyncMeta,
} from './fileStore'
import type { Card, MindMapMeta } from '../types/card'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}))

import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

const sample: Card[] = [{ id: 'root', level: 1, title: 'Chapitre', parentId: null, order: 0 }]

describe('loadMindMap', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
  })

  it('reads a file and deserializes its content', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(sample))
    const result = await loadMindMap('/fake/path.json')
    expect(readTextFile).toHaveBeenCalledWith('/fake/path.json')
    expect(result).toEqual(sample)
  })

  it('returns null (not an error) when the file does not exist yet', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const result = await loadMindMap('/fake/path.json')
    expect(result).toBeNull()
    expect(readTextFile).not.toHaveBeenCalled()
  })

  it('rejects when the file exists but cannot be read', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockRejectedValue(new Error('permission denied'))
    await expect(loadMindMap('/fake/path.json')).rejects.toThrow('permission denied')
  })

  it('rejects when the file exists but holds corrupt JSON', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue('{ not json')
    await expect(loadMindMap('/fake/path.json')).rejects.toThrow()
  })
})

describe('saveMindMap', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
    vi.mocked(writeTextFile).mockReset()
  })

  it('serializes and writes to the given path', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    await saveMindMap('/fake/path.json', sample)
    expect(writeTextFile).toHaveBeenCalledWith('/fake/path.json', JSON.stringify(sample, null, 2))
  })
})

const meta: MindMapMeta = { id: 'abc-123', author: 'aife', role: 'prof', lastModified: '2026-01-01T00:00:00.000Z' }

describe('loadMindMapMeta', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
  })

  it('returns null for a file that does not exist', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    expect(await loadMindMapMeta('/fake/path.zmap')).toBeNull()
  })

  it('returns null for a legacy bare-array file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(sample))
    expect(await loadMindMapMeta('/fake/path.zmap')).toBeNull()
  })

  it('returns the meta of an enveloped file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ meta, cards: sample }))
    expect(await loadMindMapMeta('/fake/path.zmap')).toEqual(meta)
  })
})

describe('stripMindMapSyncMeta', () => {
  beforeEach(() => {
    vi.mocked(readTextFile).mockReset()
    vi.mocked(writeTextFile).mockReset()
  })

  it('rewrites an enveloped file as a bare array of cards, and says it did', async () => {
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ meta, cards: sample }))

    expect(await stripMindMapSyncMeta('/cours/chapitre (copie).zmap')).toBe(true)

    expect(writeTextFile).toHaveBeenCalledWith('/cours/chapitre (copie).zmap', JSON.stringify(sample, null, 2))
  })

  it('leaves a file with no meta byte-for-byte alone — no pointless rewrite', async () => {
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(sample))

    expect(await stripMindMapSyncMeta('/cours/chapitre (copie).zmap')).toBe(false)

    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it('never throws on an unreadable or corrupt copy — the duplicate itself already succeeded', async () => {
    vi.mocked(readTextFile).mockRejectedValue(new Error('permission denied'))
    expect(await stripMindMapSyncMeta('/cours/chapitre (copie).zmap')).toBe(false)

    vi.mocked(readTextFile).mockResolvedValue('{ not json')
    expect(await stripMindMapSyncMeta('/cours/chapitre (copie).zmap')).toBe(false)

    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it('never throws when the rewrite itself fails', async () => {
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ meta, cards: sample }))
    vi.mocked(writeTextFile).mockRejectedValue(new Error('disque plein'))

    await expect(stripMindMapSyncMeta('/cours/chapitre (copie).zmap')).resolves.toBe(false)
  })
})

describe('stampMindMapSyncMeta', () => {
  beforeEach(() => {
    vi.mocked(readTextFile).mockReset()
    vi.mocked(writeTextFile).mockReset()
  })

  it('gives a local map a fresh identity owned by the given author', async () => {
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(sample))
    const before = Date.now()

    expect(await stampMindMapSyncMeta('/cours/chapitre.zmap', 'aife', 'prof')).toBe(true)

    const [path, contents] = vi.mocked(writeTextFile).mock.calls[0]
    expect(path).toBe('/cours/chapitre.zmap')
    const written = JSON.parse(contents as string)
    expect(written.cards).toEqual(sample) // the cards themselves are untouched
    expect(written.meta.author).toBe('aife')
    expect(written.meta.role).toBe('prof')
    expect(written.meta.id).toBeTruthy()
    expect(new Date(written.meta.lastModified).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('refuses to overwrite an existing meta — that id points at a remote record', async () => {
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ meta, cards: sample }))

    expect(await stampMindMapSyncMeta('/cours/chapitre.zmap', 'aife', 'prof')).toBe(false)
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it('propagates a failure, unlike the strip: this one runs from a click and must be reported', async () => {
    vi.mocked(readTextFile).mockRejectedValue(new Error('permission denied'))
    await expect(stampMindMapSyncMeta('/cours/chapitre.zmap', 'aife', 'prof')).rejects.toThrow('permission denied')

    vi.mocked(readTextFile).mockResolvedValue('{ not json')
    await expect(stampMindMapSyncMeta('/cours/chapitre.zmap', 'aife', 'prof')).rejects.toThrow()
  })
})

describe('saveMindMap meta preservation', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
    vi.mocked(writeTextFile).mockReset()
  })

  it('keeps writing a bare array when the file has no existing meta', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    await saveMindMap('/fake/path.zmap', sample)
    expect(writeTextFile).toHaveBeenCalledWith('/fake/path.zmap', JSON.stringify(sample, null, 2))
  })

  it('preserves author/id/role and bumps lastModified when the file already has meta', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ meta, cards: sample }))
    const before = Date.now()
    await saveMindMap('/fake/path.zmap', sample)
    const [, written] = vi.mocked(writeTextFile).mock.calls[0]
    const savedMeta = JSON.parse(written as string).meta as MindMapMeta
    expect(savedMeta.id).toBe(meta.id)
    expect(savedMeta.author).toBe(meta.author)
    expect(savedMeta.role).toBe(meta.role)
    expect(new Date(savedMeta.lastModified).getTime()).toBeGreaterThanOrEqual(before)
  })
})
