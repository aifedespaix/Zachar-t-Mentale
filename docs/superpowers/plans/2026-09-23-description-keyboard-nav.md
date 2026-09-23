# Navigation clavier de la description — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the description modal, the arrow keys never dead-end (two-step exit from a field to the neighbouring field and then the neighbouring block), MathLive's own navigation is left alone, Backspace/Delete never destroy content by accident, and the Enter variants mean the same thing in every block type.

**Architecture:** Fields emit *intents* (`onExit`, `onEnterBlock(place)`, `onBackspaceAtStart`, `onDeleteAtEnd`) and parents decide. A MathLive field reports its edges through MathLive's own `move-out` event, so there is no more capture-phase interception of ↑/↓. Raw inputs share a single helper, `rawFieldKeyDown`. A pure module, `equationNav.ts`, owns the equation reading order. `BlockEditor` gains the block-level moves (`exitBlock`, `focusBlockEdge`, `enterBlock`).

**Tech Stack:** React 19 (ref-as-prop, `useImperativeHandle`), TypeScript, MathLive `^0.110` (`<math-field>`, `move-out`, `MathfieldElement.plonkSound`), Vitest + Testing Library (jsdom), bun.

**Spec:** `docs/superpowers/specs/2026-09-23-description-keyboard-nav-design.md` is the normative source. Its key table is the reference, and every task argues from it.

## Global Constraints

- Nothing under `admin/` may import `@tauri-apps/*`. Every new module here (`fieldIntents.ts`, `equationNav.ts`) must stay pure: no Tauri, no store.
- Run the tests with `bun run test` (root). Before the final commit, run `bun run test:all` (root + admin) and `bun run build` (runs `tsc`). Never run `vitest` against `admin/` from the root.
- Code comments are in French, in the tone of the surrounding file. Identifiers are in English.
- Never `git add -f` anything under `.cours/**` or `.cartes-mentales/**`. Use `git add <explicit paths>` only.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Branch: `feat/description-keyboard-nav` (already checked out).
- User-visible labels: « Ctrl + Entrée » (context menu), « Ctrl/Cmd + Entrée » / « Ctrl/Cmd + Maj + Entrée » (shortcuts panel). The words « Nouveau bloc » must stay in the panel text (`DescriptionDialog.test.tsx` asserts on them).
- Tables and images are out of scope: block navigation *skips* them, and table cells keep their current behaviour except for the shared raw-field helper.

## Review Focus

