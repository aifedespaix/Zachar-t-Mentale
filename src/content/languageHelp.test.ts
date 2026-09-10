import { describe, it, expect } from 'vitest'
import { LANGUAGES, languageHelp } from './languageHelp'

describe('the language help sets', () => {
  it('offers English and Spanish, each labelled in French', () => {
    expect(LANGUAGES.map(language => language.id)).toEqual(['en', 'es'])
    expect(LANGUAGES.map(language => language.label)).toEqual(['Anglais', 'Espagnol'])
  })

  it('gives every language groups, and never an empty one', () => {
    for (const language of LANGUAGES) {
      expect(language.groups.length).toBeGreaterThan(0)
      for (const group of language.groups) {
        expect(group.name).not.toBe('')
        expect(group.characters.length).toBeGreaterThan(0)
      }
    }
  })

  it('never lists the same character twice, and never a blank label', () => {
    // A duplicate would be a button that inserts what its neighbour already
    // does, under a second name.
    for (const language of LANGUAGES) {
      const chars = language.groups.flatMap(group => group.characters.map(character => character.char))
      expect(new Set(chars).size).toBe(chars.length)
      for (const group of language.groups) {
        for (const character of group.characters) {
          expect(character.char.length).toBeGreaterThan(0)
          expect(character.label).not.toBe('')
        }
      }
    }
  })

  it('carries the two inverted signs Spanish is unmistakable for', () => {
    const chars = languageHelp('es').groups.flatMap(group => group.characters.map(character => character.char))
    expect(chars).toContain('¿')
    expect(chars).toContain('¡')
    expect(chars).toContain('ñ')
    expect(chars).toContain('ü')
  })

  it('carries the English apostrophe, which is not the keyboard’s', () => {
    const chars = languageHelp('en').groups.flatMap(group => group.characters.map(character => character.char))
    expect(chars).toContain('’')
    expect(chars).not.toContain("'")
  })
})
