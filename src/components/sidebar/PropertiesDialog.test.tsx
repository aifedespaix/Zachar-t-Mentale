import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-fs', () => ({ stat: vi.fn() }))
vi.mock('../../persistence/fileStore', () => ({ loadMindMap: vi.fn(), loadMindMapMeta: vi.fn() }))

import { stat } from '@tauri-apps/plugin-fs'
import { loadMindMap, loadMindMapMeta } from '../../persistence/fileStore'
import { PropertiesDialog } from './PropertiesDialog'
import type { Card, MindMapMeta } from '../../types/card'

const META: MindMapMeta = {
  id: 'file-1',
  author: 'aife',
  role: 'prof',
  lastModified: '2026-01-01T00:00:00.000Z',
  type: 'cours',
}

const CARDS: Card[] = [
  { id: 'root', level: 1, title: 'R', parentId: null, order: 0 },
  { id: 'a', level: 2, title: 'A', parentId: 'root', order: 0 },
]

describe('PropertiesDialog', () => {
  beforeEach(() => {
    vi.mocked(stat)
      .mockReset()
      .mockResolvedValue({
        size: 2048,
        mtime: new Date('2026-09-15T10:00:00.000Z'),
        birthtime: new Date('2026-01-01T09:00:00.000Z'),
        atime: null,
        isDirectory: false,
        isFile: true,
        isSymlink: false,
      } as never)
    vi.mocked(loadMindMap).mockReset().mockResolvedValue(CARDS)
    vi.mocked(loadMindMapMeta).mockReset().mockResolvedValue(META)
  })

  it('shows the real paths, the size and the sync metadata of a map', async () => {
    render(
      <PropertiesDialog
        node={{ type: 'mindmap', name: 'chapitre.zmap', path: '/cours/SVT/chapitre.zmap' }}
        onClose={() => {}}
      />
    )

    expect(screen.getByText('/cours/SVT/chapitre.zmap')).toBeInTheDocument()
    expect(screen.getByText('/cours/SVT')).toBeInTheDocument()
    expect(await screen.findByText('2,0 Ko')).toBeInTheDocument()
    expect(screen.getByText('aife (Prof)')).toBeInTheDocument()
    expect(screen.getByText('Nœuds (cartes)')).toBeInTheDocument()
    // The type is stated as text AND as the coloured badge next to the title.
    expect(screen.getAllByText('Cours').length).toBeGreaterThanOrEqual(1)
  })

  it('says a map was never synced rather than inventing an author', async () => {
    vi.mocked(loadMindMapMeta).mockResolvedValue(null)

    render(<PropertiesDialog node={{ type: 'mindmap', name: 'local.zmap', path: '/cours/local.zmap' }} onClose={() => {}} />)

    expect(await screen.findByText(/jamais été synchronisée/)).toBeInTheDocument()
  })

  it('counts the elements of a folder', async () => {
    render(
      <PropertiesDialog
        node={{
          type: 'folder',
          name: 'SVT',
          path: '/cours/SVT',
          children: [
            { type: 'mindmap', name: 'a.zmap', path: '/cours/SVT/a.zmap' },
            { type: 'other', name: 'n.pdf', path: '/cours/SVT/n.pdf' },
          ],
        }}
        isRoot
        onClose={() => {}}
      />
    )

    expect(await screen.findByText('Éléments')).toBeInTheDocument()
    expect(screen.getByText('Dossier racine de l’espace de travail')).toBeInTheDocument()
  })
})
