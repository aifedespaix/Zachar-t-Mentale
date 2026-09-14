import { describe, expect, it } from 'vitest'
import {
  allFolderPaths,
  buildTree,
  countMaps,
  filterTree,
  foldersUnder,
  isDescendantPath,
  isValidSegment,
  joinPath,
  mapsUnder,
  moveObjection,
  movedTo,
  nameOf,
  normalizePath,
  parentOf,
  rebasedUnder,
  renamedTo,
  type FolderNode,
  type LibraryMap,
  type TreeNode,
} from './tree'

function map(path: string, overrides: Partial<LibraryMap> = {}): LibraryMap {
  return {
    id: `rec-${path}`,
    file_id: `file-${path}`,
    author: 'eleve1',
    path,
    type: '',
    updated: '2026-09-01 10:00:00.000Z',
    ...overrides,
  }
}

/** Le chemin de chaque nœud, en profondeur — la forme la plus lisible pour une assertion d'arbre. */
function outline(nodes: readonly TreeNode[], depth = 0): string[] {
  return nodes.flatMap(node => [
    `${'  '.repeat(depth)}${node.kind === 'folder' ? '/' : ''}${node.name}`,
    ...(node.kind === 'folder' ? outline(node.children, depth + 1) : []),
  ])
}

describe('isValidSegment', () => {
  it('accepts an ordinary name', () => {
    expect(isValidSegment('Chapitre 1')).toBe(true)
  })

  it('refuses the names that would escape the synced folder', () => {
    expect(isValidSegment('..')).toBe(false)
    expect(isValidSegment('.')).toBe(false)
  })

  it('refuses a separator, which would silently create a folder', () => {
    expect(isValidSegment('Maths/Chapitre')).toBe(false)
    expect(isValidSegment('Maths\\Chapitre')).toBe(false)
  })

  it('refuses an empty or blank name', () => {
    expect(isValidSegment('')).toBe(false)
    expect(isValidSegment('   ')).toBe(false)
  })
})

describe('path helpers', () => {
  it('reads a parent and a name, root included', () => {
    expect(parentOf('Maths/Algebre/x.zmap')).toBe('Maths/Algebre')
    expect(parentOf('x.zmap')).toBe('')
    expect(nameOf('Maths/x.zmap')).toBe('x.zmap')
    expect(nameOf('x.zmap')).toBe('x.zmap')
  })

  it('joins without leaving a leading separator at the root', () => {
    expect(joinPath('', 'x.zmap')).toBe('x.zmap')
    expect(joinPath('Maths', 'x.zmap')).toBe('Maths/x.zmap')
  })

  it('does not mistake a sibling with a shared prefix for a descendant', () => {
    expect(isDescendantPath('Maths/x.zmap', 'Maths')).toBe(true)
    expect(isDescendantPath('Maths2/x.zmap', 'Maths')).toBe(false)
    // Un dossier n'est pas son propre descendant.
    expect(isDescendantPath('Maths', 'Maths')).toBe(false)
  })

  it('treats everything as a descendant of the root', () => {
    expect(isDescendantPath('x.zmap', '')).toBe(true)
  })

  it('renames in place and moves across', () => {
    expect(renamedTo('Maths/x.zmap', 'y.zmap')).toBe('Maths/y.zmap')
    expect(movedTo('Maths/x.zmap', 'Physique')).toBe('Physique/x.zmap')
    expect(movedTo('Maths/x.zmap', '')).toBe('x.zmap')
  })
})

describe('rebasedUnder', () => {
  it('rewrites the prefix of everything a folder carries', () => {
    expect(rebasedUnder('Maths/Algebre/x.zmap', 'Maths', 'Archive/Maths')).toBe('Archive/Maths/Algebre/x.zmap')
  })

  it('rewrites the folder itself, not only what is inside it', () => {
    expect(rebasedUnder('Maths', 'Maths', 'Archive/Maths')).toBe('Archive/Maths')
  })

  it('leaves a path that does not belong to the moved folder alone', () => {
    expect(rebasedUnder('Physique/x.zmap', 'Maths', 'Archive')).toBe('Physique/x.zmap')
  })

  it('moves a root-level item into a folder', () => {
    expect(rebasedUnder('x.zmap', '', 'Archive')).toBe('Archive/x.zmap')
  })
})

describe('normalizePath', () => {
  it('accepts the canonical form untouched', () => {
    expect(normalizePath('Maths/Chapitre 1.zmap')).toBe('Maths/Chapitre 1.zmap')
  })

  it('canonicalises what a Windows client may have pushed', () => {
    expect(normalizePath('Maths\\Chapitre 1.zmap')).toBe('Maths/Chapitre 1.zmap')
  })

  it('collapses the doubled and trailing separators that would grow a nameless folder', () => {
    expect(normalizePath('Maths//Algebre/')).toBe('Maths/Algebre')
    expect(normalizePath('/Maths/x.zmap')).toBe('Maths/x.zmap')
  })

  it('refuses anything that escapes the synced folder', () => {
    expect(normalizePath('../secrets.zmap')).toBe('')
    expect(normalizePath('Maths/../../x.zmap')).toBe('')
    expect(normalizePath('C:/Users/x.zmap')).toBe('')
  })
})

