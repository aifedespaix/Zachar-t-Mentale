# Import / Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PDF/image export (with automatic multi-page splitting for large trees) and XMind import/export to the file sidebar, without touching the interactive editor.

**Architecture:** A new `src/export/` module renders any card subset off-screen — reusing the exact same `computeLayout` the live canvas uses, so exported pages look identical to the app, never a bespoke print style — captures it to PNG (`html-to-image`), and assembles PNGs into a multi-page PDF (`jsPDF`). A pure, independently-testable pagination function decides which cards go on which page by walking the tree and splitting only when a branch's leaf count exceeds what fits on one A4 page, always keeping the branch's full root-to-leaf path together. A new `src/xmind/` module converts between `Card[]` and the XMind Zen (2021) `content.json` shape, zipped/unzipped with `jszip`; XMind depth beyond the app's strict 4 levels is folded into text inside the level-4 card's `definition` rather than detached, since a detached card would lose all hierarchical context. Both pipelines are wired into the file sidebar: an "Exporter" button per mind-map file opens a format dialog (PDF/Image/XMind), and an "Importer XMind" button per folder writes one `.json` file per XMind sheet into that folder.

**Tech Stack:** React 19 + TypeScript, `html-to-image` (new), `jspdf` (new), `jszip` (new), `@tauri-apps/plugin-fs` (binary read/write, new permissions), `@tauri-apps/plugin-dialog` (save/open with filters), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-07-import-export-design.md`

## Global Constraints

- Export always covers the whole open file — never a manually selected sub-branch (spec: "Hors périmètre"). The pagination algorithm is what handles a file too large for one page.
- "Afficher les définitions" is one global on/off toggle applied to the whole export — never per-card (spec: "Pagination").
- Cartes volantes (detached cards) are included only when the checkbox is checked, and always land on their own dedicated final page/section, never interleaved with the tree (spec: "Cartes volantes").
- XMind import/export targets the modern XMind Zen/2021 format (`content.json` inside the zip) only — never the legacy `content.xml` (spec: "XMind" → "Import").
- A card deeper than the app's strict 4 levels (only possible via XMind import) is folded into text inside its level-4 ancestor's `definition`, never turned into a detached "carte volante" — a detached copy would lose the hierarchical context that made it meaningful (spec: "Import").
- Any import/export failure (corrupt file, cancelled dialog handled separately as a no-op, disk write failure) surfaces through the sidebar's existing `setWorkspaceError` channel — no silent no-op, matching the app's "aucun état caché sans explication" principle already applied to file operations (lot 5 plan, Global Constraints).
- A cancelled native save/open dialog is not an error — it is a deliberate no-op, never routed through `setWorkspaceError`.
- New dependencies (`html-to-image`, `jspdf`, `jszip`) use whatever `bun add` resolves as latest stable, matching the project-wide convention set in lot 1.

---

## Task 1: Binary file permissions for the fs plugin

**Files:**
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Produces: `readFile`/`writeFile` (binary, `@tauri-apps/plugin-fs`) become permitted for the app's window — required by every later task that reads/writes a `.xmind`, `.pdf`, or `.png` file.
- Consumed by: Task 11 (`exportIO.ts`).

No unit tests — config-only, verified by a successful Rust compile.

- [ ] **Step 1: Add the binary read/write permissions**

Replace the full contents of `src-tauri/capabilities/default.json` with:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": [
    "main"
  ],
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default",
    "fs:default",
    "fs:allow-exists",
    "fs:allow-read-text-file",
    "fs:allow-write-text-file",
    "fs:allow-read-file",
    "fs:allow-write-file",
    "fs:allow-read-dir",
    "fs:allow-mkdir",
    "fs:allow-remove",
    "fs:allow-rename",
    {
      "identifier": "fs:scope",
      "allow": ["$HOME/**"]
    }
  ]
}
```

Only `fs:allow-read-file` and `fs:allow-write-file` (the binary variants) are new — everything else already existed for the file-navigation lot.

- [ ] **Step 2: Verify the Rust build**

Run: `cd src-tauri && cargo check`
Expected: compiles without error (no new Rust dependency — these permissions cover the already-registered `tauri-plugin-fs`).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/capabilities/default.json
git commit -m "feat: allow binary file read/write for import/export"
```

---

## Task 2: Export pagination algorithm

**Files:**
- Create: `src/export/pagination.ts`
- Create: `src/export/pagination.test.ts`

**Interfaces:**
- Consumes: `Card` (`../types/card`, already exists).
- Produces:
  - `PAGE_ROW_BUDGET: number`
  - `ExportPage { cards: Card[] }`
  - `paginateForExport(cards: Card[], options: { includeDetached: boolean }, rowBudget?: number): ExportPage[]`
- Consumed by: Task 4 (`ExportPageRenderer`, via `ExportPage`), Task 8 (`exportMindMap.ts`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/export/pagination.test.ts
import { describe, it, expect } from 'vitest'
import { paginateForExport } from './pagination'
import type { Card } from '../types/card'

describe('paginateForExport', () => {
  it('returns a single page when the whole tree fits the budget', () => {
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'R', parentId: null, order: 0 },
      { id: 'a', level: 2, title: 'A', parentId: 'root', order: 0 },
      { id: 'b', level: 2, title: 'B', parentId: 'root', order: 1 },
    ]
    const pages = paginateForExport(cards, { includeDetached: false }, 5)
    expect(pages).toHaveLength(1)
    expect(pages[0].cards.map(c => c.id).sort()).toEqual(['a', 'b', 'root'])
  })

  it('splits by branch when two branches together exceed the budget but each fits alone, repeating the root on every page', () => {
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'R', parentId: null, order: 0 },
      { id: 'a', level: 2, title: 'A', parentId: 'root', order: 0 },
      { id: 'a1', level: 3, title: 'A1', parentId: 'a', order: 0 },
      { id: 'a2', level: 3, title: 'A2', parentId: 'a', order: 1 },
      { id: 'b', level: 2, title: 'B', parentId: 'root', order: 1 },
      { id: 'b1', level: 3, title: 'B1', parentId: 'b', order: 0 },
      { id: 'b2', level: 3, title: 'B2', parentId: 'b', order: 1 },
    ]
    const pages = paginateForExport(cards, { includeDetached: false }, 2)
    expect(pages).toHaveLength(2)
    expect(pages[0].cards.map(c => c.id).sort()).toEqual(['a', 'a1', 'a2', 'root'])
    expect(pages[1].cards.map(c => c.id).sort()).toEqual(['b', 'b1', 'b2', 'root'])
  })

  it('batches a branch of many leaf children into several pages, each repeating the ancestor chain', () => {
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'R', parentId: null, order: 0 },
      { id: 'p', level: 2, title: 'P', parentId: 'root', order: 0 },
      { id: 'c1', level: 3, title: 'C1', parentId: 'p', order: 0 },
      { id: 'c2', level: 3, title: 'C2', parentId: 'p', order: 1 },
      { id: 'c3', level: 3, title: 'C3', parentId: 'p', order: 2 },
    ]
    const pages = paginateForExport(cards, { includeDetached: false }, 2)
    expect(pages).toHaveLength(2)
    expect(pages[0].cards.map(c => c.id)).toEqual(['root', 'p', 'c1', 'c2'])
    expect(pages[1].cards.map(c => c.id)).toEqual(['root', 'p', 'c3'])
  })

  it('appends a dedicated final page of detached cards only when includeDetached is true', () => {
    const cards: Card[] = [
      { id: 'root', level: 1, title: 'R', parentId: null, order: 0 },
      { id: 'f1', level: 2, title: 'F1', parentId: null, order: 0, detached: true },
    ]
    const withDetached = paginateForExport(cards, { includeDetached: true }, 5)
    expect(withDetached).toHaveLength(2)
    expect(withDetached[1].cards.map(c => c.id)).toEqual(['f1'])

    const withoutDetached = paginateForExport(cards, { includeDetached: false }, 5)
    expect(withoutDetached).toHaveLength(1)
  })

  it('returns no pages for a file with no root', () => {
    expect(paginateForExport([], { includeDetached: false })).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/export/pagination.test.ts`
Expected: FAIL — `src/export/pagination.ts` does not exist yet.

- [ ] **Step 3: Implement `pagination.ts`**

