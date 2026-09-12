import { describe, it, expect } from 'vitest'
import { filterTree, flattenFolders, isRowVisible, lastSegment } from './treeFilter'
import type { FileTreeNode, RootFolder } from '../../types/workspace'

const TREE: FileTreeNode[] = [
  {
    type: 'folder',
    name: 'Chapitre 1',
    path: '/cours/Chapitre 1',
    children: [
      { type: 'mindmap', name: 'Évaluation.zmap', path: '/cours/Chapitre 1/Évaluation.zmap' },
      { type: 'mindmap', name: 'Cours.zmap', path: '/cours/Chapitre 1/Cours.zmap' },
    ],
  },
  {
    type: 'folder',
    name: 'Divers',
    path: '/cours/Divers',
    children: [{ type: 'mindmap', name: 'Notes.zmap', path: '/cours/Divers/Notes.zmap' }],
  },
  { type: 'mindmap', name: 'Accueil.zmap', path: '/cours/Accueil.zmap' },
]

describe('lastSegment', () => {
  it('names a folder whatever separator the path uses', () => {
    expect(lastSegment('/cours/SVT/Chapitre 1')).toBe('Chapitre 1')
    expect(lastSegment('C:\\Cours\\SVT')).toBe('SVT')
    expect(lastSegment('/cours/')).toBe('cours')
  })
})

describe('isRowVisible', () => {
  it('always shows folders and readable maps', () => {
    expect(isRowVisible({ type: 'folder', name: 'Divers', path: '/c/x', children: [] }, false)).toBe(true)
    expect(isRowVisible({ type: 'mindmap', name: 'a.zmap', path: '/c/a.zmap' }, false)).toBe(true)
  })

  it('shows unreadable files and asset sidecars only when the eye button allows them', () => {
    expect(isRowVisible({ type: 'other', name: 'notes.pdf', path: '/c/notes.pdf' }, false)).toBe(false)
    expect(isRowVisible({ type: 'other', name: 'notes.pdf', path: '/c/notes.pdf' }, true)).toBe(true)
    expect(isRowVisible({ type: 'folder', name: 'a.assets', path: '/c/a.assets', children: [] }, false)).toBe(false)
    expect(isRowVisible({ type: 'folder', name: 'a.assets', path: '/c/a.assets', children: [] }, true)).toBe(true)
  })
})

/** The children of a folder node — the union type only exposes them once narrowed. */
function childNames(node: FileTreeNode): string[] {
  if (node.type !== 'folder') throw new Error(`« ${node.name} » n’est pas un dossier`)
  return node.children.map(child => child.name)
}

describe('filterTree', () => {
  it('keeps a matching file, and the folders that lead to it, opened', () => {
    const result = filterTree(TREE, 'cours', false)

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].name).toBe('Chapitre 1')
    expect(childNames(result.nodes[0])).toEqual(['Cours.zmap'])
    expect([...result.expanded]).toEqual(['/cours/Chapitre 1'])
    expect(result.count).toBe(1)
  })

  it('ignores accents and case, so a French course tree is searchable as typed', () => {
    const result = filterTree(TREE, 'evaluation', false)

    expect(childNames(result.nodes[0])).toEqual(['Évaluation.zmap'])
    expect(filterTree(TREE, 'NOTES', false).nodes[0].name).toBe('Divers')
  })

  it('gives a matching folder its WHOLE subtree rather than only its matches', () => {
    const result = filterTree(TREE, 'chapitre', false)

    expect(result.nodes).toHaveLength(1)
    expect(childNames(result.nodes[0])).toEqual(['Évaluation.zmap', 'Cours.zmap'])
    expect([...result.expanded]).toEqual(['/cours/Chapitre 1'])
  })

  it('drops the folders that contain no match at all, at every depth', () => {
    const result = filterTree(TREE, 'accueil', false)

    expect(result.nodes.map(node => node.name)).toEqual(['Accueil.zmap'])
  })

  it('finds nothing rather than everything for a query no row contains', () => {
    const result = filterTree(TREE, 'intégrales', false)

    expect(result.nodes).toEqual([])
    expect(result.count).toBe(0)
  })

  it('returns the tree untouched for an empty or blank query', () => {
    expect(filterTree(TREE, '', false).nodes).toBe(TREE)
    expect(filterTree(TREE, '   ', false).count).toBe(0)
  })

  it('searches what the eye button shows, not what is on disk', () => {
    const withPdf: FileTreeNode[] = [{ type: 'other', name: 'notes.pdf', path: '/c/notes.pdf' }]

    expect(filterTree(withPdf, 'notes', false).nodes).toEqual([])
    expect(filterTree(withPdf, 'notes', true).nodes).toHaveLength(1)
  })

  it('hides the unreadable files inside a folder that matched by name', () => {
    const folder: FileTreeNode[] = [
      {
        type: 'folder',
        name: 'Chapitre 1',
        path: '/c/Chapitre 1',
        children: [
          { type: 'mindmap', name: 'Cours.zmap', path: '/c/Chapitre 1/Cours.zmap' },
          { type: 'other', name: 'notes.pdf', path: '/c/Chapitre 1/notes.pdf' },
        ],
      },
    ]

    expect(childNames(filterTree(folder, 'chapitre', false).nodes[0])).toEqual(['Cours.zmap'])
  })
})

describe('flattenFolders', () => {
  const roots: RootFolder[] = [
    { path: '/cours', tree: [TREE[0], TREE[2]] },
    { path: '/autre', tree: [] },
  ]

  it('lists every root and subfolder, depth-first, with its nesting depth', () => {
    expect(flattenFolders(roots)).toEqual([
      { path: '/cours', name: 'cours', depth: 0 },
      { path: '/cours/Chapitre 1', name: 'Chapitre 1', depth: 1 },
      { path: '/autre', name: 'autre', depth: 0 },
    ])
  })

  it('offers no destination when the workspace has no folders at all', () => {
    expect(flattenFolders([])).toEqual([])
  })
})
