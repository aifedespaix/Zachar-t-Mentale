import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMindMapFile, createSubfolder, renamePath, deletePath, freeMindMapPath, freeSiblingPath, duplicatePath } from './fileOps'

vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  writeTextFile: vi.fn(),
  exists: vi.fn(),
  readDir: vi.fn(),
  copyFile: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))
vi.mock('./fileStore', () => ({ mindMapExists: vi.fn() }))

import { mkdir, remove, rename, writeTextFile, exists, readDir, copyFile } from '@tauri-apps/plugin-fs'
import { mindMapExists } from './fileStore'

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

describe('freeMindMapPath', () => {
  beforeEach(() => vi.mocked(mindMapExists).mockReset())

  it('returns the plain sanitized name when nothing collides', async () => {
    vi.mocked(mindMapExists).mockResolvedValue(false)
    const path = await freeMindMapPath('/cours', 'Vecteurs: Forces')
    expect(path).toBe('/cours/Vecteurs Forces.json')
  })

  it('appends a numbered suffix until it finds a free name', async () => {
    vi.mocked(mindMapExists)
      .mockResolvedValueOnce(true) // "Chapitre.json" taken
      .mockResolvedValueOnce(true) // "Chapitre (2).json" taken
      .mockResolvedValueOnce(false) // "Chapitre (3).json" free
    const path = await freeMindMapPath('/cours', 'Chapitre')
    expect(path).toBe('/cours/Chapitre (3).json')
  })
})


describe('the asset sidecar travels with its mind map', () => {
  beforeEach(() => {
    vi.mocked(rename).mockReset().mockResolvedValue(undefined)
    vi.mocked(remove).mockReset().mockResolvedValue(undefined)
    vi.mocked(exists).mockReset().mockResolvedValue(true)
  })

  it('renames the sidecar alongside the map', async () => {
    // Blocks address assets relative to a sidecar named after the file, so
    // leaving it behind breaks every image in the map at once.
    await renamePath('/cours/chapitre.json', '/cours/chapitre 2.json')
    expect(vi.mocked(rename).mock.calls).toEqual([
      ['/cours/chapitre.json', '/cours/chapitre 2.json'],
      ['/cours/chapitre.assets', '/cours/chapitre 2.assets'],
    ])
  })

  it('does not look for a sidecar when renaming a folder', async () => {
    await renamePath('/cours/maths', '/cours/mathematiques')
    expect(vi.mocked(rename).mock.calls).toHaveLength(1)
  })

  it('leaves a map with no sidecar alone', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    await renamePath('/cours/chapitre.json', '/cours/autre.json')
    expect(vi.mocked(rename).mock.calls).toHaveLength(1)
  })

  it('deletes the sidecar with the map', async () => {
    await deletePath('/cours/chapitre.json', false)
    expect(vi.mocked(remove).mock.calls).toEqual([
      ['/cours/chapitre.json', { recursive: false }],
      ['/cours/chapitre.assets', { recursive: true }],
    ])
  })

  it('deletes a folder without hunting for a sidecar', async () => {
    await deletePath('/cours/maths', true)
    expect(vi.mocked(remove).mock.calls).toHaveLength(1)
  })
})

describe('freeSiblingPath', () => {
  beforeEach(() => {
    vi.mocked(mindMapExists).mockReset()
    vi.mocked(exists).mockReset()
  })

  it('returns the plain sanitized name for a file, appending .json', async () => {
    vi.mocked(mindMapExists).mockResolvedValue(false)
    const path = await freeSiblingPath('/cours', 'Chapitre 3 (copie)', false)
    expect(path).toBe('/cours/Chapitre 3 (copie).json')
  })

  it('returns the plain sanitized name for a folder, with no extension', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const path = await freeSiblingPath('/cours', 'Chimie (copie)', true)
    expect(path).toBe('/cours/Chimie (copie)')
  })

  it('appends a numbered suffix until it finds a free file name', async () => {
    vi.mocked(mindMapExists).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const path = await freeSiblingPath('/cours', 'Chapitre', false)
    expect(path).toBe('/cours/Chapitre (2).json')
  })

  it('appends a numbered suffix until it finds a free folder name', async () => {
    vi.mocked(exists).mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const path = await freeSiblingPath('/cours', 'Chimie', true)
    expect(path).toBe('/cours/Chimie (3)')
  })
})

describe('duplicatePath', () => {
  beforeEach(() => {
    vi.mocked(copyFile).mockReset().mockResolvedValue(undefined)
    vi.mocked(mkdir).mockReset().mockResolvedValue(undefined)
    vi.mocked(readDir).mockReset()
    vi.mocked(exists).mockReset().mockResolvedValue(false)
  })

  it('copies a single mind map file with no sidecar', async () => {
    await duplicatePath('/cours/chapitre.json', '/cours/chapitre (copie).json', false)
    expect(copyFile).toHaveBeenCalledWith('/cours/chapitre.json', '/cours/chapitre (copie).json')
    expect(mkdir).not.toHaveBeenCalled()
  })

  it('copies the asset sidecar alongside a duplicated mind map', async () => {
    vi.mocked(exists).mockResolvedValueOnce(true)
    vi.mocked(readDir).mockResolvedValueOnce([
      { name: 'schema.png', isDirectory: false, isFile: true, isSymlink: false },
    ])
    await duplicatePath('/cours/chapitre.json', '/cours/chapitre (copie).json', false)
    expect(mkdir).toHaveBeenCalledWith('/cours/chapitre (copie).assets')
    expect(copyFile).toHaveBeenCalledWith(
      '/cours/chapitre.assets/schema.png',
      '/cours/chapitre (copie).assets/schema.png'
    )
  })

  it('leaves a map with no sidecar alone', async () => {
    await duplicatePath('/cours/chapitre.json', '/cours/chapitre (copie).json', false)
    expect(mkdir).not.toHaveBeenCalled()
  })

  it('recursively copies a folder and its contents', async () => {
    vi.mocked(readDir)
      .mockResolvedValueOnce([
        { name: 'atomes.json', isDirectory: false, isFile: true, isSymlink: false },
        { name: 'sous-dossier', isDirectory: true, isFile: false, isSymlink: false },
      ])
      .mockResolvedValueOnce([{ name: 'liaisons.json', isDirectory: false, isFile: true, isSymlink: false }])
    await duplicatePath('/cours/chimie', '/cours/chimie (copie)', true)

    expect(mkdir).toHaveBeenCalledWith('/cours/chimie (copie)')
    expect(mkdir).toHaveBeenCalledWith('/cours/chimie (copie)/sous-dossier')
    expect(copyFile).toHaveBeenCalledWith('/cours/chimie/atomes.json', '/cours/chimie (copie)/atomes.json')
    expect(copyFile).toHaveBeenCalledWith(
      '/cours/chimie/sous-dossier/liaisons.json',
      '/cours/chimie (copie)/sous-dossier/liaisons.json'
    )
  })
})
