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
  it('classifies .json files as mindmap nodes and other files as other nodes', async () => {
    vi.mocked(readDir).mockResolvedValueOnce([entry('chapitre.json'), entry('notes.pdf')])
    const tree = await scanFolder('/cours')
    expect(tree).toEqual([
      { type: 'mindmap', name: 'chapitre.json', path: '/cours/chapitre.json' },
      { type: 'other', name: 'notes.pdf', path: '/cours/notes.pdf' },
    ])
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
    vi.mocked(readDir).mockResolvedValueOnce([entry('Chapitre.JSON')])
    const tree = await scanFolder('/cours')
    expect(tree[0].type).toBe('mindmap')
  })
})
