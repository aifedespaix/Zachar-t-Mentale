import { describe, it, expect } from 'vitest'
import { filterTree } from './treeFilter'
import type { FileTreeNode } from '../../types/workspace'

/**
 * The same shape as `treeFilter.test.ts`, reused here to state what the TYPE
 * predicate alone does to it — the name query and the predicate are independent.
 */
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

/** The children of a folder node — the union type only exposes them once narrowed. */
function childNames(node: FileTreeNode): string[] {
  if (node.type !== 'folder') throw new Error(`« ${node.name} » n’est pas un dossier`)
  return node.children.map(child => child.name)
}

describe('filterTree with a file predicate', () => {
  it('keeps only the files that pass, plus the folders that lead to them, opened', () => {
    const result = filterTree(TREE, '', false, node => node.path === '/cours/Chapitre 1/Cours.zmap')

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].name).toBe('Chapitre 1')
    expect(childNames(result.nodes[0])).toEqual(['Cours.zmap'])
    expect([...result.expanded]).toEqual(['/cours/Chapitre 1'])
    expect(result.count).toBe(1)
  })

  it('combines with the name query: a file must satisfy both', () => {
    // « Notes » passes the predicate, « Cours » does not — and the query alone
    // would have kept both of Chapitre 1's files.
    const result = filterTree(TREE, 'zmap', false, node => node.name === 'Notes.zmap')

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].name).toBe('Divers')
    expect(result.count).toBe(1)
  })

  it('drops a folder that matched by name when no file under it passes', () => {
    const result = filterTree(TREE, 'divers', false, () => false)

    expect(result.nodes).toHaveLength(0)
    expect(result.count).toBe(0)
  })

  it('drops a name-matching folder’s non-passing files from its subtree', () => {
    const result = filterTree(TREE, 'chapitre', false, node => node.name === 'Cours.zmap')

    expect(result.nodes).toHaveLength(1)
    expect(childNames(result.nodes[0])).toEqual(['Cours.zmap'])
    expect(result.count).toBe(1)
  })

  it('keeps every folder when no predicate is given, even with an empty query', () => {
    const result = filterTree(TREE, '', false)
    expect(result.nodes).toBe(TREE)
    expect(result.count).toBe(0)
  })
})
