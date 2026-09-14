import { describe, it, expect } from 'vitest'
import {
  copyLink,
  copyLinkBadgeText,
  copyLinkLabel,
  copySuffixFor,
  groupBaseNameAfterRename,
  isSameGroup,
  linkedBaseNameOf,
  nextCopyIndex,
  renamedLink,
  sourceLink,
  stripCopySuffix,
} from './copyLink'

describe('copySuffixFor', () => {
  it('leaves the first copy unnumbered', () => {
    expect(copySuffixFor(1)).toBe(' (copie)')
  })

  it('numbers the following ones', () => {
    expect(copySuffixFor(2)).toBe(' (copie 2)')
    expect(copySuffixFor(3)).toBe(' (copie 3)')
  })
})

describe('linkedBaseNameOf', () => {
  it('names the original after the group', () => {
    expect(linkedBaseNameOf(sourceLink('id-1', 'Chapitre 1'))).toBe('Chapitre 1')
  })

  it('names a copy after the group, with its suffix', () => {
    expect(linkedBaseNameOf(copyLink('id-1', 'Chapitre 1', 1))).toBe('Chapitre 1 (copie)')
    expect(linkedBaseNameOf(copyLink('id-1', 'Chapitre 1', 2))).toBe('Chapitre 1 (copie 2)')
  })

  it('falls back to the first copy when the index is missing', () => {
    expect(linkedBaseNameOf({ groupId: 'id-1', role: 'copy', baseName: 'Chapitre 1' })).toBe('Chapitre 1 (copie)')
  })
})

describe('stripCopySuffix', () => {
  it('leaves a plain name alone', () => {
    expect(stripCopySuffix('Chapitre 1')).toBe('Chapitre 1')
  })

  it('removes the suffix, numbered or not', () => {
    expect(stripCopySuffix('Chapitre 1 (copie)')).toBe('Chapitre 1')
    expect(stripCopySuffix('Chapitre 1 (copie 4)')).toBe('Chapitre 1')
  })

  it('only removes a suffix at the very end', () => {
    expect(stripCopySuffix('Chapitre (copie) revu')).toBe('Chapitre (copie) revu')
  })

  it('leaves a parenthesis that is not a copy suffix', () => {
    expect(stripCopySuffix('Chapitre 1 (brouillon)')).toBe('Chapitre 1 (brouillon)')
  })
})

describe('groupBaseNameAfterRename', () => {
  it('renames the whole group from what the user typed on a copy', () => {
    expect(groupBaseNameAfterRename('Chapitre 2 (copie)')).toBe('Chapitre 2')
  })

  it('renames the whole group from what the user typed on the original', () => {
    expect(groupBaseNameAfterRename('Chapitre 2')).toBe('Chapitre 2')
  })

  it('never renames a group to nothing', () => {
    expect(groupBaseNameAfterRename('(copie)')).toBe('(copie)')
  })
})

describe('nextCopyIndex', () => {
  it('starts at one', () => {
    expect(nextCopyIndex([])).toBe(1)
  })

  it('takes the first free rank', () => {
    expect(nextCopyIndex([1])).toBe(2)
    expect(nextCopyIndex([1, 2, 4])).toBe(3)
  })
})

describe('renamedLink', () => {
  it('moves a link onto a new base name without losing the group', () => {
    const renamed = renamedLink(copyLink('id-1', 'Chapitre 1', 2), 'Chapitre 2')
    expect(renamed).toEqual({ groupId: 'id-1', role: 'copy', baseName: 'Chapitre 2', index: 2 })
  })
})

describe('isSameGroup', () => {
  it('pairs two links sharing a group', () => {
    expect(isSameGroup(sourceLink('id-1', 'A'), copyLink('id-1', 'A', 1))).toBe(true)
  })

  it('never pairs a file with no link at all', () => {
    expect(isSameGroup(undefined, copyLink('id-1', 'A', 1))).toBe(false)
    expect(isSameGroup(sourceLink('id-1', 'A'), undefined)).toBe(false)
  })

  it('does not pair two different groups', () => {
    expect(isSameGroup(sourceLink('id-1', 'A'), copyLink('id-2', 'A', 1))).toBe(false)
  })
})

describe('the words the interface shows', () => {
  it('tells each side what it is linked to', () => {
    expect(copyLinkLabel(sourceLink('id-1', 'Chapitre 1'))).toContain('Chapitre 1 (copie)')
    expect(copyLinkLabel(copyLink('id-1', 'Chapitre 1', 1))).toContain('Copie liée de « Chapitre 1 »')
  })

  it('keeps the badge itself short', () => {
    expect(copyLinkBadgeText(sourceLink('id-1', 'Chapitre 1'))).toBe('liée')
    expect(copyLinkBadgeText(copyLink('id-1', 'Chapitre 1', 1))).toBe('copie')
    expect(copyLinkBadgeText(copyLink('id-1', 'Chapitre 1', 3))).toBe('copie 3')
  })
})
