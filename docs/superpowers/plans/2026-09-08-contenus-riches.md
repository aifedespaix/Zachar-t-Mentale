# Contenus riches dans les cartes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-`string` card definition with a list of typed blocks — text, math (LaTeX), image, table — editable from the existing definition popover through an input-mode selector, so a maths card can hold a real stacked fraction instead of `20/100 x 425`, and so a SVT card can hold a diagram. Every existing file keeps opening unchanged, and every export path carries the new content.

**Architecture:** `Card` gains an optional `content?: CardBlock[]`. When it is present, `definition` becomes a **derived plain-text mirror**, written by a single store action (`updateContent`) through one projection function (`blocksToPlainText`) — so the quiz, the XMind export and the validation keep reading the field they already read, degraded but never empty, and nothing can make the two fields disagree. A card whose content is a single text block stores no `content` at all (`normalizeContent`), so the overwhelming majority of existing files stay byte-identical. A shared read-only renderer (`BlockView`) is used by BOTH the popover and the export's `StaticCardView`, parameterized only by how it resolves an image asset — live (`convertFileSrc`) or inlined as a data URI (export). Images live in a sidecar `<carte>.assets/` folder next to the `.json`, content-addressed by SHA-256, never base64 inside the JSON that autosave rewrites on every keystroke.

**Tech Stack:** React 19 + TypeScript, `katex` (new, display + `contrib/mhchem` for chemistry/physics), `mathlive` (new, WYSIWYG editing, dynamically imported), `@tauri-apps/plugin-fs` (binary read/write, already permitted), `@tauri-apps/plugin-dialog` (file picker, already used), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-08-contenus-riches-cartes-design.md`
**Spike:** `docs/superpowers/spikes/2026-09-08-contenus-riches/` (KaTeX and abcjs survive the capture pipeline; a cross-origin image makes the whole export throw)

## Global Constraints

- **`definition` is never written by hand when `content` exists.** Exactly one function computes it (`blocksToPlainText`) and exactly one store action writes both (`updateContent`). Any other write path is a bug (spec: « Règle d'or »).
- **`normalizeContent` runs before every write.** A `content` that is one single `text` block is stored as `definition` alone, with `content` deleted — an existing plain-text card that is merely re-saved must not gain a `content` field.
- **The card's footprint never depends on the definition's content.** Rich content lives in the popover; the card node shows at most a fixed-height badge row (spec: règle anti-décalage 1).
- **An image reserves its box before decoding.** `width`/`height` are captured at insertion and rendered as an `aspect-ratio` placeholder — never a box that grows when the file arrives (règle 5).
- **Math renders synchronously.** KaTeX only, on the display path. No async engine anywhere in a render (règle 4).
- **KaTeX CSS comes from the bundle, never a CDN.** Cross-origin stylesheets make `html-to-image` unable to read `cssRules`, and the fonts then never get embedded in the export (spike, résultat 1).
- **Switching a block's mode never destroys content** — text ↔ math round-trips through the same string (règle 6).
- **Unknown block kinds degrade to text, they never reject the card.** This is what makes `code`/`music`/`audio` addable later without a migration, and what lets a file written by a newer version open in an older one.
- **Assets are addressed relative to the sidecar**, never by absolute path — an absolute path breaks the moment the workspace moves.
- **Never garbage-collect unreferenced assets during autosave.** Deleting an image block then pressing `Ctrl+Z` must find the file still there (spec: cycle de vie, piège 2).
- New dependencies use whatever `bun add` resolves as latest stable, matching the project-wide convention set in lot 1.

## A simplification that fell out of sequencing this

The design listed the export overlap (point 2) and the pagination budget (point 5) as two separate problems. They are one. `computeLayout` places rows on a fixed `ROW_HEIGHT = 168` grid while an export card is `EXPORT_CARD_HEIGHT = 120` — 48 px of slack. **If the export card is hard-capped below the row pitch, overlap becomes impossible AND the existing leaf-count budget stays correct**, so `paginateForExport` needs no change at all in v1. Point 5 only comes back for the future « fiche de révision » format, where cards are deliberately allowed to grow. Task 12 implements the cap; there is no pagination task.

---

## Task 1: The block model and its plain-text projection

**Files:**
- Create: `src/types/cardBlock.ts`
- Create: `src/content/blocks.ts`
- Create: `src/content/blocks.test.ts`

**Interfaces:**
- Produces:
  - `CardBlock` (discriminated union on `kind`: `text` | `math` | `image` | `table`)
  - `blocksToPlainText(blocks: CardBlock[]): string`
  - `latexToPlainText(latex: string): string`
  - `normalizeContent(blocks: CardBlock[]): { content?: CardBlock[]; definition?: string }`
  - `contentOf(card: Card): CardBlock[]` — the reading adapter: `card.content` when present, else a single `text` block from `card.definition`, else `[]`
- Consumed by: every later task.

- [ ] **Step 1: Write the failing tests**

```ts
// src/content/blocks.test.ts
import { describe, it, expect } from 'vitest'
import { blocksToPlainText, latexToPlainText, normalizeContent, contentOf } from './blocks'
import type { CardBlock } from '../types/cardBlock'