describe('buildTree', () => {
  it('derives folders from the paths alone', () => {
    const tree = buildTree([map('Maths/Algebre/Chapitre 1.zmap'), map('Maths/Chapitre 0.zmap'), map('Notes.zmap')])

    expect(outline(tree)).toEqual([
      '/Maths',
      '  /Algebre',
      '    Chapitre 1.zmap',
      '  Chapitre 0.zmap',
      'Notes.zmap',
    ])
  })

  it('lists folders before files, and numbers in human order', () => {
    const tree = buildTree([map('Chapitre 10.zmap'), map('Chapitre 2.zmap'), map('Zoo/a.zmap')])
    expect(outline(tree)).toEqual(['/Zoo', '  a.zmap', 'Chapitre 2.zmap', 'Chapitre 10.zmap'])
  })

  it('keeps an empty declared folder, which no path could ever imply', () => {
    const tree = buildTree([], [{ id: 'fold-1', path: 'Chapitre 5' }])
    expect(outline(tree)).toEqual(['/Chapitre 5'])
    expect((tree[0] as FolderNode).explicit).toBe(true)
    expect((tree[0] as FolderNode).recordId).toBe('fold-1')
  })

  it('marks a folder as explicit even when cards already imply it', () => {
    const tree = buildTree([map('Maths/x.zmap')], [{ id: 'fold-1', path: 'Maths' }])
    const maths = tree[0] as FolderNode
    expect(maths.explicit).toBe(true)
    expect(countMaps(maths)).toBe(1)
  })

  it('leaves an implied folder marked as such: it disappears with its last card', () => {
    const tree = buildTree([map('Maths/x.zmap')])
    expect((tree[0] as FolderNode).explicit).toBe(false)
  })

  it('drops a record whose path escapes rather than parking it at the root', () => {
    const tree = buildTree([map('../evade.zmap'), map('ok.zmap')])
    expect(outline(tree)).toEqual(['ok.zmap'])
  })
})

describe('mapsUnder / foldersUnder', () => {
  const maps = [map('Maths/a.zmap'), map('Maths/Algebre/b.zmap'), map('Maths2/c.zmap'), map('d.zmap')]

  it('collects a whole branch, at any depth', () => {
    expect(mapsUnder(maps, 'Maths').map(entry => entry.path)).toEqual(['Maths/a.zmap', 'Maths/Algebre/b.zmap'])
  })

  it('does not sweep in a sibling with a shared prefix', () => {
    expect(mapsUnder(maps, 'Maths').some(entry => entry.path === 'Maths2/c.zmap')).toBe(false)
  })

  it('includes the folder itself, because deleting a branch deletes its root too', () => {
    const folders = [{ id: '1', path: 'Maths' }, { id: '2', path: 'Maths/Algebre' }, { id: '3', path: 'Physique' }]
    expect(foldersUnder(folders, 'Maths').map(entry => entry.path)).toEqual(['Maths', 'Maths/Algebre'])
  })
})

describe('allFolderPaths', () => {
  it('lists every folder, so a destination picker can offer them', () => {
    const tree = buildTree([map('Maths/Algebre/a.zmap'), map('Physique/b.zmap')])
    expect(allFolderPaths(tree)).toEqual(['Maths', 'Maths/Algebre', 'Physique'])
  })
})

describe('moveObjection', () => {
  it('allows an ordinary move', () => {
    expect(moveObjection('Maths/a.zmap', 'Physique', 'map')).toBeNull()
  })

  it('refuses a move that changes nothing', () => {
    expect(moveObjection('Maths/a.zmap', 'Maths', 'map')).toMatch(/déjà dans ce dossier/)
  })

  it('refuses to swallow a folder into itself, which would destroy the branch', () => {
    expect(moveObjection('Maths', 'Maths', 'folder')).toMatch(/dans lui-même/)
  })

  it('refuses to swallow a folder into its own descendant', () => {
    expect(moveObjection('Maths', 'Maths/Algebre', 'folder')).toMatch(/sous-dossiers/)
  })

  it('still allows a folder to move into a sibling that merely shares its prefix', () => {
    expect(moveObjection('Maths', 'Maths2', 'folder')).toBeNull()
  })
})

describe('filterTree', () => {
  const tree = buildTree([
    map('Maths/Algebre/Équations.zmap'),
    map('Maths/Géométrie.zmap'),
    map('Physique/Optique.zmap'),
  ])

  it('returns everything for an empty query', () => {
    expect(outline(filterTree(tree, '  '))).toEqual(outline(tree))
  })

  it('keeps a matching file and the folders leading to it', () => {
    expect(outline(filterTree(tree, 'optique'))).toEqual(['/Physique', '  Optique.zmap'])
  })

  it('ignores accents, which nobody types on a phone in a hurry', () => {
    expect(outline(filterTree(tree, 'equations'))).toEqual(['/Maths', '  /Algebre', '    Équations.zmap'])
    expect(outline(filterTree(tree, 'geometrie'))).toEqual(['/Maths', '  Géométrie.zmap'])
  })

  it('keeps a whole folder when the folder itself matches', () => {
    expect(outline(filterTree(tree, 'maths'))).toEqual([
      '/Maths',
      '  /Algebre',
      '    Équations.zmap',
      '  Géométrie.zmap',
    ])
  })

  it('drops a folder the filter emptied rather than showing an empty shell', () => {
    expect(filterTree(tree, 'rien-du-tout')).toEqual([])
  })
})
