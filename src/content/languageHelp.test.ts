import { describe, it, expect } from 'vitest'
import { LANGUAGES, languageHelp, insertCharacter, type SpecialCharacter } from './languageHelp'

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

  it('gives every paired sign the closing sign that goes with it', () => {
    const paired = LANGUAGES.flatMap(language =>
      language.groups.flatMap(group => group.characters)
    ).filter(character => character.closesWith !== undefined)
    expect(paired.map(character => character.char + character.closesWith)).toEqual([
      '‘’',
      '“”',
      '¿?',
      '¡!',
      '«»',
    ])
  })

  it('stops offering the closing signs as buttons of their own', () => {
    // A closing sign costs a click AND a second thought about which side of the
    // sentence the caret has to be on; the opening sign now brings its partner.
    const chars = LANGUAGES.flatMap(language =>
      language.groups.flatMap(group => group.characters.map(character => character.char))
    )
    expect(chars).not.toContain('»')
    expect(chars).not.toContain('”')
  })

  it('sets the guillemets off by a space, and leaves the inverted signs glued', () => {
    const byChar = new Map(
      languageHelp('es').groups.flatMap(group => group.characters).map(character => [character.char, character])
    )
    expect(byChar.get('«')?.spaced).toBe(true)
    expect(byChar.get('¿')?.spaced).toBeUndefined()
    expect(byChar.get('¡')?.spaced).toBeUndefined()
  })
})

describe('insertCharacter', () => {
  const apostrophe: SpecialCharacter = { char: '’', label: 'Apostrophe anglaise (don’t)' }
  const question: SpecialCharacter = { char: '¿', label: 'Point d’interrogation inversé', closesWith: '?' }
  const guillemets: SpecialCharacter = { char: '«', label: 'Guillemet ouvrant', closesWith: '»', spaced: true }

  it('inserts an unpaired sign at the caret', () => {
    expect(insertCharacter('don', 3, 3, apostrophe)).toEqual({ text: 'don’', caret: 4 })
  })

  it('inserts a pair with the caret between the two signs', () => {
    expect(insertCharacter('', 0, 0, question)).toEqual({ text: '¿?', caret: 1 })
  })

  it('wraps a selection instead of replacing it, the caret after the closing sign', () => {
    expect(insertCharacter('Cómo estás', 0, 10, question)).toEqual({ text: '¿Cómo estás?', caret: 12 })
  })

  it('wraps only the selection, leaving the rest of the text alone', () => {
    expect(insertCharacter('aXb', 1, 2, question)).toEqual({ text: 'a¿X?b', caret: 4 })
  })

  it('pads a spaced pair, with the caret between the two spaces', () => {
    expect(insertCharacter('', 0, 0, guillemets)).toEqual({ text: '«  »', caret: 2 })
  })

  it('pads the inside of a spaced pair around a selection', () => {
    expect(insertCharacter('le texte', 0, 8, guillemets)).toEqual({ text: '« le texte »', caret: 12 })
  })
})