describe('latexToPlainText', () => {
  it('renders the common collège forms in unicode', () => {
    expect(latexToPlainText('\\frac{20}{100} \\times 425')).toBe('20/100 × 425')
    expect(latexToPlainText('x^2 + \\sqrt{2}')).toBe('x² + √2')
    expect(latexToPlainText('a \\div b \\leq c')).toBe('a ÷ b ≤ c')
  })

  it('falls back to the raw LaTeX rather than losing anything it cannot map', () => {
    expect(latexToPlainText('\\oint_C \\vec{F}')).toContain('\\oint')
  })
})

describe('blocksToPlainText', () => {
  it('never yields an empty string for a card that holds only an image', () => {
    const blocks: CardBlock[] = [{ kind: 'image', asset: 'a1.png', alt: 'Cycle de l’eau', width: 200, height: 90 }]
    expect(blocksToPlainText(blocks)).toBe('[image : Cycle de l’eau]')
  })

  it('joins mixed blocks in order', () => {
    const blocks: CardBlock[] = [
      { kind: 'text', text: 'On garde le signe du plus éloigné de zéro.' },
      { kind: 'math', latex: '(+10) + (-4) = +6' },
    ]
    expect(blocksToPlainText(blocks)).toBe('On garde le signe du plus éloigné de zéro.\n(+10) + (-4) = +6')
  })
})

describe('normalizeContent', () => {
  it('stores a lone text block as `definition` only, so an existing file gains no `content`', () => {
    expect(normalizeContent([{ kind: 'text', text: 'Un nombre positif, négatif, ou zéro.' }]))
      .toEqual({ definition: 'Un nombre positif, négatif, ou zéro.' })
  })

  it('drops empty blocks, and yields neither field when nothing is left', () => {
    expect(normalizeContent([{ kind: 'text', text: '   ' }])).toEqual({})
  })

  it('keeps `content` and derives `definition` as soon as a block is not plain text', () => {
    const blocks: CardBlock[] = [{ kind: 'math', latex: 'x^2' }]
    expect(normalizeContent(blocks)).toEqual({ content: blocks, definition: 'x²' })
  })
})

