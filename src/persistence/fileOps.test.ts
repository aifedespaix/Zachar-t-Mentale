import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMindMapFile, createSubfolder, renamePath, deletePath } from './fileOps'

vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  writeTextFile: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

import { mkdir, remove, rename, writeTextFile } from '@tauri-apps/plugin-fs'

describe('createMindMapFile', () => {
  beforeEach(() => vi.mocked(writeTextFile).mockReset())

  it('writes a new .json file with a single default root card', async () => {
    const path = await createMindMapFile('/cours', 'Chapitre 3')
    expect(path).toBe('/cours/Chapitre 3.json')

    const [writtenPath, content] = vi.mocked(writeTextFile).mock.calls[0]
    expect(writtenPath).toBe('/cours/Chapitre 3.json')
    const cards = JSON.parse(content as string)
    expect(cards).toEqual([
      expect.objectContaining({ level: 1, title: 'Nouveau chapitre', parentId: null, order: 0 }),
    ])
  })

  it('does not double-append .json when the given name already has it', async () => {
    const path = await createMindMapFile('/cours', 'Chapitre 3.json')
    expect(path).toBe('/cours/Chapitre 3.json')
  })
})

describe('createSubfolder', () => {
  beforeEach(() => vi.mocked(mkdir).mockReset())

  it('creates a subfolder at the given path', async () => {
    const path = await createSubfolder('/cours', 'Chimie')
    expect(mkdir).toHaveBeenCalledWith('/cours/Chimie')
    expect(path).toBe('/cours/Chimie')
  })
})

describe('renamePath', () => {
  beforeEach(() => vi.mocked(rename).mockReset())

  it('renames a file or folder', async () => {
    await renamePath('/cours/old.json', '/cours/new.json')
    expect(rename).toHaveBeenCalledWith('/cours/old.json', '/cours/new.json')
  })
})

describe('deletePath', () => {
  beforeEach(() => vi.mocked(remove).mockReset())

  it('deletes a single file non-recursively', async () => {
    await deletePath('/cours/chapitre.json', false)
    expect(remove).toHaveBeenCalledWith('/cours/chapitre.json', { recursive: false })
  })

  it('deletes a folder recursively', async () => {
    await deletePath('/cours/chimie', true)
    expect(remove).toHaveBeenCalledWith('/cours/chimie', { recursive: true })
  })
})
