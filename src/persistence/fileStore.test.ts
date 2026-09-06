import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadMindMap, saveMindMap } from './fileStore'
import type { Card } from '../types/card'

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
  it('serializes and writes to the given path', async () => {
    await saveMindMap('/fake/path.json', sample)
    expect(writeTextFile).toHaveBeenCalledWith('/fake/path.json', JSON.stringify(sample, null, 2))
  })
})