describe('contentOf', () => {
  it('presents a legacy definition-only card as one text block', () => {
    const card = { id: 'a', level: 2 as const, title: 'T', parentId: 'r', order: 0, definition: 'Règle' }
    expect(contentOf(card)).toEqual([{ kind: 'text', text: 'Règle' }])
  })
})
```

Also cover: a `table` block projecting as ` | `-joined rows; `blocksToPlainText([])` returning `''`; `normalizeContent` preserving block order.

- [ ] **Step 2: Implement**

`latexToPlainText` is a small ordered list of regex replacements (`\frac{a}{b}` → `a/b`, `^2`/`^3` → `²`/`³`, `\sqrt{x}` → `√x`, `\times` → `×`, `\div` → `÷`, `\leq`/`\geq` → `≤`/`≥`, `\pi` → `π`), then a strip of the remaining `\command` braces. It is deliberately partial: anything unmapped survives as raw LaTeX, because the contract is « jamais de champ vide », not « rendu fidèle ».

- [ ] **Step 3: Verify** — `npx vitest run src/content/blocks.test.ts`
- [ ] **Step 4: Commit** — `feat(content): add the CardBlock model and its plain-text projection`

---

## Task 2: Validate and repair `content`

**Files:**
- Modify: `src/validation/cardsValidation.ts`
- Modify: `src/validation/cardsValidation.test.ts`

**Interfaces:**
- Consumes: `CardBlock`, `contentOf` (Task 1).
- Produces: `sanitizeContent(value: unknown): CardBlock[] | undefined` — per-block validation that degrades rather than rejects.
- Consumed by: the load path, unchanged otherwise.

- [ ] **Step 1: Write the failing tests**

```ts
it('keeps a card whose only content is an image, instead of dropping it', () => {
  // salvage() currently returns null when title === '' && definition === undefined
  const repaired = repairCards([
    { id: 'r', level: 1, title: 'Racine', parentId: null, order: 0 },
    { id: 'x', level: 9, title: '', parentId: 'ghost', order: 0,
      content: [{ kind: 'image', asset: 'a1.png', alt: 'Schéma', width: 100, height: 50 }] },
  ])
  expect(repaired.some(c => c.id === 'x' || c.content?.[0]?.kind === 'image')).toBe(true)
})

it('degrades an unknown block kind to text rather than rejecting the card', () => {
  const report = validateCards([
    { id: 'r', level: 1, title: 'R', parentId: null, order: 0,
      content: [{ kind: 'music', abc: 'X:1' }], definition: '[partition]' },
  ])
  expect(report.valid).toBe(true)
})

it('rejects a malformed block payload (image without an asset)', () => {
  expect(sanitizeContent([{ kind: 'image', alt: 'x' }])).toBeUndefined()
})
```

- [ ] **Step 2: Implement**

Extend `isUsableCardRecord` with `if (value.content !== undefined && !Array.isArray(value.content)) return false` — nothing stricter, because per-block problems are *degraded*, not fatal. `sanitizeContent` maps each entry: a known `kind` with a well-formed payload passes through, anything else becomes `{ kind: 'text', text: <projection or '' > }`, and an entry with no salvageable text is dropped. Update `salvage()` so `content` counts as recoverable material alongside `title`/`definition`.

- [ ] **Step 3: Verify** — `npx vitest run src/validation/`
- [ ] **Step 4: Commit** — `fix(validation): validate card content blocks, degrade unknown kinds instead of dropping cards`

---

## Task 3: `updateContent` — the single writer

**Files:**
- Modify: `src/state/cardsReducer.ts`
- Modify: `src/state/cardsReducer.test.ts`
- Modify: `src/state/useCardsStore.ts`
- Modify: `src/state/useCardsStore.test.ts`

**Interfaces:**
- Produces: `updateContent(cards: Card[], cardId: string, blocks: CardBlock[]): Card[]` and the store action `updateContent(id: string, blocks: CardBlock[]): void`.
- `updateDefinition` stays, and is redefined in terms of `updateContent([{ kind: 'text', text }])` so there is genuinely one write path.

- [ ] **Step 1: Write the failing tests**

```ts
it('writes content and its derived definition together', () => {
  const next = updateContent(cards, 'a', [{ kind: 'math', latex: 'x^2' }])
  const card = next.find(c => c.id === 'a')!
  expect(card.content).toEqual([{ kind: 'math', latex: 'x^2' }])
  expect(card.definition).toBe('x²')
})

