import { describe, it, expect, vi } from 'vitest'
import { loadMindMap, saveMindMap } from './fileStore'
import type { Card } from '../types/card'

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}))

import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

const sample: Card[] = [{ id: 'root', level: 1, title: 'Chapitre', parentId: null, order: 0 }]

describe('loadMindMap', () => {
  it('reads a file and deserializes its content', async () => {
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(sample))
    const result = await loadMindMap('/fake/path.json')
    expect(readTextFile).toHaveBeenCalledWith('/fake/path.json')
    expect(result).toEqual(sample)
  })
})

describe('saveMindMap', () => {
  it('serializes and writes to the given path', async () => {
    await saveMindMap('/fake/path.json', sample)
    expect(writeTextFile).toHaveBeenCalledWith('/fake/path.json', JSON.stringify(sample, null, 2))
  })
})