```ts
// src/export/pagination.ts
import type { Card } from '../types/card'

/**
 * How many leaf rows comfortably fit one A4 landscape page at a legible
 * print scale. A4 landscape usable height (297mm minus 2×15mm margins) is
 * ~267mm; at a print size that keeps cards readable on paper (roughly
 * matching the on-screen 168px `ROW_HEIGHT` scaled down for print), that is
 * about 6 rows.
 */
export const PAGE_ROW_BUDGET = 6

export interface ExportPage {
  cards: Card[]
}

function childrenOf(cards: Card[], parentId: string): Card[] {
  return cards.filter(c => c.parentId === parentId && !c.detached).sort((a, b) => a.order - b.order)
}

function leafCount(cards: Card[], cardId: string): number {
  const kids = childrenOf(cards, cardId)
  if (kids.length === 0) return 1
  return kids.reduce((sum, kid) => sum + leafCount(cards, kid.id), 0)
}

function subtreeIds(cards: Card[], cardId: string): string[] {
  const ids = [cardId]
  for (const kid of childrenOf(cards, cardId)) ids.push(...subtreeIds(cards, kid.id))
  return ids
}

/**
 * Ids of `nodeId` and everything under it that belongs on the same page,
 * grouped into as many pages as needed to keep every page within `budget`
 * leaf rows. `nodeId` heads every group this returns, so a caller one level
 * up can prepend ITS own id to each and build a full root-to-leaf chain by
 * induction.
 */
function splitSubtree(cards: Card[], nodeId: string, budget: number): string[][] {
  const kids = childrenOf(cards, nodeId)
  if (kids.length === 0) return [[nodeId]]
  if (leafCount(cards, nodeId) <= budget) {
    return [[nodeId, ...subtreeIds(cards, nodeId).slice(1)]]
  }

  const allChildrenAreLeaves = kids.every(kid => childrenOf(cards, kid.id).length === 0)
  if (allChildrenAreLeaves) {
    const batches: string[][] = []
    for (let i = 0; i < kids.length; i += budget) {
      batches.push([nodeId, ...kids.slice(i, i + budget).map(k => k.id)])
    }
    return batches
  }

  return kids.flatMap(kid => splitSubtree(cards, kid.id, budget).map(ids => [nodeId, ...ids]))
}

/**
 * Splits a mind map into print-ready pages: each page's `cards` form a
 * valid root-rooted (sub)tree, safe to hand straight to `computeLayout` —
 * small enough to read on one A4 landscape page. A branch too big for one
 * page is recursively split (by sub-branch, then by leaf batch), always
 * repeating the path from the true root down to that page's content.
 */
export function paginateForExport(
  cards: Card[],
  options: { includeDetached: boolean },
  rowBudget: number = PAGE_ROW_BUDGET
): ExportPage[] {
  const root = cards.find(c => c.parentId === null && !c.detached)
  const byId = new Map(cards.map(c => [c.id, c]))
  const pages: ExportPage[] = root
    ? splitSubtree(cards, root.id, rowBudget).map(ids => ({ cards: ids.map(id => byId.get(id)!) }))
    : []

  if (options.includeDetached) {
    const detached = cards.filter(c => c.detached).sort((a, b) => a.order - b.order)
    if (detached.length > 0) pages.push({ cards: detached })
  }
  return pages
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/export/pagination.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/export/pagination.ts src/export/pagination.test.ts
git commit -m "feat: add recursive per-branch pagination for export"
```

---

## Task 3: Static (read-only) card visual

**Files:**
- Create: `src/export/StaticCardView.tsx`
- Create: `src/export/StaticCardView.test.tsx`

**Interfaces:**
- Consumes: `Card` (`../types/card`), `detachedColors`/`levelColor` (`../colors/levelColors`), `toCss` (`../colors/contrast`) — all already exist.
- Produces: `EXPORT_CARD_WIDTH: number`, `EXPORT_CARD_HEIGHT: number`, `StaticCardView({ card: Card; showDefinition: boolean }): JSX.Element`.
- Consumed by: Task 4 (`ExportPageRenderer`).

- [ ] **Step 1: Write the failing tests**

```tsx
// src/export/StaticCardView.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StaticCardView } from './StaticCardView'
import type { Card } from '../types/card'

describe('StaticCardView', () => {
  const card: Card = { id: 'c1', level: 2, title: 'Titre', definition: 'Def', parentId: 'root', order: 0 }

  it('always shows the title', () => {
    render(<StaticCardView card={card} showDefinition={false} />)
    expect(screen.getByText('Titre')).toBeInTheDocument()
  })

  it('shows the definition only when showDefinition is true', () => {
    const { rerender } = render(<StaticCardView card={card} showDefinition={false} />)
    expect(screen.queryByText('Def')).not.toBeInTheDocument()
    rerender(<StaticCardView card={card} showDefinition={true} />)
    expect(screen.getByText('Def')).toBeInTheDocument()
  })

  it('renders no interactive elements', () => {
    render(<StaticCardView card={card} showDefinition={true} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/export/StaticCardView.test.tsx`
Expected: FAIL — `src/export/StaticCardView.tsx` does not exist yet.

- [ ] **Step 3: Implement `StaticCardView.tsx`**

```tsx
// src/export/StaticCardView.tsx
import type { Card } from '../types/card'
import { detachedColors, levelColor } from '../colors/levelColors'
import { toCss } from '../colors/contrast'

export const EXPORT_CARD_WIDTH = 260
export const EXPORT_CARD_HEIGHT = 120

export interface StaticCardViewProps {
  card: Card
  showDefinition: boolean
}

/**
 * Read-only visual of a card for export capture: same palette as `CardNode`,
 * none of its interactivity (no inputs, no structural buttons, no drag
 * handle) — a screenshot never needs to be editable.
 */
export function StaticCardView({ card, showDefinition }: StaticCardViewProps) {
  const colors = card.detached ? detachedColors : levelColor(card.level)
  return (
    <div
      data-testid={`export-card-${card.id}`}
      style={{
        width: EXPORT_CARD_WIDTH,
        minHeight: EXPORT_CARD_HEIGHT,
        boxSizing: 'border-box',
        background: toCss(colors.bg),
        color: toCss(colors.text),
        border: card.detached ? '2px dashed' : '2px solid',
        borderColor: toCss(colors.border),
        borderRadius: 8,
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
      }}
    >
      <strong style={{ fontSize: 14 }}>{card.title}</strong>
      {showDefinition && card.definition && <p style={{ margin: 0, fontSize: 12 }}>{card.definition}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/export/StaticCardView.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/export/StaticCardView.tsx src/export/StaticCardView.test.tsx
git commit -m "feat: add read-only card visual for export capture"
```

---

## Task 4: Export page layout (positions a page's cards)

**Files:**
- Create: `src/export/ExportPageRenderer.tsx`
- Create: `src/export/ExportPageRenderer.test.tsx`

**Interfaces:**
- Consumes: `computeLayout`, `COLUMN_WIDTH`, `ROW_HEIGHT` (`../layout/columns`, already exist), `ExportPage` (`./pagination`, Task 2), `StaticCardView`, `EXPORT_CARD_WIDTH` (`./StaticCardView`, Task 3).
- Produces: `PageBounds { width: number; height: number }`, `computePageBounds(page: ExportPage): PageBounds`, `ExportPageRenderer({ page: ExportPage; showDefinitions: boolean }): JSX.Element`.
- Consumed by: Task 6 (`renderPagesToImages.ts`).

- [ ] **Step 1: Write the failing tests**

```tsx
// src/export/ExportPageRenderer.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExportPageRenderer, computePageBounds } from './ExportPageRenderer'
import type { ExportPage } from './pagination'
import { ROW_HEIGHT, COLUMN_WIDTH } from '../layout/columns'

const page: ExportPage = {
  cards: [
    { id: 'root', level: 1, title: 'Racine', parentId: null, order: 0 },
    { id: 'child', level: 2, title: 'Enfant', parentId: 'root', order: 0 },
  ],
}

describe('ExportPageRenderer', () => {
  it('renders one StaticCardView per card', () => {
    render(<ExportPageRenderer page={page} showDefinitions={false} />)
    expect(screen.getByTestId('export-card-root')).toBeInTheDocument()
    expect(screen.getByTestId('export-card-child')).toBeInTheDocument()
  })

  it('positions each card at its computeLayout coordinates', () => {
    render(<ExportPageRenderer page={page} showDefinitions={false} />)
    const childWrapper = screen.getByTestId('export-card-child').parentElement!
    expect(childWrapper.style.left).toBe(`${COLUMN_WIDTH}px`)
    expect(childWrapper.style.top).toBe('0px')
  })
})

describe('computePageBounds', () => {
  it('covers the widest column and the tallest row', () => {
    const bounds = computePageBounds(page)
    expect(bounds.width).toBeGreaterThan(COLUMN_WIDTH)
    expect(bounds.height).toBeGreaterThanOrEqual(ROW_HEIGHT)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/export/ExportPageRenderer.test.tsx`
Expected: FAIL — `src/export/ExportPageRenderer.tsx` does not exist yet.

- [ ] **Step 3: Implement `ExportPageRenderer.tsx`**

```tsx
// src/export/ExportPageRenderer.tsx
import { computeLayout, COLUMN_WIDTH, ROW_HEIGHT } from '../layout/columns'
import { StaticCardView, EXPORT_CARD_WIDTH } from './StaticCardView'
import type { ExportPage } from './pagination'

export interface PageBounds {
  width: number
  height: number
}

export function computePageBounds(page: ExportPage): PageBounds {
  const positions = computeLayout(page.cards)
  const xs = page.cards.map(c => positions[c.id].x)
  const ys = page.cards.map(c => positions[c.id].y)
  return {
    width: (xs.length > 0 ? Math.max(...xs) : 0) + COLUMN_WIDTH,
    height: (ys.length > 0 ? Math.max(...ys) : 0) + ROW_HEIGHT,
  }
}

export interface ExportPageRendererProps {
  page: ExportPage
  showDefinitions: boolean
}

/**
 * A page's mini mind map, absolutely positioned by the same `computeLayout`
 * the live canvas uses (`position` is a top-left coordinate, exactly as
 * `MindMapCanvas` feeds it straight into a React Flow node) — so an export
 * page reads exactly like a slice of the real canvas, never a bespoke print
 * layout that could drift from it.
 */
export function ExportPageRenderer({ page, showDefinitions }: ExportPageRendererProps) {
  const positions = computeLayout(page.cards)
  const bounds = computePageBounds(page)
  return (
    <div style={{ position: 'relative', width: bounds.width, height: bounds.height }}>
      {page.cards.map(card => {
        const pos = positions[card.id]
        return (
          <div key={card.id} style={{ position: 'absolute', left: pos.x, top: pos.y, width: EXPORT_CARD_WIDTH }}>
            <StaticCardView card={card} showDefinition={showDefinitions} />
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/export/ExportPageRenderer.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/export/ExportPageRenderer.tsx src/export/ExportPageRenderer.test.tsx
git commit -m "feat: add per-page card layout reusing the canvas's computeLayout"
```