it('drops `content` entirely when the blocks normalize back to plain text', () => {
  const withMath = updateContent(cards, 'a', [{ kind: 'math', latex: 'x^2' }])
  const backToText = updateContent(withMath, 'a', [{ kind: 'text', text: 'Une règle' }])
  const card = backToText.find(c => c.id === 'a')!
  expect(card.content).toBeUndefined()
  expect(card.definition).toBe('Une règle')
})

it('pushes exactly one undo entry per content change', () => { /* … */ })
```

- [ ] **Step 2: Implement** — apply `normalizeContent`, then set/delete `content` and `definition` on the card. Never mutate.
- [ ] **Step 3: Verify** — `npx vitest run src/state/`
- [ ] **Step 4: Commit** — `feat(state): add updateContent as the single writer of content and its derived definition`

---

## Task 4: KaTeX rendering helper

**Files:**
- Create: `src/content/renderMath.ts`
- Create: `src/content/renderMath.test.ts`
- Modify: `src/index.css` (import `katex/dist/katex.min.css` through the bundler)
- Modify: `package.json` (`bun add katex`)

**Interfaces:**
- Produces: `renderMathToHtml(latex: string, display: boolean): string` — `katex.renderToString` with `throwOnError: false` and the mhchem extension loaded, so `\ce{2H2 + O2 -> 2H2O}` works.

- [ ] **Step 1: Write the failing tests** — a formula produces markup containing `katex`; an invalid formula returns markup rather than throwing; `\ce{H2O}` renders (mhchem is wired).
- [ ] **Step 2: Implement** — `import 'katex/contrib/mhchem'` after the katex import; the CSS import goes in `src/index.css`, **never** a CDN `<link>` (Global Constraints).
- [ ] **Step 3: Verify** — `npx vitest run src/content/renderMath.test.ts`
- [ ] **Step 4: Commit** — `feat(content): render math with KaTeX and mhchem`

---

## Task 5: `BlockView` — the shared read-only renderer

**Files:**
- Create: `src/content/BlockView.tsx`
- Create: `src/content/BlockView.test.tsx`

**Interfaces:**
- Consumes: `CardBlock`, `renderMathToHtml`.
- Produces: `BlockView({ blocks, resolveAsset }: { blocks: CardBlock[]; resolveAsset: (asset: string) => string })`.
- Consumed by: Task 6 (popover), Task 12 (`StaticCardView`). **This component is the seam that keeps the screen and the PDF identical** — neither caller may render blocks itself.

- [ ] **Step 1: Write the failing tests**

```ts
it('reserves an image box from the stored dimensions, before any load event', () => {
  render(<BlockView blocks={[{ kind: 'image', asset: 'a1.png', alt: 'Schéma', width: 200, height: 100 }]}
                    resolveAsset={a => `/x/${a}`} />)
  const img = screen.getByAltText('Schéma')
  expect(img).toHaveStyle({ aspectRatio: '200 / 100' })
})

