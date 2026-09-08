import { describe, it, expect, vi } from 'vitest'
import { scanFolder } from './fileTree'

vi.mock('@tauri-apps/plugin-fs', () => ({ readDir: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

import { readDir } from '@tauri-apps/plugin-fs'

function entry(name: string, isDirectory = false) {
  return { name, isDirectory, isFile: !isDirectory, isSymlink: false }
}

describe('scanFolder', () => {
  it('classifies mind maps as mindmap nodes and other files as other nodes', async () => {
    vi.mocked(readDir).mockResolvedValueOnce([entry('chapitre.zmap'), entry('notes.pdf')])
    const tree = await scanFolder('/cours')
    expect(tree).toEqual([
      { type: 'mindmap', name: 'chapitre.zmap', path: '/cours/chapitre.zmap' },
      { type: 'other', name: 'notes.pdf', path: '/cours/notes.pdf' },
    ])
  })

  it('still lists maps written before .zmap existed, so no course disappears from the tree', async () => {
    vi.mocked(readDir).mockResolvedValueOnce([entry('chapitre.json')])
    const tree = await scanFolder('/cours')
    expect(tree[0].type).toBe('mindmap')
  })

  it('recurses into subfolders', async () => {
    vi.mocked(readDir).mockImplementation(async (path: unknown) => {
      if (path === '/cours') return [entry('chapitre1', true)]
      if (path === '/cours/chapitre1') return [entry('intro.json')]
      return []
    })
    const tree = await scanFolder('/cours')
    expect(tree).toEqual([
      {
        type: 'folder',
        name: 'chapitre1',
        path: '/cours/chapitre1',
        children: [{ type: 'mindmap', name: 'intro.json', path: '/cours/chapitre1/intro.json' }],
      },
    ])
  })

  it('sorts folders before files, alphabetically within each group', async () => {
    vi.mocked(readDir).mockResolvedValueOnce([entry('zeta.json'), entry('alpha-folder', true), entry('alpha.json')])
    const tree = await scanFolder('/cours')
    expect(tree.map(n => n.name)).toEqual(['alpha-folder', 'alpha.json', 'zeta.json'])
  })

  it('treats file extensions case-insensitively', async () => {
    vi.mocked(readDir).mockResolvedValueOnce([entry('Chapitre.ZMAP')])
    const tree = await scanFolder('/cours')
    expect(tree[0].type).toBe('mindmap')
  })
})

import { countDescendants } from './fileTree'

describe('countDescendants', () => {
  it('returns 0 for a file node', () => {
    expect(countDescendants({ type: 'mindmap', name: 'a.json', path: '/a.json' })).toBe(0)
  })

  it('counts every nested file and folder, not just direct children', () => {
    const tree = {
      type: 'folder' as const,
      name: 'chimie',
      path: '/chimie',
      children: [
        { type: 'mindmap' as const, name: 'atomes.json', path: '/chimie/atomes.json' },
        {
          type: 'folder' as const,
          name: 'td',
          path: '/chimie/td',
          children: [{ type: 'mindmap' as const, name: 'td1.json', path: '/chimie/td/td1.json' }],
        },
      ],
    }
    expect(countDescendants(tree)).toBe(3)
  })
})
