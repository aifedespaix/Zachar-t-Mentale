# Graph Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A right-click anywhere on the mind-map canvas opens a menu to create a floating card, undo/redo, or export directly (PDF/Image/XMind, no dialog) — reusing the context-menu primitive and its never-yet-used submenu support from sub-project A.

**Architecture:** `MindMapCanvas.tsx` wraps its `<ReactFlow>` (inside a plain `<div>`, per the Radix `asChild`/React-Flow integration constraint) with the existing `ContextMenu` component. A new `addFloatingCard` reducer function + store action follows the exact shape of `addChild`/`addSibling`. Export reuses the exact functions `ExportDialog.tsx` already calls, with `dataUrlToBytes` extracted out of that file into `exportIO.ts` so both consumers share one implementation.

**Tech Stack:** React + TypeScript, `radix-ui` (ContextMenu, already built), `@xyflow/react`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-09-graph-menu-contextuel-design.md`

## Global Constraints

- No new npm dependency.
- `ContextMenuTrigger asChild` must wrap a plain DOM element (a `<div>`), never `<ReactFlow>` directly — Radix's `Slot` clones props like `onContextMenu`/`ref` onto its direct child, and `<ReactFlow>` is a strictly-typed third-party component that does not forward arbitrary props to its own root node.
- The wrapping `<div>` needs explicit `style={{ width: '100%', height: '100%' }}` — it sits inside a flex:1 parent (`<main>` in `App.tsx`) that gives it a real height, but React Flow itself needs that height passed down explicitly through the div, not implied.
- Export from the canvas uses fixed options (`showDefinitions: true, includeDetached: true`) and no dialog — this is a *separate* code path from the sidebar's `ExportDialog.tsx`, which is untouched.
- "Créer une carte volante" / "Annuler" / "Refaire" are hidden when `locked` is true (quiz mode); "Exporter" is always available.
- `tsconfig.json` has `noUnusedLocals`/`noUnusedParameters: true`.
- When a mock replaces a whole module that a moved/shared function now lives in, every test file mocking that module must be checked for whether it needs the real implementation preserved via `importOriginal` — this exact class of bug (a fully-mocked module missing a function another file now depends on) broke two previous sub-projects' test suites after merge.

---

### Task 1: Extract `dataUrlToBytes` into `exportIO.ts`

**Files:**
- Modify: `src/persistence/exportIO.ts`
- Modify: `src/components/sidebar/ExportDialog.tsx`
- Modify: `src/components/sidebar/ExportDialog.test.tsx`
- Test: `src/persistence/exportIO.test.ts`

**Interfaces:**
- Produces: `dataUrlToBytes(dataUrl: string): Uint8Array`, exported from `src/persistence/exportIO.ts` — a later task (Task 3) imports it from here too.

- [ ] **Step 1: Write the failing test**

Add to `src/persistence/exportIO.test.ts` (a new `describe` block, no new imports/mocks needed — it's a pure function):

```ts
describe('dataUrlToBytes', () => {
  it('decodes a base64 data URL into its raw bytes', () => {
    // "AAECAw==" is the base64 encoding of the bytes [0, 1, 2, 3]
    const bytes = dataUrlToBytes('data:image/png;base64,AAECAw==')
    expect(bytes).toEqual(new Uint8Array([0, 1, 2, 3]))
  })

  it('returns an empty array for a data URL with no comma-separated payload', () => {
    const bytes = dataUrlToBytes('not-a-data-url')
    expect(bytes).toEqual(new Uint8Array([]))
  })
})
```

Add `dataUrlToBytes` to the existing import line at the top of the file:

```ts
import { saveBytesAs, pickXmindFile, readBinaryFile, dataUrlToBytes } from './exportIO'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/persistence/exportIO.test.ts`
Expected: FAIL — `dataUrlToBytes` is not exported from `./exportIO`.

- [ ] **Step 3: Move the function and wire both consumers**

In `src/persistence/exportIO.ts`, add at the end of the file:

```ts
/** Decodes a base64 data URL (as produced by canvas/image capture) into raw bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? ''
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
```

In `src/components/sidebar/ExportDialog.tsx`:
1. Remove the private `dataUrlToBytes` function (currently defined right after the imports, before the `ExportDialog` component).
2. Add `dataUrlToBytes` to the existing import from `'../../persistence/exportIO'`:

```ts
import { saveBytesAs, dataUrlToBytes } from '../../persistence/exportIO'
```

The rest of `ExportDialog.tsx` is unchanged — it already calls `dataUrlToBytes(dataUrl)` exactly the same way, just now imported instead of locally defined.

**Critical fix in `src/components/sidebar/ExportDialog.test.tsx`:** this file currently mocks the whole `../../persistence/exportIO` module down to just `{ saveBytesAs: vi.fn(...) }`. Since `ExportDialog.tsx` now imports `dataUrlToBytes` from that same (mocked) module, the existing image-export test would call `undefined` as a function and crash. Fix the mock to keep every real export except `saveBytesAs`:

Replace:

```ts
vi.mock('../../persistence/exportIO', () => ({ saveBytesAs: vi.fn(async () => '/out/chapitre.pdf') }))
```

With:

```ts
vi.mock('../../persistence/exportIO', async importOriginal => {
  const actual = await importOriginal<typeof import('../../persistence/exportIO')>()
  return { ...actual, saveBytesAs: vi.fn(async () => '/out/chapitre.pdf') }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/persistence/exportIO.test.ts src/components/sidebar/ExportDialog.test.tsx`
Expected: PASS, all tests in both files (including the pre-existing image-export test in `ExportDialog.test.tsx`, which now exercises the real `dataUrlToBytes` again instead of a missing one).

- [ ] **Step 5: Commit**

```bash
git add src/persistence/exportIO.ts src/persistence/exportIO.test.ts src/components/sidebar/ExportDialog.tsx src/components/sidebar/ExportDialog.test.tsx
git commit -m "$(cat <<'EOF'
refactor(export): move dataUrlToBytes into exportIO, share it

Was private to ExportDialog.tsx; the graph's new canvas export path
needs the same conversion, so it moves next to saveBytesAs (which it
always accompanies) instead of being duplicated. ExportDialog.test.tsx's
mock of the module is fixed to keep every real export except
saveBytesAs, via importOriginal — a fully-replaced mock would have
made dataUrlToBytes undefined at the one call site that still needs it.
EOF
)"
```

---

### Task 2: `addFloatingCard` — reducer function and store action

**Files:**
- Modify: `src/state/cardsReducer.ts`
- Modify: `src/state/cardsReducer.test.ts`
- Modify: `src/state/useCardsStore.ts`
- Modify: `src/state/useCardsStore.test.ts`

**Interfaces:**
- Produces: `addFloatingCard(cards: Card[]): { cards: Card[]; newCardId: string }` in `cardsReducer.ts`; `nextDetachedOrder(cards: Card[]): number` becomes exported (was private, same file); `addFloatingCard: () => string` added to `CardsState`/`createCardsStore()` in `useCardsStore.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `src/state/cardsReducer.test.ts`, add `addFloatingCard, nextDetachedOrder` to the existing import from `./cardsReducer`:

```ts
import {
  createRootCard,
  addChild,
  addFloatingCard,
  nextDetachedOrder,
  addSibling,
  updateTitle,
  updateContent,
  updateDefinition,
  updateIcon,
  countDescendants,
  hasChildren,
  deleteCard,
  deleteCardDetachingChildren,
  detachCard,
  moveCard,
  moveCardToIndex,
  moveCardToParent,
  canMoveCardTo,
  flattenedCardCount,
  overflowingCardCount,
  subtreeDepths,
} from './cardsReducer'
```

Add a new `describe` block anywhere after `deepTree`'s definition (e.g. right after the `describe('detachCard', ...)` block):

```ts
describe('addFloatingCard', () => {
  it('creates a new floating card with no parent', () => {
    const root = createRootCard()
    const { cards, newCardId } = addFloatingCard([root])
    const card = cards.find(c => c.id === newCardId)!
    expect(card.detached).toBe(true)
    expect(card.parentId).toBeNull()
    expect(card.title).toBe('Nouveau titre')
    expect(card.order).toBe(0)
  })

  it('appends after existing floating cards', () => {
    const { cards, c } = deepTree()
    const detached = detachCard(cards, c)
    const { cards: next, newCardId } = addFloatingCard(detached)
    const card = next.find(x => x.id === newCardId)!
    expect(card.order).toBe(1)
  })

  it('does not mutate the input cards array', () => {
    const root = createRootCard()
    const before = structuredClone([root])
    addFloatingCard([root])
    expect([root]).toEqual(before)
  })
})

describe('nextDetachedOrder', () => {
  it('is 0 when there are no floating cards yet', () => {
    const root = createRootCard()
    expect(nextDetachedOrder([root])).toBe(0)
  })

  it('is one past the highest existing floating order', () => {
    const { cards, c } = deepTree()
    const detached = detachCard(cards, c)
    expect(nextDetachedOrder(detached)).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/state/cardsReducer.test.ts`
Expected: FAIL — `addFloatingCard`/`nextDetachedOrder` are not exported from `./cardsReducer`.

- [ ] **Step 3: Implement in `cardsReducer.ts`**

Change `function nextDetachedOrder` (currently private, around line 52) to `export function nextDetachedOrder`.

Add `addFloatingCard` right after `addSibling`'s definition:

```ts
/**
 * Creates a brand-new floating card, out of the hierarchy from the start.
 * Lands in the floating-cards zone's layout at whatever slot
 * `nextDetachedOrder` computes — no position math needed here, the grid
 * layout places every detached card the same way regardless of how it
 * became detached.
 */
