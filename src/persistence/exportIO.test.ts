import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(), open: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), readFile: vi.fn() }))

import { save, open } from '@tauri-apps/plugin-dialog'
import { writeFile, readFile } from '@tauri-apps/plugin-fs'
import { saveBytesAs, pickXmindFile, readBinaryFile, dataUrlToBytes } from './exportIO'

describe('saveBytesAs', () => {
  beforeEach(() => {
    vi.mocked(save).mockReset()
    vi.mocked(writeFile).mockReset()
  })

  it('writes the bytes to the chosen path and returns it', async () => {
    vi.mocked(save).mockResolvedValue('/home/user/chapitre.pdf')
    const path = await saveBytesAs(new Uint8Array([1, 2]), 'chapitre.pdf', [{ name: 'PDF', extensions: ['pdf'] }])
    expect(path).toBe('/home/user/chapitre.pdf')
    expect(writeFile).toHaveBeenCalledWith('/home/user/chapitre.pdf', new Uint8Array([1, 2]))
  })

  it('returns null and writes nothing when the dialog is cancelled', async () => {
    vi.mocked(save).mockResolvedValue(null)
    const path = await saveBytesAs(new Uint8Array([1]), 'x.pdf', [])
    expect(path).toBeNull()
    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('pickXmindFile', () => {
  beforeEach(() => vi.mocked(open).mockReset())

  it('opens a dialog filtered to .xmind and returns the picked path', async () => {
    vi.mocked(open).mockResolvedValue('/cours/vieux.xmind')
    expect(await pickXmindFile()).toBe('/cours/vieux.xmind')
    expect(open).toHaveBeenCalledWith({ multiple: false, filters: [{ name: 'XMind', extensions: ['xmind'] }] })
  })

  it('returns null when the dialog is cancelled', async () => {
    vi.mocked(open).mockResolvedValue(null)
    expect(await pickXmindFile()).toBeNull()
  })
})

describe('readBinaryFile', () => {
  it('delegates to the fs plugin\'s binary readFile', async () => {
    vi.mocked(readFile).mockResolvedValue(new Uint8Array([9]))
    expect(await readBinaryFile('/a/b.xmind')).toEqual(new Uint8Array([9]))
    expect(readFile).toHaveBeenCalledWith('/a/b.xmind')
  })
})

describe('dataUrlToBytes', () => {
  it('decodes a base64 data URL into its raw bytes', () => {
    // "AAECAw==" is the base64 encoding of the bytes [0, 1, 2, 3]
    const bytes = dataUrlToBytes('data:image/png;base64,AAECAw==')
    expect(bytes).toEqual(new Uint8Array([0, 1, 2, 3]))
  })

  it('returns an empty array for a data URL with no comma-separated payload', () => {
    const bytes = dataUrlToBytes('not-a-data-url')
    expect(bytes).toEqual(new Uint8Array([]))
  })
})
