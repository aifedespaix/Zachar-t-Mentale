import { describe, it, expect, vi, beforeEach } from 'vitest'
import { imageBlockFrom, probeImageSize, extensionForMime, altFromName } from './imageBlock'

vi.mock('../persistence/assets', () => ({ writeAsset: vi.fn() }))
import { writeAsset } from '../persistence/assets'

describe('extensionForMime', () => {
  it('maps the usual image types', () => {
    expect(extensionForMime('image/png')).toBe('png')
    expect(extensionForMime('image/jpeg')).toBe('jpg')
    expect(extensionForMime('IMAGE/WEBP')).toBe('webp')
  })

  it('falls back to the file name, then to png', () => {
    expect(extensionForMime('application/octet-stream', 'schema.avif')).toBe('avif')
    expect(extensionForMime('', '')).toBe('png')
  })
})

describe('altFromName', () => {
  it('turns a file name into readable words', () => {
    expect(altFromName('schema-cellule_animale.png')).toBe('schema cellule animale')
  })

  it('is empty for a clipboard paste or a hash-like name', () => {
    expect(altFromName('')).toBe('')
    expect(altFromName('a3f91c2b7d4e.png')).toBe('')
  })
})

describe('probeImageSize', () => {
  it('falls back rather than hanging when a decode never settles', async () => {
    // A truncated file can leave onload/onerror unfired; without the timeout
    // the insertion would stay pending forever with no way out.
    const size = await probeImageSize(new Uint8Array([0]), 'image/png', 10)
    expect(size).toEqual({ width: 320, height: 240 })
  })

  it('never returns a non-finite or zero dimension, whatever the decode does', async () => {
    // A NaN pair serializes to `null` and the block is dropped on the next
    // load — the picture is lost while the definition still claims one.
    const size = await probeImageSize(new Uint8Array([0, 1, 2]), 'image/png', 20)
    expect(Number.isFinite(size.width)).toBe(true)
    expect(Number.isFinite(size.height)).toBe(true)
    expect(size.width).toBeGreaterThan(0)
    expect(size.height).toBeGreaterThan(0)
  })
})

describe('imageBlockFrom', () => {
  beforeEach(() => vi.mocked(writeAsset).mockReset().mockResolvedValue('a3f9.png'))

  it('stores the file and references it by name, never by path', async () => {
    const block = await imageBlockFrom('/cours/carte.json', {
      bytes: new Uint8Array([1, 2]),
      mime: 'image/png',
      name: 'cycle-de-l-eau.png',
    }, { probeTimeoutMs: 20 })

    expect(writeAsset).toHaveBeenCalledWith('/cours/carte.json', expect.any(Uint8Array), 'png')
    expect(block).toMatchObject({ kind: 'image', asset: 'a3f9.png', alt: 'cycle de l eau' })
    expect(block).not.toHaveProperty('path')
  })

  it('always produces usable dimensions', async () => {
    const block = (await imageBlockFrom('/cours/carte.json', {
      bytes: new Uint8Array([1]),
      mime: 'image/png',
    }, { probeTimeoutMs: 20 })) as { width: number; height: number }

    expect(Number.isFinite(block.width) && block.width > 0).toBe(true)
    expect(Number.isFinite(block.height) && block.height > 0).toBe(true)
  })

  it('propagates a storage failure instead of inserting a broken block', async () => {
    // `…Once`, not a persistent rejecting mock: the persistent form leaves a
    // rejected promise unconsumed after the test and vitest reports it as a
    // failure of this test.
    vi.mocked(writeAsset).mockRejectedValueOnce(new Error('Image trop volumineuse'))

    await expect(
      imageBlockFrom('/cours/carte.json', { bytes: new Uint8Array([1]), mime: 'image/png' }, { probeTimeoutMs: 20 })
    ).rejects.toThrow(/volumineuse/)
  })
})
