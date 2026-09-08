# Éditeur de carte mentale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core mind-map editor for Zachar't Mentale — a 4-level, 4-column, click-driven card editor with autosave, undo/redo, and TSA-friendly predictable interactions.

**Architecture:** A Tauri desktop shell hosts a React + TypeScript UI. Card data is a flat array (`Card[]`) manipulated by pure reducer functions, wrapped in a Zustand store that also owns undo/redo history and the global lock flag. React Flow renders one custom node per card, positioned by a pure column-layout function; Tauri's fs plugin persists the array to a JSON file with debounced autosave.

**Tech Stack:** Tauri, Bun, React, TypeScript, `@xyflow/react` (React Flow), Zustand, Tailwind CSS v4, shadcn/ui (Radix), Framer Motion, Vitest, @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-09-06-editeur-carte-mentale-design.md`

## Global Constraints

- Always install the latest stable version of every dependency. If a blocking bug forces pinning an older version, document the exception inline (comment + link to the tracked upstream issue) so the pin can be lifted later.
- All 4 level color pairs (text on background) must meet WCAG AA contrast (≥ 4.5:1).
- Every tree-building action (create, edit, delete) is a single click — never a double-click or complex gesture.
- Strict tree: each card has exactly one parent (`parentId`); exactly one root (`parentId === null`) per file. This invariant is enforced at the data layer, not just the UI.
- No element ever disappears silently when disabled — it stays visible, greyed out.
- No destructive action without either a confirmation dialog or an available undo.

---

### Task 1: Scaffold the Tauri + React + TypeScript project

**Files:**
- Create: entire scaffolded project (`package.json`, `src/`, `src-tauri/`, `index.html`, `vite.config.ts`, etc.)
- Modify: `.gitignore` (append Node/Tauri/Vite ignores, keep the existing `graphify-out/` entry)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a runnable Tauri dev shell (`bun run tauri dev`) that later tasks build on

- [ ] **Step 1: Scaffold into a temp folder**

```bash
bunx create-tauri-app@latest zachart-mentale-scaffold --template react-ts --manager bun
```

If the CLI's flags have changed by the time you run this, run `bunx create-tauri-app@latest --help` and adjust — the target is unchanged: React + TypeScript template, Bun package manager.

- [ ] **Step 2: Merge scaffolded files into the repo root**

Move everything from `zachart-mentale-scaffold/` (except its `.git` if any) into the repo root. Do not overwrite the existing `.gitignore` / `.gitattributes` — merge the scaffold's `.gitignore` entries (e.g. `node_modules`, `dist`, `src-tauri/target`) into the existing file instead of replacing it. Delete the now-empty `zachart-mentale-scaffold/` folder. Set `"name": "zachart-mentale"` in the root `package.json` (the apostrophe in the folder name is not a valid npm package name).

- [ ] **Step 3: Install dependencies**

```bash
bun install
```

- [ ] **Step 4: Verify the dev shell launches**

```bash
bun run tauri dev
```

Expected: a native window opens showing the default Tauri + React template page, with no errors in the terminal. Close the window/stop the process once confirmed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri + React + TypeScript project"
```

---

### Task 2: Set up the test harness (Vitest + React Testing Library)

**Files:**
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/test/smoke.test.tsx`
- Modify: `package.json` (add `test` script and dev dependencies)

**Interfaces:**
- Consumes: the scaffolded Vite project from Task 1
- Produces: `bun run test` runs Vitest; every later task's `*.test.ts(x)` files run under this harness

- [ ] **Step 1: Install test dependencies**

```bash
bun add -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Configure Vitest**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
})
```

```ts
// src/test/setup.ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 3: Add the `test` script**

In `package.json`:

```json
{
  "scripts": {
    "test": "vitest run"
  }
}
```

- [ ] **Step 4: Write a failing smoke test**

```tsx
// src/test/smoke.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

function Hello() {
  return <p>hello test harness</p>
}

describe('test harness smoke test', () => {
  it('renders a component and finds it by text', () => {
    render(<Hello />)
    expect(screen.getByText('hello test harness')).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Run it and confirm it passes (harness works)**

```bash
bun run test
```

Expected: PASS — 1 test passed. (There is nothing to make fail here; this test validates the harness itself, so go straight to green.)

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts src/test package.json bun.lock
git commit -m "test: set up Vitest + React Testing Library harness"
```

---

### Task 3: OKLCH contrast utility + the 4 level color palettes

**Files:**
- Create: `src/colors/contrast.ts`
- Create: `src/colors/contrast.test.ts`
- Create: `src/colors/levelColors.ts`
- Create: `src/colors/levelColors.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Oklch` type, `oklchWcagContrast(a: Oklch, b: Oklch): number`, `toCss(color: Oklch): string`, `levelColors: Record<1|2|3|4, { bg: Oklch; border: Oklch; text: Oklch }>` — used by every component that renders a card

- [ ] **Step 1: Write the failing contrast tests**

```ts
// src/colors/contrast.test.ts
import { describe, it, expect } from 'vitest'
import { oklchWcagContrast, type Oklch } from './contrast'

describe('oklchWcagContrast', () => {
  it('returns 21 for pure black vs pure white', () => {
    const black: Oklch = { l: 0, c: 0, h: 0 }
    const white: Oklch = { l: 1, c: 0, h: 0 }
    expect(oklchWcagContrast(black, white)).toBeCloseTo(21, 0)
  })

  it('returns a low ratio for two similar light colors', () => {
    const light1: Oklch = { l: 0.98, c: 0, h: 0 }
    const light2: Oklch = { l: 0.9, c: 0, h: 0 }
    expect(oklchWcagContrast(light1, light2)).toBeLessThan(4.5)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/colors/contrast.test.ts
```

Expected: FAIL — `contrast.ts` does not exist yet.

- [ ] **Step 3: Implement the contrast utility**

```ts
// src/colors/contrast.ts
export interface Oklch {
  l: number
  c: number
  h: number
}

function oklchToLinearRgb({ l: L, c: C, h: hDeg }: Oklch): [number, number, number] {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return [r, g, bl]
}

function linearToGamma(c: number): number {
  const clamped = Math.min(1, Math.max(0, c))
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
}

function relativeLuminance(gammaRgb: [number, number, number]): number {
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const [lr, lg, lb] = gammaRgb.map(toLinear)
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

export function oklchWcagContrast(a: Oklch, b: Oklch): number {
  const gammaA = oklchToLinearRgb(a).map(linearToGamma) as [number, number, number]
  const gammaB = oklchToLinearRgb(b).map(linearToGamma) as [number, number, number]
  const la = relativeLuminance(gammaA)
  const lb = relativeLuminance(gammaB)
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la]
  return (lighter + 0.05) / (darker + 0.05)
}

export function toCss({ l, c, h }: Oklch): string {
  return `oklch(${l} ${c} ${h})`
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun run test src/colors/contrast.test.ts
```

Expected: PASS

- [ ] **Step 5: Write the failing level-palette test**

```ts
// src/colors/levelColors.test.ts
import { describe, it, expect } from 'vitest'
import { oklchWcagContrast } from './contrast'
import { levelColors } from './levelColors'

describe('levelColors', () => {
  it.each(Object.entries(levelColors))('level %s text meets WCAG AA (>=4.5) against its background', (_level, colors) => {
    const ratio = oklchWcagContrast(colors.bg, colors.text)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
})
```

- [ ] **Step 6: Run to verify it fails**

```bash
bun run test src/colors/levelColors.test.ts
```

Expected: FAIL — `levelColors.ts` does not exist yet.

- [ ] **Step 7: Implement the level palette**

These values were verified with the contrast formula above (Rouge: 11.16, Orange: 10.74, Bleu: 10.57, Jaune: 12.09 — all well above the 4.5 floor).

```ts
// src/colors/levelColors.ts
import type { Oklch } from './contrast'
import type { CardLevel } from '../types/card'

export interface LevelColor {
  bg: Oklch
  border: Oklch
  text: Oklch
}

export const levelColors: Record<CardLevel, LevelColor> = {
  1: {
    // Rouge — Titre
    bg: { l: 0.96, c: 0.03, h: 25 },
    border: { l: 0.55, c: 0.18, h: 25 },
    text: { l: 0.32, c: 0.15, h: 25 },
  },
  2: {
    // Orange — Sous-titre
    bg: { l: 0.96, c: 0.03, h: 55 },
    border: { l: 0.6, c: 0.16, h: 55 },
    text: { l: 0.34, c: 0.14, h: 55 },
  },
  3: {
    // Bleu — Sous-partie
    bg: { l: 0.96, c: 0.03, h: 235 },
    border: { l: 0.55, c: 0.14, h: 235 },
    text: { l: 0.32, c: 0.13, h: 235 },
  },
  4: {
    // Jaune — Info
    bg: { l: 0.96, c: 0.03, h: 95 },
    border: { l: 0.62, c: 0.14, h: 95 },
    text: { l: 0.3, c: 0.12, h: 95 },
  },
}
```

- [ ] **Step 8: Run to verify it passes**

```bash
bun run test src/colors/levelColors.test.ts
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/colors
git commit -m "feat: add OKLCH contrast utility and WCAG-AA-verified level color palette"
```

---

### Task 4: Card type definition

