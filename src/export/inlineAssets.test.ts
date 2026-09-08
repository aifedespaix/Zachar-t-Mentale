import { describe, it, expect, vi, beforeEach } from 'vitest'
import { inlineAssets } from './inlineAssets'
import type { Card } from '../types/card'

vi.mock('../persistence/assets', () => ({ readAssetBytes: vi.fn() }))
import { readAssetBytes } from '../persistence/assets'

const cardWith = (id: string, asset: string): Card => ({
  id, level: 2, title: id, parentId: 'root', order: 0,
  content: [{ kind: 'image', asset, alt: 'S', width: 10, height: 5 }],
  definition: '[image : S]',
})

describe('inlineAssets', () => {
  beforeEach(() => vi.mocked(readAssetBytes).mockReset().mockResolvedValue(new Uint8Array([1, 2, 3])))

  it('turns each referenced asset into a data URI', async () => {
    const inlined = await inlineAssets([cardWith('a', 'x.png')], '/cours/carte.json')
    expect(inlined.get('x.png')).toMatch(/^data:image\/png;base64,/)
  })

  it('reads each asset once even when several cards share it', async () => {
    const cards = [cardWith('a', 'x.png'), cardWith('b', 'x.png')]
    await inlineAssets(cards, '/cours/carte.json')
    expect(readAssetBytes).toHaveBeenCalledTimes(1)
  })

  it('omits an unreadable asset instead of failing the whole export', async () => {
    // The alternative is a thrown capture: html-to-image rejects the entire
    // page when it meets an image it cannot re-encode.
    vi.mocked(readAssetBytes).mockRejectedValueOnce(new Error('ENOENT'))
    const inlined = await inlineAssets([cardWith('a', 'manquante.png')], '/cours/carte.json')
    expect(inlined.size).toBe(0)
  })

  it('is empty when no file is open', async () => {
    expect((await inlineAssets([cardWith('a', 'x.png')], null)).size).toBe(0)
    expect(readAssetBytes).not.toHaveBeenCalled()
  })

  it('ignores cards with no image', async () => {
    const plain: Card = { id: 'p', level: 2, title: 'P', parentId: 'root', order: 0, definition: 'texte' }
    expect((await inlineAssets([plain], '/cours/carte.json')).size).toBe(0)
  })

  it('encodes a payload larger than the call-stack limit of fromCharCode', async () => {
    vi.mocked(readAssetBytes).mockResolvedValue(new Uint8Array(200_000).fill(65))
    const inlined = await inlineAssets([cardWith('a', 'grande.png')], '/cours/carte.json')
    expect(inlined.get('grande.png')!.length).toBeGreaterThan(100_000)
  })
})
