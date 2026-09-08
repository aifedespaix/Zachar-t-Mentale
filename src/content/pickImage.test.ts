import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mimeForPath, pickImageFile } from './pickImage'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn() }))

import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'

describe('mimeForPath', () => {
  it('derives the type from the extension, case-insensitively', () => {
    expect(mimeForPath('/x/schema.PNG')).toBe('image/png')
    expect(mimeForPath('/x/photo.jpeg')).toBe('image/jpeg')
    expect(mimeForPath('/x/figure.svg')).toBe('image/svg+xml')
  })

  it('falls back rather than returning an empty type', () => {
    expect(mimeForPath('/x/sans-extension')).toBe('image/png')
  })
})

describe('pickImageFile', () => {
  beforeEach(() => {
    vi.mocked(open).mockReset()
    vi.mocked(readFile).mockReset().mockResolvedValue(new Uint8Array([1, 2]))
  })

  it('reads the chosen file and names it', async () => {
    vi.mocked(open).mockResolvedValue('/cours/schema-cellule.png')

    const source = await pickImageFile()

    expect(source).toMatchObject({ mime: 'image/png', name: 'schema-cellule.png' })
    expect(readFile).toHaveBeenCalledWith('/cours/schema-cellule.png')
  })

  it('treats a cancelled dialog as a no-op, not an error', async () => {
    vi.mocked(open).mockResolvedValue(null)
    await expect(pickImageFile()).resolves.toBeNull()
    expect(readFile).not.toHaveBeenCalled()
  })
})