export function addFloatingCard(cards: Card[]): { cards: Card[]; newCardId: string } {
  const newCard: Card = {
    id: crypto.randomUUID(),
    level: 1,
    title: 'Nouveau titre',
    parentId: null,
    detached: true,
    order: nextDetachedOrder(cards),
  }
  return { cards: [...cards, newCard], newCardId: newCard.id }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/state/cardsReducer.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing store test**

Add to `src/state/useCardsStore.test.ts`, anywhere inside the `describe('useCardsStore', ...)` block (e.g. right after the `'detachCard flattens a branch...'` test):

```ts
it('addFloatingCard adds a floating card and is undoable', () => {
  const store = createCardsStore()
  const newCardId = store.getState().addFloatingCard()
  expect(store.getState().history.present.find(c => c.id === newCardId)?.detached).toBe(true)

  store.getState().undo()
  expect(store.getState().history.present.find(c => c.id === newCardId)).toBeUndefined()
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/state/useCardsStore.test.ts`
Expected: FAIL — `store.getState().addFloatingCard` is not a function.

- [ ] **Step 7: Implement in `useCardsStore.ts`**

Add `addFloatingCard as addFloatingCardOp` to the existing import from `./cardsReducer`:

```ts
import {
  createRootCard,
  addChild as addChildOp,
  addFloatingCard as addFloatingCardOp,
  addSibling as addSiblingOp,
  updateTitle as updateTitleOp,
  updateDefinition as updateDefinitionOp,
  updateIcon as updateIconOp,
  updateContent as updateContentOp,
  deleteCard as deleteCardOp,
  deleteCardDetachingChildren as deleteCardDetachingChildrenOp,
  moveCardToIndex as moveCardToIndexOp,
  moveCardToParent as moveCardToParentOp,
  moveCard as moveCardOp,
  detachCard as detachCardOp,
  countDescendants,
  flattenedCardCount,
  overflowingCardCount,
  hasChildren as hasChildrenOp,
} from './cardsReducer'
```

Add `addFloatingCard: () => string` to the `CardsState` interface, right after `addSibling`:

```ts
  addFloatingCard: () => string
```

Add the implementation inside `createCardsStore()`'s returned object, right after `addSibling`'s implementation:

```ts
    addFloatingCard: () => {
      const { cards: next, newCardId } = addFloatingCardOp(get().history.present)
      set(state => ({ history: pushState(state.history, next) }))
      return newCardId
    },
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/state/useCardsStore.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/state/cardsReducer.ts src/state/cardsReducer.test.ts src/state/useCardsStore.ts src/state/useCardsStore.test.ts
git commit -m "$(cat <<'EOF'
feat(state): add addFloatingCard, creating a floating card from scratch

Same shape as addChild/addSibling. No position math needed: the
floating-cards zone's grid layout places any detached card the same
way regardless of how it became detached, so this just needs the next
free order in that zone (nextDetachedOrder, now exported alongside it).
EOF
)"
```

---

### Task 3: Wire the context menu into `MindMapCanvas.tsx`

**Files:**
- Modify: `src/components/MindMapCanvas.tsx`
- Modify: `src/components/MindMapCanvas.test.tsx`

**Interfaces:**
- Consumes: `ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent` from `./ui/context-menu` (sub-project A); `addFloatingCard: () => string` from `useCardsStore` (Task 2); `dataUrlToBytes` from `../persistence/exportIO` (Task 1); `exportToPdfBytes, exportToImageDataUrls` from `../export/exportMindMap`; `writeXmindFile` from `../xmind/exportXmind`; `saveBytesAs` from `../persistence/exportIO`; `describeExportError` from `../export/describeExportError`; `mindMapBaseName` from `../persistence/paths`; `currentFilePath` from `useWorkspaceStore`.

- [ ] **Step 1: Write the failing tests**

In `src/components/MindMapCanvas.test.tsx`, add `fireEvent` to the existing `@testing-library/react` import:

```ts
import { render, screen, act, within, fireEvent } from '@testing-library/react'
```

Add `useWorkspaceStore` right after the existing `useCardsStore` import:

```ts
import { useWorkspaceStore } from '../state/useWorkspaceStore'
```

Add these mocks right after the existing `vi.mock('@xyflow/react', ...)` block:

```ts
vi.mock('../export/exportMindMap', () => ({
  exportToPdfBytes: vi.fn(async () => new Uint8Array([1])),
  exportToImageDataUrls: vi.fn(async () => ['data:image/png;base64,AA==']),
}))
vi.mock('../xmind/exportXmind', () => ({ writeXmindFile: vi.fn(async () => new Uint8Array([2])) }))
vi.mock('../persistence/exportIO', async importOriginal => {
  const actual = await importOriginal<typeof import('../persistence/exportIO')>()
  return { ...actual, saveBytesAs: vi.fn(async () => '/out/carte-mentale.pdf') }
})

import { exportToPdfBytes, exportToImageDataUrls } from '../export/exportMindMap'
import { writeXmindFile } from '../xmind/exportXmind'
import { saveBytesAs } from '../persistence/exportIO'
```

Add this whole new `describe` block at the end of the file (after the existing `describe('MindMapCanvas', ...)`, `describe('carryMeasured', ...)`, etc. blocks — anywhere at the top level is fine):

```tsx
describe('MindMapCanvas — context menu', () => {
  function openMenu(container: HTMLElement) {
    fireEvent.contextMenu(container.querySelector('.react-flow')!)
  }

  beforeEach(() => {
    useCardsStore.getState().loadCards([root, child])
    useCardsStore.setState({ locked: false })
    useWorkspaceStore.setState({ currentFilePath: null })
    vi.mocked(exportToPdfBytes).mockClear()
    vi.mocked(exportToImageDataUrls).mockClear()
    vi.mocked(writeXmindFile).mockClear()
    vi.mocked(saveBytesAs).mockClear()
  })

  it('opens on right-click anywhere on the canvas', async () => {
    const { container } = render(<MindMapCanvas />)
    openMenu(container)
    expect(await screen.findByRole('menuitem', { name: /créer une carte volante/i })).toBeInTheDocument()
  })

  it('creates a floating card', async () => {
    const user = userEvent.setup()
    const { container } = render(<MindMapCanvas />)
    const before = useCardsStore.getState().history.present.length
    openMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: /créer une carte volante/i }))
    expect(useCardsStore.getState().history.present).toHaveLength(before + 1)
    expect(useCardsStore.getState().history.present.some(c => c.detached)).toBe(true)
  })

  it('hides creation/undo/redo but keeps export when the map is locked', async () => {
    useCardsStore.setState({ locked: true })
    const { container } = render(<MindMapCanvas />)
    openMenu(container)
    expect(screen.queryByRole('menuitem', { name: /créer une carte volante/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Annuler' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Refaire' })).not.toBeInTheDocument()
    expect(await screen.findByRole('menuitem', { name: /exporter/i })).toBeInTheDocument()
  })

  it('disables Annuler when there is no history and Refaire when there is no future', async () => {
    const { container } = render(<MindMapCanvas />)
    openMenu(container)
    expect(await screen.findByRole('menuitem', { name: 'Annuler' })).toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: 'Refaire' })).toHaveAttribute('data-disabled')
  })

  it('enables Annuler after a change and undoes it', async () => {
    const user = userEvent.setup()
    const { container } = render(<MindMapCanvas />)
    act(() => {
      useCardsStore.getState().addFloatingCard()
    })
    const countAfterAdd = useCardsStore.getState().history.present.length
    openMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: 'Annuler' }))
    expect(useCardsStore.getState().history.present).toHaveLength(countAfterAdd - 1)
  })

  it('exports to PDF via the submenu, using the workspace file name', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ currentFilePath: '/cours/chapitre1.zmap' })
    const { container } = render(<MindMapCanvas />)
    openMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: /exporter/i }))
    await user.click(await screen.findByRole('menuitem', { name: 'PDF' }))
    expect(exportToPdfBytes).toHaveBeenCalledWith(useCardsStore.getState().history.present, {
      showDefinitions: true,
      includeDetached: true,
      mindMapPath: '/cours/chapitre1.zmap',
    })
    expect(saveBytesAs).toHaveBeenCalledWith(new Uint8Array([1]), 'chapitre1.pdf', [
      { name: 'PDF', extensions: ['pdf'] },
    ])
  })

  it('exports to XMind via the submenu, defaulting the file name when nothing is open', async () => {
    const user = userEvent.setup()
    const { container } = render(<MindMapCanvas />)
    openMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: /exporter/i }))
    await user.click(await screen.findByRole('menuitem', { name: 'XMind' }))
    expect(writeXmindFile).toHaveBeenCalledWith(useCardsStore.getState().history.present)
    expect(saveBytesAs).toHaveBeenCalledWith(new Uint8Array([2]), 'carte-mentale.xmind', [
      { name: 'XMind', extensions: ['xmind'] },
    ])
  })

  it('shows an error banner when the export fails', async () => {
    const user = userEvent.setup()
    vi.mocked(exportToPdfBytes).mockRejectedValueOnce(new Error('disque plein'))
    const { container } = render(<MindMapCanvas />)
    openMenu(container)
    await user.click(await screen.findByRole('menuitem', { name: /exporter/i }))
    await user.click(await screen.findByRole('menuitem', { name: 'PDF' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/disque plein/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/MindMapCanvas.test.tsx`
Expected: FAIL on every test in the new `describe` block — no context menu exists yet on the canvas. (The pre-existing tests keep passing unaffected.)

- [ ] **Step 3: Wire the menu into the component**

In `src/components/MindMapCanvas.tsx`:

Add a `lucide-react` import (this file has none yet) right after the `import '@xyflow/react/dist/style.css'` line:

```ts
import { Sparkles, Undo2, Redo2, Download, X } from 'lucide-react'
```

Add these imports right after it:

```ts
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent } from './ui/context-menu'
import { useWorkspaceStore } from '../state/useWorkspaceStore'
import { exportToPdfBytes, exportToImageDataUrls } from '../export/exportMindMap'
import { writeXmindFile } from '../xmind/exportXmind'
import { saveBytesAs, dataUrlToBytes } from '../persistence/exportIO'
import { describeExportError } from '../export/describeExportError'
import { mindMapBaseName } from '../persistence/paths'
```

Inside the `MindMapCanvas` component function, right after the existing `const moveCard = useCardsStore(s => s.moveCard)` line (around line 294):

```ts
  const addFloatingCard = useCardsStore(s => s.addFloatingCard)
  const undo = useCardsStore(s => s.undo)
  const redo = useCardsStore(s => s.redo)
  const canUndo = useCardsStore(s => s.history.past.length > 0)
  const canRedo = useCardsStore(s => s.history.future.length > 0)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const [exportError, setExportError] = useState<string | null>(null)
```

(`useState` is already imported at the top of this file.)

Add this function anywhere inside the component, before the `return` statement:

```ts
  async function exportFromCanvas(format: 'pdf' | 'image' | 'xmind') {
    const options = { showDefinitions: true, includeDetached: true, mindMapPath: currentFilePath }
    const baseName = currentFilePath ? mindMapBaseName(currentFilePath) : 'carte-mentale'
    try {
      if (format === 'pdf') {
        const bytes = await exportToPdfBytes(cards, options)
        await saveBytesAs(bytes, `${baseName}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }])
      } else if (format === 'image') {
        const dataUrls = await exportToImageDataUrls(cards, options)
        for (const [index, dataUrl] of dataUrls.entries()) {
          const suffix = dataUrls.length > 1 ? ` (${index + 1})` : ''
          const path = await saveBytesAs(dataUrlToBytes(dataUrl), `${baseName}${suffix}.png`, [
            { name: 'Image PNG', extensions: ['png'] },
          ])
          if (path === null) break
        }
      } else {
        const bytes = await writeXmindFile(cards)
        await saveBytesAs(bytes, `${baseName}.xmind`, [{ name: 'XMind', extensions: ['xmind'] }])
      }
    } catch (error) {
      setExportError(`Échec de l’export : ${describeExportError(error)}`)
    }
  }
