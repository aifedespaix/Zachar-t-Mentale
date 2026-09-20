# Recherche de cartes & capture rapide — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-map card search (title + definition, current file only) reachable through a contextual Ctrl+F, and fix the two friction points on the existing `card.addFloating` quick-capture shortcut.

**Architecture:** A pure ranking module (`src/search/textSearch.ts`) is shared by the existing command palette and a new `scoreCard` function. A new `CardSearchBar` component (props-only, no store reads of its own) renders as a bottom-docked panel in `MindMapCanvas.tsx`, mirroring the existing `viewport-dock` pattern. Three command-catalogue entries replace the single `view.findInTree` binding: `view.findInTree` and `view.findInCards` keep no default key (palette-only, like `sync.now`), and a new `app.find` command owns `Mod+F`, dispatching to whichever of the two makes sense via a pure, independently-tested function (`resolveFindTarget`) that reads `document.activeElement`.

**Tech Stack:** React, TypeScript, Zustand, `@xyflow/react` (`Panel`), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-20-recherche-cartes-et-capture-rapide-design.md`

## Global Constraints

- Search is scoped to the currently open mind map only — no cross-file search.
- Fields searched: `card.title` and `card.definition` only, never raw `content` blocks.
- Floating (`detached: true`) cards are included in search results.
- No new command may run in a text field unless it explicitly needs to (`allowInEditable`) — the keyboard gate in `useGlobalShortcuts.ts` blocks everything else by default.
- No new index or persistence: filtering re-runs over the in-memory `cards` array on every keystroke, no debounce.
- French labels/descriptions throughout `commands.ts`, matching the existing catalogue's tone (imperative labels, one-sentence descriptions).

---

### Task 1: Shared text-matching module

**Files:**
- Create: `src/search/textSearch.ts`
- Test: `src/search/textSearch.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no project imports).
- Produces: `fold(text: string): string`, `matchScore(haystack: string, query: string): number | null`, `rankedScore(primary: string, secondary: string, query: string): number | null` — consumed by Task 2 (`CommandPalette.tsx`) and Task 3 (`scoreCard.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// src/search/textSearch.test.ts
import { describe, it, expect } from 'vitest'
import { fold, matchScore, rankedScore } from './textSearch'

describe('fold', () => {
  it('strips accents and lower-cases', () => {
    expect(fold('Créer une Carte')).toBe('creer une carte')
  })
})

describe('matchScore', () => {
  it('returns 0 for an empty query regardless of haystack', () => {
    expect(matchScore('Anything', '')).toBe(0)
  })

  it('returns the match index, accent- and case-insensitive', () => {
    expect(matchScore('Les acides et les bases', 'BASES')).toBe(19)
  })

  it('returns null when the query is not found', () => {
    expect(matchScore('Les acides', 'xyzzy')).toBeNull()
  })
})

describe('rankedScore', () => {
  it('scores an empty query as 0', () => {
    expect(rankedScore('Renommer', 'Renomme le fichier', '')).toBe(0)
  })

  it('scores a primary hit at position 0 as 0', () => {
    expect(rankedScore('Renommer', 'description', 'Renom')).toBe(0)
  })

  it('scores a later primary hit above a position-0 hit', () => {
    const early = rankedScore('Renommer', '', 'ren')
    const late = rankedScore('Ouvrir la fiche', '', 'fiche')
    expect(early).toBeLessThan(late!)
  })

  it('scores a secondary-only hit as 100', () => {
    expect(rankedScore('Renommer', 'Renomme le fichier ouvert', 'fichier')).toBe(100)
  })

  it('returns null when neither field matches', () => {
    expect(rankedScore('Renommer', 'Renomme le fichier', 'xyzzy')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/search/textSearch.test.ts`
Expected: FAIL — `Cannot find module './textSearch'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/search/textSearch.ts

/**
 * Strips accents and case, so « Créer » is found by typing "creer". Shared by
 * the command palette and the card search, so the two rank query text the
 * same way.
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** The position of `query` inside `haystack`, folded — or `null` if absent. An empty query always matches at 0. */
export function matchScore(haystack: string, query: string): number | null {
  if (query === '') return 0
  const index = fold(haystack).indexOf(fold(query))
  return index === -1 ? null : index
}

/**
 * Ranks a candidate against a query using a primary field (title, label) and a
 * secondary one (definition, description): a hit at the very start of
 * `primary` wins outright, an earlier hit elsewhere in `primary` beats a
 * later one, and a hit confined to `secondary` still counts, but behind every
 * hit in `primary`.
 */
export function rankedScore(primary: string, secondary: string, query: string): number | null {
  const primaryScore = matchScore(primary, query)
  if (primaryScore === 0) return 0
  if (primaryScore !== null) return 1 + primaryScore / 100
  const secondaryScore = matchScore(secondary, query)
  return secondaryScore === null ? null : 100
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/search/textSearch.test.ts`
Expected: PASS (all 8 assertions)

- [ ] **Step 5: Commit**

```bash
git add src/search/textSearch.ts src/search/textSearch.test.ts
git commit -m "feat(search): add shared fold/matchScore/rankedScore module"
```

---

### Task 2: Migrate the command palette onto the shared module

**Files:**
- Modify: `src/components/commands/CommandPalette.tsx`

**Interfaces:**
- Consumes: `fold`, `rankedScore` from `src/search/textSearch.ts` (Task 1).
- Produces: `scoreCommand(command: CommandDefinition, query: string): number | null` — unchanged signature and behavior, still exported from `CommandPalette.tsx` (existing consumer: `src/components/commands/CommandPalette.test.tsx`).

- [ ] **Step 1: Run the existing test to confirm current behavior**

Run: `bun run test src/components/commands/CommandPalette.test.tsx`
Expected: PASS (this is the non-regression baseline — no new test is written for this task, since the public behavior of `scoreCommand` must not change)

- [ ] **Step 2: Replace the local `fold`/`scoreCommand` body**

```ts
// src/components/commands/CommandPalette.tsx
// Remove the local `fold` function entirely, and its call sites in `scoreCommand`.
import { rankedScore } from '../../search/textSearch'

export function scoreCommand(command: CommandDefinition, query: string): number | null {
  return rankedScore(command.label, `${command.description} ${CATEGORY_LABELS[command.category]}`, query)
}
```

Remove the now-unused local `fold` function and its docstring from this file entirely.

- [ ] **Step 3: Run the test to verify it still passes**

Run: `bun run test src/components/commands/CommandPalette.test.tsx`
Expected: PASS — identical results, now computed through the shared module

- [ ] **Step 4: Commit**

```bash
git add src/components/commands/CommandPalette.tsx
git commit -m "refactor(search): route the command palette's ranking through textSearch"
```

---

### Task 3: Card scoring

**Files:**
- Create: `src/search/scoreCard.ts`
- Test: `src/search/scoreCard.test.ts`

**Interfaces:**
- Consumes: `rankedScore` from `src/search/textSearch.ts` (Task 1); `Card` from `src/types/card.ts`.
- Produces: `scoreCard(card: Card, query: string): number | null` — consumed by Task 7 (`CardSearchBar.tsx`).

- [ ] **Step 1: Write the failing test**

```ts
// src/search/scoreCard.test.ts
import { describe, it, expect } from 'vitest'
import { scoreCard } from './scoreCard'
import type { Card } from '../types/card'

const acide: Card = {
  id: 'acide',
  level: 2,
  title: 'Les acides',
  definition: 'Une substance dont le pH est inférieur à 7.',
  parentId: 'root',
  order: 0,
}

const flottante: Card = {
  id: 'flottante',
  level: 2,
  title: '',
  detached: true,
  parentId: null,
  order: 0,
}

describe('scoreCard', () => {
  it('ranks a title hit before a definition-only hit', () => {
    const titleHit = scoreCard(acide, 'acide')
    const defHit = scoreCard(acide, 'substance')
    expect(titleHit).not.toBeNull()
    expect(defHit).not.toBeNull()
    expect(titleHit!).toBeLessThan(defHit!)
  })

  it('matches inside the definition when the title does not match', () => {
    expect(scoreCard(acide, 'inférieur')).not.toBeNull()
  })

  it('includes floating (detached) cards in scoring', () => {
    const noted: Card = { ...flottante, title: 'Exercice 3 corrigé' }
    expect(scoreCard(noted, 'exercice')).not.toBeNull()
  })

  it('only an empty query matches a card with no text', () => {
    expect(scoreCard(flottante, '')).toBe(0)
    expect(scoreCard(flottante, 'quoi')).toBeNull()
  })

  it('returns null when the query matches neither field', () => {
    expect(scoreCard(acide, 'xyzzy')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/search/scoreCard.test.ts`
Expected: FAIL — `Cannot find module './scoreCard'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/search/scoreCard.ts
import { rankedScore } from './textSearch'
import type { Card } from '../types/card'

/**
 * Ranks a card against a search query: a title hit outranks a definition-only
 * hit, and an earlier hit outranks a later one — same principle as
 * `scoreCommand`, applied to card content instead of the command catalogue.
 */
export function scoreCard(card: Card, query: string): number | null {
  return rankedScore(card.title, card.definition ?? '', query)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/search/scoreCard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/search/scoreCard.ts src/search/scoreCard.test.ts
git commit -m "feat(search): add scoreCard for ranking cards against a query"
```

---

### Task 4: Contextual Ctrl+F dispatch logic

**Files:**
- Create: `src/search/findDispatch.ts`
- Test: `src/search/findDispatch.test.ts`

**Interfaces:**
- Consumes: nothing project-specific (reads a DOM `Element`).
- Produces: `type FindTarget = 'view.findInTree' | 'view.findInCards'`, `resolveFindTarget(activeElement: Element | null, quizActive: boolean): FindTarget` — consumed by Task 10 (`App.tsx`).

- [ ] **Step 1: Write the failing test**

```ts
// src/search/findDispatch.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { resolveFindTarget } from './findDispatch'

function elementWith(attrs: Record<string, string>): HTMLElement {
  const el = document.createElement('input')
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('resolveFindTarget', () => {
  it('routes to card search when focus is in the tree search field', () => {
    const el = elementWith({ 'data-search-zone': 'tree' })
    expect(resolveFindTarget(el, false)).toBe('view.findInCards')
  })

  it('routes to tree search when focus is in the card search field', () => {
    const el = elementWith({ 'data-search-zone': 'cards' })
    expect(resolveFindTarget(el, false)).toBe('view.findInTree')
  })

  it('routes to tree search when focus is elsewhere in the sidebar', () => {
    const zone = document.createElement('div')
    zone.setAttribute('data-focus-zone', 'sidebar')
    const button = document.createElement('button')
    zone.appendChild(button)
    document.body.appendChild(zone)
    expect(resolveFindTarget(button, false)).toBe('view.findInTree')
  })

  it('routes to card search when focus is elsewhere and no quiz is active', () => {
    expect(resolveFindTarget(document.body, false)).toBe('view.findInCards')
  })

  it('falls back to tree search when focus is elsewhere during a quiz', () => {
    expect(resolveFindTarget(document.body, true)).toBe('view.findInTree')
  })

  it('treats a null active element like the canvas', () => {
    expect(resolveFindTarget(null, false)).toBe('view.findInCards')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/search/findDispatch.test.ts`
Expected: FAIL — `Cannot find module './findDispatch'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/search/findDispatch.ts

export type FindTarget = 'view.findInTree' | 'view.findInCards'

/**
 * Which search zone Ctrl+F should route to, given where focus currently is.
 * A focused search field routes to the OTHER zone — that's what lets repeated
 * presses toggle between the two, with no extra state to track beyond
 * `document.activeElement` itself.
 */
export function resolveFindTarget(activeElement: Element | null, quizActive: boolean): FindTarget {
  const zone = activeElement instanceof HTMLElement ? activeElement.getAttribute('data-search-zone') : null
  if (zone === 'tree') return 'view.findInCards'
  if (zone === 'cards') return 'view.findInTree'

  const inSidebar =
    activeElement instanceof HTMLElement && activeElement.closest('[data-focus-zone="sidebar"]') !== null
  if (inSidebar) return 'view.findInTree'

  return quizActive ? 'view.findInTree' : 'view.findInCards'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/search/findDispatch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/search/findDispatch.ts src/search/findDispatch.test.ts
git commit -m "feat(search): add pure Ctrl+F zone-dispatch logic"
```

---

### Task 5: Command catalogue changes

**Files:**
- Modify: `src/types/commands.ts:404-410` (`view.findInTree`), and the "Application" section around `src/types/commands.ts:456-471` (add `app.find`); add `view.findInCards` immediately after `view.findInTree`
- Test: `src/types/commands.test.ts` (new file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `commandById('view.findInCards')`, `commandById('app.find')` — consumed by Task 7 (`CardSearchBar.tsx` registers `view.findInCards`) and Task 10 (`App.tsx` registers `app.find`).

- [ ] **Step 1: Write the failing test**

```ts
// src/types/commands.test.ts
import { describe, it, expect } from 'vitest'
import { commandById } from './commands'

describe('command catalogue — recherche', () => {
  it('view.findInTree no longer has a default binding', () => {
    expect(commandById('view.findInTree')?.defaultBinding).toBeNull()
  })

  it('view.findInCards exists, view-category, no default binding', () => {
    const command = commandById('view.findInCards')
    expect(command?.category).toBe('view')
    expect(command?.defaultBinding).toBeNull()
  })

  it('app.find owns Mod+F, works while typing and during a quiz', () => {
    const command = commandById('app.find')
    expect(command?.category).toBe('app')
    expect(command?.defaultBinding).toBe('Mod+F')
    expect(command?.allowInEditable).toBe(true)
    expect(command?.allowInQuiz).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/types/commands.test.ts`
Expected: FAIL — `view.findInTree` still has `defaultBinding: 'Mod+F'`, `view.findInCards`/`app.find` are `undefined`

- [ ] **Step 3: Edit the catalogue**

Change `view.findInTree` (`src/types/commands.ts:404-410`):

```ts
  {
    id: 'view.findInTree',
    label: 'Rechercher dans l’arborescence',
    description: 'Filtre les cartes et les dossiers par nom, et place le curseur dans le champ de recherche.',
    category: 'view',
    defaultBinding: null,
  },
  {
    id: 'view.findInCards',
    label: 'Rechercher dans les cartes',
    description:
      'Cherche une carte par son titre ou sa définition dans la carte mentale ouverte, et place le curseur dans le champ de recherche.',
    category: 'view',
    defaultBinding: null,
  },
```

Add, right after `app.quiz` (`src/types/commands.ts:466-471`, before `sync.publish`):

```ts
  {
    id: 'app.find',
    label: 'Rechercher',
    description:
      'Cherche dans l’arborescence ou dans les cartes selon l’endroit où tu es — un second appui bascule vers l’autre.',
    category: 'app',
    defaultBinding: 'Mod+F',
    allowInEditable: true,
    allowInQuiz: true,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/types/commands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/commands.ts src/types/commands.test.ts
git commit -m "feat(commands): split Ctrl+F into a contextual app.find dispatcher"
```

---

### Task 6: Rebind `card.addFloating` to `N`

**Files:**
- Modify: `src/types/commands.ts:254-261`
- Modify: `src/components/MindMapCanvas.shortcuts.test.tsx:187,204,212`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new (same command id, new default key).

- [ ] **Step 1: Update the failing assertions first**

In `src/components/MindMapCanvas.shortcuts.test.tsx`, change the three `key: 'Insert'` occurrences to `key: 'n'`:

Line 187 (inside `'refuses every editing shortcut on a map that belongs to someone else'`):
```ts
    pressOnCanvas(container, { key: 'n' })
```

Line 204 (inside `'creates a floating card, which needs no selection at all'`):
```ts
    pressOnCanvas(container, { key: 'n' })
```

Line 212 (inside `'follows a rebinding made in the settings'`, this is the OLD-default-does-nothing assertion — keep the surrounding logic, only change the key):
```ts
    pressOnCanvas(container, { key: 'n' })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test src/components/MindMapCanvas.shortcuts.test.tsx`
Expected: FAIL on the three edited assertions — `'n'` does not yet resolve to `card.addFloating` (still bound to `Insert`)

- [ ] **Step 3: Rebind the command**

```ts
// src/types/commands.ts:254-261
  {
    id: 'card.addFloating',
    label: 'Créer une carte volante',
    description: 'Ajoute une carte libre, hors de la hiérarchie, dans la zone des cartes volantes.',
    category: 'card',
    defaultBinding: 'N',
    scope: 'canvas',
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test src/components/MindMapCanvas.shortcuts.test.tsx`
Expected: PASS — all tests in the file, including the three edited ones and the untouched ones (`Tab`/`Delete`/`Mod+Shift+K` rebinding)

- [ ] **Step 5: Commit**

```bash
git add src/types/commands.ts src/components/MindMapCanvas.shortcuts.test.tsx
git commit -m "fix(shortcuts): rebind card.addFloating from Insert to N"
```

---

### Task 7: `CardSearchBar` component

**Files:**
- Create: `src/components/search/CardSearchBar.tsx`
- Test: `src/components/search/CardSearchBar.test.tsx`
- Modify: `src/index.css` (append new rules after the `.viewport-dock__minimap` block, around line 469)

**Interfaces:**
- Consumes: `scoreCard` (Task 3); `useCommand` from `src/hooks/useCommand.ts` (`useCommand(id, run): void`); `toCss` from `src/colors/contrast.ts`; `detachedColors` from `src/colors/levelColors.ts`; `Card`, `CardLevel` from `src/types/card.ts`; `LevelAppearance` from `src/types/appearanceSettings.ts`.
- Produces: `CardSearchBarProps { cards: Card[]; theme: 'light' | 'dark'; levelAppearance: Record<CardLevel, LevelAppearance>; onSelectResult: (cardId: string) => void; onOpenFiche: (cardId: string) => void }`, component `CardSearchBar(props: CardSearchBarProps)` — consumed by Task 8 (`MindMapCanvas.tsx`). Registers command `view.findInCards` itself (only while mounted).

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/search/CardSearchBar.test.tsx
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CardSearchBar } from './CardSearchBar'
import { useCommandRegistry } from '../../state/useCommandRegistry'
import { runCommand } from '../../hooks/useCommand'
import { DEFAULT_APPEARANCE_SETTINGS } from '../../types/appearanceSettings'
import type { Card } from '../../types/card'

const root: Card = { id: 'root', level: 1, title: 'Chimie', parentId: null, order: 0 }
const acides: Card = {
  id: 'acides',
  level: 2,
  title: 'Les acides',
  definition: 'Un acide a un pH inférieur à 7.',
  parentId: 'root',
  order: 0,
}
const flottante: Card = { id: 'flottante', level: 2, title: 'Exercice 3', detached: true, parentId: null, order: 0 }

const CARDS = [root, acides, flottante]

function renderBar(overrides: Partial<Parameters<typeof CardSearchBar>[0]> = {}) {
  const onSelectResult = vi.fn()
  const onOpenFiche = vi.fn()
  render(
    <CardSearchBar
      cards={CARDS}
      theme="light"
      levelAppearance={DEFAULT_APPEARANCE_SETTINGS.levels}
      onSelectResult={onSelectResult}
      onOpenFiche={onOpenFiche}
      {...overrides}
    />
  )
  return { onSelectResult, onOpenFiche }
}

describe('CardSearchBar', () => {
  beforeEach(() => {
    useCommandRegistry.setState({ registrations: {} })
  })

  it('shows no results while the query is empty', () => {
    renderBar()
    expect(screen.queryByTestId('card-search-results')).not.toBeInTheDocument()
  })

  it('lists matching cards, including floating ones, sorted by relevance', async () => {
    const user = userEvent.setup()
    renderBar()
    await user.type(screen.getByLabelText(/rechercher une carte/i), 'exercice')
    const results = screen.getAllByTestId('card-search-result')
    expect(results).toHaveLength(1)
    expect(results[0]).toHaveTextContent('Exercice 3')
  })

  it('shows an empty-results message when nothing matches', async () => {
    const user = userEvent.setup()
    renderBar()
    await user.type(screen.getByLabelText(/rechercher une carte/i), 'xyzzy')
    expect(screen.getByTestId('card-search-empty')).toBeInTheDocument()
  })

  it('selecting a result calls onSelectResult with its id, and keeps the bar open', async () => {
    const user = userEvent.setup()
    const { onSelectResult } = renderBar()
    await user.type(screen.getByLabelText(/rechercher une carte/i), 'acide')
    await user.click(screen.getByTestId('card-search-result'))
    expect(onSelectResult).toHaveBeenCalledWith('acides')
    expect(screen.getByLabelText(/rechercher une carte/i)).toBeInTheDocument()
  })

  it('the fiche button calls onOpenFiche with the card id', async () => {
    const user = userEvent.setup()
    const { onOpenFiche } = renderBar()
    await user.type(screen.getByLabelText(/rechercher une carte/i), 'acide')
    await user.click(screen.getByLabelText(/ouvrir la fiche/i))
    expect(onOpenFiche).toHaveBeenCalledWith('acides')
  })

  it('Escape clears the query and blurs the field', async () => {
    const user = userEvent.setup()
    renderBar()
    const input = screen.getByLabelText(/rechercher une carte/i)
    await user.type(input, 'acide')
    await user.keyboard('{Escape}')
    expect(input).toHaveValue('')
    expect(input).not.toHaveFocus()
  })

  it('registers view.findInCards, which focuses the field', () => {
    renderBar()
    const input = screen.getByLabelText(/rechercher une carte/i) as HTMLInputElement
    act(() => {
      runCommand('view.findInCards')
    })
    expect(input).toHaveFocus()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test src/components/search/CardSearchBar.test.tsx`
Expected: FAIL — `Cannot find module './CardSearchBar'`

- [ ] **Step 3: Write the CSS**

Append to `src/index.css`, right after the `.viewport-dock__minimap .react-flow__minimap-node` rule (around line 469):

```css

/*
 * The card search sits at the bottom-CENTER of the canvas — the dock at
 * bottom-right already owns zoom/navigation/minimap, and a bar spanning the
 * middle reads as its own, independent tool rather than a fourth widget
 * crammed into that corner. Semi-transparent at rest, same `color-mix` trick
 * as the minimap's mask, so it reads as an overlay rather than a panel that
 * permanently eats canvas space.
 */
.card-search-panel {
  pointer-events: none;
}
.card-search-dock {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 320px;
  pointer-events: auto;
}
.card-search-dock--expanded {
  width: 420px;
}
.card-search-dock__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in oklch, var(--card), transparent 25%);
  box-shadow: 0 6px 16px -8px oklch(0 0 0 / 45%);
  color: var(--muted-foreground);
}
.card-search-dock__input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font-size: 13px;
}
.card-search-dock__results {
  list-style: none;
  margin: 6px 0 0;
  padding: 4px;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--card);
  box-shadow: 0 6px 16px -8px oklch(0 0 0 / 45%);
}
.card-search-dock__empty {
  padding: 10px 8px;
  font-size: 12.5px;
  color: var(--muted-foreground);
}
.card-search-dock__result {
  display: flex;
  align-items: center;
  gap: 6px;
}
.card-search-dock__result-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.card-search-dock__result-main:hover {
  background: var(--muted);
}
.card-search-dock__pastille {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  border: 1px solid;
}
.card-search-dock__result-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.card-search-dock__breadcrumb {
  font-size: 11px;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-search-dock__title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-search-dock__snippet {
  font-size: 11.5px;
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-search-dock__fiche {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
}
.card-search-dock__fiche:hover {
  background: var(--muted);
  color: inherit;
}
```

- [ ] **Step 4: Write the component**

```tsx
// src/components/search/CardSearchBar.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, FileText } from 'lucide-react'
import { useCommand } from '../../hooks/useCommand'
import { scoreCard } from '../../search/scoreCard'
import { toCss } from '../../colors/contrast'
import { detachedColors } from '../../colors/levelColors'
import type { Card, CardLevel } from '../../types/card'
import type { LevelAppearance } from '../../types/appearanceSettings'

export interface CardSearchBarProps {
  cards: Card[]
  theme: 'light' | 'dark'
  levelAppearance: Record<CardLevel, LevelAppearance>
  /** Focuses and selects the card in the canvas; the bar stays open. */
  onSelectResult: (cardId: string) => void
  /** Same as `onSelectResult`, and also opens the card's detail panel. */
  onOpenFiche: (cardId: string) => void
}

interface Result {
  card: Card
  score: number
  breadcrumb: string[]
}

const SNIPPET_MAX_LENGTH = 80

function truncate(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed
}

/** Root-first chain of ancestor titles — empty for a root card or a floating one. */
function breadcrumbOf(card: Card, byId: Map<string, Card>): string[] {
  const trail: string[] = []
  let parentId = card.parentId
  while (parentId !== null) {
    const parent = byId.get(parentId)
    if (parent === undefined) break
    trail.unshift(parent.title)
    parentId = parent.parentId
  }
  return trail
}

/**
 * A bottom-docked, semi-transparent search bar for the cards of the open mind
 * map. Purely props-driven — the caller supplies the card list and the two
 * navigation actions — so it carries no dependency on React Flow or any
 * store beyond registering its own `view.findInCards` command.
 */
export function CardSearchBar({ cards, theme, levelAppearance, onSelectResult, onOpenFiche }: CardSearchBarProps) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [focusRequest, setFocusRequest] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useCommand('view.findInCards', () => setFocusRequest(request => request + 1))

  useEffect(() => {
    if (focusRequest === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusRequest])

  const expanded = focused || query !== ''

  const results: Result[] = useMemo(() => {
    if (query === '') return []
    const byId = new Map(cards.map(card => [card.id, card]))
    const scored: Result[] = []
    for (const card of cards) {
      const score = scoreCard(card, query)
      if (score !== null) scored.push({ card, score, breadcrumb: breadcrumbOf(card, byId) })
    }
    return scored.sort((a, b) => a.score - b.score)
  }, [cards, query])

  return (
    <div className={`card-search-dock${expanded ? ' card-search-dock--expanded' : ''}`}>
      <div className="card-search-dock__bar">
        <Search size={14} aria-hidden />
        <input
          ref={inputRef}
          data-search-zone="cards"
          className="card-search-dock__input"
          type="text"
          value={query}
          placeholder="Rechercher une carte…"
          aria-label="Rechercher une carte dans la carte mentale ouverte"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Escape') return
            setQuery('')
            event.currentTarget.blur()
          }}
        />
      </div>
      {query !== '' && (
        <ul className="card-search-dock__results" data-testid="card-search-results">
          {results.length === 0 && (
            <li className="card-search-dock__empty" data-testid="card-search-empty">
              Aucune carte ne correspond à « {query} ».
            </li>
          )}
          {results.map(({ card, breadcrumb }) => {
            const colors = card.detached ? detachedColors[theme] : levelAppearance[card.level].color[theme]
            const title = card.title !== '' ? card.title : '(sans titre)'
            return (
              <li key={card.id} className="card-search-dock__result" data-testid="card-search-result">
                <button
                  type="button"
                  className="card-search-dock__result-main"
                  onClick={() => onSelectResult(card.id)}
                >
                  <span
                    className="card-search-dock__pastille"
                    style={{ background: toCss(colors.bg), borderColor: toCss(colors.border) }}
                    aria-hidden
                  />
                  <span className="card-search-dock__result-text">
                    {breadcrumb.length > 0 && (
                      <span className="card-search-dock__breadcrumb">{breadcrumb.join(' › ')}</span>
                    )}
                    <span className="card-search-dock__title">{title}</span>
                    {card.definition && (
                      <span className="card-search-dock__snippet">{truncate(card.definition, SNIPPET_MAX_LENGTH)}</span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className="card-search-dock__fiche"
                  aria-label={`Ouvrir la fiche de ${title}`}
                  onClick={() => onOpenFiche(card.id)}
                >
                  <FileText size={14} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test src/components/search/CardSearchBar.test.tsx`
Expected: PASS (all 7 tests)

- [ ] **Step 6: Commit**

```bash
git add src/components/search/CardSearchBar.tsx src/components/search/CardSearchBar.test.tsx src/index.css
git commit -m "feat(search): add CardSearchBar component"
```

---

### Task 8: Mount `CardSearchBar` in the canvas

**Files:**
- Modify: `src/components/MindMapCanvas.tsx`

**Interfaces:**
- Consumes: `CardSearchBar` (Task 7); existing local values `cards`, `theme`, `levelAppearance`, `focusCard`, `selectCard`, `useCardDetailStore` (all already present in `MindMapCanvasInner`, see lines 333-344, 369-425).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing test**

```tsx
// Add to src/components/MindMapCanvas.test.tsx (append; do not remove existing tests)
it('hides the card search bar while a quiz is active, shows it otherwise', () => {
  const cards: Card[] = [{ id: 'root', level: 1, title: 'Racine', parentId: null, order: 0 }]
  useCardsStore.getState().loadCards(cards)

  const { rerender } = render(<MindMapCanvas />)
  expect(screen.getByLabelText(/rechercher une carte dans la carte mentale/i)).toBeInTheDocument()

  act(() => useQuizStore.setState({ active: true }))
  rerender(<MindMapCanvas />)
  expect(screen.queryByLabelText(/rechercher une carte dans la carte mentale/i)).not.toBeInTheDocument()
})
```

Check the top of `src/components/MindMapCanvas.test.tsx` first: if `useQuizStore` isn't already imported there, add `import { useQuizStore } from '../state/useQuizStore'` to its import block, and reset it in the file's existing `beforeEach` the same way `MindMapCanvas.shortcuts.test.tsx` does (`useQuizStore.setState(createQuizStore().getState())`) so this test does not leak `active: true` into later tests in the same file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/MindMapCanvas.test.tsx`
Expected: FAIL — no element with that accessible name exists yet

- [ ] **Step 3: Wire it in**

Add the import near the other component imports in `src/components/MindMapCanvas.tsx`:

```ts
import { CardSearchBar } from './search/CardSearchBar'
```

Add a `quizActive` read alongside the existing `quizQuestions`/`quizResults` reads (`src/components/MindMapCanvas.tsx:338-339`):

```ts
  const quizActive = useQuizStore(s => s.active)
```

Add a new `<Panel>` inside the `<ReactFlow>` tree, alongside the existing `bottom-right` one (`src/components/MindMapCanvas.tsx`, right before or after the `<Panel position="bottom-right" className="viewport-dock">` block around line 739):

```tsx
                {!quizActive && (
                  <Panel position="bottom-center" className="card-search-panel">
                    <CardSearchBar
                      cards={cards}
                      theme={theme}
                      levelAppearance={levelAppearance}
                      onSelectResult={cardId => {
                        focusCard(cardId)
                        selectCard(cardId)
                      }}
                      onOpenFiche={cardId => {
                        focusCard(cardId)
                        selectCard(cardId)
                        useCardDetailStore.getState().show(cardId)
                      }}
                    />
                  </Panel>
                )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/MindMapCanvas.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full canvas test suite to check for regressions**

Run: `bun run test src/components/MindMapCanvas`
Expected: PASS (this file, `MindMapCanvas.test.tsx`, `MindMapCanvas.shortcuts.test.tsx`, and any other `MindMapCanvas.*.test.tsx`)

- [ ] **Step 6: Commit**

```bash
git add src/components/MindMapCanvas.tsx src/components/MindMapCanvas.test.tsx
git commit -m "feat(search): mount CardSearchBar on the canvas, hidden during quizzes"
```

---

### Task 9: Sidebar focus-zone markers

**Files:**
- Modify: `src/components/sidebar/FileSidebar.tsx:517` (root container), `src/components/sidebar/FileSidebar.tsx:565-580` (search input)
- Test: `src/components/sidebar/FileSidebar.test.tsx` (append to existing file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `data-focus-zone="sidebar"` on the sidebar's root container, `data-search-zone="tree"` on its search `<input>` — both consumed by Task 4's `resolveFindTarget` (already written and tested against these exact attribute names) via Task 10's wiring.

- [ ] **Step 1: Write the failing test**

First check `src/components/sidebar/FileSidebar.test.tsx` for its existing render helper and import list, then append:

```tsx
it('marks its root container as the sidebar focus zone, and its search field as the tree search zone', () => {
  renderSidebar() // use whatever the file's existing helper is named/shaped
  expect(screen.getByTestId('file-sidebar')).toHaveAttribute('data-focus-zone', 'sidebar')
  expect(screen.getByLabelText('Rechercher une carte ou un dossier')).toHaveAttribute('data-search-zone', 'tree')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/sidebar/FileSidebar.test.tsx`
Expected: FAIL — neither attribute exists yet

- [ ] **Step 3: Add the attributes**

On the root `<div>` at `src/components/sidebar/FileSidebar.tsx:516-517`:

```tsx
          <div
            data-testid="file-sidebar"
            data-focus-zone="sidebar"
            style={{
```

On the search `<input>` at `src/components/sidebar/FileSidebar.tsx:565-571`:

```tsx
                  <input
                    ref={searchInputRef}
                    data-search-zone="tree"
                    className="sidebar-search"
                    type="text"
                    value={search}
                    placeholder="Rechercher…"
                    aria-label="Rechercher une carte ou un dossier"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/sidebar/FileSidebar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/FileSidebar.tsx src/components/sidebar/FileSidebar.test.tsx
git commit -m "feat(search): mark sidebar and tree-search zones for Ctrl+F dispatch"
```

---

### Task 10: Wire `app.find` in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `resolveFindTarget` (Task 4); `useCommand`, `runCommand` from `src/hooks/useCommand.ts`; existing local `quizActive` (`src/App.tsx:99`).
- Produces: nothing new for later tasks (terminal wiring task).

- [ ] **Step 1: Write the failing test**

Append to `src/App.test.tsx` (reusing its existing mocks and `resetStores()` helper):

```tsx
it('Ctrl+F focuses the tree search field when nothing else has focus', async () => {
  const user = userEvent.setup()
  vi.mocked(scanFolder).mockResolvedValue([])
  useWorkspaceStore.setState({ rootFolders: [{ path: '/cours', name: 'cours', tree: [] }] })
  render(<App />)
  await settle()

  await user.keyboard('{Control>}f{/Control}')
  expect(screen.getByLabelText('Rechercher une carte ou un dossier')).toHaveFocus()
})
```

Check the existing mocks in `src/App.test.tsx` first — `rootFolders` shape must match whatever `useWorkspaceStore`'s type actually declares (see other tests in that file for the exact `RootFolder` shape already in use, and reuse it rather than inventing a new one).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/App.test.tsx -t "Ctrl+F"`
Expected: FAIL — `Mod+F` still runs the old direct `view.findInTree` binding path (none is currently registered as `app.find`), so nothing focuses

- [ ] **Step 3: Add the import and the command registration**

Add to the import block in `src/App.tsx` (near `useGlobalShortcuts`):

```ts
import { useCommand, runCommand } from './hooks/useCommand'
import { resolveFindTarget } from './search/findDispatch'
```

Add right after `useGlobalShortcuts()` (`src/App.tsx:117`):

```ts
  useCommand('app.find', () => runCommand(resolveFindTarget(document.activeElement, quizActive)))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/App.test.tsx -t "Ctrl+F"`
Expected: PASS

- [ ] **Step 5: Run the full App test suite to check for regressions**

Run: `bun run test src/App.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(search): dispatch Ctrl+F to tree or card search via app.find"
```

---

### Task 11: Toolbar button label for `card.addFloating`

**Files:**
- Modify: `src/components/toolbar/AppToolbar.tsx:371`
- Test: `src/components/toolbar/AppToolbar.test.tsx` (append to existing file)

**Interfaces:**
- Consumes: `CommandButton`'s existing `label`/`showLabel` props (`src/components/commands/CommandButton.tsx:57,60`) — no changes to `CommandButton` itself.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `src/components/toolbar/AppToolbar.test.tsx`, reusing its existing `renderToolbar()` helper:

```tsx
it('shows a visible text label on the floating-card button', () => {
  renderToolbar()
  expect(screen.getByRole('button', { name: 'Carte volante' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/toolbar/AppToolbar.test.tsx -t "Carte volante"`
Expected: FAIL — the button's accessible name is still "Créer une carte volante", with no visible label span

- [ ] **Step 3: Update the button**

```tsx
// src/components/toolbar/AppToolbar.tsx:371
<CommandButton command="card.addFloating" icon={PictureInPicture2} label="Carte volante" showLabel />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/toolbar/AppToolbar.test.tsx`
Expected: PASS (new test, plus the full existing file with no regressions)

- [ ] **Step 5: Commit**

```bash
git add src/components/toolbar/AppToolbar.tsx src/components/toolbar/AppToolbar.test.tsx
git commit -m "fix(toolbar): give the floating-card button a visible text label"
```

---

## Self-Review

**Spec coverage:**
- Décision 1 (recherche = carte ouverte uniquement) → `CardSearchBar` only ever receives the open map's `cards` prop (Task 8); no cross-file code path exists anywhere in this plan.
- Décision 2 (champs `title`+`definition`) → `scoreCard` (Task 3).
- Décision 3 (cartes volantes incluses) → tested explicitly in Task 3 and Task 7.
- Décision 4 (désactivé pendant un quiz) → Task 8 unmounts `CardSearchBar` entirely when `quizActive`; as a side effect `view.findInCards` is simply unregistered during a quiz, which already greys it out in the palette exactly as the spec's `enabled: !quizActive` requirement asks for, with no extra flag needed.
- Décision 5 (pas d'index, filtrage en mémoire) → `useMemo` over the raw `cards` array in `CardSearchBar`, Task 7.
- Recherche de cartes (algorithme, composant, tri, breadcrumb, clic, bouton fiche, Échap) → Tasks 1, 3, 7.
- Recherche contextuelle Ctrl+F (3 commandes, dispatch, palette-only invocation, toggle) → Tasks 4, 5, 10.
- Ajustements `card.addFloating` (rebind, non-régression) → Task 6.
- Ajustement bouton toolbar → Task 11.
- Cas limites (aucun résultat, sélection non affectée pendant la frappe, carte volante vide, sidebar repliée) → "aucun résultat" tested in Task 7; "sélection non affectée" is a structural consequence of `scope: 'canvas'` commands already gating on `isCanvasTarget`, no new code needed; "carte volante vide" tested in Task 3 (`scoreCard` empty-text case); "sidebar repliée" behavior is pre-existing and untouched by this plan (`view.findInTree`'s own handler in `FileSidebar.tsx:377-382` already calls `setCollapsed(false)`, and Task 10 reaches it exactly the same way the old direct binding did, through `runCommand`).

**Placeholder scan:** no TBD/TODO, no "add appropriate X", no "similar to Task N" without code — every step has concrete, complete code.

**Type consistency:** `scoreCard(card: Card, query: string): number | null` (Task 3) matches its only call site in `CardSearchBar.tsx` (Task 7). `resolveFindTarget(activeElement: Element | null, quizActive: boolean): FindTarget` (Task 4) matches its only call site in `App.tsx` (Task 10), and its two possible return values (`'view.findInTree'`, `'view.findInCards'`) are exactly the two command ids added/kept in Task 5. `CardSearchBarProps` (Task 7) fields (`cards`, `theme`, `levelAppearance`, `onSelectResult`, `onOpenFiche`) match exactly what Task 8 passes at the mount site. The `data-search-zone`/`data-focus-zone` attribute names and values are identical across Task 4 (test + implementation), Task 7 (`CardSearchBar`'s own input), and Task 9 (`FileSidebar`'s input and root container).

---

**Plan complete and saved to `docs/superpowers/plans/2026-09-20-recherche-cartes-et-capture-rapide.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