**Files:**
- Create: `src/types/card.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `CardLevel` type, `Card` interface — used by every task from here on

- [ ] **Step 1: Write the type (no test needed — a type has no runtime behavior)**

```ts
// src/types/card.ts
export type CardLevel = 1 | 2 | 3 | 4

export interface Card {
  id: string
  level: CardLevel
  title: string
  definition?: string
  parentId: string | null
  order: number
}
```

- [ ] **Step 2: Verify the project still type-checks**

```bash
bunx tsc --noEmit
```

Expected: no new errors introduced.

- [ ] **Step 3: Commit**

```bash
git add src/types/card.ts
git commit -m "feat: add Card data model type"
```

---

### Task 5: Tailwind CSS v4 + shadcn/ui setup

**Files:**
- Create: `src/index.css` (or modify if the scaffold already created one)
- Modify: `vite.config.ts` (add Tailwind plugin)
- Create: `components.json` (shadcn/ui config)
- Create: `src/components/ui/` (shadcn-generated primitives: button, dialog, tooltip)
- Create: `src/lib/utils.ts` (shadcn's `cn` helper)

**Interfaces:**
- Consumes: `levelColors` from Task 3 (to define CSS custom properties)
- Produces: Tailwind utility classes available everywhere; `Button`, `Dialog`, `Tooltip` components from shadcn/ui for later tasks

- [ ] **Step 1: Install Tailwind v4**

```bash
bun add tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Wire the Vite plugin**

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
```

- [ ] **Step 3: Define CSS custom properties matching the verified palette**

```css
/* src/index.css */
@import "tailwindcss";

:root {
  --level-1-bg: oklch(0.96 0.03 25);
  --level-1-border: oklch(0.55 0.18 25);
  --level-1-text: oklch(0.32 0.15 25);

  --level-2-bg: oklch(0.96 0.03 55);
  --level-2-border: oklch(0.6 0.16 55);
  --level-2-text: oklch(0.34 0.14 55);

  --level-3-bg: oklch(0.96 0.03 235);
  --level-3-border: oklch(0.55 0.14 235);
  --level-3-text: oklch(0.32 0.13 235);

  --level-4-bg: oklch(0.96 0.03 95);
  --level-4-border: oklch(0.62 0.14 95);
  --level-4-text: oklch(0.3 0.12 95);
}
```

These constants intentionally mirror `src/colors/levelColors.ts` (Task 3) exactly — that TypeScript module stays the single source of truth for anything computed in JS (contrast checks, tests), while this CSS block is what the browser actually paints with. If the palette changes, update both.

- [ ] **Step 4: Initialize shadcn/ui**

```bash
bunx shadcn@latest init
bunx shadcn@latest add button dialog tooltip
```

Accept the defaults for a Vite + React + TypeScript project when prompted.

- [ ] **Step 5: Verify the dev shell still launches with Tailwind active**

```bash
bun run tauri dev
```

Expected: window opens, no console errors about Tailwind or shadcn.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: add Tailwind CSS v4 and shadcn/ui with level color tokens"
```

---

### Task 6: Install React Flow + Framer Motion, jsdom polyfills, smoke test

**Files:**
- Create: `src/components/MindMapCanvas.test.tsx` (smoke test only — full implementation comes in Task 14)
- Modify: `src/test/setup.ts` (add `ResizeObserver` polyfill required by React Flow under jsdom)

**Interfaces:**
- Consumes: test harness from Task 2
- Produces: confirms `@xyflow/react` renders under the test harness before any real feature depends on it

- [ ] **Step 1: Install React Flow and Framer Motion**

```bash
bun add @xyflow/react motion
```

- [ ] **Step 2: Add the ResizeObserver polyfill React Flow needs under jsdom**

```ts
// src/test/setup.ts
import '@testing-library/jest-dom/vitest'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in globalThis)) {
  // @ts-expect-error test polyfill
  globalThis.ResizeObserver = ResizeObserverMock
}
```

- [ ] **Step 3: Write the failing smoke test**

```tsx
// src/components/MindMapCanvas.test.tsx
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

describe('React Flow smoke test', () => {
  it('renders an empty canvas without crashing', () => {
    const { container } = render(
      <ReactFlowProvider>
        <div style={{ width: 400, height: 400 }}>
          <ReactFlow nodes={[]} edges={[]} />
        </div>
      </ReactFlowProvider>
    )
    expect(container.querySelector('.react-flow')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun run test src/components/MindMapCanvas.test.tsx
```

Expected: PASS. (This is a smoke test for the library + polyfill, not a feature — nothing to see fail first.)

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock src/test/setup.ts src/components/MindMapCanvas.test.tsx
git commit -m "chore: install React Flow and Framer Motion, verify they render under jsdom"
```

---

### Task 7: Card reducer — creation operations

**Files:**
- Create: `src/state/cardsReducer.ts`
- Create: `src/state/cardsReducer.test.ts`

**Interfaces:**
- Consumes: `Card`, `CardLevel` from `src/types/card.ts`
- Produces: `createRootCard(title?: string): Card`, `addChild(cards: Card[], parentId: string): { cards: Card[]; newCardId: string }`, `addSibling(cards: Card[], siblingId: string, position: 'above' | 'below'): { cards: Card[]; newCardId: string }` — consumed by Task 8, 9, 11 (store)

- [ ] **Step 1: Write the failing tests**

```ts
// src/state/cardsReducer.test.ts
import { describe, it, expect } from 'vitest'
import { createRootCard, addChild, addSibling } from './cardsReducer'
import type { Card } from '../types/card'

describe('createRootCard', () => {
  it('creates a level-1 card with no parent', () => {
    const root = createRootCard('Chapitre 1')
    expect(root.level).toBe(1)
    expect(root.parentId).toBeNull()
    expect(root.title).toBe('Chapitre 1')
    expect(root.order).toBe(0)
  })
})

describe('addChild', () => {
  it('adds a level+1 card linked to the parent', () => {
    const root = createRootCard()
    const { cards, newCardId } = addChild([root], root.id)
    const child = cards.find(c => c.id === newCardId)!
    expect(child.level).toBe(2)
    expect(child.parentId).toBe(root.id)
    expect(cards).toHaveLength(2)
  })

  it('throws when the parent is level 4 (cannot have children)', () => {
    const level4: Card = { id: 'x', level: 4, title: 'x', parentId: null, order: 0 }
    expect(() => addChild([level4], 'x')).toThrow()
  })
})