```

Replace the `return (...)` block. The current one is:

```tsx
  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        fitView
        colorMode={theme}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>

      {pendingMove && (
        <Dialog open onOpenChange={open => !open && setPendingMove(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{overflowWarningMessage(pendingMove.overflowCount)}</DialogTitle>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPendingMove(null)}>
                Annuler
              </Button>
              <Button
                onClick={() => {
                  moveCard(pendingMove.cardId, pendingMove.parentId, pendingMove.index)
                  setPendingMove(null)
                }}
              >
                Confirmer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
```

Replace it with:

```tsx
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div style={{ width: '100%', height: '100%' }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              nodeTypes={nodeTypes}
              onNodeDragStart={handleNodeDragStart}
              onNodeDrag={handleNodeDrag}
              onNodeDragStop={handleNodeDragStop}
              fitView
              colorMode={theme}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {!locked && (
            <>
              <ContextMenuItem onSelect={() => addFloatingCard()}>
                <Sparkles size={14} /> Créer une carte volante
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem disabled={!canUndo} onSelect={undo}>
                <Undo2 size={14} /> Annuler
              </ContextMenuItem>
              <ContextMenuItem disabled={!canRedo} onSelect={redo}>
                <Redo2 size={14} /> Refaire
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Download size={14} /> Exporter
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onSelect={() => exportFromCanvas('pdf')}>PDF</ContextMenuItem>
              <ContextMenuItem onSelect={() => exportFromCanvas('image')}>Image</ContextMenuItem>
              <ContextMenuItem onSelect={() => exportFromCanvas('xmind')}>XMind</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>

      {exportError && (
        <div role="alert" className="status-banner">
          <span style={{ flex: 1 }}>{exportError}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Masquer le message d’erreur"
            onClick={() => setExportError(null)}
          >
            <X size={14} />
          </Button>
        </div>
      )}

      {pendingMove && (
        <Dialog open onOpenChange={open => !open && setPendingMove(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{overflowWarningMessage(pendingMove.overflowCount)}</DialogTitle>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPendingMove(null)}>
                Annuler
              </Button>
              <Button
                onClick={() => {
                  moveCard(pendingMove.cardId, pendingMove.parentId, pendingMove.index)
                  setPendingMove(null)
                }}
              >
                Confirmer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/MindMapCanvas.test.tsx`
Expected: PASS, all tests (pre-existing plus the new context-menu block).

Also run the full suite once, since this is the last task of the plan:

Run: `npx vitest run`
Expected: PASS, all test files, exit code 0, no unhandled-rejection errors.

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add src/components/MindMapCanvas.tsx src/components/MindMapCanvas.test.tsx
git commit -m "$(cat <<'EOF'
feat(graph): add a right-click context menu to the canvas

Create a floating card, undo/redo (hidden during a quiz, same as the
card-level structural buttons), and a direct-export submenu
(PDF/Image/XMind, no dialog — the submenu choice IS the format).
First real use of the ContextMenuSub/SubTrigger/SubContent primitives
built in sub-project A.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** menu contents and quiz-lock gating (Task 3), `addFloatingCard` with no position math (Task 2), direct export with fixed options and shared `dataUrlToBytes` (Tasks 1 and 3), the `asChild`/`<div>`/React-Flow integration constraint (Task 3) — all covered. `computeLayout`, `CardNode.tsx`, and the sidebar's `ExportDialog.tsx` dialog flow are all confirmed untouched (Task 1 only extracts a helper `ExportDialog.tsx` already used identically; nothing about its own behavior changes).
- **Type consistency:** `addFloatingCard(cards: Card[]): { cards: Card[]; newCardId: string }` (Task 2) matches the shape `useCardsStore.ts`'s `addFloatingCard: () => string` action destructures. `dataUrlToBytes(dataUrl: string): Uint8Array` (Task 1) matches its call site in both `ExportDialog.tsx` and Task 3's `exportFromCanvas`.
- **Cross-task mock hygiene:** Task 1 explicitly fixes `ExportDialog.test.tsx`'s mock of `../../persistence/exportIO` to preserve `dataUrlToBytes` via `importOriginal` — the exact bug class (a fully-mocked module missing a function another file now needs) that broke test suites in sub-projects A and B after their respective merges. Task 3's own new mock of `../persistence/exportIO` in `MindMapCanvas.test.tsx` uses the same `importOriginal` pattern from the start, for the same reason (it needs the real `dataUrlToBytes` alongside a mocked `saveBytesAs`).