---

## Task 5: DOM-to-PNG capture

**Files:**
- Create: `src/export/captureElement.ts`
- Create: `src/export/captureElement.test.ts`

**Interfaces:**
- Produces: `captureElementAsPng(element: HTMLElement): Promise<string>` (a `data:image/png;...` URL).
- Consumed by: Task 6 (`renderPagesToImages.ts`).

- [ ] **Step 1: Add the dependency**

Run: `bun add html-to-image`

- [ ] **Step 2: Write the failing test**

```ts
// src/export/captureElement.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('html-to-image', () => ({ toPng: vi.fn(async () => 'data:image/png;base64,AAA') }))

import { toPng } from 'html-to-image'
import { captureElementAsPng } from './captureElement'

describe('captureElementAsPng', () => {
  it('delegates to html-to-image toPng at 2x pixel ratio', async () => {
    const el = document.createElement('div')
    const result = await captureElementAsPng(el)
    expect(result).toBe('data:image/png;base64,AAA')
    expect(toPng).toHaveBeenCalledWith(el, { pixelRatio: 2 })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/export/captureElement.test.ts`
Expected: FAIL — `src/export/captureElement.ts` does not exist yet.

- [ ] **Step 4: Implement `captureElement.ts`**

```ts
// src/export/captureElement.ts
import { toPng } from 'html-to-image'

/**
 * Rasterizes a mounted DOM element to a PNG data URL. `pixelRatio: 2` keeps
 * print output sharp — the on-screen card visuals are sized for a monitor,
 * not for the higher DPI a printed page benefits from.
 */
export async function captureElementAsPng(element: HTMLElement): Promise<string> {
  return toPng(element, { pixelRatio: 2 })
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/export/captureElement.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/export/captureElement.ts src/export/captureElement.test.ts
git commit -m "feat: add DOM-to-PNG capture for export"
```

---

## Task 6: Off-screen page rendering harness

**Files:**
- Create: `src/export/renderPagesToImages.ts`
- Create: `src/export/renderPagesToImages.test.tsx`

**Interfaces:**
- Consumes: `ExportPageRenderer`, `computePageBounds` (`./ExportPageRenderer`, Task 4), `captureElementAsPng` (`./captureElement`, Task 5), `ExportPage` (`./pagination`, Task 2).
- Produces: `CapturedPage { dataUrl: string; width: number; height: number }`, `renderPagesToImages(pages: ExportPage[], showDefinitions: boolean): Promise<CapturedPage[]>`.
- Consumed by: Task 8 (`exportMindMap.ts`).

- [ ] **Step 1: Write the failing test**

```tsx
// src/export/renderPagesToImages.test.tsx
import { describe, it, expect, vi } from 'vitest'

vi.mock('./captureElement', () => ({ captureElementAsPng: vi.fn(async () => 'data:image/png;base64,X') }))

import { captureElementAsPng } from './captureElement'
import { renderPagesToImages } from './renderPagesToImages'
import { computePageBounds } from './ExportPageRenderer'
import type { ExportPage } from './pagination'

describe('renderPagesToImages', () => {
  it('captures one image per page and leaves no DOM behind', async () => {
    const pages: ExportPage[] = [
      { cards: [{ id: 'a', level: 1, title: 'A', parentId: null, order: 0 }] },
      { cards: [{ id: 'b', level: 1, title: 'B', parentId: null, order: 0 }] },
    ]
    const results = await renderPagesToImages(pages, false)

    expect(captureElementAsPng).toHaveBeenCalledTimes(2)
    expect(results).toHaveLength(2)
    expect(results[0].dataUrl).toBe('data:image/png;base64,X')
    expect(results[0].width).toBe(computePageBounds(pages[0]).width)
    expect(results[0].height).toBe(computePageBounds(pages[0]).height)
    expect(document.querySelectorAll('[data-export-page-container]')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/export/renderPagesToImages.test.tsx`
Expected: FAIL — `src/export/renderPagesToImages.ts` does not exist yet.

- [ ] **Step 3: Implement `renderPagesToImages.ts`**

```tsx
// src/export/renderPagesToImages.tsx
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { ExportPageRenderer, computePageBounds } from './ExportPageRenderer'
import { captureElementAsPng } from './captureElement'
import type { ExportPage } from './pagination'

export interface CapturedPage {
  dataUrl: string
  width: number
  height: number
}

/**
 * Renders each page off-screen (fixed position, far outside the viewport —
 * a page can be larger or smaller than the window) and captures it to a PNG.
 * Pages are processed one at a time: each capture is awaited, and its DOM
 * removed, before the next page mounts.
 */
export async function renderPagesToImages(pages: ExportPage[], showDefinitions: boolean): Promise<CapturedPage[]> {
  const results: CapturedPage[] = []
  for (const page of pages) {
    const bounds = computePageBounds(page)
    const container = document.createElement('div')
    container.setAttribute('data-export-page-container', '')
    container.style.position = 'fixed'
    container.style.left = '-99999px'
    container.style.top = '0'
    container.style.width = `${bounds.width}px`
    container.style.height = `${bounds.height}px`
    document.body.appendChild(container)
    const root = createRoot(container)
    flushSync(() => {
      root.render(<ExportPageRenderer page={page} showDefinitions={showDefinitions} />)
    })
    try {
      const dataUrl = await captureElementAsPng(container)
      results.push({ dataUrl, width: bounds.width, height: bounds.height })
    } finally {
      root.unmount()
      container.remove()
    }
  }
  return results
}
```

The file is `.tsx` (renamed from the `.ts` used in the plan header above) since it renders JSX.

- [ ] **Step 4: Rename the file to `.tsx` and re-run the test**

Run: `npx vitest run src/export/renderPagesToImages.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/export/renderPagesToImages.tsx src/export/renderPagesToImages.test.tsx
git commit -m "feat: add off-screen rendering harness that captures each export page"
```

---

## Task 7: PDF assembly

**Files:**
- Create: `src/export/assemblePdf.ts`
- Create: `src/export/assemblePdf.test.ts`

**Interfaces:**
- Consumes: `CapturedPage` (`./renderPagesToImages`, Task 6).
- Produces: `assemblePdf(pages: CapturedPage[]): Uint8Array`.
- Consumed by: Task 8 (`exportMindMap.ts`).

- [ ] **Step 1: Add the dependency**

Run: `bun add jspdf`

- [ ] **Step 2: Write the failing tests**

```ts
// src/export/assemblePdf.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const addImage = vi.fn()
const addPage = vi.fn()
const output = vi.fn(() => new ArrayBuffer(4))
vi.mock('jspdf', () => ({
  jsPDF: vi.fn().mockImplementation(() => ({ addImage, addPage, output })),
}))

import { assemblePdf } from './assemblePdf'
import type { CapturedPage } from './renderPagesToImages'

describe('assemblePdf', () => {
  beforeEach(() => {
    addImage.mockClear()
    addPage.mockClear()
  })

  it('adds one image per page and a new PDF page between each', () => {
    const pages: CapturedPage[] = [
      { dataUrl: 'data:image/png;base64,A', width: 640, height: 480 },
      { dataUrl: 'data:image/png;base64,B', width: 640, height: 480 },
    ]
    const bytes = assemblePdf(pages)
    expect(addImage).toHaveBeenCalledTimes(2)
    expect(addPage).toHaveBeenCalledTimes(1)
    expect(bytes).toBeInstanceOf(Uint8Array)
  })

  it('adds no extra page for a single-page export', () => {
    assemblePdf([{ dataUrl: 'data:image/png;base64,A', width: 640, height: 480 }])
    expect(addPage).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/export/assemblePdf.test.ts`
Expected: FAIL — `src/export/assemblePdf.ts` does not exist yet.

- [ ] **Step 4: Implement `assemblePdf.ts`**

```ts
// src/export/assemblePdf.ts
import { jsPDF } from 'jspdf'
import type { CapturedPage } from './renderPagesToImages'

/** A4 landscape, in mm, with a 10mm margin on every side. */
const PAGE_WIDTH_MM = 297
const PAGE_HEIGHT_MM = 210
const MARGIN_MM = 10

/**
 * Assembles captured page images into a multi-page A4 landscape PDF: one
 * image per page, scaled down (never up) to fit inside the printable
 * margin while preserving its aspect ratio, and centred on the page.
 */
export function assemblePdf(pages: CapturedPage[]): Uint8Array {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const maxWidth = PAGE_WIDTH_MM - 2 * MARGIN_MM
  const maxHeight = PAGE_HEIGHT_MM - 2 * MARGIN_MM

  pages.forEach((page, index) => {
    if (index > 0) doc.addPage()
    const scale = Math.min(maxWidth / page.width, maxHeight / page.height, 1)
    const width = page.width * scale
    const height = page.height * scale
    const x = MARGIN_MM + (maxWidth - width) / 2
    const y = MARGIN_MM + (maxHeight - height) / 2
    doc.addImage(page.dataUrl, 'PNG', x, y, width, height)
  })

  return new Uint8Array(doc.output('arraybuffer') as ArrayBuffer)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/export/assemblePdf.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/export/assemblePdf.ts src/export/assemblePdf.test.ts
git commit -m "feat: assemble captured export pages into a multi-page A4 PDF"
```

