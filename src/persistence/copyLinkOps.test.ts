import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MindMapMeta } from '../types/card'
import { copyLink, sourceLink } from '../sync/copyLink'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}))
vi.mock('./fileStore', () => ({ loadMindMapMeta: vi.fn(), setMindMapCopyLink: vi.fn() }))
vi.mock('./fileOps', () => ({ copyAssetSidecar: vi.fn(), movePath: vi.fn(), renamePath: vi.fn() }))

import { exists, readDir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { loadMindMapMeta, setMindMapCopyLink } from './fileStore'
import { copyAssetSidecar, movePath, renamePath } from './fileOps'
import {
  createLinkedCopy,
  linkedGroupOf,
  linkedMembersIn,
  moveLinkedGroup,
  renameLinkedGroup,
  unlinkIfAlone,
} from './copyLinkOps'

const ORIGINAL: MindMapMeta = {
  id: 'file-1',
  author: 'eleve1',
  role: 'eleve',
  lastModified: '2026-02-01T10:00:00.000Z',
}

/** Le dossier tel que `readDir` le rend : des noms, et rien d'autre. */
function folder(...names: string[]) {
  vi.mocked(readDir).mockResolvedValue(names.map(name => ({ name, isDirectory: false })) as never)
}

/** L'en-tête que chaque chemin renvoie, pour `loadMindMapMeta`. */
function metas(byPath: Record<string, MindMapMeta | null>) {
  vi.mocked(loadMindMapMeta).mockImplementation(path => Promise.resolve(byPath[path] ?? null))
}

beforeEach(() => {
  vi.mocked(exists).mockReset().mockResolvedValue(false)
  vi.mocked(readDir).mockReset().mockResolvedValue([])
  vi.mocked(readTextFile).mockReset()
  vi.mocked(writeTextFile).mockReset()
  vi.mocked(loadMindMapMeta).mockReset().mockResolvedValue(null)
  vi.mocked(setMindMapCopyLink).mockReset().mockResolvedValue(undefined)
  vi.mocked(copyAssetSidecar).mockReset().mockResolvedValue(undefined)
  vi.mocked(movePath).mockReset().mockResolvedValue(undefined)
  vi.mocked(renamePath).mockReset().mockResolvedValue(undefined)
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000')
})

describe('createLinkedCopy', () => {
  beforeEach(() => {
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({ meta: ORIGINAL, cards: [{ id: 'root', level: 1, title: 'R', parentId: null, order: 0 }] })
    )
  })

  it('writes « <original> (copie) » next to the original, with a fresh identity', async () => {
    const { path, link } = await createLinkedCopy({
      sourcePath: '/cours/Maths/Chapitre 1.zmap',
      author: 'eleve1',
      role: 'eleve',
    })

    expect(path).toBe('/cours/Maths/Chapitre 1 (copie).zmap')
    expect(link).toEqual({ groupId: 'file-1', role: 'copy', baseName: 'Chapitre 1', index: 1 })
    const written = JSON.parse(vi.mocked(writeTextFile).mock.calls[0]?.[1] as string)
    // Une identité NEUVE : deux fichiers locaux sur un même enregistrement
    // distant est exactement ce que le modèle en fourche interdit.
    expect(written.meta.id).not.toBe('file-1')
    expect(written.meta.author).toBe('eleve1')
    expect(written.meta.copyLink).toEqual(link)
    expect(written.cards).toHaveLength(1)
  })

  it('carries the images of the original over to the copy', async () => {
    await createLinkedCopy({ sourcePath: '/cours/Chapitre 1.zmap', author: 'eleve1', role: 'eleve' })
    expect(copyAssetSidecar).toHaveBeenCalledWith('/cours/Chapitre 1.zmap', '/cours/Chapitre 1 (copie).zmap')
  })

  it('marks the original as the source of the group, once the copy exists', async () => {
    await createLinkedCopy({ sourcePath: '/cours/Chapitre 1.zmap', author: 'eleve1', role: 'eleve' })
    expect(setMindMapCopyLink).toHaveBeenCalledWith('/cours/Chapitre 1.zmap', sourceLink('file-1', 'Chapitre 1'))
    // Le lien n'est posé qu'APRÈS l'écriture : sinon un échec laisserait un
    // original qui se dit lié à une copie qui n'existe pas.
    const writeOrder = vi.mocked(writeTextFile).mock.invocationCallOrder[0] ?? 0
    const linkOrder = vi.mocked(setMindMapCopyLink).mock.invocationCallOrder[0] ?? 0
    expect(linkOrder).toBeGreaterThan(writeOrder)
  })

  it('numbers a second copy instead of overwriting the first', async () => {
    folder('Chapitre 1.zmap', 'Chapitre 1 (copie).zmap')
    metas({
      '/cours/Chapitre 1 (copie).zmap': { ...ORIGINAL, id: 'file-2', copyLink: copyLink('file-1', 'Chapitre 1', 1) },
    })

    const { path } = await createLinkedCopy({ sourcePath: '/cours/Chapitre 1.zmap', author: 'eleve1', role: 'eleve' })

    expect(path).toBe('/cours/Chapitre 1 (copie 2).zmap')
  })

  it('never overwrites a file that already sits on the name, link or not', async () => {
    vi.mocked(exists).mockImplementation(path => Promise.resolve(path === '/cours/Chapitre 1 (copie).zmap'))

    const { path } = await createLinkedCopy({ sourcePath: '/cours/Chapitre 1.zmap', author: 'eleve1', role: 'eleve' })

    expect(path).toBe('/cours/Chapitre 1 (copie 2).zmap')
  })

  it('joins the existing group when what is copied is itself a copy', async () => {
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({
        meta: { ...ORIGINAL, id: 'file-2', copyLink: copyLink('file-1', 'Chapitre 1', 1) },
        cards: [],
      })
    )

    const { path, link } = await createLinkedCopy({
      sourcePath: '/cours/Chapitre 1 (copie).zmap',
      author: 'eleve1',
      role: 'eleve',
    })

    expect(link.groupId).toBe('file-1')
    expect(path).toBe('/cours/Chapitre 1 (copie 2).zmap')
    // L'original porte déjà le lien : rien à réécrire chez lui.
    expect(setMindMapCopyLink).not.toHaveBeenCalled()
  })

  it('refuses a file that has no sync identity at all', async () => {
    vi.mocked(readTextFile).mockResolvedValue('[]')
    await expect(
      createLinkedCopy({ sourcePath: '/cours/brouillon.zmap', author: 'eleve1', role: 'eleve' })
    ).rejects.toThrow(/identité de synchronisation/)
  })
})