describe('addSibling', () => {
  it('inserts a sibling below the reference and reindexes order', () => {
    const root = createRootCard()
    const { cards: withChild, newCardId: firstChildId } = addChild([root], root.id)
    const { cards, newCardId } = addSibling(withChild, firstChildId, 'below')
    const siblings = cards.filter(c => c.parentId === root.id).sort((a, b) => a.order - b.order)
    expect(siblings.map(c => c.id)).toEqual([firstChildId, newCardId])
    expect(siblings[0].order).toBe(0)
    expect(siblings[1].order).toBe(1)
  })

  it('inserts a sibling above the reference', () => {
    const root = createRootCard()
    const { cards: withChild, newCardId: firstChildId } = addChild([root], root.id)
    const { cards, newCardId } = addSibling(withChild, firstChildId, 'above')
    const siblings = cards.filter(c => c.parentId === root.id).sort((a, b) => a.order - b.order)
    expect(siblings.map(c => c.id)).toEqual([newCardId, firstChildId])
  })

  it('throws when trying to add a sibling to the root (single-root invariant)', () => {
    const root = createRootCard()
    expect(() => addSibling([root], root.id, 'below')).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/state/cardsReducer.test.ts
```

Expected: FAIL — `cardsReducer.ts` does not exist yet.

- [ ] **Step 3: Implement the creation operations**

```ts
// src/state/cardsReducer.ts
import type { Card, CardLevel } from '../types/card'

export function createRootCard(title = 'Nouveau titre'): Card {
  return { id: crypto.randomUUID(), level: 1, title, parentId: null, order: 0 }
}

export function addChild(cards: Card[], parentId: string): { cards: Card[]; newCardId: string } {
  const parent = cards.find(c => c.id === parentId)
  if (!parent) throw new Error(`addChild: parent ${parentId} not found`)
  if (parent.level === 4) throw new Error('addChild: level 4 cards cannot have children')
  const childLevel = (parent.level + 1) as CardLevel
  const siblings = cards.filter(c => c.parentId === parentId)
  const newCard: Card = {
    id: crypto.randomUUID(),
    level: childLevel,
    title: 'Nouveau titre',
    parentId,
    order: siblings.length,
  }
  return { cards: [...cards, newCard], newCardId: newCard.id }
}

export function addSibling(
  cards: Card[],
  siblingId: string,
  position: 'above' | 'below'
): { cards: Card[]; newCardId: string } {
  const reference = cards.find(c => c.id === siblingId)
  if (!reference) throw new Error(`addSibling: card ${siblingId} not found`)
  if (reference.parentId === null) {
    throw new Error('addSibling: cannot add a sibling to the root card (single-root invariant)')
  }
  const group = cards.filter(c => c.parentId === reference.parentId).sort((a, b) => a.order - b.order)
  const refIndex = group.findIndex(c => c.id === siblingId)
  const insertAt = position === 'above' ? refIndex : refIndex + 1
  const newCard: Card = {
    id: crypto.randomUUID(),
    level: reference.level,
    title: 'Nouveau titre',
    parentId: reference.parentId,
    order: 0,
  }
  const newGroup = [...group.slice(0, insertAt), newCard, ...group.slice(insertAt)].map((c, i) => ({
    ...c,
    order: i,
  }))
  const otherCards = cards.filter(c => c.parentId !== reference.parentId)
  return { cards: [...otherCards, ...newGroup], newCardId: newCard.id }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun run test src/state/cardsReducer.test.ts
```

Expected: PASS — 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/state/cardsReducer.ts src/state/cardsReducer.test.ts
git commit -m "feat: add card creation reducer operations (root, addChild, addSibling)"
```

---

### Task 8: Card reducer — update & delete operations

**Files:**
- Modify: `src/state/cardsReducer.ts`
- Modify: `src/state/cardsReducer.test.ts`

**Interfaces:**
- Consumes: `Card` type; existing `createRootCard`, `addChild` from Task 7
- Produces: `updateTitle(cards, cardId, title): Card[]`, `updateDefinition(cards, cardId, definition): Card[]`, `countDescendants(cards, cardId): number`, `deleteCard(cards, cardId): Card[]` — consumed by Task 11 (store), Task 17 (delete UI)

- [ ] **Step 1: Add the failing tests**

```ts
// append to src/state/cardsReducer.test.ts
import { updateTitle, updateDefinition, countDescendants, deleteCard } from './cardsReducer'

describe('updateTitle', () => {
  it('updates only the targeted card', () => {
    const root = createRootCard('old')
    const cards = updateTitle([root], root.id, 'new')
    expect(cards[0].title).toBe('new')
  })
})

describe('updateDefinition', () => {
  it('sets the definition on the targeted card', () => {
    const root = createRootCard()
    const cards = updateDefinition([root], root.id, 'une définition')
    expect(cards[0].definition).toBe('une définition')
  })
})

describe('countDescendants', () => {
  it('counts children and grandchildren', () => {
    const root = createRootCard()
    const { cards: withChild, newCardId: childId } = addChild([root], root.id)
    const { cards: withGrandchild } = addChild(withChild, childId)
    expect(countDescendants(withGrandchild, root.id)).toBe(2)
    expect(countDescendants(withGrandchild, childId)).toBe(1)
  })
})

describe('deleteCard', () => {
  it('removes a leaf card and reindexes its remaining siblings', () => {
    const root = createRootCard()
    const { cards: c1, newCardId: firstChild } = addChild([root], root.id)
    const { cards: c2, newCardId: secondChild } = addChild(c1, root.id)
    const result = deleteCard(c2, firstChild)
    expect(result.find(c => c.id === firstChild)).toBeUndefined()
    const remainingChild = result.find(c => c.id === secondChild)!
    expect(remainingChild.order).toBe(0)
  })

  it('cascades deletion to descendants', () => {
    const root = createRootCard()
    const { cards: c1, newCardId: childId } = addChild([root], root.id)
    const { cards: c2, newCardId: grandchildId } = addChild(c1, childId)
    const result = deleteCard(c2, childId)
    expect(result.find(c => c.id === childId)).toBeUndefined()
    expect(result.find(c => c.id === grandchildId)).toBeUndefined()
    expect(result).toHaveLength(1)
  })

  it('throws when trying to delete the root card', () => {
    const root = createRootCard()
    expect(() => deleteCard([root], root.id)).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

```bash
bun run test src/state/cardsReducer.test.ts
```

Expected: FAIL — the four new functions are not exported yet.

- [ ] **Step 3: Implement update & delete**

```ts
// append to src/state/cardsReducer.ts
export function updateTitle(cards: Card[], cardId: string, title: string): Card[] {
  return cards.map(c => (c.id === cardId ? { ...c, title } : c))
}

export function updateDefinition(cards: Card[], cardId: string, definition: string | undefined): Card[] {
  return cards.map(c => (c.id === cardId ? { ...c, definition } : c))
}

export function countDescendants(cards: Card[], cardId: string): number {
  const children = cards.filter(c => c.parentId === cardId)
  return children.reduce((sum, child) => sum + 1 + countDescendants(cards, child.id), 0)
}

export function deleteCard(cards: Card[], cardId: string): Card[] {
  const target = cards.find(c => c.id === cardId)
  if (!target) throw new Error(`deleteCard: card ${cardId} not found`)
  if (target.parentId === null) {
    throw new Error('deleteCard: cannot delete the root card (single-root invariant)')
  }

  const toDelete = new Set<string>([cardId])
  let added = true
  while (added) {
    added = false
    for (const c of cards) {
      if (c.parentId && toDelete.has(c.parentId) && !toDelete.has(c.id)) {
        toDelete.add(c.id)
        added = true
      }
    }
  }

  const remaining = cards.filter(c => !toDelete.has(c.id))
  const siblings = remaining
    .filter(c => c.parentId === target.parentId)
    .sort((a, b) => a.order - b.order)
    .map((c, i) => ({ ...c, order: i }))
  const others = remaining.filter(c => c.parentId !== target.parentId)
  return [...others, ...siblings]
}
```

- [ ] **Step 4: Run to verify all tests pass**

```bash
bun run test src/state/cardsReducer.test.ts
```

Expected: PASS — all tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/state/cardsReducer.ts src/state/cardsReducer.test.ts
git commit -m "feat: add card update/delete reducer operations with cascade delete"
```

---

### Task 9: Card reducer — reorder operation

**Files:**
- Modify: `src/state/cardsReducer.ts`
- Modify: `src/state/cardsReducer.test.ts`

**Interfaces:**
- Consumes: `Card` type; existing `createRootCard`, `addChild` from Task 7
- Produces: `moveCardToIndex(cards: Card[], cardId: string, newIndex: number): Card[]` — consumed by Task 11 (store) and Task 18 (drag handle)

- [ ] **Step 1: Add the failing test**

```ts
// append to src/state/cardsReducer.test.ts
import { moveCardToIndex } from './cardsReducer'

describe('moveCardToIndex', () => {
  it('moves a card to a new index among its siblings and reindexes order', () => {
    const root = createRootCard()
    const { cards: c1, newCardId: first } = addChild([root], root.id)
    const { cards: c2, newCardId: second } = addChild(c1, root.id)
    const { cards: c3, newCardId: third } = addChild(c2, root.id)

    const result = moveCardToIndex(c3, first, 2)
    const siblings = result.filter(c => c.parentId === root.id).sort((a, b) => a.order - b.order)
    expect(siblings.map(c => c.id)).toEqual([second, third, first])
  })

  it('clamps out-of-range indexes to the valid range', () => {
    const root = createRootCard()
    const { cards: c1, newCardId: first } = addChild([root], root.id)
    const { cards: c2, newCardId: second } = addChild(c1, root.id)
    const result = moveCardToIndex(c2, first, 999)
    const siblings = result.filter(c => c.parentId === root.id).sort((a, b) => a.order - b.order)
    expect(siblings.map(c => c.id)).toEqual([second, first])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/state/cardsReducer.test.ts
```

Expected: FAIL — `moveCardToIndex` is not exported yet.

- [ ] **Step 3: Implement it**

```ts
// append to src/state/cardsReducer.ts
export function moveCardToIndex(cards: Card[], cardId: string, newIndex: number): Card[] {
  const target = cards.find(c => c.id === cardId)
  if (!target) throw new Error(`moveCardToIndex: card ${cardId} not found`)

  const group = cards.filter(c => c.parentId === target.parentId).sort((a, b) => a.order - b.order)
  const currentIndex = group.findIndex(c => c.id === cardId)
  const clampedIndex = Math.max(0, Math.min(newIndex, group.length - 1))

  const [moved] = group.splice(currentIndex, 1)
  group.splice(clampedIndex, 0, moved)
  const reindexed = group.map((c, i) => ({ ...c, order: i }))

  const others = cards.filter(c => c.parentId !== target.parentId)
  return [...others, ...reindexed]
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun run test src/state/cardsReducer.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/state/cardsReducer.ts src/state/cardsReducer.test.ts
git commit -m "feat: add moveCardToIndex reducer operation for sibling reordering"
```

---

### Task 10: Undo/redo history manager

**Files:**
- Create: `src/state/history.ts`
- Create: `src/state/history.test.ts`

**Interfaces:**
- Consumes: nothing (generic over `T`)
- Produces: `History<T>` type, `createHistory<T>(initial: T): History<T>`, `pushState<T>(history, next): History<T>`, `undo<T>(history): History<T>`, `redo<T>(history): History<T>` — consumed by Task 11 (store)

- [ ] **Step 1: Write the failing tests**

```ts
// src/state/history.test.ts
import { describe, it, expect } from 'vitest'
import { createHistory, pushState, undo, redo } from './history'

describe('history', () => {
  it('starts with only a present value', () => {
    const h = createHistory(1)
    expect(h.present).toBe(1)
    expect(h.past).toEqual([])
    expect(h.future).toEqual([])
  })

  it('pushState moves the old present into past', () => {
    const h = pushState(createHistory(1), 2)
    expect(h.present).toBe(2)
    expect(h.past).toEqual([1])
  })

  it('undo restores the previous present and stashes the current one in future', () => {
    const h = pushState(createHistory(1), 2)
    const undone = undo(h)
    expect(undone.present).toBe(1)
    expect(undone.future).toEqual([2])
  })

  it('undo is a no-op when there is no past', () => {
    const h = createHistory(1)
    expect(undo(h)).toEqual(h)
  })

  it('redo re-applies a value that was undone', () => {
    const h = pushState(createHistory(1), 2)
    const redone = redo(undo(h))
    expect(redone.present).toBe(2)
    expect(redone.future).toEqual([])
  })

  it('redo is a no-op when there is no future', () => {
    const h = createHistory(1)
    expect(redo(h)).toEqual(h)
  })

  it('pushState after an undo clears the redo stack', () => {
    const h = pushState(createHistory(1), 2)
    const branched = pushState(undo(h), 3)
    expect(branched.present).toBe(3)
    expect(branched.future).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/state/history.test.ts
```

Expected: FAIL — `history.ts` does not exist yet.

- [ ] **Step 3: Implement it**

```ts
// src/state/history.ts
export interface History<T> {
  past: T[]
  present: T
  future: T[]
}

export function createHistory<T>(initial: T): History<T> {
  return { past: [], present: initial, future: [] }
}

export function pushState<T>(history: History<T>, next: T): History<T> {
  return { past: [...history.past, history.present], present: next, future: [] }
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history
  const previous = history.past[history.past.length - 1]
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history
  const next = history.future[0]
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun run test src/state/history.test.ts
```

Expected: PASS — 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/state/history.ts src/state/history.test.ts
git commit -m "feat: add generic undo/redo history manager"
```

---

### Task 11: Cards Zustand store

**Files:**
- Create: `src/state/useCardsStore.ts`
- Create: `src/state/useCardsStore.test.ts`

**Interfaces:**
- Consumes: `Card` type; all reducer functions from Tasks 7-9 (`createRootCard`, `addChild`, `addSibling`, `updateTitle`, `updateDefinition`, `countDescendants`, `deleteCard`, `moveCardToIndex`); `History`, `createHistory`, `pushState`, `undo`, `redo` from Task 10
- Produces: `createCardsStore()` factory and `useCardsStore` singleton, exposing state `{ history: History<Card[]>, locked: boolean }` and actions `addChild(parentId): string`, `addSibling(siblingId, position): string`, `updateTitle(id, title): void`, `updateDefinition(id, definition): void`, `deleteCard(id): void`, `descendantCount(id): number`, `moveCardToIndex(id, newIndex): void`, `undo(): void`, `redo(): void`, `toggleLock(): void`, `loadCards(cards: Card[]): void` — consumed by every UI component from Task 13 onward

- [ ] **Step 1: Write the failing tests**

```ts
// src/state/useCardsStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createCardsStore } from './useCardsStore'

describe('useCardsStore', () => {
  it('starts with a single root card', () => {
    const store = createCardsStore()
    expect(store.getState().history.present).toHaveLength(1)
    expect(store.getState().history.present[0].parentId).toBeNull()
  })

  it('addChild adds a card and is undoable/redoable', () => {
    const store = createCardsStore()
    const rootId = store.getState().history.present[0].id
    store.getState().addChild(rootId)
    expect(store.getState().history.present).toHaveLength(2)

    store.getState().undo()
    expect(store.getState().history.present).toHaveLength(1)

    store.getState().redo()
    expect(store.getState().history.present).toHaveLength(2)
  })

  it('descendantCount reflects the current tree', () => {
    const store = createCardsStore()
    const rootId = store.getState().history.present[0].id
    const childId = store.getState().addChild(rootId)
    store.getState().addChild(childId)
    expect(store.getState().descendantCount(rootId)).toBe(2)
  })

  it('toggleLock flips the locked flag', () => {
    const store = createCardsStore()
    expect(store.getState().locked).toBe(false)
    store.getState().toggleLock()
    expect(store.getState().locked).toBe(true)
  })

  it('loadCards replaces the tree and resets history', () => {
    const store = createCardsStore()
    const rootId = store.getState().history.present[0].id
    store.getState().addChild(rootId)
    const freshCards = [{ id: 'x', level: 1 as const, title: 'x', parentId: null, order: 0 }]
    store.getState().loadCards(freshCards)
    expect(store.getState().history.present).toEqual(freshCards)
    expect(store.getState().history.past).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/state/useCardsStore.test.ts
```

Expected: FAIL — `useCardsStore.ts` does not exist yet.

- [ ] **Step 3: Install Zustand and implement the store**

```bash
bun add zustand
```

```ts
// src/state/useCardsStore.ts
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { Card } from '../types/card'
import { createHistory, pushState, undo as undoHistory, redo as redoHistory, type History } from './history'
import {
  createRootCard,
  addChild as addChildOp,
  addSibling as addSiblingOp,
  updateTitle as updateTitleOp,
  updateDefinition as updateDefinitionOp,
  deleteCard as deleteCardOp,
  moveCardToIndex as moveCardToIndexOp,
  countDescendants,
} from './cardsReducer'

interface CardsState {
  history: History<Card[]>
  locked: boolean
  addChild: (parentId: string) => string
  addSibling: (siblingId: string, position: 'above' | 'below') => string
  updateTitle: (id: string, title: string) => void
  updateDefinition: (id: string, definition: string | undefined) => void
  deleteCard: (id: string) => void
  descendantCount: (id: string) => number
  moveCardToIndex: (id: string, newIndex: number) => void
  undo: () => void
  redo: () => void
  toggleLock: () => void
  loadCards: (cards: Card[]) => void
}

export type CardsStore = UseBoundStore<StoreApi<CardsState>>

export function createCardsStore(): CardsStore {
  return create<CardsState>((set, get) => ({
    history: createHistory<Card[]>([createRootCard('Nouveau chapitre')]),
    locked: false,
    addChild: parentId => {
      const { cards: next, newCardId } = addChildOp(get().history.present, parentId)
      set(state => ({ history: pushState(state.history, next) }))
      return newCardId
    },
    addSibling: (siblingId, position) => {
      const { cards: next, newCardId } = addSiblingOp(get().history.present, siblingId, position)
      set(state => ({ history: pushState(state.history, next) }))
      return newCardId
    },
    updateTitle: (id, title) => {
      const next = updateTitleOp(get().history.present, id, title)
      set(state => ({ history: pushState(state.history, next) }))
    },
    updateDefinition: (id, definition) => {
      const next = updateDefinitionOp(get().history.present, id, definition)
      set(state => ({ history: pushState(state.history, next) }))
    },
    deleteCard: id => {
      const next = deleteCardOp(get().history.present, id)
      set(state => ({ history: pushState(state.history, next) }))
    },
    descendantCount: id => countDescendants(get().history.present, id),
    moveCardToIndex: (id, newIndex) => {
      const next = moveCardToIndexOp(get().history.present, id, newIndex)
      set(state => ({ history: pushState(state.history, next) }))
    },
    undo: () => set(state => ({ history: undoHistory(state.history) })),
    redo: () => set(state => ({ history: redoHistory(state.history) })),
    toggleLock: () => set(state => ({ locked: !state.locked })),
    loadCards: cards => set({ history: createHistory(cards) }),
  }))
}

export const useCardsStore = createCardsStore()
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun run test src/state/useCardsStore.test.ts
```

Expected: PASS — 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock src/state/useCardsStore.ts src/state/useCardsStore.test.ts
git commit -m "feat: add Zustand cards store wiring reducer, undo/redo, and lock state"
```

---

### Task 12: Serialization + Tauri file persistence + autosave

**Files:**
- Create: `src/persistence/serialization.ts`
- Create: `src/persistence/serialization.test.ts`
- Create: `src/persistence/fileStore.ts`
- Create: `src/persistence/fileStore.test.ts`
- Create: `src/persistence/useAutosave.ts`
- Create: `src/persistence/useAutosave.test.ts`

**Interfaces:**
- Consumes: `Card` type
- Produces: `serializeCards(cards): string`, `deserializeCards(json): Card[]`, `loadMindMap(path): Promise<Card[]>`, `saveMindMap(path, cards): Promise<void>`, `useAutosave(path, cards, delayMs?): void` — consumed by Task 21 (App wiring)

- [ ] **Step 1: Write the failing serialization tests**

```ts
// src/persistence/serialization.test.ts
import { describe, it, expect } from 'vitest'
import { serializeCards, deserializeCards } from './serialization'
import type { Card } from '../types/card'

const sample: Card[] = [{ id: 'root', level: 1, title: 'Chapitre', parentId: null, order: 0 }]

describe('serializeCards / deserializeCards', () => {
  it('round-trips a card list', () => {
    const json = serializeCards(sample)
    expect(deserializeCards(json)).toEqual(sample)
  })

  it('throws on malformed JSON that is not an array', () => {
    expect(() => deserializeCards('{"not":"an array"}')).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/persistence/serialization.test.ts
```

Expected: FAIL — `serialization.ts` does not exist yet.

- [ ] **Step 3: Implement serialization**

```ts
// src/persistence/serialization.ts
import type { Card } from '../types/card'

export function serializeCards(cards: Card[]): string {
  return JSON.stringify(cards, null, 2)
}

export function deserializeCards(json: string): Card[] {
  const parsed = JSON.parse(json)
  if (!Array.isArray(parsed)) throw new Error('deserializeCards: expected a JSON array of cards')
  return parsed as Card[]
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun run test src/persistence/serialization.test.ts
```

Expected: PASS

- [ ] **Step 5: Install the Tauri fs plugin**

```bash
bun add @tauri-apps/plugin-fs
bunx tauri add fs
```

- [ ] **Step 6: Write the failing fileStore tests (mocking the Tauri fs plugin)**

```ts
// src/persistence/fileStore.test.ts
import { describe, it, expect, vi } from 'vitest'
import { loadMindMap, saveMindMap } from './fileStore'
import type { Card } from '../types/card'

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}))

import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

const sample: Card[] = [{ id: 'root', level: 1, title: 'Chapitre', parentId: null, order: 0 }]

describe('loadMindMap', () => {
  it('reads a file and deserializes its content', async () => {
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(sample))
    const result = await loadMindMap('/fake/path.json')
    expect(readTextFile).toHaveBeenCalledWith('/fake/path.json')
    expect(result).toEqual(sample)
  })
})

describe('saveMindMap', () => {
  it('serializes and writes to the given path', async () => {
    await saveMindMap('/fake/path.json', sample)
    expect(writeTextFile).toHaveBeenCalledWith('/fake/path.json', JSON.stringify(sample, null, 2))
  })
})
```

- [ ] **Step 7: Run to verify it fails**

```bash
bun run test src/persistence/fileStore.test.ts
```

Expected: FAIL — `fileStore.ts` does not exist yet.

- [ ] **Step 8: Implement fileStore**

```ts
// src/persistence/fileStore.ts
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import type { Card } from '../types/card'
import { serializeCards, deserializeCards } from './serialization'

export async function loadMindMap(path: string): Promise<Card[]> {
  const json = await readTextFile(path)
  return deserializeCards(json)
}

export async function saveMindMap(path: string, cards: Card[]): Promise<void> {
  await writeTextFile(path, serializeCards(cards))
}
```

- [ ] **Step 9: Run to verify it passes**

```bash
bun run test src/persistence/fileStore.test.ts
```

Expected: PASS

- [ ] **Step 10: Write the failing autosave hook test**

```ts
// src/persistence/useAutosave.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutosave } from './useAutosave'
import type { Card } from '../types/card'

vi.mock('./fileStore', () => ({ saveMindMap: vi.fn().mockResolvedValue(undefined) }))
import { saveMindMap } from './fileStore'

const cardsV1: Card[] = [{ id: 'root', level: 1, title: 'v1', parentId: null, order: 0 }]
const cardsV2: Card[] = [{ id: 'root', level: 1, title: 'v2', parentId: null, order: 0 }]

describe('useAutosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces saves and only writes the latest value', () => {
    const { rerender } = renderHook(({ cards }) => useAutosave('/fake/path.json', cards, 500), {
      initialProps: { cards: cardsV1 },
    })
    rerender({ cards: cardsV2 })

    vi.advanceTimersByTime(499)
    expect(saveMindMap).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(saveMindMap).toHaveBeenCalledTimes(1)
    expect(saveMindMap).toHaveBeenCalledWith('/fake/path.json', cardsV2)
  })
})
```

- [ ] **Step 11: Run to verify it fails**

```bash
bun run test src/persistence/useAutosave.test.ts
```

Expected: FAIL — `useAutosave.ts` does not exist yet.

- [ ] **Step 12: Implement the autosave hook**

```ts
// src/persistence/useAutosave.ts
import { useEffect, useRef } from 'react'
import type { Card } from '../types/card'
import { saveMindMap } from './fileStore'

export function useAutosave(path: string, cards: Card[], delayMs = 500): void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      void saveMindMap(path, cards)
    }, delayMs)
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [path, cards, delayMs])
}
```

- [ ] **Step 13: Run to verify it passes**

```bash
bun run test src/persistence/useAutosave.test.ts
```

Expected: PASS

- [ ] **Step 14: Commit**

```bash
git add package.json bun.lock src-tauri src/persistence
git commit -m "feat: add JSON serialization, Tauri file persistence, and debounced autosave"
```

---

### Task 13: Column layout calculator

**Files:**
- Create: `src/layout/columns.ts`
- Create: `src/layout/columns.test.ts`

**Interfaces:**
- Consumes: `Card` type
- Produces: `COLUMN_WIDTH`, `ROW_HEIGHT` constants, `Position { x: number; y: number }` type, `computeLayout(cards: Card[]): Record<string, Position>` — consumed by Task 15 (MindMapCanvas)

- [ ] **Step 1: Write the failing tests**

```ts
// src/layout/columns.test.ts
import { describe, it, expect } from 'vitest'
import { computeLayout, COLUMN_WIDTH, ROW_HEIGHT } from './columns'
import type { Card } from '../types/card'

describe('computeLayout', () => {
  it('places each level at its fixed column x position', () => {
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'r', parentId: null, order: 0 },
      { id: 'child', level: 2, title: 'c', parentId: 'root', order: 0 },
    ]
    const positions = computeLayout(cards)
    expect(positions.root.x).toBe(0)
    expect(positions.child.x).toBe(COLUMN_WIDTH)
  })

  it('stacks siblings vertically by sorted order, independent of gaps in the order field', () => {
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'r', parentId: null, order: 0 },
      { id: 'a', level: 2, title: 'a', parentId: 'root', order: 5 },
      { id: 'b', level: 2, title: 'b', parentId: 'root', order: 10 },
    ]
    const positions = computeLayout(cards)
    expect(positions.a.y).toBe(0)
    expect(positions.b.y).toBe(ROW_HEIGHT)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/layout/columns.test.ts
```

Expected: FAIL — `columns.ts` does not exist yet.

- [ ] **Step 3: Implement it**

```ts
// src/layout/columns.ts
import type { Card } from '../types/card'

export const COLUMN_WIDTH = 320
export const ROW_HEIGHT = 120

export interface Position {
  x: number
  y: number
}

export function computeLayout(cards: Card[]): Record<string, Position> {
  const positions: Record<string, Position> = {}
  const groups = new Map<string | null, Card[]>()

  for (const card of cards) {
    if (!groups.has(card.parentId)) groups.set(card.parentId, [])
    groups.get(card.parentId)!.push(card)
  }

  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.order - b.order)
    sorted.forEach((card, index) => {
      positions[card.id] = {
        x: (card.level - 1) * COLUMN_WIDTH,
        y: index * ROW_HEIGHT,
      }
    })
  }

  return positions
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun run test src/layout/columns.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/layout
git commit -m "feat: add fixed-column layout calculator"
```

---

### Task 14: CardNode — visual shell + inline title editing

**Files:**
- Create: `src/components/CardNode.tsx`
- Create: `src/components/CardNode.test.tsx`

**Interfaces:**
- Consumes: `levelColors`, `toCss` from Task 3; `useCardsStore` from Task 11
- Produces: `CardNode` React Flow custom node component (React Flow `NodeProps` with `data: { card: Card }`), rendering `data-testid="card-{id}"` — consumed by Task 15 (MindMapCanvas registers it) and extended by Tasks 16-19

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/CardNode.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import type { NodeProps } from '@xyflow/react'
import { CardNode } from './CardNode'
import { useCardsStore } from '../state/useCardsStore'
import type { Card } from '../types/card'

const testCard: Card = { id: 'root', level: 1, title: 'Titre initial', parentId: null, order: 0 }

function renderCardNode(card: Card) {
  const props = { id: card.id, data: { card } } as unknown as NodeProps & { data: { card: Card } }
  return render(<CardNode {...props} />)
}

describe('CardNode', () => {
  beforeEach(() => {
    useCardsStore.getState().loadCards([testCard])
  })

  it('displays the card title', () => {
    renderCardNode(testCard)
    expect(screen.getByText('Titre initial')).toBeInTheDocument()
  })

  it('enters edit mode on click and commits the new title on Enter', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)

    await user.click(screen.getByText('Titre initial'))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Nouveau titre{Enter}')

    expect(useCardsStore.getState().history.present[0].title).toBe('Nouveau titre')
  })

  it('cancels the edit on Escape without changing the stored title', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)

    await user.click(screen.getByText('Titre initial'))
    const input = screen.getByRole('textbox')
    await user.type(input, ' modifié{Escape}')

    expect(useCardsStore.getState().history.present[0].title).toBe('Titre initial')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/components/CardNode.test.tsx
```

Expected: FAIL — `CardNode.tsx` does not exist yet.

- [ ] **Step 3: Implement the component**

```tsx
// src/components/CardNode.tsx
import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { Card } from '../types/card'
import { useCardsStore } from '../state/useCardsStore'
import { levelColors } from '../colors/levelColors'
import { toCss } from '../colors/contrast'

type CardNodeProps = NodeProps & { data: { card: Card } }

export function CardNode({ data }: CardNodeProps) {
  const { card } = data
  const updateTitle = useCardsStore(s => s.updateTitle)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(card.title)
  const colors = levelColors[card.level]

  function commitTitle() {
    updateTitle(card.id, draftTitle.trim() || card.title)
    setEditing(false)
  }

  function cancelTitle() {
    setDraftTitle(card.title)
    setEditing(false)
  }

  return (
    <div
      data-testid={`card-${card.id}`}
      className="card-node"
      style={{
        background: toCss(colors.bg),
        borderColor: toCss(colors.border),
        color: toCss(colors.text),
        border: '2px solid',
        borderRadius: 8,
        padding: 12,
        minWidth: 180,
      }}
    >
      {editing ? (
        <input
          autoFocus
          value={draftTitle}
          onChange={e => setDraftTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={e => {
            if (e.key === 'Enter') commitTitle()
            if (e.key === 'Escape') cancelTitle()
          }}
        />
      ) : (
        <span onClick={() => setEditing(true)}>{card.title}</span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun run test src/components/CardNode.test.tsx
```

Expected: PASS — 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/CardNode.tsx src/components/CardNode.test.tsx
git commit -m "feat: add CardNode with colored shell and inline title editing"
```

---

### Task 15: MindMapCanvas — React Flow wrapper

**Files:**
- Modify: `src/components/MindMapCanvas.test.tsx` (replace the Task 6 smoke test with the real component test)
- Create: `src/components/MindMapCanvas.tsx`

**Interfaces:**
- Consumes: `useCardsStore` from Task 11, `computeLayout` from Task 13, `CardNode` from Task 14, `levelColors`/`toCss` from Task 3
- Produces: `MindMapCanvas` component rendering one `CardNode` per card with colored edges — consumed by Task 21 (App)

- [ ] **Step 1: Replace the smoke test with the real test**

```tsx
// src/components/MindMapCanvas.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { MindMapCanvas } from './MindMapCanvas'
import { useCardsStore } from '../state/useCardsStore'
import type { Card } from '../types/card'

const root: Card = { id: 'root', level: 1, title: 'Racine', parentId: null, order: 0 }
const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }

describe('MindMapCanvas', () => {
  beforeEach(() => {
    useCardsStore.getState().loadCards([root, child])
  })

  it('renders one CardNode per card', () => {
    render(<MindMapCanvas />)
    expect(screen.getByText('Racine')).toBeInTheDocument()
    expect(screen.getByText('Enfant')).toBeInTheDocument()
  })

  it('renders one edge for the parent-child link', () => {
    const { container } = render(<MindMapCanvas />)
    expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/components/MindMapCanvas.test.tsx
```

Expected: FAIL — `MindMapCanvas.tsx` does not exist yet.

- [ ] **Step 3: Implement it**

```tsx
// src/components/MindMapCanvas.tsx
import { useCallback, useMemo } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls, type Node, type Edge, type NodeDragHandler } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCardsStore } from '../state/useCardsStore'
import { computeLayout } from '../layout/columns'
import { CardNode } from './CardNode'
import { levelColors } from '../colors/levelColors'
import { toCss } from '../colors/contrast'

const nodeTypes = { card: CardNode }

function MindMapCanvasInner() {
  const cards = useCardsStore(s => s.history.present)
  const locked = useCardsStore(s => s.locked)
  const moveCardToIndex = useCardsStore(s => s.moveCardToIndex)

  const layout = useMemo(() => computeLayout(cards), [cards])

  const nodes: Node[] = useMemo(
    () =>
      cards.map(card => ({
        id: card.id,
        type: 'card',
        position: layout[card.id],
        data: { card },
        draggable: !locked,
        dragHandle: '.card-drag-handle',
      })),
    [cards, layout, locked]
  )

  const edges: Edge[] = useMemo(
    () =>
      cards
        .filter((card): card is typeof card & { parentId: string } => card.parentId !== null)
        .map(card => ({
          id: `e-${card.parentId}-${card.id}`,
          source: card.parentId,
          target: card.id,
          style: { stroke: toCss(levelColors[card.level].border) },
        })),
    [cards]
  )

  const handleNodeDragStop: NodeDragHandler = useCallback(
    (_event, draggedNode) => {
      const draggedCard = cards.find(c => c.id === draggedNode.id)
      if (!draggedCard) return
      const siblingYs = cards
        .filter(c => c.parentId === draggedCard.parentId)
        .map(c => ({ id: c.id, y: c.id === draggedCard.id ? draggedNode.position.y : layout[c.id].y }))
        .sort((a, b) => a.y - b.y)
      const newIndex = siblingYs.findIndex(c => c.id === draggedCard.id)
      moveCardToIndex(draggedCard.id, newIndex)
    },
    [cards, layout, moveCardToIndex]
  )

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeDragStop={handleNodeDragStop} fitView>
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

export function MindMapCanvas() {
  return (
    <ReactFlowProvider>
      <div style={{ width: '100%', height: '100%' }}>
        <MindMapCanvasInner />
      </div>
    </ReactFlowProvider>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun run test src/components/MindMapCanvas.test.tsx
```

Expected: PASS — 2 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/MindMapCanvas.tsx src/components/MindMapCanvas.test.tsx
git commit -m "feat: add MindMapCanvas rendering cards as a React Flow graph"
```

---

### Task 16: CardNode — structural buttons (`+` and `->`)

**Files:**
- Modify: `src/components/CardNode.tsx`
- Modify: `src/components/CardNode.test.tsx`

**Interfaces:**
- Consumes: `useCardsStore` actions `addChild`, `addSibling` (Task 11)
- Produces: visible `+` (top/bottom, hidden on level 1) and `->` (right, hidden on level 4) buttons on `CardNode`

- [ ] **Step 1: Add the failing tests**

```tsx
// append to src/components/CardNode.test.tsx
describe('CardNode structural buttons', () => {
  beforeEach(() => {
    useCardsStore.getState().loadCards([testCard])
  })

  it('creates a child when the -> button is clicked', async () => {
    const user = userEvent.setup()
    renderCardNode(testCard)
    await user.click(screen.getByRole('button', { name: /ajouter un enfant/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(2)
  })

  it('creates a sibling below when the bottom + button is clicked', async () => {
    const user = userEvent.setup()
    const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }
    useCardsStore.getState().loadCards([testCard, child])
    render(
      <CardNode {...({ id: child.id, data: { card: child } } as unknown as NodeProps & { data: { card: Card } })} />
    )
    await user.click(screen.getByRole('button', { name: /ajouter en dessous/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(3)
  })

  it('does not render + buttons on the root card (single-root invariant)', () => {
    renderCardNode(testCard)
    expect(screen.queryByRole('button', { name: /ajouter au-dessus/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ajouter en dessous/i })).not.toBeInTheDocument()
  })

  it('does not render the -> button on a level-4 card', () => {
    const level4: Card = { id: 'l4', level: 4, title: 'Info', parentId: 'root', order: 0 }
    useCardsStore.getState().loadCards([testCard, level4])
    render(<CardNode {...({ id: level4.id, data: { card: level4 } } as unknown as NodeProps & { data: { card: Card } })} />)
    expect(screen.queryByRole('button', { name: /ajouter un enfant/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/components/CardNode.test.tsx
```

Expected: FAIL — the buttons do not exist yet.

- [ ] **Step 3: Add the buttons to CardNode**

```tsx
// modify src/components/CardNode.tsx — inside the CardNode component, after reading `colors`
const addChild = useCardsStore(s => s.addChild)
const addSibling = useCardsStore(s => s.addSibling)
const childColors = card.level < 4 ? levelColors[(card.level + 1) as 1 | 2 | 3 | 4] : null
```

```tsx
// modify src/components/CardNode.tsx — replace the returned JSX with:
return (
  <div
    data-testid={`card-${card.id}`}
    className="card-node"
    style={{
      background: toCss(colors.bg),
      borderColor: toCss(colors.border),
      color: toCss(colors.text),
      border: '2px solid',
      borderRadius: 8,
      padding: 12,
      minWidth: 180,
      position: 'relative',
    }}
  >
    {card.parentId !== null && (
      <button
        aria-label="Ajouter au-dessus"
        style={{ color: toCss(colors.border) }}
        onClick={() => addSibling(card.id, 'above')}
      >
        +
      </button>
    )}

    {editing ? (
      <input
        autoFocus
        value={draftTitle}
        onChange={e => setDraftTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={e => {
          if (e.key === 'Enter') commitTitle()
          if (e.key === 'Escape') cancelTitle()
        }}
      />
    ) : (
      <span onClick={() => setEditing(true)}>{card.title}</span>
    )}

    {card.parentId !== null && (
      <button
        aria-label="Ajouter en dessous"
        style={{ color: toCss(colors.border) }}
        onClick={() => addSibling(card.id, 'below')}
      >
        +
      </button>
    )}

    {childColors && (
      <button aria-label="Ajouter un enfant" style={{ color: toCss(childColors.border) }} onClick={() => addChild(card.id)}>
        {'->'}
      </button>
    )}
  </div>
)
```

- [ ] **Step 4: Run to verify all CardNode tests pass**

```bash
bun run test src/components/CardNode.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/CardNode.tsx src/components/CardNode.test.tsx
git commit -m "feat: add +/-> structural buttons to CardNode with level-based visibility"
```

---

### Task 17: CardNode — delete button + confirmation dialog

**Files:**
- Modify: `src/components/CardNode.tsx`
- Modify: `src/components/CardNode.test.tsx`

**Interfaces:**
- Consumes: `useCardsStore` actions `deleteCard`, `descendantCount` (Task 11); shadcn/ui `Dialog` (Task 5)
- Produces: delete button (hidden on level 1) that deletes immediately if childless, or opens a confirmation dialog otherwise

- [ ] **Step 1: Add the failing tests**

```tsx
// append to src/components/CardNode.test.tsx
describe('CardNode delete', () => {
  it('deletes immediately when the card has no children', async () => {
    const user = userEvent.setup()
    const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }
    useCardsStore.getState().loadCards([testCard, child])
    render(<CardNode {...({ id: child.id, data: { card: child } } as unknown as NodeProps & { data: { card: Card } })} />)

    await user.click(screen.getByRole('button', { name: /supprimer/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(1)
  })

  it('shows a confirmation dialog before deleting a card with children', async () => {
    const user = userEvent.setup()
    const child: Card = { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 }
    const grandchild: Card = { id: 'grandchild', level: 3, title: 'Petit-enfant', parentId: 'child', order: 0 }
    useCardsStore.getState().loadCards([testCard, child, grandchild])
    render(<CardNode {...({ id: child.id, data: { card: child } } as unknown as NodeProps & { data: { card: Card } })} />)

    await user.click(screen.getByRole('button', { name: /supprimer/i }))
    expect(screen.getByText(/supprimer cette card et ses 1 enfants/i)).toBeInTheDocument()
    expect(useCardsStore.getState().history.present).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: /confirmer/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(1)
  })

  it('does not render a delete button on the root card', () => {
    renderCardNode(testCard)
    expect(screen.queryByRole('button', { name: /supprimer/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/components/CardNode.test.tsx
```

Expected: FAIL — no delete button exists yet.

- [ ] **Step 3: Add delete behavior with a shadcn Dialog**

```tsx
// modify src/components/CardNode.tsx — add imports
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'
```

```tsx
// modify src/components/CardNode.tsx — inside the component
const deleteCard = useCardsStore(s => s.deleteCard)
const descendantCount = useCardsStore(s => s.descendantCount)
const [confirmOpen, setConfirmOpen] = useState(false)

function handleDeleteClick() {
  if (descendantCount(card.id) === 0) {
    deleteCard(card.id)
  } else {
    setConfirmOpen(true)
  }
}
```

```tsx
// modify src/components/CardNode.tsx — add just before the closing </div> of the card, still inside it
{card.parentId !== null && (
  <button aria-label="Supprimer" onClick={handleDeleteClick}>
    ×
  </button>
)}

<Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>
        Supprimer cette card et ses {descendantCount(card.id)} enfants ?
      </DialogTitle>
    </DialogHeader>
    <DialogFooter>
      <Button variant="outline" onClick={() => setConfirmOpen(false)}>
        Annuler
      </Button>
      <Button
        variant="destructive"
        onClick={() => {
          deleteCard(card.id)
          setConfirmOpen(false)
        }}
      >
        Confirmer
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

If `bunx shadcn@latest add dialog` (Task 5) generated a different export shape than `DialogHeader`/`DialogFooter`, match whatever it actually generated in `src/components/ui/dialog.tsx` — the required behavior is: a dialog that shows the descendant count and has a cancel and a confirm button.

- [ ] **Step 4: Run to verify all CardNode tests pass**

```bash
bun run test src/components/CardNode.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/CardNode.tsx src/components/CardNode.test.tsx
git commit -m "feat: add delete button with conditional confirmation dialog to CardNode"
```

---

### Task 18: CardNode — drag handle + global lock toggle

**Files:**
- Modify: `src/components/CardNode.tsx`
- Modify: `src/components/CardNode.test.tsx`
- Create: `src/components/LockToggle.tsx`
- Create: `src/components/LockToggle.test.tsx`

**Interfaces:**
- Consumes: `useCardsStore` state `locked` and action `toggleLock` (Task 11)
- Produces: a `.card-drag-handle` element inside `CardNode` (top-left corner, greyed out when locked) matching the `dragHandle` selector already wired in `MindMapCanvas` (Task 15); a standalone `LockToggle` component for the app toolbar

- [ ] **Step 1: Add the failing CardNode test**

```tsx
// append to src/components/CardNode.test.tsx
describe('CardNode drag handle', () => {
  it('renders an enabled drag handle when unlocked', () => {
    useCardsStore.getState().loadCards([testCard])
    renderCardNode(testCard)
    const handle = screen.getByTestId('drag-handle')
    expect(handle).toHaveAttribute('aria-disabled', 'false')
  })

  it('greys out the drag handle when locked, without removing it', () => {
    useCardsStore.getState().loadCards([testCard])
    useCardsStore.getState().toggleLock()
    renderCardNode(testCard)
    const handle = screen.getByTestId('drag-handle')
    expect(handle).toHaveAttribute('aria-disabled', 'true')
    useCardsStore.getState().toggleLock() // reset for other tests
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/components/CardNode.test.tsx
```

Expected: FAIL — no `drag-handle` test id exists yet.

- [ ] **Step 3: Add the drag handle to CardNode**

```tsx
// modify src/components/CardNode.tsx — inside the component
const locked = useCardsStore(s => s.locked)
```

```tsx
// modify src/components/CardNode.tsx — add as the first child inside the card's outer div
<span
  className="card-drag-handle"
  data-testid="drag-handle"
  aria-disabled={locked}
  style={{
    position: 'absolute',
    top: 4,
    left: 4,
    cursor: locked ? 'default' : 'grab',
    color: locked ? '#c0c0c0' : toCss(colors.border),
    pointerEvents: locked ? 'none' : 'auto',
  }}
>
  ⠿
</span>
```

- [ ] **Step 4: Run to verify the CardNode tests pass**

```bash
bun run test src/components/CardNode.test.tsx
```

Expected: PASS

- [ ] **Step 5: Write the failing LockToggle test**

```tsx
// src/components/LockToggle.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { LockToggle } from './LockToggle'
import { useCardsStore } from '../state/useCardsStore'

describe('LockToggle', () => {
  beforeEach(() => useCardsStore.setState({ locked: false }))

  it('toggles the store lock flag on click', async () => {
    const user = userEvent.setup()
    render(<LockToggle />)
    const button = screen.getByRole('button', { name: /verrouiller/i })
    await user.click(button)
    expect(useCardsStore.getState().locked).toBe(true)
  })
})
```

- [ ] **Step 6: Run to verify it fails**

```bash
bun run test src/components/LockToggle.test.tsx
```

Expected: FAIL — `LockToggle.tsx` does not exist yet.

- [ ] **Step 7: Implement LockToggle**

```tsx
// src/components/LockToggle.tsx
import { Button } from './ui/button'
import { useCardsStore } from '../state/useCardsStore'

export function LockToggle() {
  const locked = useCardsStore(s => s.locked)
  const toggleLock = useCardsStore(s => s.toggleLock)

  return (
    <Button variant={locked ? 'default' : 'outline'} onClick={toggleLock}>
      {locked ? 'Déverrouiller' : 'Verrouiller'}
    </Button>
  )
}
```

- [ ] **Step 8: Run to verify it passes**

```bash
bun run test src/components/LockToggle.test.tsx
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/components/CardNode.tsx src/components/CardNode.test.tsx src/components/LockToggle.tsx src/components/LockToggle.test.tsx
git commit -m "feat: add drag handle to CardNode and global LockToggle"
```

---

### Task 19: CardNode — footer icons (definition toggle + flip preview)

**Files:**
- Modify: `src/components/CardNode.tsx`
- Modify: `src/components/CardNode.test.tsx`

**Interfaces:**
- Consumes: `useCardsStore` action `updateDefinition` (Task 11); `motion` from Framer Motion (Task 6)
- Produces: a footer row inside `CardNode` with a definition show/hide/add icon and a flip-preview icon (Framer Motion 3D flip, no scoring logic) — the flip animation is written so the future quiz lot can reuse it as-is

- [ ] **Step 1: Add the failing tests**

```tsx
// append to src/components/CardNode.test.tsx
describe('CardNode footer', () => {
  it('shows an "add definition" affordance when there is none yet', () => {
    useCardsStore.getState().loadCards([testCard])
    renderCardNode(testCard)
    expect(screen.getByRole('button', { name: /ajouter une définition/i })).toBeInTheDocument()
  })

  it('toggles an existing definition between hidden and shown', async () => {
    const user = userEvent.setup()
    const withDef: Card = { ...testCard, definition: 'Une définition' }
    useCardsStore.getState().loadCards([withDef])
    renderCardNode(withDef)

    expect(screen.queryByText('Une définition')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /afficher la définition/i }))
    expect(screen.getByText('Une définition')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /masquer la définition/i }))
    expect(screen.queryByText('Une définition')).not.toBeInTheDocument()
  })

  it('flips the card visually when the flip icon is clicked, without altering any card data', async () => {
    const user = userEvent.setup()
    useCardsStore.getState().loadCards([testCard])
    renderCardNode(testCard)

    await user.click(screen.getByRole('button', { name: /retourner/i }))
    expect(screen.getByTestId(`card-${testCard.id}`)).toHaveAttribute('data-flipped', 'true')
    expect(useCardsStore.getState().history.present).toEqual([testCard])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/components/CardNode.test.tsx
```

Expected: FAIL — the footer does not exist yet.

- [ ] **Step 3: Implement the footer**

```tsx
// modify src/components/CardNode.tsx — add import
import { motion } from 'motion/react'
```

```tsx
// modify src/components/CardNode.tsx — inside the component
const updateDefinition = useCardsStore(s => s.updateDefinition)
const [definitionShown, setDefinitionShown] = useState(false)
const [flipped, setFlipped] = useState(false)
```

```tsx
// modify src/components/CardNode.tsx — footer JSX, placed inside the outer card div, after the title/definition area
<div className="card-footer" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
  {card.definition ? (
    <button
      aria-label={definitionShown ? 'Masquer la définition' : 'Afficher la définition'}
      onClick={() => setDefinitionShown(v => !v)}
    >
      👁
    </button>
  ) : (
    <button aria-label="Ajouter une définition" onClick={() => updateDefinition(card.id, '')}>
      👁+
    </button>
  )}

  <button aria-label="Retourner" onClick={() => setFlipped(v => !v)}>
    ⟲
  </button>
</div>

{definitionShown && card.definition && <p>{card.definition}</p>}
```

```tsx
// modify src/components/CardNode.tsx — wrap the outer card content in a motion.div carrying the flip,
// and move data-testid/data-flipped onto it (replacing the plain outer <div>)
<motion.div
  data-testid={`card-${card.id}`}
  data-flipped={flipped}
  className="card-node"
  animate={{ rotateY: flipped ? 180 : 0 }}
  transition={{ duration: 0.4 }}
  style={{
    background: toCss(colors.bg),
    borderColor: toCss(colors.border),
    color: toCss(colors.text),
    border: '2px solid',
    borderRadius: 8,
    padding: 12,
    minWidth: 180,
    position: 'relative',
  }}
>
  {/* ...existing children unchanged... */}
</motion.div>
```

- [ ] **Step 4: Run to verify all CardNode tests pass**

```bash
bun run test src/components/CardNode.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/CardNode.tsx src/components/CardNode.test.tsx
git commit -m "feat: add CardNode footer with definition toggle and reusable flip animation"
```

---

### Task 20: Global undo/redo keyboard shortcuts

**Files:**
- Create: `src/hooks/useUndoRedoShortcuts.ts`
- Create: `src/hooks/useUndoRedoShortcuts.test.ts`

**Interfaces:**
- Consumes: `useCardsStore` actions `undo`, `redo` (Task 11)
- Produces: `useUndoRedoShortcuts(): void` — a hook that wires `Ctrl+Z` / `Ctrl+Shift+Z` (and `Ctrl+Y`) to the store, consumed by Task 21 (App)

- [ ] **Step 1: Write the failing tests**

```ts
// src/hooks/useUndoRedoShortcuts.test.ts
import { renderHook } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { useUndoRedoShortcuts } from './useUndoRedoShortcuts'
import { useCardsStore } from '../state/useCardsStore'

describe('useUndoRedoShortcuts', () => {
  beforeEach(() => {
    const rootId = useCardsStore.getState().history.present[0].id
    useCardsStore.getState().loadCards(useCardsStore.getState().history.present)
    useCardsStore.getState().addChild(rootId)
  })

  it('undoes on Ctrl+Z', async () => {
    const user = userEvent.setup()
    renderHook(() => useUndoRedoShortcuts())
    expect(useCardsStore.getState().history.present).toHaveLength(2)

    await user.keyboard('{Control>}z{/Control}')
    expect(useCardsStore.getState().history.present).toHaveLength(1)
  })

  it('redoes on Ctrl+Shift+Z', async () => {
    const user = userEvent.setup()
    renderHook(() => useUndoRedoShortcuts())

    await user.keyboard('{Control>}z{/Control}')
    expect(useCardsStore.getState().history.present).toHaveLength(1)

    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(useCardsStore.getState().history.present).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/hooks/useUndoRedoShortcuts.test.ts
```

Expected: FAIL — the hook does not exist yet.

- [ ] **Step 3: Implement it**

```ts
// src/hooks/useUndoRedoShortcuts.ts
import { useEffect } from 'react'
import { useCardsStore } from '../state/useCardsStore'

export function useUndoRedoShortcuts(): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isUndoCombo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey
      const isRedoCombo =
        (event.ctrlKey || event.metaKey) &&
        ((event.key.toLowerCase() === 'z' && event.shiftKey) || event.key.toLowerCase() === 'y')

      if (isRedoCombo) {
        event.preventDefault()
        useCardsStore.getState().redo()
      } else if (isUndoCombo) {
        event.preventDefault()
        useCardsStore.getState().undo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun run test src/hooks/useUndoRedoShortcuts.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useUndoRedoShortcuts.ts src/hooks/useUndoRedoShortcuts.test.ts
git commit -m "feat: add global Ctrl+Z / Ctrl+Shift+Z undo-redo keyboard shortcuts"
```

---

### Task 21: Auto-focus new cards + final App wiring

**Files:**
- Modify: `src/components/MindMapCanvas.tsx` (fit view to a newly created node)
- Modify: `src/components/MindMapCanvas.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: everything built in Tasks 1-20
- Produces: a working end-to-end app — the deliverable of this entire plan

- [ ] **Step 1: Write the failing auto-focus test**

```tsx
// append to src/components/MindMapCanvas.test.tsx
import userEvent from '@testing-library/user-event'

describe('MindMapCanvas auto-focus', () => {
  it('centers the view on a newly created card', async () => {
    const user = userEvent.setup()
    useCardsStore.getState().loadCards([root])
    render(<MindMapCanvas />)

    await user.click(screen.getByRole('button', { name: /ajouter un enfant/i }))

    const newCard = useCardsStore
      .getState()
      .history.present.find(c => c.parentId === root.id)!
    expect(screen.getByTestId(`card-${newCard.id}`)).toBeInTheDocument()
  })
})
```

This test intentionally only asserts the new card renders (jsdom cannot meaningfully assert real viewport centering/animation) — the actual pan-to-new-card behavior is verified manually in Step 5.

- [ ] **Step 2: Run to verify it fails**

```bash
bun run test src/components/MindMapCanvas.test.tsx
```

Expected: FAIL if the new card isn't found (guards against a broken store wiring) — if it already passes, proceed straight to Step 3's implementation since the auto-focus behavior itself isn't asserted here.

- [ ] **Step 3: Track the most recently created card and fit the view to it**

```tsx
// modify src/components/MindMapCanvas.tsx
import { useEffect, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
```

```tsx
// modify src/components/MindMapCanvas.tsx — inside MindMapCanvasInner
const { setCenter } = useReactFlow()
const previousIds = useRef(new Set(cards.map(c => c.id)))

useEffect(() => {
  const currentIds = new Set(cards.map(c => c.id))
  const createdId = cards.map(c => c.id).find(id => !previousIds.current.has(id))
  if (createdId) {
    const position = layout[createdId]
    setCenter(position.x + 90, position.y + 40, { zoom: 1, duration: 400 })
  }
  previousIds.current = currentIds
}, [cards, layout, setCenter])
```

- [ ] **Step 4: Run to verify the test suite passes**

```bash
bun run test
```

Expected: PASS — full test suite green.

- [ ] **Step 5: Wire the App shell and verify manually**

```tsx
// src/App.tsx
import { useEffect } from 'react'
import { MindMapCanvas } from './components/MindMapCanvas'
import { LockToggle } from './components/LockToggle'
import { useCardsStore } from './state/useCardsStore'
import { useAutosave } from './persistence/useAutosave'
import { loadMindMap } from './persistence/fileStore'
import { useUndoRedoShortcuts } from './hooks/useUndoRedoShortcuts'

const DEMO_FILE_PATH = 'demo-chapitre.mmap.json'

function App() {
  const cards = useCardsStore(s => s.history.present)
  const loadCards = useCardsStore(s => s.loadCards)
  useUndoRedoShortcuts()
  useAutosave(DEMO_FILE_PATH, cards)

  useEffect(() => {
    loadMindMap(DEMO_FILE_PATH)
      .then(loadCards)
      .catch(() => {
        // No existing file yet — keep the default single-root card from the store.
      })
  }, [loadCards])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ padding: 8 }}>
        <LockToggle />
      </header>
      <main style={{ flex: 1 }}>
        <MindMapCanvas />
      </main>
    </div>
  )
}

export default App
```

Run the app and manually verify the full flow end to end:

```bash
bun run tauri dev
```

Manual checklist:
1. A red root card appears, titled "Nouveau chapitre".
2. Click it, type a new title, press Enter — it updates.
3. Click `->` — an orange child appears and the view centers on it.
4. Click `+` on that child — a sibling appears at the same level.
5. Click the drag handle and move a card — it snaps to the new vertical slot among siblings.
6. Click "Verrouiller" — drag handles on every card grey out and dragging stops working.
7. Delete a childless card — it disappears immediately. Delete a card with children — a confirmation dialog appears first.
8. Press Ctrl+Z after any of the above — it undoes. Ctrl+Shift+Z redoes.
9. Add a definition via the footer icon, toggle it shown/hidden.
10. Click the flip icon — the card visually flips.
11. Close and reopen the app (`bun run tauri dev` again) — the tree you built is still there (autosave/reload worked).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/MindMapCanvas.tsx src/components/MindMapCanvas.test.tsx
git commit -m "feat: wire auto-focus on new cards and assemble the full editor app shell"
```