---

## Task 8: Export orchestration

**Files:**
- Create: `src/export/exportMindMap.ts`
- Create: `src/export/exportMindMap.test.ts`

**Interfaces:**
- Consumes: `paginateForExport` (`./pagination`, Task 2), `renderPagesToImages` (`./renderPagesToImages`, Task 6), `assemblePdf` (`./assemblePdf`, Task 7), `Card` (`../types/card`).
- Produces:
  - `ExportOptions { showDefinitions: boolean; includeDetached: boolean }`
  - `exportToPdfBytes(cards: Card[], options: ExportOptions): Promise<Uint8Array>`
  - `exportToImageDataUrls(cards: Card[], options: ExportOptions): Promise<string[]>` — one PNG data URL per export page.
- Consumed by: Task 12 (`ExportDialog.tsx`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/export/exportMindMap.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('./pagination', () => ({ paginateForExport: vi.fn(() => [{ cards: [] }]) }))
vi.mock('./renderPagesToImages', () => ({
  renderPagesToImages: vi.fn(async () => [{ dataUrl: 'data:image/png;base64,X', width: 1, height: 1 }]),
}))
vi.mock('./assemblePdf', () => ({ assemblePdf: vi.fn(() => new Uint8Array([1, 2, 3])) }))

import { paginateForExport } from './pagination'
import { renderPagesToImages } from './renderPagesToImages'
import { assemblePdf } from './assemblePdf'
import { exportToPdfBytes, exportToImageDataUrls } from './exportMindMap'
import type { Card } from '../types/card'

const cards: Card[] = [{ id: 'root', level: 1, title: 'R', parentId: null, order: 0 }]

describe('exportToPdfBytes', () => {
  it('paginates, renders, and assembles a PDF', async () => {
    const bytes = await exportToPdfBytes(cards, { showDefinitions: true, includeDetached: false })
    expect(paginateForExport).toHaveBeenCalledWith(cards, { includeDetached: false })
    expect(renderPagesToImages).toHaveBeenCalledWith([{ cards: [] }], true)
    expect(assemblePdf).toHaveBeenCalled()
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]))
  })
})