describe('linkedMembersIn', () => {
  it('keeps only the mind maps of the asked group', async () => {
    folder('Chapitre 1.zmap', 'Chapitre 1 (copie).zmap', 'Autre.zmap', 'notes.pdf')
    metas({
      '/cours/Chapitre 1.zmap': { ...ORIGINAL, copyLink: sourceLink('file-1', 'Chapitre 1') },
      '/cours/Chapitre 1 (copie).zmap': { ...ORIGINAL, id: 'f2', copyLink: copyLink('file-1', 'Chapitre 1', 1) },
      '/cours/Autre.zmap': { ...ORIGINAL, id: 'f3', copyLink: sourceLink('autre-groupe', 'Autre') },
    })

    const members = await linkedMembersIn('/cours', 'file-1')

    expect(members.map(member => member.path)).toEqual(['/cours/Chapitre 1.zmap', '/cours/Chapitre 1 (copie).zmap'])
  })

  it('excludes the file that asked', async () => {
    folder('Chapitre 1.zmap', 'Chapitre 1 (copie).zmap')
    metas({
      '/cours/Chapitre 1.zmap': { ...ORIGINAL, copyLink: sourceLink('file-1', 'Chapitre 1') },
      '/cours/Chapitre 1 (copie).zmap': { ...ORIGINAL, id: 'f2', copyLink: copyLink('file-1', 'Chapitre 1', 1) },
    })

    const members = await linkedMembersIn('/cours', 'file-1', '/cours/Chapitre 1.zmap')

    expect(members.map(member => member.path)).toEqual(['/cours/Chapitre 1 (copie).zmap'])
  })

  it('answers nothing rather than failing on an unreadable folder', async () => {
    vi.mocked(readDir).mockRejectedValue(new Error('dossier illisible'))
    await expect(linkedMembersIn('/cours', 'file-1')).resolves.toEqual([])
  })
})

