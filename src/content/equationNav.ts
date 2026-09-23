import type { EquationStep } from '../types/cardBlock'
import { equationStepIsSolved } from './blocks'

/**
 * La navigation clavier DANS un bloc équation, sans React : l'ordre de lecture
 * `G₀ D₀ Op₀ G₁ D₁ Op₁ … Gₙ Dₙ [Opₙ]` et ce que chaque flèche y vise. Voir le
 * tableau « Équation » de la spec de navigation clavier — ce module en est la
 * transcription, et ses tests la vérifient ligne à ligne.
 */

export type EqField = 'left' | 'right' | 'operation'
export interface EqPos {
  step: number
  field: EqField
}
export type EqMove = 'left' | 'right' | 'up' | 'down'
/** Le dernier membre (G ou D) qui a eu le focus — là où ↑/↓ reviennent depuis une opération. */
export type EqColumn = 'left' | 'right'
export type EqTarget = { pos: EqPos; at: 'start' | 'end' } | 'exit-before' | 'exit-after'

/**
 * L'opération après l'étape `step` est-elle à l'écran ? Toujours entre deux
 * étapes ; après la dernière, cachée seulement quand l'étape est résolue ET
 * que l'opération est vide — un contenu saisi n'est jamais masqué.
 */
export function operationVisible(steps: EquationStep[], step: number): boolean {
  const last = steps.length - 1
  if (step < last) return true
  if (step !== last) return false
  return !equationStepIsSolved(steps, step) || (steps[step].operation ?? '').trim() !== ''
}

export function readingOrder(steps: EquationStep[]): EqPos[] {
  const order: EqPos[] = []
  steps.forEach((_, step) => {
    order.push({ step, field: 'left' }, { step, field: 'right' })
    if (operationVisible(steps, step)) order.push({ step, field: 'operation' })
  })
  return order
}

/** Où mène `move` depuis `from`. Avancer/descendre pose le curseur au début, reculer/monter à la fin. */
export function navigate(steps: EquationStep[], from: EqPos, move: EqMove, column: EqColumn): EqTarget {
  if (move === 'left' || move === 'right') {
    const backward = move === 'left'
    const order = readingOrder(steps)
    const here = order.findIndex(pos => pos.step === from.step && pos.field === from.field)
    const next = here === -1 ? undefined : order[here + (backward ? -1 : 1)]
    if (next === undefined) return backward ? 'exit-before' : 'exit-after'
    return { pos: next, at: backward ? 'end' : 'start' }
  }
  if (move === 'down') {
    if (from.field === 'operation') {
      return from.step + 1 < steps.length ? { pos: { step: from.step + 1, field: column }, at: 'start' } : 'exit-after'
    }
    if (operationVisible(steps, from.step)) return { pos: { step: from.step, field: 'operation' }, at: 'start' }
    return from.step + 1 < steps.length ? { pos: { step: from.step + 1, field: from.field }, at: 'start' } : 'exit-after'
  }
  if (from.field === 'operation') return { pos: { step: from.step, field: column }, at: 'end' }
  if (from.step === 0) return 'exit-before'
  return { pos: { step: from.step - 1, field: 'operation' }, at: 'end' }
}