it('shows a named placeholder when an asset cannot be resolved, never an empty box', () => {
  render(<BlockView blocks={[{ kind: 'image', asset: 'missing.png', alt: '', width: 10, height: 10 }]}
                    resolveAsset={() => ''} />)
  expect(screen.getByText(/missing\.png/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Implement** — math via `dangerouslySetInnerHTML` on the KaTeX markup (the input is the user's own LaTeX, and KaTeX escapes its output); image with `aspectRatio` and `max-width: 100%`; table as a plain `<table>`.
- [ ] **Step 3: Verify** — `npx vitest run src/content/BlockView.test.tsx`
- [ ] **Step 4: Commit** — `feat(content): add the shared read-only block renderer`

---

## Task 6: The block editor and its mode selector

**Files:**
- Create: `src/content/BlockEditor.tsx`
- Create: `src/content/BlockEditor.test.tsx`
- Modify: `src/components/DefinitionPopover.tsx`
- Modify: `src/components/DefinitionPopover.test.tsx`

**Interfaces:**
- Produces: `BlockEditor({ blocks, onCommit, locked })`.
- The popover keeps its current contract with `CardNode` but swaps its `<p>`/`<textarea>` pair for `BlockView`/`BlockEditor`.

- [ ] **Step 1: Write the failing tests**

```ts
it('keeps the popover box a fixed width whatever the content', () => { /* règle 2 */ })

it('converts a text block to math in place when the user types $$', () => { /* raccourci */ })

it('keeps the text when switching a block from math back to text', () => {
  // règle 6 : réversible, donc explorable sans peur
})

it('does not resize the card when a definition gains a formula', () => { /* règle 1 */ })
```

- [ ] **Step 2: Implement** — the mode selector is a segmented control in the popover's **existing** fixed-height header (`DefinitionPopover.tsx:62-72`), so revealing it shifts nothing. Insertion goes through a permanent `+` gutter, never a hover toolbar (règle 7). `$$` in a text block converts it in place; `Ctrl+M` inserts a math block.
- [ ] **Step 3: Verify** — `npx vitest run src/content/ src/components/DefinitionPopover.test.tsx`
- [ ] **Step 4: Commit** — `feat(content): edit definitions as blocks, with an input-mode selector`

---

## Task 7: MathLive as the formula editor

**Files:**
- Create: `src/content/MathFieldEditor.tsx`
- Create: `src/content/MathFieldEditor.test.tsx`
- Modify: `package.json` (`bun add mathlive`)

**Interfaces:**
- Produces: `MathFieldEditor({ latex, onChange })` — a `<math-field>` wrapper.
- **Loaded through a dynamic `import()`**, on first edit of a math block only, so app startup pays nothing for it.

- [ ] **Step 1: Write the failing tests** — renders a fallback textarea until the module resolves; emits LaTeX on change; seeds from the block's existing `latex`.
- [ ] **Step 2: Implement** — a `useRef` callback on the custom element (JSX cannot pass a LaTeX string through props safely: both use braces).
- [ ] **Step 3: Verify** — `npx vitest run src/content/MathFieldEditor.test.tsx`
- [ ] **Step 4: Commit** — `feat(content): edit formulas with MathLive, loaded on demand`

---

## Task 8: Sidecar asset storage

**Files:**
- Create: `src/persistence/assets.ts`
- Create: `src/persistence/assets.test.ts`

**Interfaces:**
- Produces:
  - `sidecarDirOf(mindMapPath: string): string` — `chapitre.json` → `chapitre.assets`, built with `parentDirOf`/`separatorOf` from `paths.ts` so Windows paths keep their backslashes
  - `writeAsset(mindMapPath: string, bytes: Uint8Array, ext: string): Promise<string>` — SHA-256 content addressing, so pasting the same image twice costs one file
  - `readAssetBytes(mindMapPath: string, asset: string): Promise<Uint8Array>`
  - `assetSrc(mindMapPath: string, asset: string): string` — `convertFileSrc` for live display

- [ ] **Step 1: Write the failing tests** — `sidecarDirOf` on both separators; the same bytes twice yield the same name and one write; a name is never an absolute path.
- [ ] **Step 2: Implement** — `crypto.subtle.digest('SHA-256', bytes)`; downscale beyond ~1600 px and refuse beyond ~10 Mo, with a message (spec: garde-fous).
- [ ] **Step 3: Verify** — `npx vitest run src/persistence/assets.test.ts`
- [ ] **Step 4: Commit** — `feat(persistence): store card images in a sidecar folder, content-addressed`

---

## Task 9: The three image entry points

**Files:**
- Create: `src/hooks/useImageInsertion.ts`
- Create: `src/hooks/useImageInsertion.test.ts`
- Modify: `src/hooks/useFileDropZone.ts` (route by extension instead of rejecting non-`.json`)
- Modify: `src/hooks/useFileDropZone.test.ts`

**Interfaces:**
- Produces: `useImageInsertion({ onInsert })` covering paste, drop and picker.

- [ ] **Step 1: Write the failing tests** — `Ctrl+V` with an image item inserts a block carrying the decoded `width`/`height`; a dropped `.png` inserts, a dropped `.json` still opens the map; the picker filters to image extensions.
- [ ] **Step 2: Implement** — **the DOM `drop` event never fires under Tauri** (`useFileDropZone.ts` header comment): reuse its window-level event and its physical→logical pixel conversion. When a popover is open it wins the drop over the canvas (spec, drag & drop, conséquence 2). Paste reads `clipboardData.items`; the `@tauri-apps/plugin-clipboard-manager` fallback is **deferred to spike 3** — do not add the dependency until that spike says the webview path is insufficient.
- [ ] **Step 3: Verify** — `npx vitest run src/hooks/`
- [ ] **Step 4: Commit** — `feat(content): insert images by paste, drop, or file picker`

---

## Task 10: Asset lifecycle in file operations

**Files:**
- Modify: `src/persistence/fileOps.ts`
- Modify: `src/persistence/fileOps.test.ts`

**Interfaces:**
- `renamePath` and `deletePath` carry the sidecar folder with the `.json`.

- [ ] **Step 1: Write the failing tests** — renaming `chapitre.json` renames `chapitre.assets`; deleting removes both; a map with no sidecar is unaffected; a rename whose sidecar is missing still succeeds.
- [ ] **Step 2: Implement** — best-effort on the sidecar: a failure to move it must not lose the `.json` rename that already succeeded; surface it through the existing `setWorkspaceError` channel.
- [ ] **Step 3: Verify** — `npx vitest run src/persistence/fileOps.test.ts`
- [ ] **Step 4: Commit** — `fix(persistence): carry the asset sidecar through rename and delete`

---

## Task 11: The table block

**Files:**
- Modify: `src/content/BlockView.tsx`, `src/content/BlockEditor.tsx` (+ tests)

- [ ] **Step 1: Write the failing tests** — a table renders its header and rows; adding/removing a column keeps every row the same length; the plain-text projection joins with ` | `.
- [ ] **Step 2: Implement** — no dependency, an editable `<table>`.
- [ ] **Step 3: Verify** — `npx vitest run src/content/`
- [ ] **Step 4: Commit** — `feat(content): add the table block`

---

## Task 12: Export — render blocks, inline assets, cap the height

**Files:**
- Modify: `src/export/StaticCardView.tsx` (+ test)
- Create: `src/export/inlineAssets.ts` (+ test)
- Modify: `src/export/renderPagesToImages.tsx` (+ test)
- Modify: `src/components/sidebar/ExportDialog.tsx` (+ test)

**Interfaces:**
- Produces: `inlineAssets(cards: Card[], mindMapPath: string): Promise<Map<string, string>>` — asset name → data URI.
- `StaticCardView` gains `resolveAsset` and renders through `BlockView` (Task 5).

- [ ] **Step 1: Write the failing tests**

```ts
it('renders a math block in the export card, not its LaTeX source', () => { /* point 1 */ })

it('never exceeds the row pitch, so a picture card cannot overlap its neighbour', () => {
  // EXPORT_CARD_MAX_HEIGHT < ROW_HEIGHT (168) — voir « une simplification » ci-dessus
})

it('reports a readable message when toPng rejects with an Event rather than an Error', () => {
  // ExportDialog affiche aujourd'hui « erreur inconnue » sur ce cas (spike, résultat 3)
})
```

- [ ] **Step 2: Implement**

Three things, in this order:
1. `StaticCardView` renders `contentOf(card)` through `BlockView`, resolving assets from the inlined map.
2. `inlineAssets` reads every referenced asset and encodes it as a data URI **before** any capture. This is not an optimization: the spike showed a cross-origin `asset:` URL makes `toPng` **reject the whole page**, so without this the export throws rather than losing an image.
3. `EXPORT_CARD_MAX_HEIGHT = ROW_HEIGHT - 16` with `overflow: hidden` on the card. `computeLayout` and `paginateForExport` stay untouched.

Also normalize the `catch` in `ExportDialog`: `toPng` rejects with an `Event`, not an `Error`, so the current `error instanceof Error ? … : 'erreur inconnue'` hides the real cause.

- [ ] **Step 3: Verify** — `npx vitest run src/export/ src/components/sidebar/ExportDialog.test.tsx`
- [ ] **Step 4: Commit** — `fix(export): render content blocks, inline image assets, and cap card height`

---

## Task 13: Quiz — read the projection, not the raw field

**Files:**
- Modify: `src/state/quizReducer.ts` (+ test)
- Modify: `src/components/quiz/QcmDialog.tsx` (+ test)

- [ ] **Step 1: Write the failing tests**

```ts
it('truncates a « moyen » hint on the projection, never mid-LaTeX', () => {
  // truncateAtWordBoundary('\\frac{20}{100}', 0.5) produirait '\\frac{20}{10' — invalide
})

it('deduplicates distractors on the projection, so two cards with the same formula collide', () => { /* … */ })

it('renders a rich definition as a QCM option instead of its source', () => { /* … */ })
```

- [ ] **Step 2: Implement** — hints and distractor pools read `card.definition` (already the projection, by Task 3's invariant), and `QcmDialog` renders options through `BlockView` when the card carries `content`. `computeTitleSimilarity` is untouched: titles stay plain strings by design (spec: hors périmètre).
- [ ] **Step 3: Verify** — `npx vitest run src/state/quizReducer.test.ts src/components/quiz/`
- [ ] **Step 4: Commit** — `fix(quiz): read definitions through the plain-text projection, render rich QCM options`

---

## Task 14: Teach the skill to emit `content`

**Files:**
- Modify: `.claude/skills/transformer-cours-en-carte-mentale/SKILL.md`

- [ ] **Step 1: Update the target schema** — document `content?: CardBlock[]`, the `math` block, and the rule that `definition` is derived (so a generated file carries both, consistent).
- [ ] **Step 2: Rewrite the comparability rule** — step 7 currently talks about `definition` length/register for QCM distractors; it must talk about the **projection**.
- [ ] **Step 3: Update the « Nombres relatifs » example** so its formulas are math blocks rather than `(+10) + (-4) = +6` typed as text.
- [ ] **Step 4: Commit** — `docs(skill): emit math blocks in generated mind maps`

This task is what makes the feature real at scale: the existing maps are full of `20/100 x 425` precisely because the skill had nowhere else to put it.

---

## Out of scope for this plan

- `code`, `music` (abcjs), `audio`, `molecule` blocks — deferred by the arbitration; the model and the validation already accept them without a migration.
- XMind export of images (`resources/` + topic `image`): the projection's `[image : alt]` marker keeps the export lossless-in-intent, and the export dialog says so.
- The « fiche de révision » export format (full-size images, one page per branch) — the reason Task 12 caps heights rather than making the layout content-aware.
- `@tauri-apps/plugin-clipboard-manager` — gated on spike 3.

## Open spikes that do not block this plan

- **Spike 3** — `Ctrl+V` of an image in the Tauri webview, per OS. Decides whether Task 9 needs the clipboard plugin.
- **Spike 4** — MathLive ↔ KaTeX visual drift. Affects comfort, not correctness.
- **Spike 5** — replay `page-katex.html` in the real app on **macOS and Linux** (WebKit webviews). The Chromium result covers Windows only; if glyphs are missing there, Task 12 gains a font-preload + warm-up capture on those platforms.
