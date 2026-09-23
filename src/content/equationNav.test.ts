import { describe, it, expect } from 'vitest'
import { navigate, operationVisible, readingOrder, type EqPos } from './equationNav'
import type { EquationStep } from '../types/cardBlock'

// Deux étapes non résolues : G0 D0 Op0 G1 D1 Op1.
const open: EquationStep[] = [
  { left: '2x', right: '8' },
  { left: 'x', right: '2x' },
]
// Dernière étape résolue, Op1 vide → caché : G0 D0 Op0 G1 D1.
const solved: EquationStep[] = [
  { left: '2x', right: '8', operation: '\div 2' },
  { left: 'x', right: '4' },
]
const at = (step: number, field: EqPos['field']): EqPos => ({ step, field })

describe('operationVisible', () => {
  it('toujours visible entre deux etapes', () => {
    expect(operationVisible(solved, 0)).toBe(true)
  })
  it('apres la derniere etape : visible tant qu\'elle n\'est pas resolue', () => {
    expect(operationVisible(open, 1)).toBe(true)
    expect(operationVisible(solved, 1)).toBe(false)
  })
  it('un contenu saisi n\'est jamais masque', () => {
    expect(operationVisible([{ left: 'x', right: '4', operation: 'verif' }], 0)).toBe(true)
  })
  it('hors limites : faux', () => {
    expect(operationVisible(open, 2)).toBe(false)
  })
})

describe('readingOrder', () => {
  it('G D Op par etape, Opₙ seulement s\'il est visible', () => {
    expect(readingOrder(open)).toEqual([at(0, 'left'), at(0, 'right'), at(0, 'operation'), at(1, 'left'), at(1, 'right'), at(1, 'operation')])
    expect(readingOrder(solved)).toEqual([at(0, 'left'), at(0, 'right'), at(0, 'operation'), at(1, 'left'), at(1, 'right')])
  })
})

describe('navigate — ←/→ (et Tab) suivent l\'ordre de lecture', () => {
  it('→ va au champ suivant, curseur au debut', () => {
    expect(navigate(open, at(0, 'left'), 'right', 'left')).toEqual({ pos: at(0, 'right'), at: 'start' })
    expect(navigate(open, at(0, 'right'), 'right', 'left')).toEqual({ pos: at(0, 'operation'), at: 'start' })
    expect(navigate(open, at(0, 'operation'), 'right', 'left')).toEqual({ pos: at(1, 'left'), at: 'start' })
  })
  it('← va au champ precedent, curseur a la fin', () => {
    expect(navigate(open, at(1, 'left'), 'left', 'left')).toEqual({ pos: at(0, 'operation'), at: 'end' })
    expect(navigate(open, at(0, 'right'), 'left', 'left')).toEqual({ pos: at(0, 'left'), at: 'end' })
  })
  it('au-dela des extremites : sortie du bloc', () => {
    expect(navigate(open, at(0, 'left'), 'left', 'left')).toBe('exit-before')
    expect(navigate(open, at(1, 'operation'), 'right', 'left')).toBe('exit-after')
    expect(navigate(solved, at(1, 'right'), 'right', 'left')).toBe('exit-after')
  })
  it('depuis un Opₙ cache (focus perdu en route) : sortie plutot qu\'une erreur', () => {
    expect(navigate(solved, at(1, 'operation'), 'right', 'left')).toBe('exit-after')
    expect(navigate(solved, at(1, 'operation'), 'left', 'left')).toBe('exit-before')
  })
})

describe('navigate — ↓', () => {
  it('Gᵢ / Dᵢ → Opᵢ quand il est visible', () => {
    expect(navigate(open, at(0, 'left'), 'down', 'left')).toEqual({ pos: at(0, 'operation'), at: 'start' })
    expect(navigate(open, at(1, 'right'), 'down', 'left')).toEqual({ pos: at(1, 'operation'), at: 'start' })
  })
  it('Gₙ / Dₙ sans Opₙ → sortie bas', () => {
    expect(navigate(solved, at(1, 'left'), 'down', 'left')).toBe('exit-after')
  })
  it('Opᵢ → etape suivante, colonne memorisee', () => {
    expect(navigate(open, at(0, 'operation'), 'down', 'left')).toEqual({ pos: at(1, 'left'), at: 'start' })
    expect(navigate(open, at(0, 'operation'), 'down', 'right')).toEqual({ pos: at(1, 'right'), at: 'start' })
  })
  it('Opₙ → sortie bas', () => {
    expect(navigate(open, at(1, 'operation'), 'down', 'left')).toBe('exit-after')
  })
})

describe('navigate — ↑', () => {
  it('Opᵢ → meme etape, colonne memorisee, curseur a la fin', () => {
    expect(navigate(open, at(0, 'operation'), 'up', 'left')).toEqual({ pos: at(0, 'left'), at: 'end' })
    expect(navigate(open, at(0, 'operation'), 'up', 'right')).toEqual({ pos: at(0, 'right'), at: 'end' })
  })
  it('Gᵢ / Dᵢ, i > 0 → Opᵢ₋₁', () => {
    expect(navigate(open, at(1, 'left'), 'up', 'left')).toEqual({ pos: at(0, 'operation'), at: 'end' })
    expect(navigate(open, at(1, 'right'), 'up', 'right')).toEqual({ pos: at(0, 'operation'), at: 'end' })
  })
  it('G₀ / D₀ → sortie haut', () => {
    expect(navigate(open, at(0, 'left'), 'up', 'left')).toBe('exit-before')
    expect(navigate(open, at(0, 'right'), 'up', 'left')).toBe('exit-before')
  })
})
