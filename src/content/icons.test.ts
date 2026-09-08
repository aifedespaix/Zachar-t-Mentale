import { describe, it, expect } from 'vitest'
import { ICON_NAMES, SUGGESTED_ICONS, iconComponent, iconLabel, searchIcons } from './icons'

describe('the catalogue', () => {
  it('exposes the whole Lucide set, alphabetically', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(1000)
    expect([...ICON_NAMES]).toEqual([...ICON_NAMES].sort())
  })

  it('resolves a stored name to its component', () => {
    expect(iconComponent('Brain')).not.toBeNull()
  })

  it('returns null for a name it does not know rather than throwing', () => {
    // A card written by a later version of the app, or a hand-edited file:
    // an unusable icon must never take the card's render down with it.
    expect(iconComponent('NotAnIconName')).toBeNull()
    expect(iconComponent(undefined)).toBeNull()
    expect(iconComponent('')).toBeNull()
  })

  it('every suggested icon actually exists', () => {
    for (const name of SUGGESTED_ICONS) {
      expect(iconComponent(name), `${name} is not in the Lucide catalogue`).not.toBeNull()
    }
  })
})

describe('iconLabel', () => {
  it('reads a PascalCase name as words', () => {
    expect(iconLabel('BookOpen')).toBe('book open')
    expect(iconLabel('Dna')).toBe('dna')
    expect(iconLabel('CircleQuestionMark')).toBe('circle question mark')
  })
})

describe('searchIcons', () => {
  it('offers the suggestions when nothing has been typed', () => {
    expect(searchIcons('')).toEqual([...SUGGESTED_ICONS])
    expect(searchIcons('   ')).toEqual([...SUGGESTED_ICONS])
  })

  it('finds icons by their English name', () => {
    expect(searchIcons('brain')).toContain('Brain')
    expect(searchIcons('book')).toContain('BookOpen')
  })

  it('ranks a name that starts with the term above one that merely contains it', () => {
    const results = searchIcons('book')
    expect(results.indexOf('Book')).toBeLessThan(results.indexOf('NotebookPen'))
  })

  it('finds icons through the French bridge', () => {
    expect(searchIcons('cerveau')).toContain('Brain')
    expect(searchIcons('livre')).toContain('Book')
    expect(searchIcons('etoile')).toContain('Star')
    expect(searchIcons('chimie')).toContain('FlaskConical')
  })

  it('ignores accents and case', () => {
    expect(searchIcons('École')).toEqual(searchIcons('ecole'))
    expect(searchIcons('École').length).toBeGreaterThan(0)
  })

  it('narrows on every term rather than widening', () => {
    const results = searchIcons('arrow up')
    expect(results.length).toBeGreaterThan(0)
    for (const name of results) {
      expect(iconLabel(name)).toContain('arrow')
      expect(iconLabel(name)).toContain('up')
    }
  })

  it('returns nothing for a term that matches no icon', () => {
    expect(searchIcons('zzzzznotanicon')).toEqual([])
  })

  it('never returns more than the limit', () => {
    expect(searchIcons('a', 12)).toHaveLength(12)
  })
})