describe('exportToImageDataUrls', () => {
  it('returns one data URL per captured page', async () => {
    const urls = await exportToImageDataUrls(cards, { showDefinitions: false, includeDetached: true })
    expect(paginateForExport).toHaveBeenCalledWith(cards, { includeDetached: true })
    expect(urls).toEqual(['data:image/png;base64,X'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/export/exportMindMap.test.ts`
Expected: FAIL — `src/export/exportMindMap.ts` does not exist yet.

- [ ] **Step 3: Implement `exportMindMap.ts`**

```ts
// src/export/exportMindMap.ts
import type { Card } from '../types/card'
import { paginateForExport } from './pagination'
import { renderPagesToImages } from './renderPagesToImages'
import { assemblePdf } from './assemblePdf'

export interface ExportOptions {
  showDefinitions: boolean
  includeDetached: boolean
}

export async function exportToPdfBytes(cards: Card[], options: ExportOptions): Promise<Uint8Array> {
  const pages = paginateForExport(cards, { includeDetached: options.includeDetached })
  const captured = await renderPagesToImages(pages, options.showDefinitions)
  return assemblePdf(captured)
}

/** One PNG data URL per export page — several when the tree needed more than one page. */
export async function exportToImageDataUrls(cards: Card[], options: ExportOptions): Promise<string[]> {
  const pages = paginateForExport(cards, { includeDetached: options.includeDetached })
  const captured = await renderPagesToImages(pages, options.showDefinitions)
  return captured.map(page => page.dataUrl)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/export/exportMindMap.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/export/exportMindMap.ts src/export/exportMindMap.test.ts
git commit -m "feat: add top-level PDF/image export orchestration"
```

---

## Task 9: XMind import

**Files:**
- Create: `src/xmind/importXmind.ts`
- Create: `src/xmind/importXmind.test.ts`

**Interfaces:**
- Consumes: `Card`, `CardLevel` (`../types/card`).
- Produces:
  - `XmindSheetImport { sheetTitle: string; cards: Card[] }`
  - `xmindContentToCards(contentJson: unknown): XmindSheetImport[]` — pure mapping, throws a French `Error` on unreadable input.
  - `readXmindFile(bytes: Uint8Array): Promise<XmindSheetImport[]>` — unzips, reads `content.json`, delegates to `xmindContentToCards`.
- Consumed by: Task 14 (XMind import wiring in `FileTreeRow.tsx`).

- [ ] **Step 1: Add the dependency**

Run: `bun add jszip`

- [ ] **Step 2: Write the failing tests**

```ts
// src/xmind/importXmind.test.ts
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { xmindContentToCards, readXmindFile } from './importXmind'

describe('xmindContentToCards', () => {
  it('maps a central topic and its children to levels 1..4', () => {
    const content = [
      {
        title: 'Ma feuille',
        rootTopic: {
          title: 'Chapitre',
          children: {
            attached: [
              {
                title: 'Thème',
                notes: { plain: { content: 'note du thème' } },
                children: { attached: [{ title: 'Règle', children: { attached: [{ title: 'Exemple' }] } }] },
              },
            ],
          },
        },
      },
    ]
    const [sheet] = xmindContentToCards(content)
    expect(sheet.sheetTitle).toBe('Ma feuille')
    const byLevel = (level: number) => sheet.cards.filter(c => c.level === level)
    expect(byLevel(1)).toHaveLength(1)
    expect(byLevel(1)[0].title).toBe('Chapitre')
    expect(byLevel(2)[0]).toMatchObject({ title: 'Thème', definition: 'note du thème' })
    expect(byLevel(3)[0].title).toBe('Règle')
    expect(byLevel(4)[0].title).toBe('Exemple')
  })

  it('produces one XmindSheetImport per sheet', () => {
    const content = [
      { title: 'Feuille A', rootTopic: { title: 'A' } },
      { title: 'Feuille B', rootTopic: { title: 'B' } },
    ]
    const sheets = xmindContentToCards(content)
    expect(sheets.map(s => s.sheetTitle)).toEqual(['Feuille A', 'Feuille B'])
  })

  it('folds a subtree deeper than level 4 into the level-4 ancestor\'s definition instead of dropping or detaching it', () => {
    const content = [
      {
        title: 'Feuille',
        rootTopic: {
          title: 'L1',
          children: {
            attached: [
              {
                title: 'L2',
                children: {
                  attached: [
                    {
                      title: 'L3',
                      children: {
                        attached: [
                          {
                            title: 'L4',
                            children: { attached: [{ title: 'L5', notes: { plain: { content: 'trop profond' } } }] },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    ]
    const [sheet] = xmindContentToCards(content)
    expect(sheet.cards).toHaveLength(4) // L1..L4 only — L5 is folded, not a 5th card
    const level4 = sheet.cards.find(c => c.title === 'L4')!
    expect(level4.definition).toContain('L5')
    expect(level4.definition).toContain('trop profond')
  })

  it('throws a readable error when the root is not usable', () => {
    expect(() => xmindContentToCards([{ title: 'Feuille' }])).toThrow(/sujet central/)
  })

  it('throws a readable error when the content is not an array of sheets', () => {
    expect(() => xmindContentToCards({ not: 'an array' })).toThrow(/non reconnu/)
  })
})

describe('readXmindFile', () => {
  it('reads content.json out of the zip and maps it', async () => {
    const zip = new JSZip()
    zip.file(
      'content.json',
      JSON.stringify([{ title: 'Ma feuille', rootTopic: { title: 'Racine' } }])
    )
    const bytes = await zip.generateAsync({ type: 'uint8array' })

    const sheets = await readXmindFile(bytes)
    expect(sheets).toHaveLength(1)
    expect(sheets[0].sheetTitle).toBe('Ma feuille')
    expect(sheets[0].cards[0].title).toBe('Racine')
  })

  it('rejects a zip with no content.json (legacy XMind 8 format)', async () => {
    const zip = new JSZip()
    zip.file('content.xml', '<xmap-content/>')
    const bytes = await zip.generateAsync({ type: 'uint8array' })

    await expect(readXmindFile(bytes)).rejects.toThrow(/content\.json/)
  })

  it('rejects bytes that are not a valid zip', async () => {
    await expect(readXmindFile(new Uint8Array([1, 2, 3]))).rejects.toThrow(/illisible/)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/xmind/importXmind.test.ts`
Expected: FAIL — `src/xmind/importXmind.ts` does not exist yet.

- [ ] **Step 4: Implement `importXmind.ts`**

```ts
// src/xmind/importXmind.ts
import JSZip from 'jszip'
import type { Card, CardLevel } from '../types/card'

export interface XmindSheetImport {
  sheetTitle: string
  cards: Card[]
}

interface XmindTopic {
  title?: unknown
  notes?: { plain?: { content?: unknown } }
  children?: { attached?: XmindTopic[] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function topicTitle(topic: XmindTopic): string {
  return typeof topic.title === 'string' && topic.title.trim() !== '' ? topic.title : 'Sans titre'
}

function topicNote(topic: XmindTopic): string | undefined {
  const content = topic.notes?.plain?.content
  return typeof content === 'string' && content.trim() !== '' ? content : undefined
}

function topicChildren(topic: XmindTopic): XmindTopic[] {
  return Array.isArray(topic.children?.attached) ? topic.children!.attached! : []
}

/** Renders a subtree deeper than level 4 as indented text lines, folded into the level-4 ancestor's definition. */
function foldDeepSubtree(topic: XmindTopic, indent: number): string[] {
  const prefix = '  '.repeat(indent)
  const lines = [`${prefix}- ${topicTitle(topic)}`]
  const note = topicNote(topic)
  if (note) lines.push(`${prefix}  ${note}`)
  for (const child of topicChildren(topic)) lines.push(...foldDeepSubtree(child, indent + 1))
  return lines
}

function buildCards(topic: XmindTopic, level: CardLevel, parentId: string | null, order: number, out: Card[]): void {
  const id = crypto.randomUUID()
  const children = topicChildren(topic)
  let definition = topicNote(topic)
  if (level === 4 && children.length > 0) {
    const folded = children.flatMap(child => foldDeepSubtree(child, 0))
    definition = [definition, ...folded].filter((line): line is string => Boolean(line)).join('\n')
  }
  const card: Card = { id, level, title: topicTitle(topic), parentId, order }
  if (definition) card.definition = definition
  out.push(card)
  if (level < 4) {
    children.forEach((child, index) => buildCards(child, (level + 1) as CardLevel, id, index, out))
  }
}

/**
 * Pure mapping from a parsed XMind Zen/2021 `content.json` (an array of
 * sheets, each with a `rootTopic`) to one `XmindSheetImport` per sheet. A
 * topic deeper than the app's strict 4 levels is folded into text inside its
 * level-4 ancestor's `definition` — never detached, which would strip it of
 * the hierarchy that gave it meaning.
 */
export function xmindContentToCards(contentJson: unknown): XmindSheetImport[] {
  if (!Array.isArray(contentJson)) {
    throw new Error('Format XMind non reconnu : contenu racine attendu sous forme de liste de feuilles.')
  }
  return contentJson.map((sheet, index) => {
    if (!isRecord(sheet) || !isRecord(sheet.rootTopic)) {
      throw new Error(`Feuille XMind n°${index + 1} illisible : sujet central manquant.`)
    }
    const sheetTitle = typeof sheet.title === 'string' && sheet.title.trim() !== '' ? sheet.title : `Feuille ${index + 1}`
    const cards: Card[] = []
    buildCards(sheet.rootTopic as XmindTopic, 1, null, 0, cards)
    return { sheetTitle, cards }
  })
}

/** Unzips a `.xmind` file (XMind Zen/2021 format only) and maps its sheets. */
export async function readXmindFile(bytes: Uint8Array): Promise<XmindSheetImport[]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new Error('Fichier .xmind illisible : archive corrompue.')
  }
  const entry = zip.file('content.json')
  if (!entry) {
    throw new Error(
      'Fichier .xmind non pris en charge : content.json introuvable (format XMind 8 ou antérieur ?).'
    )
  }
  const text = await entry.async('string')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Fichier .xmind illisible : content.json n’est pas un JSON valide.')
  }
  return xmindContentToCards(parsed)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/xmind/importXmind.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/xmind/importXmind.ts src/xmind/importXmind.test.ts
git commit -m "feat: import XMind Zen/2021 files into Card sheets"
```

---

## Task 10: XMind export

**Files:**
- Create: `src/xmind/exportXmind.ts`
- Create: `src/xmind/exportXmind.test.ts`

**Interfaces:**
- Consumes: `Card` (`../types/card`), `xmindContentToCards` (`./importXmind`, Task 9 — round-trip test only).
- Produces: `cardsToXmindContent(cards: Card[]): unknown`, `writeXmindFile(cards: Card[]): Promise<Uint8Array>`.
- Consumed by: Task 12 (`ExportDialog.tsx`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/xmind/exportXmind.test.ts
import { describe, it, expect } from 'vitest'
import { cardsToXmindContent, writeXmindFile } from './exportXmind'
import { xmindContentToCards } from './importXmind'
import type { Card } from '../types/card'

const cards: Card[] = [
  { id: 'root', level: 1, title: 'Chapitre', parentId: null, order: 0 },
  { id: 'a', level: 2, title: 'Thème', definition: 'note', parentId: 'root', order: 0 },
  { id: 'a1', level: 3, title: 'Règle', parentId: 'a', order: 0 },
  { id: 'f1', level: 2, title: 'Idée en vrac', parentId: null, order: 0, detached: true },
]

describe('cardsToXmindContent', () => {
  it('maps the root card to the sheet\'s central topic, with children nested by level', () => {
    const [sheet] = cardsToXmindContent(cards) as [{ title: string; rootTopic: { title: string; children: { attached: unknown[] } } }]
    expect(sheet.title).toBe('Chapitre')
    expect(sheet.rootTopic.title).toBe('Chapitre')
  })

  it('adds a synthetic "Cartes volantes" topic under the root for detached cards', () => {
    const [sheet] = cardsToXmindContent(cards) as [
      { rootTopic: { children: { attached: { title: string; children?: { attached: { title: string }[] } }[] } } },
    ]
    const volantes = sheet.rootTopic.children.attached.find(t => t.title === 'Cartes volantes')!
    expect(volantes).toBeDefined()
    expect(volantes.children!.attached.map(t => t.title)).toEqual(['Idée en vrac'])
  })

  it('throws when there is no root card', () => {
    expect(() => cardsToXmindContent([])).toThrow(/racine/)
  })
})

describe('round trip', () => {
  it('re-imports what it exported with the same titles, levels, definitions, and structure', () => {
    const content = cardsToXmindContent(cards)
    const [reimported] = xmindContentToCards(content)
    const shape = (list: Card[]) =>
      list
        .map(c => ({ title: c.title, level: c.level, definition: c.definition }))
        .sort((x, y) => x.title.localeCompare(y.title))
    expect(shape(reimported.cards)).toEqual(shape(cards.filter(c => c.title !== 'Cartes volantes')))
  })
})

describe('writeXmindFile', () => {
  it('produces a zip whose content.json matches cardsToXmindContent', async () => {
    const bytes = await writeXmindFile(cards)
    expect(bytes.length).toBeGreaterThan(0)
    // Byte 0-1 of a zip file is the local file header signature "PK".
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })
})
```

Note: the round-trip test's expected list filters out `'Cartes volantes'` by title, but the folder card itself and its child (`'Idée en vrac'`) both get re-imported as regular cards under the root's synthetic topic — so the re-imported set has one extra `'Cartes volantes'` card not present in the original flat `cards` list. Filtering both sides on `title !== 'Cartes volantes'` keeps the comparison meaningful without asserting on that synthetic wrapper's own shape.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/xmind/exportXmind.test.ts`
Expected: FAIL — `src/xmind/exportXmind.ts` does not exist yet.

- [ ] **Step 3: Implement `exportXmind.ts`**

```ts
// src/xmind/exportXmind.ts
import JSZip from 'jszip'
import type { Card } from '../types/card'

interface XmindTopicOut {
  id: string
  class: 'topic'
  title: string
  notes?: { plain: { content: string } }
  children?: { attached: XmindTopicOut[] }
}

function toTopic(cards: Card[], card: Card): XmindTopicOut {
  const children = cards.filter(c => c.parentId === card.id && !c.detached).sort((a, b) => a.order - b.order)
  const topic: XmindTopicOut = { id: card.id, class: 'topic', title: card.title }
  if (card.definition) topic.notes = { plain: { content: card.definition } }
  if (children.length > 0) topic.children = { attached: children.map(child => toTopic(cards, child)) }
  return topic
}

/**
 * Maps `Card[]` to an XMind Zen/2021 `content.json` (one sheet, since one
 * file is always one chapter/root). Detached cards, if present, are nested
 * under a synthetic "Cartes volantes" topic hanging off the root — mirroring
 * the dedicated final page the PDF/image export gives them — so nothing is
 * silently dropped from the export.
 */
export function cardsToXmindContent(cards: Card[]): unknown {
  const root = cards.find(c => c.parentId === null && !c.detached)
  if (!root) throw new Error('Aucune carte racine à exporter.')

  const rootTopic = toTopic(cards, root)
  const detached = cards.filter(c => c.detached).sort((a, b) => a.order - b.order)
  if (detached.length > 0) {
    const detachedTopic: XmindTopicOut = {
      id: crypto.randomUUID(),
      class: 'topic',
      title: 'Cartes volantes',
      children: { attached: detached.map(card => toTopic(cards, card)) },
    }
    rootTopic.children = { attached: [...(rootTopic.children?.attached ?? []), detachedTopic] }
  }

  return [{ id: crypto.randomUUID(), class: 'sheet', title: root.title, rootTopic }]
}

export async function writeXmindFile(cards: Card[]): Promise<Uint8Array> {
  const content = cardsToXmindContent(cards)
  const zip = new JSZip()
  zip.file('content.json', JSON.stringify(content))
  return zip.generateAsync({ type: 'uint8array' })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/xmind/exportXmind.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/xmind/exportXmind.ts src/xmind/exportXmind.test.ts
git commit -m "feat: export Card sheets to XMind Zen/2021 files"
```

---

## Task 11: Native save/open dialogs and binary fs wrappers

**Files:**
- Create: `src/persistence/exportIO.ts`
- Create: `src/persistence/exportIO.test.ts`

**Interfaces:**
- Produces:
  - `SaveFilter { name: string; extensions: string[] }`
  - `saveBytesAs(bytes: Uint8Array, defaultName: string, filters: SaveFilter[]): Promise<string | null>` — `null` means the user cancelled.
  - `pickXmindFile(): Promise<string | null>` — `null` means the user cancelled.
  - `readBinaryFile(path: string): Promise<Uint8Array>`
- Consumed by: Task 12 (`ExportDialog.tsx`), Task 14 (XMind import wiring).

- [ ] **Step 1: Write the failing tests**

```ts
// src/persistence/exportIO.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(), open: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), readFile: vi.fn() }))

import { save, open } from '@tauri-apps/plugin-dialog'
import { writeFile, readFile } from '@tauri-apps/plugin-fs'
import { saveBytesAs, pickXmindFile, readBinaryFile } from './exportIO'

describe('saveBytesAs', () => {
  beforeEach(() => {
    vi.mocked(save).mockReset()
    vi.mocked(writeFile).mockReset()
  })

  it('writes the bytes to the chosen path and returns it', async () => {
    vi.mocked(save).mockResolvedValue('/home/user/chapitre.pdf')
    const path = await saveBytesAs(new Uint8Array([1, 2]), 'chapitre.pdf', [{ name: 'PDF', extensions: ['pdf'] }])
    expect(path).toBe('/home/user/chapitre.pdf')
    expect(writeFile).toHaveBeenCalledWith('/home/user/chapitre.pdf', new Uint8Array([1, 2]))
  })

  it('returns null and writes nothing when the dialog is cancelled', async () => {
    vi.mocked(save).mockResolvedValue(null)
    const path = await saveBytesAs(new Uint8Array([1]), 'x.pdf', [])
    expect(path).toBeNull()
    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('pickXmindFile', () => {
  beforeEach(() => vi.mocked(open).mockReset())

  it('opens a dialog filtered to .xmind and returns the picked path', async () => {
    vi.mocked(open).mockResolvedValue('/cours/vieux.xmind')
    expect(await pickXmindFile()).toBe('/cours/vieux.xmind')
    expect(open).toHaveBeenCalledWith({ multiple: false, filters: [{ name: 'XMind', extensions: ['xmind'] }] })
  })

  it('returns null when the dialog is cancelled', async () => {
    vi.mocked(open).mockResolvedValue(null)
    expect(await pickXmindFile()).toBeNull()
  })
})

describe('readBinaryFile', () => {
  it('delegates to the fs plugin\'s binary readFile', async () => {
    vi.mocked(readFile).mockResolvedValue(new Uint8Array([9]))
    expect(await readBinaryFile('/a/b.xmind')).toEqual(new Uint8Array([9]))
    expect(readFile).toHaveBeenCalledWith('/a/b.xmind')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/persistence/exportIO.test.ts`
Expected: FAIL — `src/persistence/exportIO.ts` does not exist yet.

- [ ] **Step 3: Implement `exportIO.ts`**

```ts
// src/persistence/exportIO.ts
import { save, open } from '@tauri-apps/plugin-dialog'
import { readFile, writeFile } from '@tauri-apps/plugin-fs'

export interface SaveFilter {
  name: string
  extensions: string[]
}

/**
 * Opens the native "save as" dialog and writes `bytes` to the chosen path.
 * Returns the path written to, or `null` if the user cancelled — cancelling
 * is not an error, callers should just do nothing.
 */
export async function saveBytesAs(bytes: Uint8Array, defaultName: string, filters: SaveFilter[]): Promise<string | null> {
  const path = await save({ defaultPath: defaultName, filters })
  if (!path) return null
  await writeFile(path, bytes)
  return path
}

/** Native "open" dialog filtered to `.xmind` files. `null` if cancelled. */
export async function pickXmindFile(): Promise<string | null> {
  const path = await open({ multiple: false, filters: [{ name: 'XMind', extensions: ['xmind'] }] })
  return typeof path === 'string' ? path : null
}

export async function readBinaryFile(path: string): Promise<Uint8Array> {
  return readFile(path)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/persistence/exportIO.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/persistence/exportIO.ts src/persistence/exportIO.test.ts
git commit -m "feat: add native save/open dialogs and binary fs wrappers"
```

---

## Task 12: Export dialog component

**Files:**
- Create: `src/components/sidebar/ExportDialog.tsx`
- Create: `src/components/sidebar/ExportDialog.test.tsx`

**Interfaces:**
- Consumes: `exportToPdfBytes`, `exportToImageDataUrls` (`../../export/exportMindMap`, Task 8), `writeXmindFile` (`../../xmind/exportXmind`, Task 10), `saveBytesAs` (`../../persistence/exportIO`, Task 11), `mindMapBaseName` (`../../persistence/paths`, already exists), `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogFooter` (`../ui/dialog`), `Button` (`../ui/button`).
- Produces: `ExportDialog({ fileName: string; cards: Card[]; open: boolean; onClose: () => void; onError: (message: string) => void }): JSX.Element`.
- Consumed by: Task 13 (`FileTreeRow.tsx`).

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/sidebar/ExportDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportDialog } from './ExportDialog'
import type { Card } from '../../types/card'

vi.mock('../../export/exportMindMap', () => ({
  exportToPdfBytes: vi.fn(async () => new Uint8Array([1])),
  exportToImageDataUrls: vi.fn(async () => ['data:image/png;base64,AA==']),
}))
vi.mock('../../xmind/exportXmind', () => ({ writeXmindFile: vi.fn(async () => new Uint8Array([2])) }))
vi.mock('../../persistence/exportIO', () => ({ saveBytesAs: vi.fn(async () => '/out/chapitre.pdf') }))

import { exportToPdfBytes } from '../../export/exportMindMap'
import { writeXmindFile } from '../../xmind/exportXmind'
import { saveBytesAs } from '../../persistence/exportIO'

const cards: Card[] = [{ id: 'root', level: 1, title: 'R', parentId: null, order: 0 }]

describe('ExportDialog', () => {
  beforeEach(() => {
    vi.mocked(exportToPdfBytes).mockClear()
    vi.mocked(writeXmindFile).mockClear()
    vi.mocked(saveBytesAs).mockClear()
  })

  it('exports PDF by default (with definitions shown and detached cards excluded) and closes on success', async () => {
    const onClose = vi.fn()
    const onError = vi.fn()
    render(<ExportDialog fileName="chapitre.json" cards={cards} open onClose={onClose} onError={onError} />)

    await userEvent.click(screen.getByRole('button', { name: 'Exporter' }))

    expect(exportToPdfBytes).toHaveBeenCalledWith(cards, { showDefinitions: true, includeDetached: false })
    expect(saveBytesAs).toHaveBeenCalledWith(new Uint8Array([1]), 'chapitre.pdf', [{ name: 'PDF', extensions: ['pdf'] }])
    expect(onClose).toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('exports XMind when that format is selected', async () => {
    render(<ExportDialog fileName="chapitre.json" cards={cards} open onClose={vi.fn()} onError={vi.fn()} />)

    await userEvent.click(screen.getByRole('radio', { name: 'XMind' }))
    await userEvent.click(screen.getByRole('button', { name: 'Exporter' }))

    expect(writeXmindFile).toHaveBeenCalledWith(cards)
    expect(saveBytesAs).toHaveBeenCalledWith(new Uint8Array([2]), 'chapitre.xmind', [{ name: 'XMind', extensions: ['xmind'] }])
  })

  it('reports a failure through onError instead of throwing', async () => {
    vi.mocked(exportToPdfBytes).mockRejectedValueOnce(new Error('disque plein'))
    const onError = vi.fn()
    render(<ExportDialog fileName="chapitre.json" cards={cards} open onClose={vi.fn()} onError={onError} />)

    await userEvent.click(screen.getByRole('button', { name: 'Exporter' }))

    expect(onError).toHaveBeenCalledWith('Échec de l’export : disque plein')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/sidebar/ExportDialog.test.tsx`
Expected: FAIL — `src/components/sidebar/ExportDialog.tsx` does not exist yet.

- [ ] **Step 3: Implement `ExportDialog.tsx`**

```tsx
// src/components/sidebar/ExportDialog.tsx
import { useState } from 'react'
import type { Card } from '../../types/card'
import { exportToPdfBytes, exportToImageDataUrls } from '../../export/exportMindMap'
import { writeXmindFile } from '../../xmind/exportXmind'
import { saveBytesAs } from '../../persistence/exportIO'
import { mindMapBaseName } from '../../persistence/paths'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'

type ExportFormat = 'pdf' | 'image' | 'xmind'

export interface ExportDialogProps {
  fileName: string
  cards: Card[]
  open: boolean
  onClose: () => void
  onError: (message: string) => void
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? ''
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function ExportDialog({ fileName, cards, open, onClose, onError }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const [showDefinitions, setShowDefinitions] = useState(true)
  const [includeDetached, setIncludeDetached] = useState(false)
  const [exporting, setExporting] = useState(false)
  const baseName = mindMapBaseName(fileName)

  async function handleExport() {
    setExporting(true)
    try {
      const options = { showDefinitions, includeDetached }
      if (format === 'pdf') {
        const bytes = await exportToPdfBytes(cards, options)
        await saveBytesAs(bytes, `${baseName}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }])
      } else if (format === 'image') {
        const dataUrls = await exportToImageDataUrls(cards, options)
        for (const [index, dataUrl] of dataUrls.entries()) {
          const suffix = dataUrls.length > 1 ? ` (${index + 1})` : ''
          // Cancelling any one page's save dialog stops the whole batch —
          // asking for a destination once per page with no way out
          // otherwise would trap the user in N unavoidable dialogs.
          const saved = await saveBytesAs(dataUrlToBytes(dataUrl), `${baseName}${suffix}.png`, [
            { name: 'Image PNG', extensions: ['png'] },
          ])
          if (saved === null) break
        }
      } else {
        const bytes = await writeXmindFile(includeDetached ? cards : cards.filter(c => !c.detached))
        await saveBytesAs(bytes, `${baseName}.xmind`, [{ name: 'XMind', extensions: ['xmind'] }])
      }
      onClose()
    } catch (error) {
      onError(`Échec de l’export : ${error instanceof Error ? error.message : 'erreur inconnue'}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Exporter « {baseName} »</DialogTitle>
        </DialogHeader>
        <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" name="export-format" checked={format === 'pdf'} onChange={() => setFormat('pdf')} />
            PDF
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" name="export-format" checked={format === 'image'} onChange={() => setFormat('image')} />
            Image
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" name="export-format" checked={format === 'xmind'} onChange={() => setFormat('xmind')} />
            XMind
          </label>
        </fieldset>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={showDefinitions}
            disabled={format === 'xmind'}
            onChange={e => setShowDefinitions(e.target.checked)}
          />
          Afficher les définitions
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={includeDetached} onChange={e => setIncludeDetached(e.target.checked)} />
          Inclure les cartes volantes
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={exporting}>
            Annuler
          </Button>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? 'Export en cours…' : 'Exporter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

XMind's `content.json` notes always carry a card's `definition` unconditionally (no toggle in that format), so the "Afficher les définitions" checkbox is disabled — not hidden, so its state is still visible — when XMind is selected.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/sidebar/ExportDialog.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/ExportDialog.tsx src/components/sidebar/ExportDialog.test.tsx
git commit -m "feat: add the export format dialog (PDF/Image/XMind)"
```

---

## Task 13: Wire the Export button into the file sidebar

**Files:**
- Modify: `src/components/sidebar/FileTreeRow.tsx`
- Modify: `src/components/sidebar/FileTreeRow.test.tsx`

**Interfaces:**
- Consumes: `ExportDialog` (`./ExportDialog`, Task 12), `loadMindMap` (`../../persistence/fileStore`, already exists), `validateCards` (`../../validation/cardsValidation`, already exists).
- Produces: an "Exporter" action on every mind-map row.

- [ ] **Step 1: Add the failing test**

Add to the top of `src/components/sidebar/FileTreeRow.test.tsx`, alongside the existing mocks:

```ts
vi.mock('../../persistence/fileStore', () => ({ loadMindMap: vi.fn() }))
```

and, alongside the existing imports:

```ts
import { loadMindMap } from '../../persistence/fileStore'
```

and, inside the existing `beforeEach`:

```ts
vi.mocked(loadMindMap).mockReset()
```

Then add these tests inside the top-level `describe('FileTreeRow', ...)` block:

```tsx
it('opens the export dialog with the file\'s cards once they are loaded and validated', async () => {
  const user = userEvent.setup()
  vi.mocked(loadMindMap).mockResolvedValue([
    { id: 'root', level: 1, title: 'Racine', parentId: null, order: 0 },
  ])
  const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
  render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

  await user.click(screen.getByRole('button', { name: 'Exporter' }))

  expect(await screen.findByText('Exporter « chapitre1 »')).toBeInTheDocument()
})

it('reports an error instead of opening the dialog when the file no longer exists', async () => {
  const user = userEvent.setup()
  vi.mocked(loadMindMap).mockResolvedValue(null)
  const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
  render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

  await user.click(screen.getByRole('button', { name: 'Exporter' }))

  await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/n’existe plus/))
  expect(screen.queryByText(/^Exporter «/)).not.toBeInTheDocument()
})

it('reports an error instead of opening the dialog when the file fails validation', async () => {
  const user = userEvent.setup()
  vi.mocked(loadMindMap).mockResolvedValue([
    { id: 'a', level: 1, title: 'A', parentId: null, order: 0 },
    { id: 'b', level: 1, title: 'B', parentId: null, order: 0 }, // a second root: invalid
  ])
  const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
  render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

  await user.click(screen.getByRole('button', { name: 'Exporter' }))

  await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/structure du fichier est invalide/))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: FAIL — no "Exporter" button exists yet.

- [ ] **Step 3: Wire the Export button and dialog into `FileTreeRow.tsx`**

Add to the imports at the top of `src/components/sidebar/FileTreeRow.tsx`:

```ts
import { Download } from 'lucide-react' // add to the existing lucide-react import list
import type { Card } from '../../types/card'
import { loadMindMap } from '../../persistence/fileStore'
import { validateCards } from '../../validation/cardsValidation'
import { ExportDialog } from './ExportDialog'
```

Inside the `FileTreeRow` component, alongside the other `useState` declarations:

```ts
const [exportCards, setExportCards] = useState<Card[] | null>(null)
```

Add this function alongside `submitCreate`/`submitRename`/`confirmDelete`:

```ts
async function openExport() {
  let raw: Card[] | null
  try {
    raw = await loadMindMap(node.path)
  } catch (error) {
    setWorkspaceError(`Impossible d’exporter « ${node.name} » : ${describeError(error)}`)
    return
  }
  if (raw === null) {
    setWorkspaceError(`Impossible d’exporter « ${node.name} » : ce fichier n’existe plus.`)
    return
  }
  if (!validateCards(raw).valid) {
    setWorkspaceError(`Impossible d’exporter « ${node.name} » : la structure du fichier est invalide.`)
    return
  }
  setExportCards(raw)
}
```

In the `node.type === 'mindmap'` branch's `<TooltipProvider>`, add the button after the existing "Renommer" action:

```tsx
<ActionButton label="Exporter" icon={Download} onClick={openExport} />
```

And after the existing `{confirmDeleteOpen && (...)}` block in that same branch, add:

```tsx
{exportCards && (
  <ExportDialog
    fileName={node.name}
    cards={exportCards}
    open
    onClose={() => setExportCards(null)}
    onError={setWorkspaceError}
  />
)}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: PASS (all tests, including the 3 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/FileTreeRow.tsx src/components/sidebar/FileTreeRow.test.tsx
git commit -m "feat: add the Exporter action to mind-map rows in the sidebar"
```

---

## Task 14: Wire XMind import into the file sidebar

**Files:**
- Modify: `src/persistence/paths.ts`
- Modify: `src/persistence/paths.test.ts`
- Modify: `src/persistence/fileOps.ts`
- Modify: `src/persistence/fileOps.test.ts`
- Modify: `src/components/sidebar/FileTreeRow.tsx`
- Modify: `src/components/sidebar/FileTreeRow.test.tsx`

**Interfaces:**
- Consumes: `readXmindFile` (`../xmind/importXmind`, Task 9), `pickXmindFile`/`readBinaryFile` (`../persistence/exportIO`, Task 11), `saveMindMap` (`../persistence/fileStore`, already exists).
- Produces:
  - `sanitizeFileName(name: string): string` (`paths.ts`)
  - `freeMindMapPath(folderPath: string, baseName: string): Promise<string>` (`fileOps.ts`)
  - an "Importer XMind" action on every folder row.

- [ ] **Step 1: Write the failing test for `sanitizeFileName`**

Add to `src/persistence/paths.test.ts` (create it if it does not already exist, following the existing `paths.ts` exports' test conventions):

```ts
import { describe, it, expect } from 'vitest'
import { sanitizeFileName } from './paths'

describe('sanitizeFileName', () => {
  it('strips characters illegal in a file name', () => {
    expect(sanitizeFileName('Chapitre 3: Vecteurs/Forces')).toBe('Chapitre 3 Vecteurs Forces')
  })

  it('falls back to a placeholder when nothing usable remains', () => {
    expect(sanitizeFileName('///')).toBe('Sans titre')
  })

  it('leaves an already-safe name untouched', () => {
    expect(sanitizeFileName('Chimie organique')).toBe('Chimie organique')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/persistence/paths.test.ts`
Expected: FAIL — `sanitizeFileName` is not exported yet.

- [ ] **Step 3: Add `sanitizeFileName` to `paths.ts`**

Add to `src/persistence/paths.ts`:

```ts
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g

/** A sheet/topic title turned into a safe file name component: illegal characters stripped, never empty. */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(ILLEGAL_FILENAME_CHARS, ' ').replace(/\s+/g, ' ').trim()
  return cleaned === '' ? 'Sans titre' : cleaned
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/persistence/paths.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for `freeMindMapPath`**

Add to `src/persistence/fileOps.test.ts`, alongside the existing mocks:

```ts
vi.mock('./fileStore', () => ({ mindMapExists: vi.fn() }))
```

and, alongside the existing imports:

```ts
import { mindMapExists } from './fileStore'
import { freeMindMapPath } from './fileOps'
```

Then add:

```ts
describe('freeMindMapPath', () => {
  beforeEach(() => vi.mocked(mindMapExists).mockReset())

  it('returns the plain sanitized name when nothing collides', async () => {
    vi.mocked(mindMapExists).mockResolvedValue(false)
    const path = await freeMindMapPath('/cours', 'Vecteurs: Forces')
    expect(path).toBe('/cours/Vecteurs Forces.json')
  })

  it('appends a numbered suffix until it finds a free name', async () => {
    vi.mocked(mindMapExists)
      .mockResolvedValueOnce(true) // "Chapitre.json" taken
      .mockResolvedValueOnce(true) // "Chapitre (2).json" taken
      .mockResolvedValueOnce(false) // "Chapitre (3).json" free
    const path = await freeMindMapPath('/cours', 'Chapitre')
    expect(path).toBe('/cours/Chapitre (3).json')
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run src/persistence/fileOps.test.ts`
Expected: FAIL — `freeMindMapPath` does not exist yet.

- [ ] **Step 7: Add `freeMindMapPath` to `fileOps.ts`**

Add to `src/persistence/fileOps.ts`:

```ts
import { mindMapExists } from './fileStore'
import { sanitizeFileName } from './paths'
```

(alongside the existing imports), and:

```ts
/**
 * A free `<folderPath>/<baseName>[ (n)].json` path: the plain sanitized name
 * if free, else the first numbered variant that doesn't collide. Used when
 * writing a file whose name comes from external data (an XMind sheet title)
 * that could coincidentally match something already in the folder.
 */
export async function freeMindMapPath(folderPath: string, baseName: string): Promise<string> {
  const safe = sanitizeFileName(baseName)
  const separator = folderPath.includes('\\') ? '\\' : '/'
  let candidate = `${folderPath}${separator}${withJsonExtension(safe)}`
  let attempt = 1
  while (await mindMapExists(candidate)) {
    attempt += 1
    candidate = `${folderPath}${separator}${withJsonExtension(`${safe} (${attempt})`)}`
  }
  return candidate
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/persistence/fileOps.test.ts`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 9: Write the failing test for the sidebar wiring**

Add to `src/components/sidebar/FileTreeRow.test.tsx`, alongside the existing mocks:

```ts
vi.mock('../../persistence/exportIO', () => ({ pickXmindFile: vi.fn(), readBinaryFile: vi.fn() }))
vi.mock('../../xmind/importXmind', () => ({ readXmindFile: vi.fn() }))
vi.mock('../../persistence/fileStore', () => ({ loadMindMap: vi.fn(), saveMindMap: vi.fn() }))
```

(this replaces the narrower `../../persistence/fileStore` mock added in Task 13 — `saveMindMap` joins `loadMindMap` in the same mock factory), and, alongside the existing imports:

```ts
import { pickXmindFile, readBinaryFile } from '../../persistence/exportIO'
import { readXmindFile } from '../../xmind/importXmind'
import { saveMindMap } from '../../persistence/fileStore'
```

and inside `beforeEach`:

```ts
vi.mocked(pickXmindFile).mockReset()
vi.mocked(readBinaryFile).mockReset()
vi.mocked(readXmindFile).mockReset()
vi.mocked(saveMindMap).mockReset()
```

Then add these tests inside the top-level `describe('FileTreeRow', ...)` block:

```tsx
it('imports every sheet of a picked XMind file as its own .json in the folder, then refreshes it', async () => {
  const user = userEvent.setup()
  vi.mocked(pickXmindFile).mockResolvedValue('/downloads/vieux-cours.xmind')
  vi.mocked(readBinaryFile).mockResolvedValue(new Uint8Array([1]))
  vi.mocked(readXmindFile).mockResolvedValue([
    { sheetTitle: 'Chapitre 1', cards: [{ id: 'r1', level: 1, title: 'R1', parentId: null, order: 0 }] },
    { sheetTitle: 'Chapitre 2', cards: [{ id: 'r2', level: 1, title: 'R2', parentId: null, order: 0 }] },
  ])
  vi.mocked(scanFolder).mockResolvedValue([])
  const node: FileTreeNode = { type: 'folder', name: 'cours', path: '/cours', children: [] }
  render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot />)

  await user.click(screen.getByRole('button', { name: 'Importer XMind' }))

  await waitFor(() => expect(saveMindMap).toHaveBeenCalledTimes(2))
  expect(saveMindMap).toHaveBeenCalledWith('/cours/Chapitre 1.json', [
    { id: 'r1', level: 1, title: 'R1', parentId: null, order: 0 },
  ])
  expect(saveMindMap).toHaveBeenCalledWith('/cours/Chapitre 2.json', [
    { id: 'r2', level: 1, title: 'R2', parentId: null, order: 0 },
  ])
  expect(scanFolder).toHaveBeenCalledWith('/cours')
})

it('does nothing when the XMind file picker is cancelled', async () => {
  const user = userEvent.setup()
  vi.mocked(pickXmindFile).mockResolvedValue(null)
  const node: FileTreeNode = { type: 'folder', name: 'cours', path: '/cours', children: [] }
  render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot />)

  await user.click(screen.getByRole('button', { name: 'Importer XMind' }))

  expect(saveMindMap).not.toHaveBeenCalled()
})

it('reports an XMind import failure through the workspace error channel', async () => {
  const user = userEvent.setup()
  vi.mocked(pickXmindFile).mockResolvedValue('/downloads/corrompu.xmind')
  vi.mocked(readBinaryFile).mockResolvedValue(new Uint8Array([1]))
  vi.mocked(readXmindFile).mockRejectedValue(new Error('archive corrompue'))
  const node: FileTreeNode = { type: 'folder', name: 'cours', path: '/cours', children: [] }
  render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot />)

  await user.click(screen.getByRole('button', { name: 'Importer XMind' }))

  await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/corrompu\.xmind.*archive corrompue/))
})
```

- [ ] **Step 10: Run the tests to verify they fail**

Run: `npx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: FAIL — no "Importer XMind" button exists yet.

- [ ] **Step 11: Wire the XMind import button into `FileTreeRow.tsx`**

Add to the imports at the top of the file:

```ts
import { FileUp } from 'lucide-react' // add to the existing lucide-react import list
import { pickXmindFile, readBinaryFile } from '../../persistence/exportIO'
import { readXmindFile } from '../../xmind/importXmind'
import { saveMindMap } from '../../persistence/fileStore'
import { freeMindMapPath } from '../../persistence/fileOps'
```

(`loadMindMap` was already added in Task 13 — keep it alongside `saveMindMap` in the same `../../persistence/fileStore` import.)

Add this function alongside `submitCreate`/`submitRename`/`confirmDelete`/`openExport`:

```ts
async function handleImportXmind() {
  const path = await pickXmindFile()
  if (!path) return
  try {
    const bytes = await readBinaryFile(path)
    const sheets = await readXmindFile(bytes)
    for (const sheet of sheets) {
      const target = await freeMindMapPath(node.path, sheet.sheetTitle)
      await saveMindMap(target, sheet.cards)
    }
    await refreshFolder(node.path)
  } catch (error) {
    setWorkspaceError(`Impossible d’importer « ${fileNameOf(path)} » : ${describeError(error)}`)
  }
}
```

(`fileNameOf` is already imported in this file for the rename flow.)

In the `node.type === 'folder'` branch's `<TooltipProvider>`, add the button right after "Nouveau sous-dossier":

```tsx
<ActionButton label="Importer XMind" icon={FileUp} onClick={handleImportXmind} />
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `npx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: PASS (all tests, including the 3 new ones)

- [ ] **Step 13: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (every test in the project, old and new)

- [ ] **Step 14: Commit**

```bash
git add src/persistence/paths.ts src/persistence/paths.test.ts src/persistence/fileOps.ts src/persistence/fileOps.test.ts src/components/sidebar/FileTreeRow.tsx src/components/sidebar/FileTreeRow.test.tsx
git commit -m "feat: add the Importer XMind action to folder rows in the sidebar"
```

---

## Self-Review Notes

- **Spec coverage:** PDF export with recursive pagination → Tasks 2, 4, 6, 7, 8. Image export → Task 8 (`exportToImageDataUrls`) + Task 12 (multi-file save loop). "Afficher les définitions" toggle → Task 3/4 (`showDefinitions` prop) threaded through Task 8/12. "Inclure les cartes volantes" + dedicated final page → Task 2 (`includeDetached`). Visual fidelity to the canvas → Tasks 3/4 reuse `levelColor`/`toCss`/`computeLayout` directly. XMind import (Zen/2021 only, depth-fold beyond level 4, one file per sheet) → Task 9. XMind export (incl. synthetic "Cartes volantes" topic) → Task 10. Native save/open dialogs → Task 11. Sidebar wiring for both directions → Tasks 13, 14. Binary fs permissions → Task 1.
- **Type consistency:** `ExportPage` (Task 2) is consumed unchanged through Tasks 4, 6, 8. `CapturedPage` (Task 6) is consumed unchanged through Tasks 7, 8. `ExportOptions` (Task 8) matches the `{ showDefinitions, includeDetached }` shape used in Task 12's `handleExport`. `XmindSheetImport` (Task 9) is consumed unchanged in Task 14's import loop. `SaveFilter` (Task 11) matches the filter objects passed in Task 12/14.
- **Out of scope, per the spec:** exporting a manually selected sub-branch, the legacy XMind XML format, and improving the `transformer-cours-en-carte-mentale` skill are explicitly not part of this plan.
