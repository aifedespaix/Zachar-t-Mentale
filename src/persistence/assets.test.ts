import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sidecarDirOf, assetPathOf, writeAsset, readAssetBytes, MAX_ASSET_BYTES } from './assets'

vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  exists: vi.fn(),
}))

import { mkdir, readFile, writeFile, exists } from '@tauri-apps/plugin-fs'

describe('sidecarDirOf', () => {
  it('sits next to the map, named after it', () => {
    expect(sidecarDirOf('/cours/maths/pourcentages.json')).toBe('/cours/maths/pourcentages.assets')
  })

  it('keeps a Windows path on backslashes', () => {
    expect(sidecarDirOf('C:\\cours\\maths\\pourcentages.json')).toBe('C:\\cours\\maths\\pourcentages.assets')
  })

  it('handles a bare file name with no folder', () => {
    expect(sidecarDirOf('carte.json')).toBe('carte.assets')
  })

  it('tolerates a map whose name is not .json', () => {
    expect(sidecarDirOf('/cours/carte')).toBe('/cours/carte.assets')
  })
})

describe('assetPathOf', () => {
  it('joins the sidecar and the asset name', () => {
    expect(assetPathOf('/cours/carte.json', 'a1.png')).toBe('/cours/carte.assets/a1.png')
  })

  it('refuses an asset name that tries to escape the sidecar', () => {
    // Asset names come from a .json someone may have shared.
    expect(() => assetPathOf('/cours/carte.json', '../../.ssh/id_rsa')).toThrow()
    expect(() => assetPathOf('/cours/carte.json', 'sous/dossier.png')).toThrow()
    expect(() => assetPathOf('/cours/carte.json', '..\\secrets.png')).toThrow()
    expect(() => assetPathOf('/cours/carte.json', '/etc/passwd')).toThrow()
  })
})

describe('writeAsset', () => {
  beforeEach(() => {
    vi.mocked(mkdir).mockReset().mockResolvedValue(undefined)
    vi.mocked(writeFile).mockReset().mockResolvedValue(undefined)
    vi.mocked(exists).mockReset().mockResolvedValue(false)
  })

  const bytes = new Uint8Array([1, 2, 3, 4])

  it('names the file by its content hash, so the same picture twice costs one file', async () => {
    const first = await writeAsset('/cours/carte.json', bytes, 'png')
    const second = await writeAsset('/cours/carte.json', new Uint8Array([1, 2, 3, 4]), 'png')
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{16}\.png$/)
  })

  it('gives different content a different name', async () => {
    const a = await writeAsset('/cours/carte.json', bytes, 'png')
    const b = await writeAsset('/cours/carte.json', new Uint8Array([9, 9, 9]), 'png')
    expect(a).not.toBe(b)
  })

  it('creates the sidecar folder before writing', async () => {
    await writeAsset('/cours/carte.json', bytes, 'png')
    expect(mkdir).toHaveBeenCalledWith('/cours/carte.assets', { recursive: true })
  })

  it('does not rewrite an asset that is already there', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    await writeAsset('/cours/carte.json', bytes, 'png')
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('refuses a file too large to belong in a mind map', async () => {
    const huge = new Uint8Array(MAX_ASSET_BYTES + 1)
    await expect(writeAsset('/cours/carte.json', huge, 'png')).rejects.toThrow(/volumineuse/i)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('normalizes the extension rather than trusting it', async () => {
    const name = await writeAsset('/cours/carte.json', bytes, '.PNG')
    expect(name).toMatch(/\.png$/)
  })

  it('falls back to png for an unusable extension', async () => {
    const name = await writeAsset('/cours/carte.json', bytes, '../evil')
    expect(name).toMatch(/^[0-9a-f]{16}\.png$/)
  })
})

describe('readAssetBytes', () => {
  it('reads from inside the sidecar', async () => {
    vi.mocked(readFile).mockResolvedValue(new Uint8Array([7]))
    await readAssetBytes('/cours/carte.json', 'a1.png')
    expect(readFile).toHaveBeenCalledWith('/cours/carte.assets/a1.png')
  })

  it('refuses to read outside the sidecar', async () => {
    await expect(readAssetBytes('/cours/carte.json', '../../secret')).rejects.toThrow()
  })
})