describe('linkedGroupOf', () => {
  it('is empty for a file that carries no link', async () => {
    metas({ '/cours/Chapitre 1.zmap': ORIGINAL })
    await expect(linkedGroupOf('/cours/Chapitre 1.zmap')).resolves.toEqual([])
  })

  it('puts the file itself at the head of its own group', async () => {
    folder('Chapitre 1.zmap', 'Chapitre 1 (copie).zmap')
    metas({
      '/cours/Chapitre 1.zmap': { ...ORIGINAL, copyLink: sourceLink('file-1', 'Chapitre 1') },
      '/cours/Chapitre 1 (copie).zmap': { ...ORIGINAL, id: 'f2', copyLink: copyLink('file-1', 'Chapitre 1', 1) },
    })

    const group = await linkedGroupOf('/cours/Chapitre 1.zmap')

    expect(group.map(member => member.path)).toEqual(['/cours/Chapitre 1.zmap', '/cours/Chapitre 1 (copie).zmap'])
  })
})

describe('renameLinkedGroup', () => {
  beforeEach(() => {
    folder('Chapitre 1.zmap', 'Chapitre 1 (copie).zmap')
    metas({
      '/cours/Chapitre 1.zmap': { ...ORIGINAL, copyLink: sourceLink('file-1', 'Chapitre 1') },
      '/cours/Chapitre 1 (copie).zmap': { ...ORIGINAL, id: 'f2', copyLink: copyLink('file-1', 'Chapitre 1', 1) },
    })
  })

  it('renaming the original renames its copy too, suffix kept', async () => {
    const moves = await renameLinkedGroup({ memberPath: '/cours/Chapitre 1.zmap', typedBaseName: 'Chapitre 2' })

    expect(moves).toEqual([
      { from: '/cours/Chapitre 1.zmap', to: '/cours/Chapitre 2.zmap' },
      { from: '/cours/Chapitre 1 (copie).zmap', to: '/cours/Chapitre 2 (copie).zmap' },
    ])
    expect(renamePath).toHaveBeenCalledWith('/cours/Chapitre 1 (copie).zmap', '/cours/Chapitre 2 (copie).zmap')
  })

  it('renaming the COPY renames the original: what was typed is the root of the group', async () => {
    const moves = await renameLinkedGroup({
      memberPath: '/cours/Chapitre 1 (copie).zmap',
      typedBaseName: 'Chapitre 2 (copie)',
    })

    expect(moves).toEqual([
      { from: '/cours/Chapitre 1 (copie).zmap', to: '/cours/Chapitre 2 (copie).zmap' },
      { from: '/cours/Chapitre 1.zmap', to: '/cours/Chapitre 2.zmap' },
    ])
  })

  it('writes the new root into every member, so the next rename starts from it', async () => {
    await renameLinkedGroup({ memberPath: '/cours/Chapitre 1.zmap', typedBaseName: 'Chapitre 2' })

    expect(setMindMapCopyLink).toHaveBeenCalledWith('/cours/Chapitre 2.zmap', sourceLink('file-1', 'Chapitre 2'))
    expect(setMindMapCopyLink).toHaveBeenCalledWith(
      '/cours/Chapitre 2 (copie).zmap',
      copyLink('file-1', 'Chapitre 2', 1)
    )
  })

  it('leaves a member alone rather than overwriting a homonym', async () => {
    vi.mocked(exists).mockImplementation(path => Promise.resolve(path === '/cours/Chapitre 2 (copie).zmap'))

    const moves = await renameLinkedGroup({ memberPath: '/cours/Chapitre 1.zmap', typedBaseName: 'Chapitre 2' })

    expect(moves).toEqual([{ from: '/cours/Chapitre 1.zmap', to: '/cours/Chapitre 2.zmap' }])
    expect(renamePath).not.toHaveBeenCalledWith('/cours/Chapitre 1 (copie).zmap', '/cours/Chapitre 2 (copie).zmap')
  })

  it('does nothing at all for a file with no link', async () => {
    metas({})
    await expect(
      renameLinkedGroup({ memberPath: '/cours/Autre.zmap', typedBaseName: 'Truc' })
    ).resolves.toEqual([])
    expect(renamePath).not.toHaveBeenCalled()
  })

  it('keeps a legacy .json a .json', async () => {
    folder('Chapitre 1.json')
    metas({ '/cours/Chapitre 1.json': { ...ORIGINAL, copyLink: sourceLink('file-1', 'Chapitre 1') } })

    const moves = await renameLinkedGroup({ memberPath: '/cours/Chapitre 1.json', typedBaseName: 'Chapitre 2' })

    expect(moves).toEqual([{ from: '/cours/Chapitre 1.json', to: '/cours/Chapitre 2.json' }])
  })
})

