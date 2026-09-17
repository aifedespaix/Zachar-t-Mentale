import { describe, it, expect } from 'vitest'
import { kebabCase } from './kebabCase'

describe('kebabCase', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(kebabCase('Chapitre 3')).toBe('chapitre-3')
  })

  it('collapses any run of punctuation into a single hyphen', () => {
    expect(kebabCase('Chapitre 3: Vecteurs/Forces')).toBe('chapitre-3-vecteurs-forces')
  })

  it('keeps accented letters, only lowercased', () => {
    expect(kebabCase('Électricité et Magnétisme')).toBe('électricité-et-magnétisme')
  })

  it('strips leading and trailing hyphens', () => {
    expect(kebabCase('  Chapitre 3 !!')).toBe('chapitre-3')
  })

  it('falls back to a placeholder for a name with no letters or digits', () => {
    expect(kebabCase('///')).toBe('sans-titre')
  })

  it('falls back to a placeholder for an empty name', () => {
    expect(kebabCase('')).toBe('sans-titre')
  })
})