1. **Alt+↑/↓ still moves blocks.** An arrow carrying Alt/Shift/Ctrl/Meta must never be taken as a field exit, or Alt+↑ would move the caret instead of moving the block. This is covered by `fieldIntents.test.tsx` (Alt/Shift cases) and `mathFieldKeys.test.tsx` (modified arrow → `move-out` ignored).
2. **Held Backspace across a boundary.** `event.repeat` at an edge must be swallowed in *all three* paths (MathLive, raw input, text block), not just one. This is covered in Task 3 (raw), Task 4 (MathLive) and Task 5 (textarea).
3. **The last operation disappears while it has focus.** Typing `x = 5` in the last step makes it "solved", so an *empty* Opₙ unmounts. A pending focus that targets it must fall back to the right-hand side instead of being lost. This is covered in Task 6 ("repli sur le membre droit").
4. **Tab at the end of an equation.** Tab in Opₙ, or a Tab `move-out` from the last field, must fall through to the browser (not be `preventDefault`ed). Otherwise Tab becomes a keyboard trap. This is covered in Task 6.
5. **Formula `["", "x=2"]` + Backspace on line 1.** It must not delete the block (bug 1). The same goes for Delete on the last empty line of `["x=2", ""]`. This is covered in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/content/blocks.ts` (modify) | `equationStepIsSolved` stricter rule; `equationToPlainText` writes a non-empty last operation. |
| `src/content/equationNav.ts` (create) | Pure: reading order, operation visibility, arrow/Tab navigation targets inside an equation. |
| `src/content/fieldIntents.ts` (create) | Shared types (`ExitDirection`, `ExitVia`, `BlockPlace`, `BlockEdgeHandle`) + `rawFieldKeyDown`, the keydown handler of every raw `<input>`/`<textarea>` fallback. |
| `src/content/MathFieldEditor.tsx` (modify) | `move-out` → `onExit`; no more ↑/↓ capture; anti-repeat; Enter variants; silent plonk. |
| `src/content/BlockEditor.tsx` (modify) | `MathLinesField` line/block exits + bug 1; `AutoGrowTextarea` arrows/Enter variants/anti-repeat; block-level `exitBlock`/`focusBlockEdge`/`enterBlock`/`enterQuestionBody`; root Ctrl+Entrée. |
| `src/content/EquationEditor.tsx` (modify) | Fields wired to `equationNav`; Backspace/Delete/Enter table; Opₙ visibility; `focusEdge` handle. |
| `src/content/BlockView.tsx` (modify) | Shows a non-empty last operation. |
| `src/types/cardBlock.ts` (modify) | `EquationStep.operation` comment. |
| `src/content/DescriptionDialog.tsx`, `src/content/EmptyAreaContextMenu.tsx` (modify) | Shortcut labels. |

---

### Task 1: Stricter « résolu » rule

**Files:**
- Modify: `src/content/blocks.ts:128-140` (`equationStepIsSolved` and its doc comment)
- Test: `src/content/blocks.test.ts` (add a `describe` after the existing `equationStepIsSolved` one, ~line 464)

**Interfaces:**
- Produces: `equationStepIsSolved(steps: EquationStep[], index: number): boolean` (same signature, stricter). Task 2 relies on it.

- [ ] **Step 1: Write the failing test**

Append to `src/content/blocks.test.ts` (`equationStepIsSolved` is already imported):

```ts
describe('equationStepIsSolved — la variable est vraiment isolée', () => {
  const cases: [string, string, boolean][] = [
    ['x', '5', true],
    ['x', '\\frac{3}{2}', true],
    ['5', 'x', true],
    ['x', '2x + 3', false],
    ['x', '', false],
    ['x', '   ', false],
    ['x', '\\max(a, b)', true],
    ['\\alpha', '2\\alpha', false],
    ['x', '2ax', false],
    ['x', '\\frac{x}{2}', false],
    ['x_1', 'x_{1} + 2', false],
    ['x_1', 'x_2 + 2', true],
    ['x', 'x_1 + 2', true],
  ]
  it.each(cases)('%s = %s → %s', (left, right, expected) => {
    expect(equationStepIsSolved([{ left, right }], 0)).toBe(expected)
  })

  it('ne regarde que la DERNIÈRE étape', () => {
    expect(equationStepIsSolved([{ left: 'x', right: '5' }, { left: '2x', right: '10' }], 0)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/content/blocks.test.ts`
Expected: FAIL on `x = 2x + 3`, `x = ` (empty), `x = '   '`, `\alpha = 2\alpha`, `x = 2ax`, `x = \frac{x}{2}`, and `x_1 = x_{1} + 2`. Each returns `true` today.

- [ ] **Step 3: Write the implementation**

In `src/content/blocks.ts`, replace the body of `equationStepIsSolved` and add the two helpers just above it. Also rewrite its doc comment (the block right above `export function equationStepIsSolved`) so it says: "résolue = dernière étape, un membre est une variable seule `v`, l'autre est non vide et ne contient pas `v` (voir `mentionsVariable`)".

```ts
/** `x_{1}` et `x_1` sont la même variable : l'indice à un caractère perd ses accolades. */
function normalizeIndexes(latex: string): string {
  return latex.replace(/_\{([a-zA-Z0-9])\}/g, '_$1')
}

/**
 * `latex` contient-il la variable `variable` ?
 *
 * Les commandes LaTeX (`\frac`, `\max`…) sont retirées d'abord, sauf si la
 * variable en est une (`\alpha`) : sans ça, le `x` de `\max` compterait. Une
 * lettre collée compte (`2ax` contient `x` — multiplication implicite), une
 * commande doit finir là (`\alphabet` n'est pas `\alpha`), et l'indice fait
 * partie du nom (`x` n'est pas `x_1`).
 */
function mentionsVariable(latex: string, variable: string): boolean {
  const name = normalizeIndexes(variable.trim())
  const [base, index] = name.split('_')
  const source = normalizeIndexes(latex).replace(/\\[a-zA-Z]+/g, command => (command === base ? command : ' '))
  const escape = (text: string) => text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
  const tail = base.startsWith('\\') ? '(?![a-zA-Z])' : ''
  const pattern =
    index === undefined
      ? `${escape(base)}${tail}(?!_)`
      : `${escape(base)}${tail}_${escape(index)}(?![a-zA-Z0-9}])`
  return new RegExp(pattern).test(source)
}

/** `variable` est seule de son côté, et l'autre côté en donne vraiment la valeur. */
function isolates(variable: string, other: string): boolean {
  return isBareVariable(variable) && other.trim() !== '' && !mentionsVariable(other, variable)
}

export function equationStepIsSolved(steps: EquationStep[], index: number): boolean {
  if (index !== steps.length - 1) return false
  const step = steps[index]
  return step !== undefined && (isolates(step.left, step.right) || isolates(step.right, step.left))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test src/content/blocks.test.ts src/content/BlockView.test.tsx src/content/equationKeys.test.tsx`
Expected: PASS. If an older test in those files relied on `x = 2x+3`-style steps being "solved", update its fixture to a truly solved step (`x = 4`) and say so in the commit body.

- [ ] **Step 5: Commit**

```bash
git add src/content/blocks.ts src/content/blocks.test.ts
git commit -m "fix(equation): « résolu » exige une variable vraiment isolée

x = 2x + 3 et x = (vide) ne passent plus en vert.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `equationNav.ts`, the pure equation navigation

**Files:**
- Create: `src/content/equationNav.ts`
- Test: `src/content/equationNav.test.ts`

**Interfaces:**
- Consumes: `equationStepIsSolved` (Task 1).
- Produces (Task 6 uses all of them):

```ts
export type EqField = 'left' | 'right' | 'operation'
export interface EqPos { step: number; field: EqField }
export type EqMove = 'left' | 'right' | 'up' | 'down'
export type EqColumn = 'left' | 'right'
export type EqTarget = { pos: EqPos; at: 'start' | 'end' } | 'exit-before' | 'exit-after'
export function operationVisible(steps: EquationStep[], step: number): boolean
export function readingOrder(steps: EquationStep[]): EqPos[]
export function navigate(steps: EquationStep[], from: EqPos, move: EqMove, column: EqColumn): EqTarget
```

- [ ] **Step 1: Write the failing test**

Create `src/content/equationNav.test.ts`:

```ts
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
  { left: '2x', right: '8', operation: '\\div 2' },
  { left: 'x', right: '4' },
]
const at = (step: number, field: EqPos['field']): EqPos => ({ step, field })

describe('operationVisible', () => {
  it('toujours visible entre deux étapes', () => {
    expect(operationVisible(solved, 0)).toBe(true)
  })
  it('après la dernière étape : visible tant qu’elle n’est pas résolue', () => {
    expect(operationVisible(open, 1)).toBe(true)
    expect(operationVisible(solved, 1)).toBe(false)
  })
  it('un contenu saisi n’est jamais masqué', () => {
    expect(operationVisible([{ left: 'x', right: '4', operation: 'vérif' }], 0)).toBe(true)
  })
  it('hors limites : faux', () => {
    expect(operationVisible(open, 2)).toBe(false)
  })
})

describe('readingOrder', () => {
  it('G D Op par étape, Opₙ seulement s’il est visible', () => {
    expect(readingOrder(open)).toEqual([at(0, 'left'), at(0, 'right'), at(0, 'operation'), at(1, 'left'), at(1, 'right'), at(1, 'operation')])
    expect(readingOrder(solved)).toEqual([at(0, 'left'), at(0, 'right'), at(0, 'operation'), at(1, 'left'), at(1, 'right')])
  })
})

describe('navigate — ←/→ (et Tab) suivent l’ordre de lecture', () => {
  it('→ va au champ suivant, curseur au début', () => {
    expect(navigate(open, at(0, 'left'), 'right', 'left')).toEqual({ pos: at(0, 'right'), at: 'start' })
    expect(navigate(open, at(0, 'right'), 'right', 'left')).toEqual({ pos: at(0, 'operation'), at: 'start' })
    expect(navigate(open, at(0, 'operation'), 'right', 'left')).toEqual({ pos: at(1, 'left'), at: 'start' })
  })
  it('← va au champ précédent, curseur à la fin', () => {
    expect(navigate(open, at(1, 'left'), 'left', 'left')).toEqual({ pos: at(0, 'operation'), at: 'end' })
    expect(navigate(open, at(0, 'right'), 'left', 'left')).toEqual({ pos: at(0, 'left'), at: 'end' })
  })
  it('au-delà des extrémités : sortie du bloc', () => {
    expect(navigate(open, at(0, 'left'), 'left', 'left')).toBe('exit-before')
    expect(navigate(open, at(1, 'operation'), 'right', 'left')).toBe('exit-after')
    expect(navigate(solved, at(1, 'right'), 'right', 'left')).toBe('exit-after')
  })
  it('depuis un Opₙ caché (focus perdu en route) : sortie plutôt qu’une erreur', () => {
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
  it('Opᵢ → étape suivante, colonne mémorisée', () => {
    expect(navigate(open, at(0, 'operation'), 'down', 'left')).toEqual({ pos: at(1, 'left'), at: 'start' })
    expect(navigate(open, at(0, 'operation'), 'down', 'right')).toEqual({ pos: at(1, 'right'), at: 'start' })
  })
  it('Opₙ → sortie bas', () => {
    expect(navigate(open, at(1, 'operation'), 'down', 'left')).toBe('exit-after')
  })
})

describe('navigate — ↑', () => {
  it('Opᵢ → même étape, colonne mémorisée, curseur à la fin', () => {
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/content/equationNav.test.ts`
Expected: FAIL with "Failed to resolve import './equationNav'".

- [ ] **Step 3: Write the implementation**

Create `src/content/equationNav.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/content/equationNav.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/equationNav.ts src/content/equationNav.test.ts
git commit -m "feat(equation): module pur de navigation entre les champs d'une équation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `fieldIntents.ts`, the shared raw-field keyboard

**Files:**
- Create: `src/content/fieldIntents.ts`
- Test: `src/content/fieldIntents.test.tsx`

**Interfaces:**
- Produces (Tasks 4–6 import these exact names):

```ts
export type ExitDirection = 'left' | 'right' | 'up' | 'down'
export type ExitVia = 'arrow' | 'tab'
export type BlockPlace = 'inside' | 'outside'
export interface BlockEdgeHandle { focusEdge: (at: 'start' | 'end') => void }
export interface RawFieldIntents {
  onEnter?: (before: string, after: string) => void
  onEnterBlock?: (place: BlockPlace) => void
  onBackspaceAtStart?: (rest: string) => void
  onDeleteAtEnd?: (rest: string) => void
  /** Returning `false` means "nowhere to go": the key is then NOT prevented (Tab falls through to the browser). */
  onExit?: (direction: ExitDirection, via: ExitVia) => boolean | void
  tabExits?: boolean
  onSwitchKind?: (direction: 1 | -1) => void
}
export function rawFieldKeyDown(intents: RawFieldIntents): (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void
```

- [ ] **Step 1: Write the failing test**

Create `src/content/fieldIntents.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { rawFieldKeyDown, type RawFieldIntents } from './fieldIntents'

function mount(intents: RawFieldIntents, value = 'abc') {
  render(<input aria-label="champ" defaultValue={value} onKeyDown={rawFieldKeyDown(intents)} />)
  const input = screen.getByRole('textbox', { name: 'champ' }) as HTMLInputElement
  const caret = (start: number, end = start) => input.setSelectionRange(start, end)
  // `fireEvent` renvoie `false` quand le gestionnaire a appelé `preventDefault`.
  const press = (init: Parameters<typeof fireEvent.keyDown>[1]) => !fireEvent.keyDown(input, init)
  return { input, caret, press }
}

describe('rawFieldKeyDown — flèches', () => {
  it('← au début et → en fin sortent ; ailleurs, natif', () => {
    const onExit = vi.fn()
    const { caret, press } = mount({ onExit })
    caret(1)
    expect(press({ key: 'ArrowLeft' })).toBe(false)
    caret(0)
    expect(press({ key: 'ArrowLeft' })).toBe(true)
    caret(3)
    expect(press({ key: 'ArrowRight' })).toBe(true)
    expect(onExit.mock.calls).toEqual([['left', 'arrow'], ['right', 'arrow']])
  })

  it('↑/↓ sortent toujours : un champ brut n’a pas de navigation verticale', () => {
    const onExit = vi.fn()
    const { caret, press } = mount({ onExit })
    caret(1)
    expect(press({ key: 'ArrowUp' })).toBe(true)
    expect(press({ key: 'ArrowDown' })).toBe(true)
    expect(onExit.mock.calls).toEqual([['up', 'arrow'], ['down', 'arrow']])
  })

  it('une flèche modifiée (Alt, Maj, Ctrl) n’est jamais une sortie', () => {
    const onExit = vi.fn()
    const { caret, press } = mount({ onExit })
    caret(0)
    expect(press({ key: 'ArrowUp', altKey: true })).toBe(false)
    expect(press({ key: 'ArrowLeft', shiftKey: true })).toBe(false)
    expect(press({ key: 'ArrowLeft', ctrlKey: true })).toBe(false)
    expect(onExit).not.toHaveBeenCalled()
  })

  it('une sélection non vide reste au navigateur', () => {
    const onExit = vi.fn()
    const { caret, press } = mount({ onExit })
    caret(0, 2)
    expect(press({ key: 'ArrowLeft' })).toBe(false)
    expect(onExit).not.toHaveBeenCalled()
  })
})

describe('rawFieldKeyDown — Retour arrière / Suppr', () => {
  it('au bord : l’intention reçoit tout le contenu', () => {
    const onBackspaceAtStart = vi.fn()
    const onDeleteAtEnd = vi.fn()
    const { caret, press } = mount({ onBackspaceAtStart, onDeleteAtEnd })
    caret(0)
    expect(press({ key: 'Backspace' })).toBe(true)
    caret(3)
    expect(press({ key: 'Delete' })).toBe(true)
    expect(onBackspaceAtStart).toHaveBeenCalledWith('abc')
    expect(onDeleteAtEnd).toHaveBeenCalledWith('abc')
  })

  it('anti-rafale : une touche répétée au bord est avalée sans rien déclencher', () => {
    const onBackspaceAtStart = vi.fn()
    const onDeleteAtEnd = vi.fn()
    const { caret, press } = mount({ onBackspaceAtStart, onDeleteAtEnd }, '')
    caret(0)
    expect(press({ key: 'Backspace', repeat: true })).toBe(true)
    expect(press({ key: 'Delete', repeat: true })).toBe(true)
    expect(onBackspaceAtStart).not.toHaveBeenCalled()
    expect(onDeleteAtEnd).not.toHaveBeenCalled()
  })

  it('pas au bord : natif', () => {
    const onBackspaceAtStart = vi.fn()
    const { caret, press } = mount({ onBackspaceAtStart })
    caret(2)
    expect(press({ key: 'Backspace' })).toBe(false)
    expect(onBackspaceAtStart).not.toHaveBeenCalled()
  })
})

describe('rawFieldKeyDown — Entrée', () => {
  it('Entrée coupe au curseur', () => {
    const onEnter = vi.fn()
    const { caret, press } = mount({ onEnter })
    caret(1)
    expect(press({ key: 'Enter' })).toBe(true)
    expect(onEnter).toHaveBeenCalledWith('a', 'bc')
  })

  it('Ctrl+Entrée hors groupe, Ctrl+Maj+Entrée dans le groupe', () => {
    const onEnterBlock = vi.fn()
    const { press } = mount({ onEnterBlock, onEnter: vi.fn() })
    press({ key: 'Enter', ctrlKey: true })
    press({ key: 'Enter', metaKey: true, shiftKey: true })
    expect(onEnterBlock.mock.calls).toEqual([['outside'], ['inside']])
  })

  it('Ctrl+Entrée sans bloc à créer (cellule) : une ligne', () => {
    const onEnter = vi.fn()
    const { caret, press } = mount({ onEnter })
    caret(3)
    press({ key: 'Enter', ctrlKey: true })
    expect(onEnter).toHaveBeenCalledWith('abc', '')
  })

  it('Maj+Entrée est avalée : un champ brut n’a pas de rangées', () => {
    const onEnter = vi.fn()
    const { press } = mount({ onEnter })
    expect(press({ key: 'Enter', shiftKey: true })).toBe(true)
    expect(onEnter).not.toHaveBeenCalled()
  })
})

describe('rawFieldKeyDown — Tab', () => {
  it('avec tabExits : champ voisin', () => {
    const onExit = vi.fn()
    const { press } = mount({ onExit, tabExits: true })
    expect(press({ key: 'Tab' })).toBe(true)
    expect(press({ key: 'Tab', shiftKey: true })).toBe(true)
    expect(onExit.mock.calls).toEqual([['right', 'tab'], ['left', 'tab']])
  })

  it('nulle part où aller (onExit → false) : Tab reste au navigateur', () => {
    const { press } = mount({ onExit: () => false, tabExits: true })
    expect(press({ key: 'Tab' })).toBe(false)
  })

  it('sans tabExits : type du bloc', () => {
    const onSwitchKind = vi.fn()
    const { press } = mount({ onSwitchKind })
    press({ key: 'Tab', shiftKey: true })
    expect(onSwitchKind).toHaveBeenCalledWith(-1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/content/fieldIntents.test.tsx`
Expected: FAIL with "Failed to resolve import './fieldIntents'".

- [ ] **Step 3: Write the implementation**

Create `src/content/fieldIntents.ts`:

```ts
import type { KeyboardEvent } from 'react'

/**
 * Le vocabulaire commun des champs de la description : un champ n'agit
 * jamais sur ses voisins, il ÉMET une intention (sortir par un côté, créer un
 * bloc, fusionner vers l'avant ou l'arrière) et son parent décide. Voir la
 * spec de navigation clavier, section « Architecture ».
 */

/** Le côté par lequel une flèche (ou Tab) demande à quitter un champ. */
export type ExitDirection = 'left' | 'right' | 'up' | 'down'
/** Ce qui a demandé la sortie — Tab retombe sur le navigateur quand le parent n'a nulle part où aller. */
export type ExitVia = 'arrow' | 'tab'
/** Ctrl/Cmd+Entrée : hors du groupe (`outside`) ; Ctrl/Cmd+Maj+Entrée : dans le groupe (`inside`). */
export type BlockPlace = 'inside' | 'outside'

/** Ce qu'un bloc expose pour qu'on y ENTRE au clavier : son premier champ au début, ou son dernier à la fin. */
export interface BlockEdgeHandle {
  focusEdge: (at: 'start' | 'end') => void
}

export interface RawFieldIntents {
  /** Entrée : ce qui reste avant le curseur, ce qui part après. */
  onEnter?: (before: string, after: string) => void
  /** Ctrl/Cmd(+Maj)+Entrée. Absent (cellule de tableau) : Ctrl+Entrée retombe sur `onEnter`. */
  onEnterBlock?: (place: BlockPlace) => void
  /** Retour arrière, curseur en tout début : `rest` est tout le contenu. */
  onBackspaceAtStart?: (rest: string) => void
  /** Suppr, curseur en toute fin : `rest` est tout le contenu. */
  onDeleteAtEnd?: (rest: string) => void
  /** Une flèche au bord (←/→) ou toujours (↑/↓) ; Tab si `tabExits`. `false` = nulle part où aller. */
  onExit?: (direction: ExitDirection, via: ExitVia) => boolean | void
  /** Tab / Maj+Tab passent au champ voisin (équation) au lieu de changer le type du bloc. */
  tabExits?: boolean
  /** Tab / Maj+Tab : le type du bloc. */
  onSwitchKind?: (direction: 1 | -1) => void
}

/**
 * Le clavier de TOUT champ brut (`<input>`/`<textarea>`) de la description —
 * le repli LaTeX d'une formule, d'un membre d'équation, l'opération. Un vrai
 * champ donne `selectionStart`/`selectionEnd` exacts : « au bord » se lit
 * directement, sans le repli défensif de `MathFieldEditor`.
 *
 * Une flèche modifiée (Alt, Maj, Ctrl, Cmd) n'est jamais une sortie : Alt+↑/↓
 * déplace le bloc, Maj+flèche sélectionne. Une touche d'effacement RÉPÉTÉE
 * au bord est avalée : Retour arrière maintenu pour vider un champ ne
 * traverse pas la frontière.
 */
export function rawFieldKeyDown(intents: RawFieldIntents) {
  return (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const field = event.currentTarget
    const value = field.value
    const start = field.selectionStart ?? value.length
    const end = field.selectionEnd ?? start
    const collapsed = start === end
    const mod = event.ctrlKey || event.metaKey
    const plain = !mod && !event.shiftKey && !event.altKey

    const exit = (direction: ExitDirection, via: ExitVia) => {
      if (intents.onExit === undefined) return
      if (intents.onExit(direction, via) !== false) event.preventDefault()
    }

    switch (event.key) {
      case 'Enter':
        event.preventDefault()
        if (mod && intents.onEnterBlock !== undefined) {
          intents.onEnterBlock(event.shiftKey ? 'inside' : 'outside')
          return
        }
        if (event.shiftKey) return
        intents.onEnter?.(value.slice(0, start), value.slice(end))
        return
      case 'Backspace':
        if (!collapsed || start !== 0 || intents.onBackspaceAtStart === undefined) return
        event.preventDefault()
        if (!event.repeat) intents.onBackspaceAtStart(value)
        return
      case 'Delete':
        if (!collapsed || start !== value.length || intents.onDeleteAtEnd === undefined) return
        event.preventDefault()
        if (!event.repeat) intents.onDeleteAtEnd(value)
        return
      case 'ArrowLeft':
        if (plain && collapsed && start === 0) exit('left', 'arrow')
        return
      case 'ArrowRight':
        if (plain && collapsed && start === value.length) exit('right', 'arrow')
        return
      case 'ArrowUp':
        if (plain) exit('up', 'arrow')
        return
      case 'ArrowDown':
        if (plain) exit('down', 'arrow')
        return
      case 'Tab':
        if (mod || event.altKey) return
        if (intents.tabExits === true) {
          exit(event.shiftKey ? 'left' : 'right', 'tab')
          return
        }
        if (intents.onSwitchKind !== undefined) {
          event.preventDefault()
          intents.onSwitchKind(event.shiftKey ? -1 : 1)
        }
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test src/content/fieldIntents.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/fieldIntents.ts src/content/fieldIntents.test.tsx
git commit -m "feat(description): intentions clavier partagées des champs bruts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: MathLive via `move-out`, formula lines, bug 1

**Files:**
- Modify: `src/content/MathFieldEditor.tsx` (props 53-99, destructuring 219-231, refs 242-261, `loadMathLive` 185-200, keydown listener 410-450)
- Modify: `src/content/BlockEditor.tsx`: `MathLineActions` + `mathLineKeyDown` (2206-2272), `MathLinesField` (2287-2427), `MathBlockField` fallback call (2477), `TableCellField` fallback call (~3069), React import (line 1)
- Modify: `src/content/EquationEditor.tsx`: `EquationTermField` passes `onExit` instead of `onArrowUp/onArrowDown` to `MathFieldEditor` (temporary bridge, replaced in Task 6)
- Test: `src/content/mathFieldKeys.test.tsx`, `src/content/formulaZoneKeys.test.tsx`

**Interfaces:**
- Consumes: `ExitDirection`, `ExitVia`, `BlockPlace`, `BlockEdgeHandle`, `rawFieldKeyDown` from `./fieldIntents` (Task 3).
- Produces:
  - `MathFieldEditorProps` loses `onArrowUp`/`onArrowDown`. It gains `onExit?: (direction: ExitDirection, via: ExitVia) => boolean | void` and `tabExits?: boolean`. `onEnterBlock` becomes `(place: BlockPlace) => void`.
  - `MathLinesField` gains `onExitBlock?: (side: 'before' | 'after') => void` and `ref?: React.Ref<BlockEdgeHandle>`. Its `onEnterBlock` becomes `(place: BlockPlace) => void`.
  - `MathBlockField` gains the optional props `onExitBlock?` and `edgeRef?: React.Ref<BlockEdgeHandle>`. Task 5 makes them required and wires them.

- [ ] **Step 1: Write the failing tests**

In `src/content/mathFieldKeys.test.tsx`:

1. Widen `mountField`'s props type:

```ts
async function mountField(props: {
  onEnter?: (before: string, after: string) => void
  onEnterBlock?: (place: 'inside' | 'outside') => void
  onBackspaceAtStart?: (rest: string) => void
  onDeleteAtEnd?: (rest: string) => void
  onExit?: (direction: 'left' | 'right' | 'up' | 'down', via: 'arrow' | 'tab') => boolean | void
  tabExits?: boolean
}) {
```

2. Add this helper under `mountField`:

```ts
/** Ce que MathLive émet quand une flèche ou Tab n'a plus rien à parcourir. Renvoie `true` si l'événement a été annulé. */
function moveOut(field: HTMLElement, direction: 'forward' | 'backward' | 'upward' | 'downward'): boolean {
  return !field.dispatchEvent(new CustomEvent('move-out', { detail: { direction }, cancelable: true, bubbles: true }))
}
```

3. Append this `describe`:

```ts
describe('move-out → onExit', () => {
  it('traduit les quatre directions et annule le « plonk »', async () => {
    const onExit = vi.fn()
    const field = await mountField({ onExit })
    expect(moveOut(field, 'forward')).toBe(true)
    moveOut(field, 'backward')
    moveOut(field, 'upward')
    moveOut(field, 'downward')
    expect(onExit.mock.calls).toEqual([
      ['right', 'arrow'],
      ['left', 'arrow'],
      ['up', 'arrow'],
      ['down', 'arrow'],
    ])
  })

  it('↑/↓ ne sont plus interceptés : MathLive les garde (fractions)', async () => {
    const onExit = vi.fn()
    const field = await mountField({ onExit })
    expect(fireEvent.keyDown(field, { key: 'ArrowUp' })).toBe(true)
    expect(fireEvent.keyDown(field, { key: 'ArrowDown' })).toBe(true)
    expect(onExit).not.toHaveBeenCalled()
  })

  it('un move-out issu de Tab reste à MathLive sans tabExits', async () => {
    const onExit = vi.fn()
    const field = await mountField({ onExit })
    fireEvent.keyDown(field, { key: 'Tab' })
    expect(moveOut(field, 'forward')).toBe(false)
    expect(onExit).not.toHaveBeenCalled()
  })

  it('avec tabExits, Tab sort vers le champ voisin ; `false` laisse faire MathLive', async () => {
    const onExit = vi.fn().mockReturnValueOnce(undefined).mockReturnValueOnce(false)
    const field = await mountField({ onExit, tabExits: true })
    fireEvent.keyDown(field, { key: 'Tab' })
    expect(moveOut(field, 'forward')).toBe(true)
    fireEvent.keyDown(field, { key: 'Tab', shiftKey: true })
    expect(moveOut(field, 'backward')).toBe(false)
    expect(onExit.mock.calls).toEqual([['right', 'tab'], ['left', 'tab']])
  })

  it('une flèche modifiée (Maj : sélection) ne sort jamais', async () => {
    const onExit = vi.fn()
    const field = await mountField({ onExit })
    fireEvent.keyDown(field, { key: 'ArrowRight', shiftKey: true })
    expect(moveOut(field, 'forward')).toBe(false)
    expect(onExit).not.toHaveBeenCalled()
  })
})

describe('anti-rafale et variantes d’Entrée', () => {
  it('Retour arrière / Suppr répétés au bord sont avalés sans rien déclencher', async () => {
    const onBackspaceAtStart = vi.fn()
    const onDeleteAtEnd = vi.fn()
    const field = await mountField({ onBackspaceAtStart, onDeleteAtEnd })
    field.position = 0
    expect(fireEvent.keyDown(field, { key: 'Backspace', repeat: true })).toBe(false)
    field.position = field.value.length
    expect(fireEvent.keyDown(field, { key: 'Delete', repeat: true })).toBe(false)
    expect(onBackspaceAtStart).not.toHaveBeenCalled()
    expect(onDeleteAtEnd).not.toHaveBeenCalled()
  })

  it('Ctrl+Entrée → hors groupe, Ctrl+Maj+Entrée → dans le groupe', async () => {
    const onEnterBlock = vi.fn()
    const field = await mountField({ onEnterBlock, onEnter: vi.fn() })
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true, shiftKey: true })
    expect(onEnterBlock.mock.calls).toEqual([['outside'], ['inside']])
  })
})
```

4. In the existing test "Entrée seule ajoute une ligne, Ctrl+Entrée demande un nouveau bloc", replace its `onEnterBlock` expectation with `expect(onEnterBlock).toHaveBeenCalledWith('outside')` (leave the rest unchanged).

In `src/content/formulaZoneKeys.test.tsx`:

1. Add the same `moveOut` helper after `mathFields()`.
2. Replace the three tests "les flèches montent/descendent d'une ligne DANS le bloc", "les flèches ne sortent pas de la formule : rien aux extrémités" and "une formule mono-ligne laisse les flèches à MathLive" (lines 109-147) with:

```ts
  it('move-out ↑/↓ et ←/→ passent d’une ligne à l’autre DANS le bloc', async () => {
    render(<Harness initial={[{ kind: 'math', latex: 'a\nb\nc' }]} />)
    const fields = await mathFields()
    expect(fields).toHaveLength(3)

    moveOut(fields[1], 'downward')
    expect(fields[2].focus).toHaveBeenCalled()
    expect(fields[2].executeCommand).toHaveBeenCalledWith('moveToMathfieldStart')

    moveOut(fields[1], 'upward')
    expect(fields[0].focus).toHaveBeenCalled()
    expect(fields[0].executeCommand).toHaveBeenCalledWith('moveToMathfieldEnd')

    fields[0].focus.mockClear()
    fields[2].focus.mockClear()
    moveOut(fields[1], 'forward')
    expect(fields[2].focus).toHaveBeenCalled()
    moveOut(fields[1], 'backward')
    expect(fields[0].focus).toHaveBeenCalled()
    expect(document.querySelectorAll('[data-row-index]')).toHaveLength(1)
  })

  it('↑/↓ au clavier ne sont jamais interceptés — MathLive circule dans la fraction', async () => {
    render(<Harness initial={[{ kind: 'math', latex: '\\frac{1}{2}\nb' }]} />)
    const [first] = await mathFields()
    expect(fireEvent.keyDown(first, { key: 'ArrowDown' })).toBe(true)
    expect(fireEvent.keyDown(first, { key: 'ArrowUp' })).toBe(true)
  })

  it('bug 1 : Retour arrière sur une première ligne vide ne supprime pas les autres', async () => {
    const onState = vi.fn()
    render(<Harness initial={[{ kind: 'text', text: 'avant' }, { kind: 'math', latex: '\nx=2' }]} onState={onState} />)
    const [first] = await mathFields()
    first.position = 0
    fireEvent.keyDown(first, { key: 'Backspace' })
    expect(onState).not.toHaveBeenCalled()
  })

  it('bug 1 : Suppr sur une dernière ligne vide ne supprime pas les autres', async () => {
    const onState = vi.fn()
    render(<Harness initial={[{ kind: 'math', latex: 'x=2\n' }, { kind: 'text', text: 'après' }]} onState={onState} />)
    const [, last] = await mathFields()
    fireEvent.keyDown(last, { key: 'Delete' })
    expect(onState).not.toHaveBeenCalled()
  })
```

(`mathFields()` returns `focus` typed as `() => void`. Change its cast in `formulaZoneKeys.test.tsx` from `focus: () => void` to `focus: ReturnType<typeof vi.fn>` in both places so `mockClear` type-checks.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test src/content/mathFieldKeys.test.tsx src/content/formulaZoneKeys.test.tsx`
Expected: FAIL. `onExit` is never called, ArrowUp is prevented on a multi-line formula, bug 1 deletes the block, and `onEnterBlock` receives no argument.

- [ ] **Step 3: Implement in `MathFieldEditor.tsx`**

1. Add at the top: `import type { BlockPlace, ExitDirection, ExitVia } from './fieldIntents'`.
2. Change `onEnterBlock` in `MathFieldEditorProps` to:

```ts
  /**
   * Ctrl/Cmd+Entrée (`outside` : un bloc après le groupe) ou Ctrl/Cmd+Maj+Entrée
   * (`inside` : un bloc dans le groupe, juste après celui-ci). Absent dans une
   * cellule de tableau, où il n'y a pas de bloc à créer : `onEnter` prend alors
   * Ctrl+Entrée, et Ctrl+Maj+Entrée reste à MathLive.
   */
  onEnterBlock?: (place: BlockPlace) => void
```

3. Replace the `onArrowUp`/`onArrowDown` props (and their doc comments) with:

```ts
  /**
   * MathLive n'a plus rien à parcourir dans cette direction (événement
   * `move-out`) : le parent décide où va le curseur — ligne voisine, champ
   * voisin, bloc voisin. Renvoyer `false` = nulle part où aller : MathLive
   * garde alors son comportement par défaut (Tab passe à l'élément suivant).
   * La navigation INTERNE (numérateur ↔ dénominateur…) n'est jamais touchée.
   */
  onExit?: (direction: ExitDirection, via: ExitVia) => boolean | void
  /** Un `move-out` issu de Tab passe par `onExit` (équation). Sans lui, Tab reste entièrement à MathLive. */
  tabExits?: boolean
```

4. In the destructuring, replace `onArrowUp, onArrowDown,` with `onExit, tabExits,`. Replace the two `onArrowUpRef`/`onArrowDownRef` pairs with:

```ts
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  const tabExitsRef = useRef(tabExits)
  tabExitsRef.current = tabExits
```

5. Add this above `loadMathLive`, and call `silencePlonk(module)` in its `.then`. The `.then(() => {` becomes `.then(module => { silencePlonk(module)`:

```ts
/**
 * MathLive joue un son (« plonk ») quand une flèche ne mène nulle part dans le
 * champ — exactement le moment où la description, elle, emmène le curseur au
 * champ ou au bloc voisin. Coupé une fois pour toutes : un son qui dit
 * « impossible » juste avant un déplacement qui réussit est faux.
 */
function silencePlonk(module: unknown): void {
  const element = (module as { MathfieldElement?: { plonkSound: string | null } }).MathfieldElement
  if (element !== undefined) element.plonkSound = null
}
```

6. Add this map near `caretAtStart`:

```ts
/** `move-out` parle en sens de lecture ; la description, en côtés. */
const MOVE_OUT_DIRECTIONS: Partial<Record<string, ExitDirection>> = {
  forward: 'right',
  backward: 'left',
  upward: 'up',
  downward: 'down',
}
```

7. In the element effect, replace the whole `field.addEventListener('keydown', …, { capture: true })` call with the block below. The long comment explaining why the listener is on capture stays above it, unchanged.

```ts
    // La dernière touche vue par ce champ : `move-out` ne dit pas s'il vient
    // d'une flèche ou de Tab, ni si une touche de modification était tenue.
    let lastKey = ''
    let lastModified = false
    field.addEventListener(
      'keydown',
      event => {
        lastKey = event.key
        lastModified = event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
        // Au bord, une touche d'effacement RÉPÉTÉE est avalée : Retour arrière
        // maintenu pour vider le champ ne traverse pas la frontière.
        if (event.key === 'Backspace' && caretAtStart(field) && onBackspaceAtStartRef.current !== undefined) {
          event.preventDefault()
          if (!event.repeat) onBackspaceAtStartRef.current(field.value)
          return
        }
        if (event.key === 'Delete' && caretAtEnd(field) && onDeleteAtEndRef.current !== undefined) {
          event.preventDefault()
          if (!event.repeat) onDeleteAtEndRef.current(field.value)
          return
        }
        if (event.key !== 'Enter') return
        const mod = event.ctrlKey || event.metaKey
        const enterBlock = onEnterBlockRef.current
        // Maj+Entrée seule appartient à MathLive (rangées d'une matrice).
        if (event.shiftKey && !(mod && enterBlock !== undefined)) return
        event.preventDefault()
        if (mod && enterBlock !== undefined) {
          enterBlock(event.shiftKey ? 'inside' : 'outside')
          return
        }
        const { before, after } = splitAtCaret(field)
        onEnterRef.current?.(before, after)
      },
      { capture: true }
    )
    // MathLive émet `move-out` quand une flèche (ou Tab) n'a plus rien à
    // parcourir DANS le champ : c'est là, et seulement là, que le curseur
    // change de champ — d'où le « deux temps » (`aaa|b` → `aaab|` → voisin).
    field.addEventListener('move-out', event => {
      const exit = onExitRef.current
      if (exit === undefined) return
      const via: ExitVia = lastKey === 'Tab' ? 'tab' : 'arrow'
      if (via === 'tab' ? tabExitsRef.current !== true : lastModified) return
      const direction = MOVE_OUT_DIRECTIONS[(event as CustomEvent<{ direction?: string }>).detail?.direction ?? '']
      if (direction === undefined) return
      if (exit(direction, via) !== false) event.preventDefault()
    })
```

8. Update the `onEnter` prop doc so it no longer says Ctrl+Entrée gives "un NOUVEAU bloc après celui-ci". Point it to `onEnterBlock` instead.

- [ ] **Step 4: Implement in `BlockEditor.tsx` (`MathLinesField` & co.)**

1. Line 1: add `useImperativeHandle` to the React import.
2. Add after the `./MathFieldEditor` import: `import { rawFieldKeyDown, type BlockEdgeHandle, type BlockPlace, type ExitDirection } from './fieldIntents'`.
3. Replace `MathLineActions` and `mathLineKeyDown` (2206-2272) with:

```ts
/** Ce qu'une ligne de formule peut demander — les mêmes intentions en WYSIWYG et en repli brut. */
interface MathLineActions {
  setValue: (next: string) => void
  /** Entrée : ce qui reste dans la ligne courante, et ce qui part dans une nouvelle ligne après elle. */
  addLine: (before: string, after: string) => void
  /** Ctrl/Cmd(+Maj)+Entrée : un nouveau bloc. Absent dans une cellule de tableau. */
  addBlock?: (place: BlockPlace) => void
  /** Retour arrière en tout début de ligne : ce qu'elle contient encore, à fusionner avec la précédente. */
  backspace: (rest: string) => void
  /** Suppr en toute fin de ligne : ce qu'elle contient encore, à fusionner avec la suivante. */
  remove: (rest: string) => void
  /** Une flèche au bord : ligne voisine, ou bloc voisin aux extrémités. */
  exit: (direction: ExitDirection) => void
  /** Tab / Maj+Tab : le type du bloc. Absent dans une cellule de tableau. */
  switchKind?: (direction: 1 | -1) => void
}

/** Le clavier d'un champ brut de ligne, partagé par le bloc et la cellule — voir `rawFieldKeyDown`. */
function mathLineKeyDown(actions: MathLineActions) {
  return rawFieldKeyDown({
    onEnter: actions.addLine,
    onEnterBlock: actions.addBlock,
    onBackspaceAtStart: actions.backspace,
    onDeleteAtEnd: actions.remove,
    onExit: direction => actions.exit(direction),
    onSwitchKind: actions.switchKind,
  })
}
```

4. In `MathLinesField`:
   - Add the props `onExitBlock` and `ref`, and change the type of `onEnterBlock`:

```ts
  onEnterBlock?: (place: BlockPlace) => void
  /** Une flèche au-delà de la première ou de la dernière ligne. Absent dans une cellule : la touche y est avalée. */
  onExitBlock?: (side: 'before' | 'after') => void
  ref?: React.Ref<BlockEdgeHandle>
```

   (Add `onExitBlock, ref,` to the destructuring.)
   - After the `pending` ref, add:

```ts
  // Le handle est construit une fois : il lit le nombre de lignes à l'appel.
  const lineCount = useRef(lines.length)
  lineCount.current = lines.length
  useImperativeHandle(
    ref,
    () => ({
      focusEdge(at) {
        const handle = handles.current[at === 'start' ? 0 : lineCount.current - 1]
        if (at === 'start') handle?.focusStart()
        else handle?.focusEnd()
      },
    }),
    []
  )
```

   - In `actionsFor`, replace the two `if (rest === '') onEmpty…?.()` lines. Replace the `arrowUp`/`arrowDown` entries (and their comment) as well:

```ts
        // Première ligne, rien avant : le bloc ne disparaît que si TOUTES ses
        // lignes sont vides — une ligne vide au-dessus de `x=2` n'emporte
        // jamais `x=2` avec elle. Sinon, comme un textarea en tout début de
        // texte, la touche ne fait rien.
        if (rest === '' && lines.every(current => current === '')) onEmptyBackspace?.()
```

```ts
        if (rest === '' && lines.every(current => current === '')) onEmptyDelete?.()
```

```ts
      // Au bord d'une ligne (MathLive n'a plus rien à parcourir) : la ligne
      // voisine, ou le bloc voisin aux extrémités.
      exit: direction => {
        const backward = direction === 'left' || direction === 'up'
        const target = backward ? line - 1 : line + 1
        if (target >= 0 && target < lines.length) {
          focusLine(target, backward ? 'end' : 'start')
          return
        }
        onExitBlock?.(backward ? 'before' : 'after')
      },
```

   - On the `<MathFieldEditor>` inside the lines map, replace `onArrowUp={actions.arrowUp}` and `onArrowDown={actions.arrowDown}` with `onExit={direction => actions.exit(direction)}`.
   - Rewrite the component's doc comment paragraph about the keyboard so it mentions the arrows ("au bord d'une ligne, les flèches passent à la ligne voisine, puis au bloc voisin").
5. `MathBlockField`: change the `onEnterBlock` type to `(place: BlockPlace) => void`. Add the optional props `onExitBlock?: (side: 'before' | 'after') => void` and `edgeRef?: React.Ref<BlockEdgeHandle>`. Pass `onExitBlock={onExitBlock}` and `ref={edgeRef}` to `<MathLinesField>`. Replace `onKeyDown={mathLineKeyDown({ ...actions, switchKind: onSwitchKind }, lines[line] ?? '')}` with `onKeyDown={mathLineKeyDown({ ...actions, switchKind: onSwitchKind })}`.
6. `TableCellField` (~3069): replace `onKeyDown={mathLineKeyDown(actions, latexLines(latex)[line] ?? '')}` with `onKeyDown={mathLineKeyDown(actions)}`.
7. `BlockField`: its `onEnterBlock: () => void` is still passed to `MathBlockField`. It type-checks (a function with fewer parameters is assignable), so leave it for Task 5.

- [ ] **Step 5: Bridge `EquationTermField` (`EquationEditor.tsx`)**

On the `<MathFieldEditor>` in `EquationTermField`, replace `onArrowUp={onArrowUp}` and `onArrowDown={onArrowDown}` with:

```tsx
        // Pont provisoire : ↑/↓ (via `move-out`) gardent l'ancien sens le
        // temps que `EquationBlockField` passe à `equationNav`.
        onExit={direction => {
          if (direction === 'up') onArrowUp?.()
          else if (direction === 'down') onArrowDown?.()
        }}
```

- [ ] **Step 6: Run the tests**

Run: `bun run test src/content`
Expected: PASS for everything. If `equationKeys.test.tsx` had a test that relied on a keydown ArrowUp/Down in a MathLive field, it now needs a `move-out`. List any such test in the commit body. Per the Grep in the plan research there are none.

- [ ] **Step 7: Type-check**

Run: `bunx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/content/MathFieldEditor.tsx src/content/BlockEditor.tsx src/content/EquationEditor.tsx src/content/mathFieldKeys.test.tsx src/content/formulaZoneKeys.test.tsx
git commit -m "feat(formule): les flèches suivent move-out de MathLive, plus de perte de lignes

- ↑/↓ ne sont plus interceptés : fractions et exposants retrouvent leur navigation
- au bord d'une ligne, ←/→/↑/↓ passent à la ligne voisine
- Retour arrière/Suppr ne suppriment le bloc que si toutes les lignes sont vides
- anti-rafale au bord, Ctrl+Maj+Entrée = bloc dans le groupe, plonk coupé

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Block-level navigation, text blocks, Enter variants

**Files:**
- Modify: `src/content/BlockEditor.tsx`:
  - focus machinery (after `focusBlockLater`, ~671)
  - `insertBlockAfter`/`appendOutside` area (694-727)
  - `handleEditorKeyDown` (1127-1191)
  - the `<BlockField>` call (1376-1386)
  - `BlockFieldProps` (1972-1989)
  - `BlockField` (1991-2096)
  - `AutoGrowTextarea` (2107-2193)
  - `MathBlockField` props (make `onExitBlock`/`edgeRef` required)
- Modify: `src/content/DescriptionDialog.tsx:1623-1636` (shortcuts panel)
- Modify: `src/content/EmptyAreaContextMenu.tsx:92`
- Test: `src/content/blockKeys.test.tsx`, `src/content/formulaZoneKeys.test.tsx`, `src/content/BlockEditor.test.tsx:1637-1652`

**Interfaces:**
- Consumes: `BlockPlace`, `BlockEdgeHandle` (Task 3); `MathBlockField`'s `onExitBlock`/`edgeRef`, and `MathLinesField.focusEdge` (Task 4).
- Produces (Task 6 wires the equation to them):
  - `BlockField` props `onEnterBlock: (place: BlockPlace) => void`, `onEnterBody: () => void`, `onExitBlock: (side: 'before' | 'after') => void`, `edgeRef: (handle: BlockEdgeHandle | null) => void`.
  - The `BlockEditor` functions `exitBlock(index, side)`, `focusBlockEdge(index, at)` and `enterBlock(index, place)`.

- [ ] **Step 1: Write the failing tests**

Append to `src/content/blockKeys.test.tsx` (this file mocks `MathFieldEditor` to its fallback, so keep these tests to text/question/table blocks). Add `fireEvent` and `waitFor` to the `@testing-library/react` import, and `import type { CardBlock } from '../types/cardBlock'` if it is not already there.

```tsx
describe('les flèches sortent d’un bloc texte en deux temps', () => {
  it('→ en fin passe au bloc suivant, curseur au début', () => {
    renderEditor([
      { kind: 'text', text: 'ab' },
      { kind: 'text', text: 'cd' },
    ])
    const first = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    first.focus()
    first.setSelectionRange(1, 1)
    expect(fireEvent.keyDown(first, { key: 'ArrowRight' })).toBe(true) // pas au bord : natif
    first.setSelectionRange(2, 2)
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    const second = screen.getByRole('textbox', { name: /texte du bloc 2/i }) as HTMLTextAreaElement
    expect(second).toHaveFocus()
    expect(second.selectionStart).toBe(0)
  })

  it('↑ seulement quand le curseur est DÉJÀ en position 0 ; arrive à la fin du précédent', () => {
    renderEditor([
      { kind: 'text', text: 'ab' },
      { kind: 'text', text: 'ligne 1\nligne 2' },
    ])
    const second = screen.getByRole('textbox', { name: /texte du bloc 2/i }) as HTMLTextAreaElement
    second.focus()
    second.setSelectionRange(3, 3)
    expect(fireEvent.keyDown(second, { key: 'ArrowUp' })).toBe(true)
    second.setSelectionRange(0, 0)
    fireEvent.keyDown(second, { key: 'ArrowUp' })
    const first = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    expect(first).toHaveFocus()
    expect(first.selectionStart).toBe(2)
  })

  it('saute un tableau, et avale la touche sans voisin', () => {
    renderEditor([
      { kind: 'text', text: 'a' },
      { kind: 'table', header: [], rows: [['x']] },
      { kind: 'text', text: 'b' },
    ])
    const first = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    first.focus()
    first.setSelectionRange(0, 0)
    expect(fireEvent.keyDown(first, { key: 'ArrowLeft' })).toBe(false) // avalée
    expect(first).toHaveFocus()
    first.setSelectionRange(1, 1)
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(screen.getByRole('textbox', { name: /texte du bloc 3/i })).toHaveFocus()
  })

  it('Alt+↓ reste le déplacement du bloc', () => {
    const { latest } = renderEditor([
      { kind: 'text', text: 'a' },
      { kind: 'text', text: 'b' },
    ])
    const first = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    first.focus()
    first.setSelectionRange(1, 1)
    fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true })
    expect(latest()).toEqual([
      { kind: 'text', text: 'b' },
      { kind: 'text', text: 'a' },
    ])
  })
})

describe('Ctrl+Entrée hors groupe, Ctrl+Maj+Entrée dans le groupe', () => {
  const group: CardBlock[] = [
    { kind: 'question', text: 'Q' },
    { kind: 'text', text: 'a' },
    { kind: 'text', text: 'b' },
  ]

  it('Ctrl+Entrée : après le DERNIER bloc du groupe, marqué standalone', () => {
    const { latest } = renderEditor(group)
    fireEvent.keyDown(screen.getByRole('textbox', { name: /texte du bloc 2/i }), { key: 'Enter', ctrlKey: true })
    expect(latest()).toEqual([...group, { kind: 'text', text: '', standalone: true }])
  })

  it('Ctrl+Maj+Entrée : juste après le bloc courant, dans le groupe', () => {
    const { latest } = renderEditor(group)
    fireEvent.keyDown(screen.getByRole('textbox', { name: /texte du bloc 2/i }), { key: 'Enter', ctrlKey: true, shiftKey: true })
    expect(latest()).toEqual([group[0], group[1], { kind: 'text', text: '' }, group[2]])
  })
})

describe('Entrée dans l’en-tête de question passe dans le corps', () => {
  it('insère un texte vide juste après l’en-tête et le focalise', async () => {
    const { latest } = renderEditor([
      { kind: 'question', text: 'Q' },
      { kind: 'text', text: 'réponse' },
    ])
    fireEvent.keyDown(screen.getByRole('textbox', { name: /question du bloc 1/i }), { key: 'Enter' })
    expect(latest()).toEqual([
      { kind: 'question', text: 'Q' },
      { kind: 'text', text: '' },
      { kind: 'text', text: 'réponse' },
    ])
    await waitFor(() => expect(screen.getByRole('textbox', { name: /texte du bloc 2/i })).toHaveFocus())
  })

  it('réutilise un texte vide qui suit déjà, sans rien insérer', () => {
    const { onState } = renderEditor([
      { kind: 'question', text: 'Q' },
      { kind: 'text', text: '' },
    ])
    fireEvent.keyDown(screen.getByRole('textbox', { name: /question du bloc 1/i }), { key: 'Enter' })
    expect(onState).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: /texte du bloc 2/i })).toHaveFocus()
  })

  it('Maj+Entrée reste un retour à la ligne dans le titre', () => {
    const { onState } = renderEditor([{ kind: 'question', text: 'Q' }])
    expect(fireEvent.keyDown(screen.getByRole('textbox', { name: /question du bloc 1/i }), { key: 'Enter', shiftKey: true })).toBe(true)
    expect(onState).not.toHaveBeenCalled()
  })
})

describe('anti-rafale sur un bloc texte vide', () => {
  it('Retour arrière répété ne supprime pas le bloc', () => {
    const { onState } = renderEditor([
      { kind: 'text', text: 'abc' },
      { kind: 'text', text: '' },
    ])
    fireEvent.keyDown(screen.getByRole('textbox', { name: /texte du bloc 2/i }), { key: 'Backspace', repeat: true })
    expect(onState).not.toHaveBeenCalled()
  })
})
```

Append to `src/content/formulaZoneKeys.test.tsx` (real `MathFieldEditor`):

```tsx
describe('sortir d’une formule vers les blocs voisins', () => {
  it('move-out au-delà de la première ligne → fin du texte au-dessus', async () => {
    render(<Harness initial={[{ kind: 'text', text: 'avant' }, { kind: 'math', latex: 'a\nb' }]} />)
    const [first] = await mathFields()
    moveOut(first, 'upward')
    const text = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    expect(text).toHaveFocus()
    expect(text.selectionStart).toBe(5)
  })

  it('move-out au-delà de la dernière ligne saute un tableau', async () => {
    render(
      <Harness
        initial={[
          { kind: 'math', latex: 'a' },
          { kind: 'table', header: [], rows: [['x']] },
          { kind: 'text', text: 'après' },
        ]}
      />
    )
    const [only] = await mathFields()
    moveOut(only, 'forward')
    const text = screen.getByRole('textbox', { name: /texte du bloc 3/i }) as HTMLTextAreaElement
    expect(text).toHaveFocus()
    expect(text.selectionStart).toBe(0)
  })

  it('↓ en fin de texte entre dans la formule, curseur au début', async () => {
    render(<Harness initial={[{ kind: 'text', text: 'ab' }, { kind: 'math', latex: 'x\ny' }]} />)
    const [first] = await mathFields()
    const text = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    text.focus()
    text.setSelectionRange(2, 2)
    fireEvent.keyDown(text, { key: 'ArrowDown' })
    expect(first.focus).toHaveBeenCalled()
    expect(first.executeCommand).toHaveBeenCalledWith('moveToMathfieldStart')
  })

  it('← au début d’un texte entre dans la formule au-dessus par sa DERNIÈRE ligne', async () => {
    render(<Harness initial={[{ kind: 'math', latex: 'x\ny' }, { kind: 'text', text: 'ab' }]} />)
    const [, last] = await mathFields()
    const text = screen.getByRole('textbox', { name: /texte du bloc 2/i }) as HTMLTextAreaElement
    text.focus()
    text.setSelectionRange(0, 0)
    fireEvent.keyDown(text, { key: 'ArrowLeft' })
    expect(last.focus).toHaveBeenCalled()
    expect(last.executeCommand).toHaveBeenCalledWith('moveToMathfieldEnd')
  })
})
```

In `src/content/BlockEditor.test.tsx`, replace the test at 1637-1652 with:

```tsx
  it('adds a block outside the question with Ctrl/Cmd + Entrée', async () => {
    const { latest } = renderEditor([
      { kind: 'question', text: 'Q' },
      { kind: 'text', text: 'a' },
    ])
    const field = screen.getByRole('textbox', { name: /texte du bloc 2/i })
    field.focus()

    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })

    expect(latest()).toMatchObject([
      { kind: 'question', text: 'Q' },
      { kind: 'text', text: 'a' },
      { kind: 'text', text: '', standalone: true },
    ])
  })

  it('adds a block inside the question with Ctrl/Cmd + Maj + Entrée', async () => {
    const { latest } = renderEditor([
      { kind: 'question', text: 'Q' },
      { kind: 'text', text: 'a' },
    ])
    const field = screen.getByRole('textbox', { name: /texte du bloc 2/i })
    field.focus()

    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true, shiftKey: true })

    expect(latest()).toEqual([
      { kind: 'question', text: 'Q' },
      { kind: 'text', text: 'a' },
      { kind: 'text', text: '' },
    ])
  })

  it('Ctrl + Entrée from a gutter button appends outside the last question', async () => {
    const { latest } = renderEditor([
      { kind: 'question', text: 'Q' },
      { kind: 'text', text: 'a' },
    ])
    fireEvent.keyDown(screen.getByRole('button', { name: /monter le bloc 2/i }), { key: 'Enter', ctrlKey: true })

    expect(latest()).toMatchObject([
      { kind: 'question', text: 'Q' },
      { kind: 'text', text: 'a' },
      { kind: 'text', text: '', standalone: true },
    ])
  })
```

(The gutter button is named `Monter le bloc ${index + 1}` in `BlockGutter`. If it is `disabled` for block 2, use `/descendre le bloc 2/i` or any enabled gutter/kind button in row 2. The test only needs a non-input target inside the editor.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test src/content/blockKeys.test.tsx src/content/formulaZoneKeys.test.tsx src/content/BlockEditor.test.tsx`
Expected: FAIL. Arrows do not exit, and Ctrl+Enter inserts right after the block with no `standalone`. The question header has no `onEnterBody`, and the gutter Ctrl+Enter does nothing.

- [ ] **Step 3: Block-level plumbing in `BlockEditor`**

1. Add near the other module constants (above `BlockEditor`):

```ts
/** Les blocs où les flèches entrent : image et tableau sont sautés (un tableau serait un piège dont les flèches ne ressortent pas). */
const NAVIGABLE_KINDS: ReadonlySet<CardBlockKind> = new Set(['text', 'question', 'math', 'equation'])
```

2. After `focusBlockLater` (~673), add:

```ts
  // Le point d'entrée clavier de chaque formule/équation, par index — même
  // raison que `fieldSetterFor` pour mettre les rappels en cache : un `ref`
  // neuf à chaque rendu se détacherait et se rattacherait à chaque rendu.
  const edgeHandles = useRef(new Map<number, BlockEdgeHandle | null>())
  const edgeRefs = useRef(new Map<number, (handle: BlockEdgeHandle | null) => void>())
  function edgeRefFor(index: number): (handle: BlockEdgeHandle | null) => void {
    let setter = edgeRefs.current.get(index)
    if (setter === undefined) {
      setter = handle => {
        edgeHandles.current.set(index, handle)
      }
      edgeRefs.current.set(index, setter)
    }
    return setter
  }

  /** Entre dans le bloc `index` par son début (premier champ) ou sa fin (dernier champ). */
  function focusBlockEdge(index: number, at: 'start' | 'end') {
    const block = blocksRef.current[index]
    if (block === undefined) return
    if (block.kind === 'text' || block.kind === 'question') {
      const field = textFieldAt(index)
      if (field === null) return
      field.focus()
      const offset = at === 'start' ? 0 : field.value.length
      field.setSelectionRange(offset, offset)
      return
    }
    edgeHandles.current.get(index)?.focusEdge(at)
  }

  /**
   * Une flèche qui sort du bloc `index` : le bloc navigable voisin (images et
   * tableaux sautés), par sa fin en remontant, par son début en descendant.
   * Sans voisin, la touche est simplement avalée.
   */
  function exitBlock(index: number, side: 'before' | 'after') {
    const current = blocksRef.current
    const step = side === 'before' ? -1 : 1
    for (let target = index + step; target >= 0 && target < current.length; target += step) {
      if (NAVIGABLE_KINDS.has(current[target].kind)) {
        focusBlockEdge(target, side === 'before' ? 'end' : 'start')
        return
      }
    }
  }
```

   `blocksRef` is declared *below* `insertBlockAfter` today (line ~703). Move the two lines `const blocksRef = useRef(blocks)` / `blocksRef.current = blocks` (with their comment) up so they sit above this new code.

3. After `appendOutside`, add:

```ts
  /**
   * Ctrl/Cmd+Entrée (`outside`) : un bloc juste APRÈS le groupe du bloc
   * `index` — marqué `standalone` si ce groupe est une question, pour ne pas
   * y tomber. Ctrl/Cmd+Maj+Entrée (`inside`) : juste après le bloc, dans son
   * groupe. Le type suit `inheritableKind`, comme le bouton du pied.
   */
  function enterBlock(index: number, place: BlockPlace) {
    const block = emptyBlock(inheritableKind(blocks[index]))
    if (place === 'inside') {
      insertBlockAfter(index, block)
      return
    }
    const group = blockGroups(blocks).find(candidate => candidate.indexes.includes(index))
    const last = group === undefined ? index : group.indexes[group.indexes.length - 1]
    insertBlockAfter(last, group !== undefined && group.headerIndex !== null ? { ...block, standalone: true } : block)
  }

  /**
   * Entrée dans l'en-tête d'une question : on passe à la réponse. Un texte
   * vide qui suit déjà (dans le groupe) est réutilisé ; sinon on en insère un.
   * Jamais de coupure du titre.
   */
  function enterQuestionBody(index: number) {
    const next = blocks[index + 1]
    const group = blockGroups(blocks).find(candidate => candidate.headerIndex === index)
    if (next !== undefined && next.kind === 'text' && next.text === '' && group?.indexes.includes(index + 1) === true) {
      focusBlockEdge(index + 1, 'start')
      return
    }
    insertBlockAfter(index, { kind: 'text', text: '' })
  }
```

4. Replace the `if (event.ctrlKey || event.metaKey) { … }` head of `handleEditorKeyDown` with:

```ts
    if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd+Entrée depuis un élément qui n'est PAS un champ (bouton de
      // gouttière, menu…) : le geste du bouton « Ajouter un bloc » du pied.
      // Depuis un champ, c'est le champ qui a déjà décidé (voir `enterBlock`).
      const target = event.target as HTMLElement | null
      const inField = target?.closest('textarea, input, math-field, [contenteditable="true"]') != null
      if (event.key === 'Enter' && !event.shiftKey && !event.defaultPrevented && !inField) {
        event.preventDefault()
        appendOutside()
      }
      return
    }
```

   In the doc comment above `handleEditorKeyDown`, replace the sentence about "Ctrl+Maj+Entrée pour ajouter un bloc HORS de la dernière question" with "Ctrl+Entrée hors d'un champ pour ajouter un bloc HORS de la dernière question".

5. The `<BlockField>` call (~1381): replace the `onEnterBlock=` line and add three props:

```tsx
                        onEnterBlock={place => enterBlock(index, place)}
                        onEnterBody={() => enterQuestionBody(index)}
                        onExitBlock={side => exitBlock(index, side)}
                        edgeRef={edgeRefFor(index)}
```

6. In `BlockFieldProps`, replace the `onEnterBlock` entry and add the rest:

```ts
  /** Ctrl/Cmd+Entrée (`outside`, après le groupe) ou Ctrl/Cmd+Maj+Entrée (`inside`, dans le groupe). */
  onEnterBlock: (place: BlockPlace) => void
  /** Entrée dans l'en-tête d'une question : passer à la réponse. */
  onEnterBody: () => void
  /** Une flèche qui sort du bloc par le haut/gauche (`before`) ou le bas/droite (`after`). */
  onExitBlock: (side: 'before' | 'after') => void
  /** Le point d'entrée clavier d'une formule ou d'une équation (voir `focusBlockEdge`). */
  edgeRef: (handle: BlockEdgeHandle | null) => void
```

   Destructure `onEnterBody, onExitBlock, edgeRef` in `BlockField`. Then:
   - `text` case: replace `onEnter={onEnterBlock}` with `onEnterBlock={onEnterBlock}` and add `onExitBlock={onExitBlock}`.
   - `question` case: same, plus `onEnterBody={onEnterBody}`.
   - `math` case: add `onExitBlock={onExitBlock}` and `edgeRef={edgeRef}`.
   - `equation` case: `onEnterBlock={() => onEnterBlock('outside')}` (temporary until Task 6: `EquationBlockField` still takes `() => void`).
7. In `MathBlockField`, make `onExitBlock` and `edgeRef` required (drop the `?`).

- [ ] **Step 4: `AutoGrowTextarea`**

Replace its props `onEnter` with `onEnterBlock`, and add `onEnterBody?` and `onExitBlock`:

```ts
  /** Ctrl/Cmd+Entrée (`outside`) ou Ctrl/Cmd+Maj+Entrée (`inside`) : un nouveau bloc. */
  onEnterBlock: (place: BlockPlace) => void
  /** En-tête de question seulement : Entrée (et Ctrl+Maj+Entrée) passe à la réponse ; Maj+Entrée reste un retour à la ligne. */
  onEnterBody?: () => void
  /** Une flèche au bord du texte : le bloc voisin. */
  onExitBlock: (side: 'before' | 'after') => void
```

Replace its `onKeyDown` with:

```tsx
      onKeyDown={event => {
        const field = event.currentTarget
        const mod = event.ctrlKey || event.metaKey
        if (event.key === 'Enter') {
          // Un en-tête de question ne se coupe jamais : Entrée passe à la réponse.
          if (onEnterBody !== undefined && !mod && !event.shiftKey) {
            event.preventDefault()
            onEnterBody()
            return
          }
          // Entrée écrit une ligne (défaut du champ). Ctrl/Cmd+Entrée : un bloc
          // après le groupe ; avec Maj : un bloc dans le groupe (ou, depuis un
          // en-tête, la réponse — c'est déjà « dans le groupe »).
          if (mod) {
            event.preventDefault()
            if (event.shiftKey && onEnterBody !== undefined) onEnterBody()
            else onEnterBlock(event.shiftKey ? 'inside' : 'outside')
          }
          return
        }
        // Anti-rafale : Retour arrière maintenu pour vider le texte s'arrête au
        // bord au lieu d'emporter le bloc (puis le précédent).
        if (event.key === 'Backspace' && value === '') {
          event.preventDefault()
          if (!event.repeat) onDeleteEmpty()
          return
        }
        if (event.key === 'Delete' && value === '') {
          event.preventDefault()
          if (!event.repeat) onDeleteForward()
          return
        }
        // Les flèches au bord mènent au bloc voisin, en DEUX temps : ↑/↓ font
        // d'abord leur travail natif (aller en début/fin), et ne sortent que
        // si le curseur y était déjà. Une flèche modifiée n'est jamais une
        // sortie : Alt+↑/↓ déplace le bloc, Maj+flèche sélectionne.
        if (!mod && !event.shiftKey && !event.altKey && field.selectionStart === field.selectionEnd) {
          const atStart = field.selectionStart === 0
          const atEnd = field.selectionStart === value.length
          const exit =
            (event.key === 'ArrowLeft' || event.key === 'ArrowUp') && atStart
              ? 'before'
              : (event.key === 'ArrowRight' || event.key === 'ArrowDown') && atEnd
                ? 'after'
                : null
          if (exit !== null) {
            event.preventDefault()
            onExitBlock(exit)
            return
          }
        }
        // Tab appartient au TYPE du bloc — sauf quand une combinaison est tenue,
        // où c'est un raccourci de l'application ou du système, pas le nôtre.
        if (event.key === 'Tab') {
          if (event.ctrlKey || event.metaKey || event.altKey) return
          event.preventDefault()
          onSwitchKind(event.shiftKey ? -1 : 1)
        }
      }}
```

Update the destructuring (`onEnterBlock, onEnterBody, onExitBlock` instead of `onEnter`).

- [ ] **Step 5: Labels**

`src/content/EmptyAreaContextMenu.tsx:92`: `<MenuShortcut keys="Ctrl + Entrée" />`.

`src/content/DescriptionDialog.tsx`, block scope of the shortcuts panel. Replace the `Ctrl/Cmd + Entrée` line, the `Entrée (en formule)` line and the `Ctrl/Cmd + Maj + Entrée` line with:

```tsx
      {scope === 'block' && <Shortcut keys="Ctrl/Cmd + Entrée" label="Nouveau bloc, après la question" />}
      {scope === 'block' && <Shortcut keys="Ctrl/Cmd + Maj + Entrée" label="Nouveau bloc dans la question" />}
      {scope === 'block' && <Shortcut keys="Entrée (en formule / équation)" label="Nouvelle ligne / étape" />}
      {scope === 'block' && <Shortcut keys="Entrée (en question)" label="Écrire la réponse" />}
      {scope === 'block' && <Shortcut keys="Flèches au bord d’un champ" label="Champ ou bloc voisin" />}
```

Also update the JSX comment just above ("C'est Ctrl/Cmd+Entrée qui ajoute un BLOC…") to mention both variants.

- [ ] **Step 6: Verify the global shortcut**

Read `src/hooks/useGlobalShortcuts.ts` around line 102 and confirm that `if (isModalOpen()) return` runs before the `card.editDescription` (Mod+Enter) dispatch. No code change is expected. If the guard is missing or comes after the dispatch, add a test in that hook's test file (a Mod+Enter with a `[role="dialog"]` in the DOM does not open the description) and move the guard.

- [ ] **Step 7: Run the tests**

Run: `bun run test src/content`
Expected: PASS. `DescriptionDialog.test.tsx` still finds « Nouveau bloc ».

- [ ] **Step 8: Type-check**

Run: `bunx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/content/BlockEditor.tsx src/content/DescriptionDialog.tsx src/content/EmptyAreaContextMenu.tsx src/content/blockKeys.test.tsx src/content/formulaZoneKeys.test.tsx src/content/BlockEditor.test.tsx
git commit -m "feat(description): les flèches passent d'un bloc à l'autre, Ctrl+Entrée sort du groupe

- texte : ←/→ au bord, ↑/↓ en deux temps ; images et tableaux sautés
- Ctrl+Entrée = bloc après le groupe, Ctrl+Maj+Entrée = bloc dans le groupe
- Entrée dans un en-tête de question passe à la réponse
- anti-rafale sur la suppression d'un bloc vide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Equation keyboard per the table

**Files:**
- Modify: `src/content/EquationEditor.tsx`: `EquationTermField` (106-211), `EquationOperationField` (224-427), `EquationBlockFieldProps` + `EquationBlockField` (429-648)
- Modify: `src/content/BlockEditor.tsx`: `equation` case of `BlockField` (wire `onEnterBlock`, `onExitBlock`, `edgeRef`)
- Test: `src/content/equationKeys.test.tsx`

**Interfaces:**
- Consumes:
  - `navigate`, `operationVisible`, `readingOrder`, `EqPos`, `EqColumn`, `EqField` (Task 2)
  - `rawFieldKeyDown`, `BlockPlace`, `BlockEdgeHandle`, `ExitDirection`, `ExitVia` (Task 3)
  - `MathFieldEditor`'s `onExit` and `tabExits` (Task 4)
  - `BlockField`'s `onExitBlock` and `edgeRef` (Task 5)
- Produces: `EquationBlockFieldProps` = `{ block, index, onChange, onEnterBlock: (place: BlockPlace) => void, onDeleteEmpty, onDeleteForward, onExitBlock: (side: 'before' | 'after') => void, onFieldChange, ref?: React.Ref<BlockEdgeHandle> }`.

- [ ] **Step 1: Write the failing tests**

In `src/content/equationKeys.test.tsx`:

1. Add after `lastBlocks`:

```ts
function moveOut(field: HTMLElement, direction: 'forward' | 'backward' | 'upward' | 'downward'): boolean {
  return !field.dispatchEvent(new CustomEvent('move-out', { detail: { direction }, cancelable: true, bubbles: true }))
}
```

2. Replace the test "Retour arrière sur l'étape VIDE la retire et rend la main à la fin du membre droit précédent" (129-151) with:

```ts
  it('Retour arrière sur l’étape VIDE la retire et rend la main à la fin de l’opération précédente', async () => {
    const onState = vi.fn()
    render(
      <Harness
        initial={[{ kind: 'equation', steps: [{ left: '2x', right: '8' }, { left: '', right: '' }] }]}
        onState={onState}
      />
    )
    const fields = await mathFields()
    fireEvent.keyDown(fields[2], { key: 'Backspace' })

    await waitFor(() => expect(lastBlocks(onState)).toEqual([
      { kind: 'equation', steps: [{ left: '2x', right: '8' }] },
    ]))
    // 2x = 8 n'est pas résolue : l'opération après la dernière étape reste là.
    await waitFor(() => expect(screen.getByTestId('equation-op-input-0-0')).toHaveFocus())
  })
```

3. In "Retour arrière sur une étape NON vide ne retire rien", append after the last `expect`:

```ts
    // … mais le curseur remonte à la fin de l'opération précédente.
    await waitFor(() => expect(screen.getByTestId('equation-op-input-0-0')).toHaveFocus())
```

4. Replace "Suppr en toute fin de bloc — le bloc entier vide demande à disparaître vers le suivant" (191-208) with:

```ts
  it('Suppr en fin de D₀ passe à l’opération, puis Suppr sur Opₙ vide retire le bloc vide', async () => {
    const onState = vi.fn()
    render(
      <Harness
        initial={[
          { kind: 'equation', steps: [{ left: '', right: '' }] },
          { kind: 'text', text: 'après' },
        ]}
        onState={onState}
      />
    )
    const fields = await mathFields()
    fireEvent.keyDown(fields[1], { key: 'Delete' })
    const operation = await waitFor(() => {
      const input = screen.getByTestId('equation-op-input-0-0')
      expect(input).toHaveFocus()
      return input
    })
    expect(onState).not.toHaveBeenCalled()

    fireEvent.keyDown(operation, { key: 'Delete' })
    await waitFor(() => expect(lastBlocks(onState)).toEqual([{ kind: 'text', text: 'après' }]))
  })
```

5. Replace the test "la dernière étape — une variable seule — n'a pas de champ opération" (233-243) with:

```ts
  it('Opₙ : visible tant que la dernière étape n’est pas résolue, caché sinon — sauf s’il a un contenu', async () => {
    const { unmount } = render(<Harness initial={[{ kind: 'equation', steps: [{ left: '2x', right: '8' }] }]} />)
    expect(await screen.findByTestId('equation-op-input-0-0')).toBeInTheDocument()
    unmount()

    const solved = render(
      <Harness initial={[{ kind: 'equation', steps: [{ left: '2x', right: '8', operation: '\\div 2' }, { left: 'x', right: '4' }] }]} />
    )
    await mathFields()
    expect(screen.queryByTestId('equation-op-input-0-1')).not.toBeInTheDocument()
    solved.unmount()

    render(<Harness initial={[{ kind: 'equation', steps: [{ left: 'x', right: '4', operation: 'vérif' }] }]} />)
    expect(await screen.findByTestId('equation-op-input-0-0')).toBeInTheDocument()
  })
```

6. Append a new `describe`:

```ts
describe('le bloc équation — flèches, Tab, Entrée', () => {
  const twoSteps: CardBlock[] = [{ kind: 'equation', steps: [{ left: '2x', right: '8' }, { left: 'x', right: '2x' }] }]

  it('→ (move-out) suit l’ordre de lecture G₀ → D₀ → Op₀', async () => {
    render(<Harness initial={twoSteps} />)
    const fields = await mathFields()
    moveOut(fields[0], 'forward')
    expect(fields[1].focus).toHaveBeenCalled()
    expect(fields[1].executeCommand).toHaveBeenCalledWith('moveToMathfieldStart')
    moveOut(fields[1], 'forward')
    await waitFor(() => expect(screen.getByTestId('equation-op-input-0-0')).toHaveFocus())
  })

  it('↓ depuis G₀ va sur l’interligne, puis ↓ sur l’étape suivante dans la colonne mémorisée', async () => {
    render(<Harness initial={twoSteps} />)
    const fields = await mathFields()
    // Focus sur D₀ : c'est lui que la colonne retient.
    fireEvent.focusIn(fields[1])
    moveOut(fields[1], 'downward')
    const operation = await waitFor(() => {
      const input = screen.getByTestId('equation-op-input-0-0')
      expect(input).toHaveFocus()
      return input
    })
    fireEvent.keyDown(operation, { key: 'ArrowDown' })
    expect(fields[3].focus).toHaveBeenCalled() // D₁
    expect(fields[3].executeCommand).toHaveBeenCalledWith('moveToMathfieldStart')
  })

  it('↑ depuis G₁ remonte sur l’opération de l’étape précédente', async () => {
    render(<Harness initial={twoSteps} />)
    const fields = await mathFields()
    moveOut(fields[2], 'upward')
    await waitFor(() => expect(screen.getByTestId('equation-op-input-0-0')).toHaveFocus())
  })

  it('au-delà de G₀, sortie vers le bloc précédent (fin du texte)', async () => {
    render(<Harness initial={[{ kind: 'text', text: 'avant' }, ...twoSteps]} />)
    const fields = await mathFields()
    moveOut(fields[0], 'backward')
    const text = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    expect(text).toHaveFocus()
    expect(text.selectionStart).toBe(5)
  })

  it('↓ en fin de texte entre dans l’équation par G₀', async () => {
    render(<Harness initial={[{ kind: 'text', text: 'ab' }, ...twoSteps]} />)
    const fields = await mathFields()
    const text = screen.getByRole('textbox', { name: /texte du bloc 1/i }) as HTMLTextAreaElement
    text.focus()
    text.setSelectionRange(2, 2)
    fireEvent.keyDown(text, { key: 'ArrowDown' })
    expect(fields[0].focus).toHaveBeenCalled()
    expect(fields[0].executeCommand).toHaveBeenCalledWith('moveToMathfieldStart')
  })

  it('Tab (move-out) depuis D₀ va sur l’opération ; Tab dans Opₙ reste au navigateur', async () => {
    render(<Harness initial={[{ kind: 'equation', steps: [{ left: '2x', right: '8' }] }]} />)
    const fields = await mathFields()
    fireEvent.keyDown(fields[1], { key: 'Tab' })
    expect(moveOut(fields[1], 'forward')).toBe(true)
    const operation = await waitFor(() => {
      const input = screen.getByTestId('equation-op-input-0-0')
      expect(input).toHaveFocus()
      return input
    })
    // Dernier champ : Tab n'est pas avalé, pas de piège au clavier.
    expect(fireEvent.keyDown(operation, { key: 'Tab' })).toBe(true)
  })

  it('Entrée réutilise une étape suivante vide au lieu d’en ajouter une', async () => {
    const onState = vi.fn()
    render(
      <Harness initial={[{ kind: 'equation', steps: [{ left: '2x', right: '8' }, { left: '', right: '' }] }]} onState={onState} />
    )
    const fields = await mathFields()
    fireEvent.keyDown(fields[0], { key: 'Enter' })
    expect(onState).not.toHaveBeenCalled()
    expect(fields[2].focus).toHaveBeenCalled()
    expect(fields[2].executeCommand).toHaveBeenCalledWith('moveToMathfieldStart')
  })

  it('Retour arrière au début de D va à la fin de G', async () => {
    render(<Harness initial={twoSteps} />)
    const fields = await mathFields()
    fields[1].position = 0
    fireEvent.keyDown(fields[1], { key: 'Backspace' })
    expect(fields[0].focus).toHaveBeenCalled()
    expect(fields[0].executeCommand).toHaveBeenCalledWith('moveToMathfieldEnd')
  })

  it('Ctrl+Maj+Entrée : un bloc dans la question, juste après l’équation', async () => {
    const onState = vi.fn()
    render(
      <Harness
        initial={[{ kind: 'question', text: 'Q' }, ...twoSteps, { kind: 'text', text: 'fin' }]}
        onState={onState}
      />
    )
    const fields = await mathFields()
    fireEvent.keyDown(fields[0], { key: 'Enter', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(lastBlocks(onState)).toEqual([
      { kind: 'question', text: 'Q' },
      ...twoSteps,
      { kind: 'text', text: '' },
      { kind: 'text', text: 'fin' },
    ]))
  })

  it('repli sur le membre droit quand l’opération visée vient de disparaître', async () => {
    // Retirer l'étape vide rend x = 4 dernière ET résolue : Op₀ vide se cache,
    // le curseur doit atterrir à la fin de D₀ plutôt que nulle part.
    const onState = vi.fn()
    render(
      <Harness initial={[{ kind: 'equation', steps: [{ left: 'x', right: '4' }, { left: '', right: '' }] }]} onState={onState} />
    )
    const fields = await mathFields()
    fireEvent.keyDown(fields[2], { key: 'Backspace' })
    await waitFor(() => expect(lastBlocks(onState)).toEqual([{ kind: 'equation', steps: [{ left: 'x', right: '4' }] }]))
    expect(screen.queryByTestId('equation-op-input-0-0')).not.toBeInTheDocument()
    const [, right] = await mathFields()
    await waitFor(() => expect(right.focus).toHaveBeenCalled())
    expect(right.executeCommand).toHaveBeenCalledWith('moveToMathfieldEnd')
  })
})
```

(`fields[i].position = 0` requires the `position` setter the mock already defines. `mathFields()` here returns the same typed array as in `formulaZoneKeys`. If `focus` is typed `() => void`, the `.focus` assertions work without `mockClear`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test src/content/equationKeys.test.tsx`
Expected: FAIL. `move-out` does nothing, Opₙ is not rendered, Backspace goes to D instead of Op, and Enter adds a step.

- [ ] **Step 3: Implement `EquationTermField`**

1. Imports at the top of `EquationEditor.tsx`:

```ts
import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react'
import { navigate, operationVisible, readingOrder, type EqColumn, type EqField, type EqPos } from './equationNav'
import { rawFieldKeyDown, type BlockEdgeHandle, type BlockPlace, type ExitDirection, type ExitVia } from './fieldIntents'
```

   Remove `type StepField` and use `EqField` wherever `StepField` appears. Remove the `equationStepIsSolved` import only if it becomes unused (it is still used for the `solved` styling, so keep it).
2. `EquationTermField` props: change `onEnterBlock: () => void` → `onEnterBlock: (place: BlockPlace) => void`. Replace `onArrowUp?`/`onArrowDown?` with:

```ts
  /** Une flèche (ou Tab) au bord : le champ voisin selon `equationNav`. `false` = nulle part où aller. */
  onExit: (direction: ExitDirection, via: ExitVia) => boolean | void
```

   Update the destructuring to match.
3. On `<MathFieldEditor>`, remove the Task 4 bridge and pass `onExit={onExit}` and `tabExits`.
4. Replace the fallback `<input>`'s whole `onKeyDown={event => { … }}` with:

```tsx
              onKeyDown={rawFieldKeyDown({
                onEnter: () => onEnter(),
                onEnterBlock,
                onBackspaceAtStart,
                onDeleteAtEnd,
                onExit,
                tabExits: true,
              })}
```

- [ ] **Step 4: Implement `EquationOperationField`**

1. Props: `onEnterBlock: (place: BlockPlace) => void`, and add `onExit: (direction: ExitDirection, via: ExitVia) => boolean | void`. Destructure `onExit`.
2. In the `<input>`'s `onKeyDown`, keep the `*` / `/` block unchanged. Replace everything after it (the Enter / Backspace / Delete handling) with:

```tsx
          rawFieldKeyDown({
            onEnter: () => onEnter(),
            onEnterBlock,
            onBackspaceAtStart,
            onDeleteAtEnd,
            onExit,
            tabExits: true,
          })(event)
```

- [ ] **Step 5: Implement `EquationBlockField`**

Replace `EquationBlockFieldProps` with:

```ts
export interface EquationBlockFieldProps {
  block: Extract<CardBlock, { kind: 'equation' }>
  index: number
  onChange: (block: CardBlock) => void
  /** Ctrl/Cmd+Entrée (`outside`, après le groupe) ou Ctrl/Cmd+Maj+Entrée (`inside`, dans le groupe). */
  onEnterBlock: (place: BlockPlace) => void
  /** Retour arrière tout en début du bloc, quand il est vide : il demande à disparaître vers le précédent. */
  onDeleteEmpty: () => void
  /** Suppr tout en fin du bloc, quand il est vide : il demande à disparaître vers le suivant. */
  onDeleteForward: () => void
  /** Une flèche qui sort du bloc par le haut/gauche (`before`) ou le bas/droite (`after`). */
  onExitBlock: (side: 'before' | 'after') => void
  /** Le champ vivant du membre focalisé, pour les touches du bandeau de symboles. */
  onFieldChange: (handle: MathFieldHandle | null) => void
  ref?: React.Ref<BlockEdgeHandle>
}
```

Rewrite the doc comment of `EquationBlockField` into a short paragraph. It should say that the keyboard follows the "Équation" table of the navigation spec: the reading order and the arrows live in `equationNav.ts`; Entrée goes to the next step (reusing an empty one); Retour arrière/Suppr move from field to field and delete only an empty step or an entirely empty block; Opₙ is visible except after a solved step with nothing written. Then replace the function body, from its start to just before `return (`, with:

```tsx
export function EquationBlockField({
  block,
  index,
  onChange,
  onEnterBlock,
  onDeleteEmpty,
  onDeleteForward,
  onExitBlock,
  onFieldChange,
  ref,
}: EquationBlockFieldProps) {
  // Un bloc équation a toujours au moins une étape à l'écran, même si son
  // contenu sur disque est un `steps: []` malformé (voir `sanitizeBlock`) —
  // le premier changement réécrit alors ce repli dans le bloc lui-même.
  const steps = block.steps.length > 0 ? block.steps : [{ left: '', right: '' }]
  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const handles = useRef(new Map<string, MathFieldHandle | null>())
  const pending = useRef<{ pos: EqPos; at: 'start' | 'end' } | null>(null)
  // Le dernier membre (G ou D) qui a eu le focus, quelle que soit la façon :
  // c'est là que ↑/↓ reviennent depuis une opération. G au montage.
  const column = useRef<EqColumn>('left')

  function handleAt(pos: EqPos): MathFieldHandle | null {
    return handles.current.get(fieldKey(pos.step, pos.field)) ?? null
  }

  // Le focus est posé APRÈS le rendu qui a ajouté ou retiré une étape : c'est
  // le seul moment où le handle de l'étape visée existe. Une opération qui
  // vient de disparaître (dernière étape devenue résolue) renvoie au membre
  // droit de la même étape plutôt que de perdre le curseur.
  useEffect(() => {
    const target = pending.current
    if (target === null) return
    pending.current = null
    const handle = handleAt(target.pos) ?? handleAt({ step: target.pos.step, field: 'right' })
    if (handle === null) return
    if (target.at === 'end') handle.focusEnd()
    else handle.focusStart()
  })

  useImperativeHandle(
    ref,
    () => ({
      focusEdge(at) {
        const order = readingOrder(stepsRef.current)
        const pos = at === 'start' ? order[0] : order[order.length - 1]
        const handle = pos === undefined ? null : handleAt(pos)
        if (at === 'start') handle?.focusStart()
        else handle?.focusEnd()
      },
    }),
    []
  )

  function write(next: EquationStep[]) {
    onChange({ kind: 'equation', steps: next, ...(block.standalone === true ? { standalone: true } : {}) })
  }

  function setField(stepIndex: number, field: EqField, value: string) {
    write(steps.map((step, i) => (i === stepIndex ? { ...step, [field]: value } : step)))
  }

  /** Focus DIRECT sur un champ déjà monté — pas de `pending` : un simple déplacement ne change pas le contenu. */
  function focusField(pos: EqPos, at: 'start' | 'end') {
    const handle = handleAt(pos)
    if (handle === null) return
    if (at === 'end') handle.focusEnd()
    else handle.focusStart()
  }

  function removeStep(stepIndex: number, focus: EqPos, at: 'start' | 'end') {
    write(steps.filter((_, i) => i !== stepIndex))
    pending.current = { pos: focus, at }
  }

  /** Entrée : l'étape suivante si elle est vide, sinon une étape neuve — focus sur son membre gauche. */
  function enterStep(stepIndex: number) {
    const next = steps[stepIndex + 1]
    if (next !== undefined && isStepEmpty(next)) {
      focusField({ step: stepIndex + 1, field: 'left' }, 'start')
      return
    }
    const inserted = [...steps]
    inserted.splice(stepIndex + 1, 0, { left: '', right: '' })
    write(inserted)
    pending.current = { pos: { step: stepIndex + 1, field: 'left' }, at: 'start' }
  }

  /** Une flèche ou Tab depuis `from` — voir `navigate`. Tab sans destination retombe sur le navigateur. */
  function go(from: EqPos, direction: ExitDirection, via: ExitVia): boolean {
    const target = navigate(steps, from, direction, column.current)
    if (target === 'exit-before' || target === 'exit-after') {
      if (via === 'tab') return false
      onExitBlock(target === 'exit-before' ? 'before' : 'after')
      return true
    }
    focusField(target.pos, target.at)
    return true
  }

  /** Les intentions clavier d'un champ — le tableau « Équation » de la spec, ligne à ligne. */
  function intentsFor(pos: EqPos) {
    const { step: i, field } = pos
    const blockEmpty = steps.length === 1 && isStepEmpty(steps[0])
    return {
      onEnter: () => enterStep(i),
      onEnterBlock,
      onExit: (direction: ExitDirection, via: ExitVia) => go(pos, direction, via),
      onBackspaceAtStart: () => {
        if (field === 'right') return focusField({ step: i, field: 'left' }, 'end')
        if (field === 'operation') return focusField({ step: i, field: 'right' }, 'end')
        if (i === 0) {
          if (blockEmpty) onDeleteEmpty()
          return
        }
        const previousOperation: EqPos = { step: i - 1, field: 'operation' }
        if (isStepEmpty(steps[i])) removeStep(i, previousOperation, 'end')
        else focusField(previousOperation, 'end')
      },
      onDeleteAtEnd: () => {
        if (field === 'left') return focusField({ step: i, field: 'right' }, 'start')
        if (field === 'right') {
          if (operationVisible(steps, i)) return focusField({ step: i, field: 'operation' }, 'start')
          if (i + 1 < steps.length) return focusField({ step: i + 1, field: 'left' }, 'start')
          if (blockEmpty) onDeleteForward()
          return
        }
        const next = steps[i + 1]
        if (next === undefined) {
          if (blockEmpty) onDeleteForward()
          return
        }
        if (isStepEmpty(next)) removeStep(i + 1, pos, 'end')
        else focusField({ step: i + 1, field: 'left' }, 'start')
      },
    }
  }
```

Then in the JSX:

- Remove `const isFirst = …` and `const isLast = …` (no longer used) and add `const showOperation = operationVisible(steps, stepIndex)`.
- Left `EquationTermField`: replace the props from `onEnter=` through `onArrowDown=` with a spread plus the focus handler:

```tsx
                {...intentsFor({ step: stepIndex, field: 'left' })}
                onFocusHandle={() => {
                  column.current = 'left'
                  onFieldChange(handles.current.get(fieldKey(stepIndex, 'left')) ?? null)
                }}
```

  Keep `value`, `onChangeValue`, `ariaLabel`, `registerHandle`, `side`, `style`. Drop the old `onFocusHandle` line in favour of this one.
- Right `EquationTermField`: the same with `'right'` (and `column.current = 'right'`).
- Replace `{!isLast && (` around the operation row with `{showOperation && (`. On `EquationOperationField`, replace `onEnter=`…`onDeleteAtEnd=` with `{...intentsFor({ step: stepIndex, field: 'operation' })}` and keep the other props.

- [ ] **Step 6: Wire it in `BlockEditor`**

In `BlockField`'s `equation` case, replace the temporary `onEnterBlock={() => onEnterBlock('outside')}` with:

```tsx
          onEnterBlock={onEnterBlock}
          onExitBlock={onExitBlock}
          ref={edgeRef}
```

- [ ] **Step 7: Run the tests**

Run: `bun run test src/content`
Expected: PASS. The remaining pre-existing equation tests should pass unchanged: Enter adds a step, Ctrl+Enter adds a block, `*`/`/` replacement, and the mirror click. If "Entrée … ajoute une ÉTAPE" now sees the `+ Opération` button count change, only DOM counts of `math-field` matter there, and those are unchanged.

- [ ] **Step 8: Type-check**

Run: `bunx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/content/EquationEditor.tsx src/content/BlockEditor.tsx src/content/equationKeys.test.tsx
git commit -m "feat(equation): navigation complète au clavier entre membres, opérations et blocs

- ordre de lecture G D Op, ↓ passe par l'interligne, colonne mémorisée
- l'opération après la dernière étape reste visible tant que ce n'est pas résolu
- Retour arrière/Suppr passent de champ en champ, ne suppriment qu'une étape vide
- Entrée réutilise une étape suivante vide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Reading side, then final verification

**Files:**
- Modify: `src/content/BlockView.tsx:195` (and any `isLast` variable left unused)
- Modify: `src/content/blocks.ts` (`equationToPlainText`)
- Modify: `src/types/cardBlock.ts:28-37` (`EquationStep` comment)
- Test: `src/content/BlockView.test.tsx`, `src/content/blocks.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no API change. A non-empty last operation is rendered and serialized.

- [ ] **Step 1: Write the failing tests**

Append to `src/content/BlockView.test.tsx`:

```tsx
describe('équation — l’opération après la dernière étape', () => {
  it('est affichée quand elle a un contenu', () => {
    const { container } = render(
      <BlockView blocks={[{ kind: 'equation', steps: [{ left: '2x', right: '8', operation: '÷ 2' }] }]} resolveAsset={resolve} />
    )
    expect(container.textContent ?? '').toContain('÷')
  })

  it('n’affiche rien quand elle est vide', () => {
    const { container } = render(
      <BlockView blocks={[{ kind: 'equation', steps: [{ left: '2x', right: '8' }] }]} resolveAsset={resolve} />
    )
    expect(container.textContent ?? '').not.toContain('÷')
  })
})
```

Append to `src/content/blocks.test.ts`:

```ts
describe('equationToPlainText — dernière opération', () => {
  it('écrit une opération non vide après la dernière étape', () => {
    expect(equationToPlainText([{ left: '2x', right: '8', operation: '÷ 2' }])).toBe('2x = 8\n(÷ 2)')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test src/content/BlockView.test.tsx src/content/blocks.test.ts`
Expected: FAIL. The last operation is dropped in both places.

- [ ] **Step 3: Implement**

`BlockView.tsx:195`: `{!isLast && operation !== '' && (` → `{operation !== '' && (`. Remove `const isLast = …` if it is no longer used. Update the comment above if it mentions "la dernière étape n'en a pas".

`blocks.ts`, `equationToPlainText`: replace

```ts
    if (index < steps.length - 1) {
      const operation = latexToPlainText(step.operation ?? '')
      if (operation !== '') lines.push(`(${operation})`)
    }
```

with

```ts
    const operation = latexToPlainText(step.operation ?? '')
    if (operation !== '') lines.push(`(${operation})`)
```

(`index` may become unused in the `forEach` callback. If so, drop it.) Update the doc comment: « l'opération entre parenthèses après chaque étape qui en a une ».

`cardBlock.ts`: replace "l'opération qui mène à l'étape SUIVANTE — absente sur la dernière, qui n'en a pas." with "l'opération qui mène à l'étape suivante. Après la dernière étape, elle reste saisissable tant que l'équation n'est pas résolue (voir `operationVisible`), et n'est jamais masquée une fois écrite."

- [ ] **Step 4: Run the full suites**

Run: `bun run test:all`
Expected: PASS (root + admin).

- [ ] **Step 5: Build**

Run: `bun run build`
Expected: `tsc` and the Vite build both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/content/BlockView.tsx src/content/BlockView.test.tsx src/content/blocks.ts src/content/blocks.test.ts src/types/cardBlock.ts
git commit -m "feat(equation): l'opération après la dernière étape est lue et exportée

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Manual check in the app (real MathLive)**

Run `bun run tauri dev` (or ask the user to). Open a card description and verify:
1. A formula `\frac{1}{2}`: ↑/↓ move between the numerator and the denominator. ↓ from the denominator of the last line goes to the next block.
2. `aaa|b` →, →: the second press lands in the next field or block. There is no sound.
3. Hold Backspace in a non-empty formula line / text / equation member: it stops at the start and never eats the previous field or block.
4. Equation: ↓ from G₀ goes to the operation, then ↓ to G₁. After a click on D₀, ↓ ↓ lands on D₁. Type `x = 5` in the last step: the empty operation after it disappears.
5. Tab in an equation: G → D → Op → next G… After the last field, Tab leaves the block (browser focus order).
6. Ctrl+Entrée in a question's body inserts after the question (outside). Ctrl+Maj+Entrée inserts inside, right after the current block.
7. Alt+↑/↓ still move blocks from within a formula and a text.

Report any failure as a new failing test before fixing it.