describe('moveLinkedGroup', () => {
  it('takes the rest of the group to the folder the moved member landed in', async () => {
    folder('Chapitre 1 (copie).zmap')
    metas({
      '/cours/Archives/Chapitre 1.zmap': { ...ORIGINAL, copyLink: sourceLink('file-1', 'Chapitre 1') },
      '/cours/Chapitre 1 (copie).zmap': { ...ORIGINAL, id: 'f2', copyLink: copyLink('file-1', 'Chapitre 1', 1) },
    })

    const moves = await moveLinkedGroup({
      memberPath: '/cours/Archives/Chapitre 1.zmap',
      previousFolderPath: '/cours',
      destFolderPath: '/cours/Archives',
    })

    expect(movePath).toHaveBeenCalledWith('/cours/Chapitre 1 (copie).zmap', '/cours/Archives', false)
    expect(moves).toEqual([
      { from: '/cours/Chapitre 1 (copie).zmap', to: '/cours/Archives/Chapitre 1 (copie).zmap' },
    ])
  })

  it('leaves a member that cannot follow where it is, without failing the move already done', async () => {
    folder('Chapitre 1 (copie).zmap')
    metas({
      '/cours/Archives/Chapitre 1.zmap': { ...ORIGINAL, copyLink: sourceLink('file-1', 'Chapitre 1') },
      '/cours/Chapitre 1 (copie).zmap': { ...ORIGINAL, id: 'f2', copyLink: copyLink('file-1', 'Chapitre 1', 1) },
    })
    vi.mocked(movePath).mockRejectedValue(new Error('existe déjà dans ce dossier'))

    await expect(
      moveLinkedGroup({
        memberPath: '/cours/Archives/Chapitre 1.zmap',
        previousFolderPath: '/cours',
        destFolderPath: '/cours/Archives',
      })
    ).resolves.toEqual([])
  })

  it('does nothing for a file with no link', async () => {
    metas({ '/cours/Archives/Autre.zmap': ORIGINAL })
    await expect(
      moveLinkedGroup({
        memberPath: '/cours/Archives/Autre.zmap',
        previousFolderPath: '/cours',
        destFolderPath: '/cours/Archives',
      })
    ).resolves.toEqual([])
    expect(movePath).not.toHaveBeenCalled()
  })
})

describe('unlinkIfAlone', () => {
  it('drops the link of the last member standing', async () => {
    folder('Chapitre 1.zmap')
    metas({ '/cours/Chapitre 1.zmap': { ...ORIGINAL, copyLink: sourceLink('file-1', 'Chapitre 1') } })

    await unlinkIfAlone('/cours', 'file-1')

    expect(setMindMapCopyLink).toHaveBeenCalledWith('/cours/Chapitre 1.zmap', undefined)
  })

  it('leaves a group that still has two members alone', async () => {
    folder('Chapitre 1.zmap', 'Chapitre 1 (copie).zmap')
    metas({
      '/cours/Chapitre 1.zmap': { ...ORIGINAL, copyLink: sourceLink('file-1', 'Chapitre 1') },
      '/cours/Chapitre 1 (copie).zmap': { ...ORIGINAL, id: 'f2', copyLink: copyLink('file-1', 'Chapitre 1', 1) },
    })

    await unlinkIfAlone('/cours', 'file-1')

    expect(setMindMapCopyLink).not.toHaveBeenCalled()
  })
})
