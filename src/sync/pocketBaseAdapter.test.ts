import { describe, it, expect, vi } from 'vitest'
import { createSyncClient } from './pocketBaseAdapter'
import type PocketBase from 'pocketbase'

function fakePb(overrides: Record<string, any> = {}): PocketBase {
  const mindMaps = { getFullList: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), getOne: vi.fn() }
  const assets = { getFullList: vi.fn().mockResolvedValue([]), create: vi.fn(), getOne: vi.fn() }
  const collections: Record<string, unknown> = { cartes_mentales: mindMaps, assets, ...overrides }
  return {
    collection: (name: string) => collections[name],
    files: { getURL: vi.fn().mockReturnValue('https://pi.local/file.png') },
  } as unknown as PocketBase
}

describe('createSyncClient — mindMaps', () => {
  it('maps getFullList records to RemoteMindMapRecord', async () => {
    const raw = { id: 'r1', file_id: 'f1', author: 'aife', path: 'a.zmap', content: '[]', updated: 'u' }
    const pb = fakePb()
    vi.mocked(pb.collection('cartes_mentales').getFullList).mockResolvedValue([raw])

    const client = createSyncClient(pb)
    expect(await client.mindMaps.getFullList()).toEqual([raw])
  })

  it('create() calls the PocketBase collection create()', async () => {
    const pb = fakePb()
    const created = { id: 'r2', file_id: 'f2', author: 'aife', path: 'b.zmap', content: '[]', updated: 'u' }
    vi.mocked(pb.collection('cartes_mentales').create).mockResolvedValue(created)

    const client = createSyncClient(pb)
    const result = await client.mindMaps.create({ file_id: 'f2', author: 'aife', path: 'b.zmap', content: '[]' })

    expect(pb.collection('cartes_mentales').create).toHaveBeenCalledWith({
      file_id: 'f2',
      author: 'aife',
      path: 'b.zmap',
      content: '[]',
    })
    expect(result).toEqual(created)
  })
})

describe('createSyncClient — assets', () => {
  it('upload() sends a FormData with hash, extension and the file blob', async () => {
    const pb = fakePb()
    const client = createSyncClient(pb)

    await client.assets.upload('hash1', 'png', new Uint8Array([1, 2, 3]))

    expect(pb.collection('assets').create).toHaveBeenCalledWith(expect.any(FormData))
    const form = vi.mocked(pb.collection('assets').create).mock.calls[0][0] as FormData
    expect(form.get('hash')).toBe('hash1')
    expect(form.get('extension')).toBe('png')
  })

  it('download() fetches the file URL and returns its bytes', async () => {
    const pb = fakePb()
    vi.mocked(pb.collection('assets').getOne).mockResolvedValue({ id: 'a1', hash: 'hash1', extension: 'png', file: 'hash1.png' })
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([9, 9]).buffer })

    const client = createSyncClient(pb)
    const bytes = await client.assets.download({ id: 'a1', hash: 'hash1', extension: 'png' })

    expect(pb.files.getURL).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), 'hash1.png')
    expect(bytes).toEqual(new Uint8Array([9, 9]))
  })

  it('download() throws a French error when the fetch response is not ok', async () => {
    const pb = fakePb()
    vi.mocked(pb.collection('assets').getOne).mockResolvedValue({ id: 'a1', hash: 'hash1', extension: 'png', file: 'hash1.png' })
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    const client = createSyncClient(pb)
    await expect(client.assets.download({ id: 'a1', hash: 'hash1', extension: 'png' })).rejects.toThrow('404')
  })
})
