import { describe, it, expect } from 'vitest'
import { titleCase } from './titleCase'

describe('titleCase', () => {
  it('uppercases the first letter of every word', () => {
    expect(titleCase('les nombres relatifs')).toBe('Les Nombres Relatifs')
  })

  it('leaves an already-capitalized name alone', () => {
    expect(titleCase('Chapitre 1')).toBe('Chapitre 1')
  })

  it('never touches the case of the remaining letters, so acronyms survive', () => {
    // Lowercasing the rest would produce « Les Adn » and « Ii ».
    expect(titleCase('les ADN et les II')).toBe('Les ADN Et Les II')
  })

  it('leaves a word that does not start with a letter alone', () => {
    expect(titleCase('3ème chapitre')).toBe('3ème Chapitre')
  })

  it('does not capitalize after an apostrophe or a hyphen', () => {
    // French title case: only whitespace starts a new word.
    expect(titleCase("l'addition et peut-être la soustraction")).toBe(
      "L'addition Et Peut-être La Soustraction"
    )
  })

  it('keeps a multi-line or multi-space name otherwise intact', () => {
    expect(titleCase('chapitre  1')).toBe('Chapitre  1')
  })

  it('returns an empty string unchanged', () => {
    expect(titleCase('')).toBe('')
  })
})
