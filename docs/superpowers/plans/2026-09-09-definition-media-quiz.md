# Définition / Média et QCM adapté — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give cards an explicit `kind: 'definition' | 'media'`, route the quiz to two new question types (`qcm-media`, `qcm-media-title`) for media cards, drop Sens A's difficulty-graded truncation so the hint always shows in full, add a `**keyword**` highlighting convention scoped to the reading panel only, fix a real cross-branch duplicate-title ambiguity found on generated data, and replace the card's inline description preview with a compact corner badge.

**Architecture:** Additive changes to the existing quiz pipeline (`selectQuizQuestions` → `attachDistractors` → `QcmDialog`) and content pipeline (`contentOf`/`BlockView`). No new stores, no new persisted fields beyond `Card.kind` and `QuizQuestionType`'s two new variants — every other field (`distractorDefinitions`, `distractorTitles`, `hint`, `answerQcmDefinition`, `answerQcmTitle`) is reused as-is because a media card's `definition` mirror already equals its plain-text projection, exactly like a text card's.

**Tech Stack:** React + TypeScript, Vitest + Testing Library, existing `BlockView`/`ContentKindBadges`/`quizReducer` modules.

**Spec:** `docs/superpowers/specs/2026-09-09-definition-media-quiz-design.md`

## Global Constraints

- Backward compatible: `Card.kind` absent behaves exactly like `'definition'` — no migration, no file rewrite.
- No new category in `src/validation/cardsValidation.ts` — it is a binary structural valid/invalid gate that drives the repair dialog; a missing media block or a duplicate title are content-quality issues, not structural ones, and belong in graceful degradation / the generation skill instead (see spec, "Validation" section).
- `**mot-clé**` renders as a coloured `<mark>` ONLY through `BlockView`'s default (`highlightKeywords: true`); every quiz-facing render of the same text (QCM options, the Sens A hint) explicitly passes `highlightKeywords={false}` / calls `stripHighlightMarkers`, so no option is ever visually richer than its neighbours because of markup rather than content.
- Every new pure function gets a Vitest unit test before the component that consumes it.

---

### Task 1: `Card.kind` and the two new quiz question types

**Files:**
- Modify: `src/types/card.ts`
- Modify: `src/types/quiz.ts`
- Modify: `src/state/quizReducer.ts:1-53` (imports + `selectQuizQuestions`)
- Test: `src/state/quizReducer.test.ts` (`describe('selectQuizQuestions')` block)

**Interfaces:**
- Produces: `export type CardKind = 'definition' | 'media'` and `Card.kind?: CardKind` (`src/types/card.ts`); `QuizQuestionType` gains `'qcm-media' | 'qcm-media-title'` (`src/types/quiz.ts`, no other field changes); `isMediaCard(card: Card): boolean` (`src/state/quizReducer.ts`, not exported — internal to routing).

- [ ] **Step 1: Write the failing tests for media routing**

Add to `src/state/quizReducer.test.ts`, inside `describe('selectQuizQuestions', ...)`:

```ts
  it('types a media card as "qcm-media" in normal mode', () => {
    const media: Card = {
      id: 'm',
      level: 1,
      title: 'Tableau des unités',
      parentId: null,
      order: 0,
      kind: 'media',
      content: [{ kind: 'table', header: ['Unité'], rows: [['m']] }],
      definition: 'Unité\nm',
    }
    const questions = selectQuizQuestions([media], baseConfig({ levels: [1], difficulty: 'difficile' }))
    expect(questions).toEqual([{ cardId: 'm', type: 'qcm-media' }])
  })

  it('types a media card as "qcm-media-title" when qcmMode is on', () => {
    const media: Card = {
      id: 'm',
      level: 1,
      title: 'Tableau des unités',
      parentId: null,
      order: 0,
      kind: 'media',
      content: [{ kind: 'table', header: ['Unité'], rows: [['m']] }],
      definition: 'Unité\nm',
    }
    const questions = selectQuizQuestions(
      [media],
      baseConfig({ levels: [1], difficulty: 'difficile', qcmMode: true })
    )
    expect(questions).toEqual([{ cardId: 'm', type: 'qcm-media-title' }])
  })

  it('degrades a "media" card with no non-text block back to normal definition/recall routing', () => {
    const fakeMedia: Card = {
      id: 'm',
      level: 1,
      title: 'Pas vraiment un média',
      parentId: null,
      order: 0,
      kind: 'media',
      definition: 'Juste du texte, aucun bloc table/math/image.',
    }
    const questions = selectQuizQuestions([fakeMedia], baseConfig({ levels: [1], difficulty: 'difficile' }))
    expect(questions).toEqual([{ cardId: 'm', type: 'qcm-definition' }])
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/state/quizReducer.test.ts`
Expected: FAIL — the three new cases return `type: 'qcm-definition'` or `'recall'` instead of `'qcm-media'`/`'qcm-media-title'` (property `kind` does not exist on `Card` yet is also a type error at this point).

- [ ] **Step 3: Add `Card.kind`**

In `src/types/card.ts`, add above the `Card` interface:

```ts
export type CardKind = 'definition' | 'media'
```

Inside `interface Card { ... }`, after the `icon?: string` field, add:

```ts
  /**
   * Absent means `'definition'` — every card written before this field
   * existed keeps behaving exactly as it does today, no migration needed.
   * `'media'` tells the quiz not to treat this card's `definition` mirror as
   * a real definition to recognise from its title (see `quizReducer.ts`).
   */
  kind?: CardKind
```

- [ ] **Step 4: Add the two new `QuizQuestionType` variants**

In `src/types/quiz.ts`, change:

```ts
export type QuizQuestionType = 'recall' | 'qcm-definition' | 'qcm-title'
```

to:

```ts
export type QuizQuestionType = 'recall' | 'qcm-definition' | 'qcm-title' | 'qcm-media' | 'qcm-media-title'
```

Update the two field doc comments just below it (`distractorDefinitions?: string[]` and `distractorTitles?: string[]`) to say "qcm-definition / qcm-media only" and "qcm-title / qcm-media-title only" respectively, and the `hint` comment to "qcm-title / qcm-media-title only" — no new fields, these three are reused by the media variants because a media card's `definition` mirror is the same plain-text projection a text card's is.

- [ ] **Step 5: Route media cards in `selectQuizQuestions`**

In `src/state/quizReducer.ts`, add to the imports at the top:

```ts
import { contentOf, nonTextKinds } from '../content/blocks'
```

Add this helper right after the `shuffle` function:

```ts
/**
 * A card only gets media-flavoured questions when it actually has media —
 * `kind: 'media'` on a card with no non-text block degrades back to the
 * normal definition/recall routing rather than blocking anything, the same
 * way an unknown icon name or a malformed block degrades elsewhere in this
 * codebase instead of failing.
 */
function isMediaCard(card: Card): boolean {
  return card.kind === 'media' && nonTextKinds(contentOf(card)).length > 0
}
```

Replace the body of `selectQuizQuestions`'s final `return`:

```ts
  return drawn.map(card => {
    if (config.qcmMode) return { cardId: card.id, type: 'qcm-title' as QuizQuestionType }
    const type: QuizQuestionType = card.definition ? 'qcm-definition' : 'recall'
    return { cardId: card.id, type }
  })
```

with:

```ts
  return drawn.map(card => {
    if (isMediaCard(card)) {
      return { cardId: card.id, type: (config.qcmMode ? 'qcm-media-title' : 'qcm-media') as QuizQuestionType }
    }
    if (config.qcmMode) return { cardId: card.id, type: 'qcm-title' as QuizQuestionType }
    const type: QuizQuestionType = card.definition ? 'qcm-definition' : 'recall'
    return { cardId: card.id, type }
  })
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- src/state/quizReducer.test.ts`
Expected: PASS, all cases including the three new ones.

- [ ] **Step 7: Commit**

```bash
git add src/types/card.ts src/types/quiz.ts src/state/quizReducer.ts src/state/quizReducer.test.ts
git commit -m "feat(quiz): add Card.kind and route media cards to qcm-media/qcm-media-title"
```

---

### Task 2: `**keyword**` highlighting utility, wired into `BlockView`

**Files:**
- Create: `src/content/highlight.tsx`
- Create: `src/content/highlight.test.tsx`
- Modify: `src/content/BlockView.tsx`
- Modify: `src/content/BlockView.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `stripHighlightMarkers(text: string): string` and `renderHighlighted(text: string): ReactNode[]` (`src/content/highlight.tsx`), both used by Task 6's CardNode QCM wiring; `BlockViewProps.highlightKeywords?: boolean` (default `true`) on `src/content/BlockView.tsx`.

- [ ] **Step 1: Write the failing tests for the highlight utility**

Create `src/content/highlight.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderHighlighted, stripHighlightMarkers } from './highlight'

describe('stripHighlightMarkers', () => {
  it('removes the double-asterisk markers, keeping the marked words', () => {
    expect(stripHighlightMarkers('Le **noyau** contrôle la cellule.')).toBe('Le noyau contrôle la cellule.')
  })

  it('leaves plain text with no markers untouched', () => {
    expect(stripHighlightMarkers('Rien à marquer ici.')).toBe('Rien à marquer ici.')
  })

  it('strips several markers in the same string', () => {
    expect(stripHighlightMarkers('**A** puis **B**')).toBe('A puis B')
  })
})

describe('renderHighlighted', () => {
  it('wraps a marked word in a <mark>, leaving the rest as plain text', () => {
    render(<>{renderHighlighted('Le **noyau** contrôle la cellule.')}</>)
    const mark = screen.getByText('noyau')
    expect(mark.tagName).toBe('MARK')
    expect(screen.getByText('contrôle la cellule.', { exact: false })).toBeInTheDocument()
  })

  it('handles several marked words in the same string', () => {
    render(<>{renderHighlighted('**A** et **B**')}</>)
    expect(screen.getByText('A').tagName).toBe('MARK')
    expect(screen.getByText('B').tagName).toBe('MARK')
  })

  it('renders unmarked text unchanged', () => {
    render(<>{renderHighlighted('Rien de marqué')}</>)
    expect(screen.getByText('Rien de marqué')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/content/highlight.test.tsx`
Expected: FAIL with "Cannot find module './highlight'".

- [ ] **Step 3: Write the highlight utility**

Create `src/content/highlight.tsx`:

```tsx
import type { ReactNode } from 'react'

/**
 * The app's own lightweight markup for a definition's key terms:
 * `**mot-clé**`. Never shown as literal asterisks — either stripped
 * (`stripHighlightMarkers`, used everywhere the quiz shows this text, so no
 * option is visually richer than another because of markup rather than
 * content) or rendered as a coloured `<mark>` (`renderHighlighted`, used only
 * by the reading panel). Non-greedy and non-nesting: the first `**` opens,
 * the next one closes.
 */
const HIGHLIGHT_PATTERN = /\*\*(.+?)\*\*/g

export function stripHighlightMarkers(text: string): string {
  return text.replace(HIGHLIGHT_PATTERN, '$1')
}

export function renderHighlighted(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  const pattern = new RegExp(HIGHLIGHT_PATTERN)
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    nodes.push(
      <mark
        key={key++}
        style={{ background: 'transparent', color: 'oklch(0.55 0.18 40)', fontWeight: 600 }}
      >
        {match[1]}
      </mark>
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/content/highlight.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `BlockView`'s `highlightKeywords` prop**

Add to `src/content/BlockView.test.tsx`, inside `describe('BlockView', ...)`:

```tsx
  it('renders **marked** words as a coloured <mark> by default', () => {
    render(<BlockView blocks={[{ kind: 'text', text: 'Le **noyau** contrôle la cellule.' }]} resolveAsset={resolve} />)
    expect(screen.getByText('noyau').tagName).toBe('MARK')
  })

  it('renders plain text with the markers stripped when highlightKeywords is false', () => {
    render(
      <BlockView
        blocks={[{ kind: 'text', text: 'Le **noyau** contrôle la cellule.' }]}
        resolveAsset={resolve}
        highlightKeywords={false}
      />
    )
    expect(screen.queryByText('noyau')).toBeNull()
    expect(screen.getByText(/Le noyau contrôle la cellule\./)).toBeInTheDocument()
  })
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npm test -- src/content/BlockView.test.tsx`
Expected: FAIL — `highlightKeywords` is not a recognised prop yet and the text block still renders the raw `**noyau**` string.

- [ ] **Step 7: Wire `highlightKeywords` into `BlockView`**

In `src/content/BlockView.tsx`, add to the imports:

```ts
import { renderHighlighted, stripHighlightMarkers } from './highlight'
```

In `BlockViewProps`, after `resolveAsset`, add:

```ts
  /**
   * Whether a `**mot-clé**` marker renders as a coloured `<mark>` (the
   * reading panel) or is silently stripped to plain text (every quiz-facing
   * render — see `highlight.tsx`). Defaults to `true`.
   */
  highlightKeywords?: boolean
```

Change the `BlockView` function signature and its call to `BlockItem`:

```ts
export function BlockView({ blocks, resolveAsset, highlightKeywords = true }: BlockViewProps) {
  if (blocks.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {blocks.map((block, index) => (
        <div key={index} style={{ maxWidth: '100%', overflowX: 'auto' }}>
          <BlockItem block={block} resolveAsset={resolveAsset} highlightKeywords={highlightKeywords} />
        </div>
      ))}
    </div>
  )
}
```

Change `BlockItem`'s props and its `'text'` case:

```ts
const BlockItem = memo(function BlockItem({
  block,
  resolveAsset,
  highlightKeywords,
}: {
  block: CardBlock
  resolveAsset: (asset: string) => string
  highlightKeywords: boolean
}) {
  switch (block.kind) {
    case 'text':
      return (
        <div style={{ whiteSpace: 'pre-wrap' }}>
          {highlightKeywords ? renderHighlighted(block.text) : stripHighlightMarkers(block.text)}
        </div>
      )
```

(the rest of the switch is unchanged).

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -- src/content/BlockView.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/content/highlight.tsx src/content/highlight.test.tsx src/content/BlockView.tsx src/content/BlockView.test.tsx
git commit -m "feat(content): add **keyword** highlighting, scoped to the reading panel via BlockView.highlightKeywords"
```

---

### Task 3: Sens A full display, marker-stripped hint, and the duplicate-title distractor fix

**Files:**
- Modify: `src/state/quizReducer.ts` (`buildDistractorPoolFrom`, `buildHint`)
- Test: `src/state/quizReducer.test.ts`

**Interfaces:**
- Consumes: `stripHighlightMarkers` from `src/content/highlight.tsx` (Task 2).
- Produces: `buildHint` and `buildDistractorPoolFrom` keep their existing signatures; behavior only.

- [ ] **Step 1: Replace the truncation test and add the two new ones**

In `src/state/quizReducer.test.ts`, inside `describe('attachDistractors', ...)`, replace this existing test:

```ts
  it('truncates the hint for "moyen" qcm-title', () => {
    const longDef: Card = { ...cardWithDef, definition: 'Un long texte de définition pour vérifier la troncature' }
    const questions = attachDistractors([longDef, otherWithDef], [{ cardId: 'a', type: 'qcm-title' }], 'moyen')
    const [question] = questions
    expect(question.type).toBe('qcm-title')
    expect(question.hint).toMatch(/…$/)
    expect(question.hint!.length).toBeLessThan(longDef.definition!.length)
  })
```

with:

```ts
  it('shows the FULL definition as the hint for "moyen" qcm-title — no more truncation', () => {
    const longDef: Card = { ...cardWithDef, definition: 'Un long texte de définition pour vérifier qu\'il n\'est plus tronqué' }
    const questions = attachDistractors([longDef, otherWithDef], [{ cardId: 'a', type: 'qcm-title' }], 'moyen')
    expect(questions[0].hint).toBe(longDef.definition)
  })

  it('strips **keyword** markers from the qcm-title hint — the quiz never shows raw asterisks or colour', () => {
    const marked: Card = { ...cardWithDef, definition: 'Le **signe** dépend de la distance à zéro.' }
    const questions = attachDistractors([marked, otherWithDef], [{ cardId: 'a', type: 'qcm-title' }], 'facile')
    expect(questions[0].hint).toBe('Le signe dépend de la distance à zéro.')
  })
```

Also add, inside `describe('buildDistractorPool', ...)`:

```ts
  it('excludes a candidate whose TITLE matches the target — a cross-branch twin title must never supply a "wrong" distractor that would in fact be an equally valid answer', () => {
    const twinTitleTarget: Card = { id: 'twin-1', level: 3, title: 'Avec calculatrice', definition: 'Méthode A', parentId: 'p1', order: 0 }
    const twinTitleOther: Card = { id: 'twin-2', level: 3, title: 'Avec calculatrice', definition: 'Méthode B', parentId: 'p2', order: 0 }
    const pool = buildDistractorPool([twinTitleTarget, twinTitleOther], twinTitleTarget, 'facile')
    expect(pool).not.toContain('Méthode B')
  })
```

and, inside `describe('buildTitleDistractorPool', ...)`:

```ts
  it('excludes a candidate whose title matches the target even when its own definition/id differ from a plain string match', () => {
    // buildTitleDistractorPool already excludes same-title candidates because
    // the pool's identity IS the title — this test locks that behaviour in
    // explicitly so a future refactor of the exclusion logic cannot drop it.
    const twinA: Card = { id: 'twin-a', level: 3, title: 'Avec calculatrice', parentId: 'p1', order: 0 }
    const twinB: Card = { id: 'twin-b', level: 3, title: 'Avec calculatrice', parentId: 'p2', order: 0 }
    const pool = buildTitleDistractorPool([twinA, twinB], twinA, 'facile')
    expect(pool).toEqual([])
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/state/quizReducer.test.ts`
Expected: FAIL — the "moyen" hint is still truncated, the hint still carries raw `**`, and `buildDistractorPool` still lets a twin-titled card's definition through.

- [ ] **Step 3: Strip markers and drop truncation in `buildHint`**

In `src/state/quizReducer.ts`, add to the imports:

```ts
import { stripHighlightMarkers } from '../content/highlight'
```

Replace:

```ts
const HINT_TRUNCATE_RATIO = 0.5
const MAX_DISTRACTORS = 3
```

with:

```ts
const MAX_DISTRACTORS = 3
```

Delete the now-unused `truncateAtWordBoundary` function entirely.

Replace the whole `buildHint` function:

```ts
/** facile = full definition, moyen = truncated, difficile = no textual hint. */
function buildHint(card: Card, difficulty: QuizDifficulty): string | undefined {
  if (!card.definition) return undefined
  if (difficulty === 'facile') return card.definition
  if (difficulty === 'moyen') return truncateAtWordBoundary(card.definition, HINT_TRUNCATE_RATIO)
  return undefined
}
```

with:

```ts
/**
 * facile/moyen = full definition (never truncated — a partial hint used to
 * cut mid-sentence, which the mission explicitly asked to stop doing);
 * difficile = no textual hint, position in the tree only. Markers are always
 * stripped: this string reaches `QcmDialog`'s plain-text hint prop, which has
 * no rich rendering of its own.
 */
function buildHint(card: Card, difficulty: QuizDifficulty): string | undefined {
  if (!card.definition) return undefined
  if (difficulty === 'difficile') return undefined
  return stripHighlightMarkers(card.definition)
}
```

- [ ] **Step 4: Exclude same-title candidates from `buildDistractorPoolFrom`**

Replace the body of `buildDistractorPoolFrom`'s inner loop condition. Find:

```ts
    for (const card of shuffle(scope, random)) {
      if (pool.length >= MAX_DISTRACTORS) break
      if (card.id === targetCard.id) continue
      const value = pick(card)
      if (!value || seen.has(value)) continue
      seen.add(value)
      pool.push(value)
    }
```

Replace with:

```ts
    for (const card of shuffle(scope, random)) {
      if (pool.length >= MAX_DISTRACTORS) break
      if (card.id === targetCard.id) continue
      // A card sharing the target's title is not a wrong answer — its own
      // definition would be just as valid an answer for that title, since
      // nothing in the QCM heading disambiguates which branch is meant. See
      // the duplicate-title bug found on real generated data (design spec).
      if (card.title === targetCard.title) continue
      const value = pick(card)
      if (!value || seen.has(value)) continue
      seen.add(value)
      pool.push(value)
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/state/quizReducer.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/state/quizReducer.ts src/state/quizReducer.test.ts
git commit -m "fix(quiz): show Sens A hint in full, strip **markers**, exclude same-title distractors"
```

---

### Task 4: `attachDistractors` for `qcm-media` / `qcm-media-title`

**Files:**
- Modify: `src/state/quizReducer.ts` (`attachDistractors`)
- Test: `src/state/quizReducer.test.ts`

**Interfaces:**
- Consumes: `buildDistractorPool`, `buildTitleDistractorPool`, `buildHint` (all from Task 1/3, unchanged signatures).
- Produces: `attachDistractors` now also fills `distractorDefinitions`/`distractorTitles`/`hint` for `'qcm-media'`/`'qcm-media-title'` questions, degrading to `'recall'` on an empty pool exactly like `'qcm-definition'`/`'qcm-title'` already do.

- [ ] **Step 1: Write the failing tests**

Add to `src/state/quizReducer.test.ts`, inside `describe('attachDistractors', ...)`:

```ts
  it('fills distractorDefinitions for a qcm-media question, same pool logic as qcm-definition', () => {
    const mediaA: Card = { id: 'a', level: 1, title: 'A', kind: 'media', definition: 'Def média A', parentId: null, order: 0 }
    const mediaB: Card = { id: 'b', level: 2, title: 'B', kind: 'media', definition: 'Def média B', parentId: 'a', order: 0 }
    const questions = attachDistractors([mediaA, mediaB], [{ cardId: 'a', type: 'qcm-media' }], 'facile')
    expect(questions).toEqual([{ cardId: 'a', type: 'qcm-media', distractorDefinitions: ['Def média B'] }])
  })

  it('falls back to "recall" when a qcm-media question has no possible distractor', () => {
    const mediaA: Card = { id: 'a', level: 1, title: 'A', kind: 'media', definition: 'Def média A', parentId: null, order: 0 }
    const questions = attachDistractors([mediaA], [{ cardId: 'a', type: 'qcm-media' }], 'facile')
    expect(questions).toEqual([{ cardId: 'a', type: 'recall' }])
  })

  it('fills distractorTitles and a full hint for qcm-media-title, same pool logic as qcm-title', () => {
    const mediaA: Card = { id: 'a', level: 1, title: 'A', kind: 'media', definition: 'Def média A', parentId: null, order: 0 }
    const mediaB: Card = { id: 'b', level: 2, title: 'B', kind: 'media', definition: 'Def média B', parentId: 'a', order: 0 }
    const questions = attachDistractors([mediaA, mediaB], [{ cardId: 'a', type: 'qcm-media-title' }], 'facile')
    expect(questions).toEqual([{ cardId: 'a', type: 'qcm-media-title', distractorTitles: ['B'], hint: 'Def média A' }])
  })

  it('gives no hint for "difficile" qcm-media-title, same as qcm-title', () => {
    const mediaA: Card = { id: 'a', level: 1, title: 'A', kind: 'media', definition: 'Def média A', parentId: null, order: 0 }
    const mediaB: Card = { id: 'b', level: 2, title: 'B', kind: 'media', definition: 'Def média B', parentId: 'a', order: 0 }
    const questions = attachDistractors([mediaA, mediaB], [{ cardId: 'a', type: 'qcm-media-title' }], 'difficile')
    expect(questions[0].hint).toBeUndefined()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/state/quizReducer.test.ts`
Expected: FAIL — `attachDistractors` currently returns `qcm-media`/`qcm-media-title` questions untouched (they fall through every `if`, matching the existing `return question` default at the bottom).

- [ ] **Step 3: Widen `attachDistractors`'s two `if` conditions**

In `src/state/quizReducer.ts`, replace:

```ts
    if (question.type === 'qcm-definition') {
      const pool = buildDistractorPool(cards, card, difficulty, random)
      if (pool.length === 0) return { cardId: question.cardId, type: 'recall' }
      return { ...question, distractorDefinitions: pool }
    }

    if (question.type === 'qcm-title') {
      const pool = buildTitleDistractorPool(cards, card, difficulty, random)
      if (pool.length === 0) return { cardId: question.cardId, type: 'recall' }
      return { ...question, distractorTitles: pool, hint: buildHint(card, difficulty) }
    }
```

with:

```ts
    if (question.type === 'qcm-definition' || question.type === 'qcm-media') {
      const pool = buildDistractorPool(cards, card, difficulty, random)
      if (pool.length === 0) return { cardId: question.cardId, type: 'recall' }
      return { ...question, distractorDefinitions: pool }
    }

    if (question.type === 'qcm-title' || question.type === 'qcm-media-title') {
      const pool = buildTitleDistractorPool(cards, card, difficulty, random)
      if (pool.length === 0) return { cardId: question.cardId, type: 'recall' }
      return { ...question, distractorTitles: pool, hint: buildHint(card, difficulty) }
    }
```

`buildDistractorPool` already picks `c => c.definition` regardless of `kind` — a media card's `definition` mirror already holds its plain-text projection (`content/blocks.ts`'s `normalizeContent`/`reconcileCards` invariant), so no change is needed there.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/state/quizReducer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/quizReducer.ts src/state/quizReducer.test.ts
git commit -m "feat(quiz): attach distractors and hints to qcm-media/qcm-media-title questions"
```

---

### Task 5: `QcmDialog.hintNode` — a rich hint alongside the existing plain-text one

**Files:**
- Modify: `src/components/quiz/QcmDialog.tsx`
- Test: `src/components/quiz/QcmDialog.test.tsx`

**Interfaces:**
- Produces: `QcmDialogProps.hintNode?: ReactNode`, rendered instead of `hint`/`noHintNote` when present. Consumed by Task 6's CardNode wiring for `qcm-media-title`'s media hint.

- [ ] **Step 1: Write the failing test**

Add to `src/components/quiz/QcmDialog.test.tsx`, inside the top `describe('QcmDialog', ...)` block (after the existing hint tests):

```tsx
  it('renders hintNode instead of the plain hint/noHintNote text when provided', () => {
    render(
      <QcmDialog
        open
        heading="À quel titre correspond ce tableau ?"
        hint="ignoré au profit de hintNode"
        hintNode={<span data-testid="rich-hint">TABLEAU RENDU</span>}
        correctOption="La bonne carte"
        distractors={['Une autre carte']}
        onAnswer={() => {}}
        onCancel={() => {}}
      />
    )

    expect(screen.getByTestId('rich-hint')).toBeInTheDocument()
    expect(screen.queryByText('ignoré au profit de hintNode')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/quiz/QcmDialog.test.tsx`
Expected: FAIL — `hintNode` is not a recognised prop, and the dialog shows the plain `hint` text instead.

- [ ] **Step 3: Add `hintNode` to `QcmDialog`**

In `src/components/quiz/QcmDialog.tsx`, add to `QcmDialogProps` (after `noHintNote?: string`):

```ts
  /**
   * A richly-rendered hint (e.g. a media block via `BlockView`), shown
   * instead of `hint`/`noHintNote` when present. `hint` stays a plain string
   * for the common text case; this exists only for content a string cannot
   * carry.
   */
  hintNode?: ReactNode
```

Add `hintNode` to the destructured props of `QcmDialog`, and change the hint block's condition and content. Replace:

```tsx
        {(hint || noHintNote) && (
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              border: '1px dashed var(--border)',
              borderRadius: 10,
              padding: '10px 12px',
              fontSize: 13,
            }}
          >
            {hint ? (
              <Lightbulb size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            ) : (
              <Network size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            )}
            <span>{hint ?? noHintNote}</span>
          </div>
        )}
```

with:

```tsx
        {(hintNode || hint || noHintNote) && (
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              border: '1px dashed var(--border)',
              borderRadius: 10,
              padding: '10px 12px',
              fontSize: 13,
            }}
          >
            {hintNode || hint ? (
              <Lightbulb size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            ) : (
              <Network size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            )}
            {hintNode ? <div style={{ minWidth: 0 }}>{hintNode}</div> : <span>{hint ?? noHintNote}</span>}
          </div>
        )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/quiz/QcmDialog.test.tsx`
Expected: PASS, including every pre-existing test in the file (no prop was removed, only added).

- [ ] **Step 5: Commit**

```bash
git add src/components/quiz/QcmDialog.tsx src/components/quiz/QcmDialog.test.tsx
git commit -m "feat(quiz): add QcmDialog.hintNode for a richly-rendered hint"
```

---

### Task 6: Wire `qcm-media`/`qcm-media-title` into `CardNode`, extend the letter-hint mask to Sens A

**Files:**
- Modify: `src/components/CardNode.tsx`
- Test: `src/components/CardNode.test.tsx`

**Interfaces:**
- Consumes: `QuizQuestionType` (Task 1), `stripHighlightMarkers` (Task 2), `buildHint`'s stripped/untruncated output (Task 3), `attachDistractors`'s media fields (Task 4), `QcmDialog.hintNode` (Task 5), `nonTextKinds`/`contentOf` (already exported from `src/content/blocks.ts`).
- Produces: nothing new consumed elsewhere — this task only makes the four QCM types (and their letter-hint mask) actually reach the screen.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/CardNode.test.tsx`. First, widen the local `QuizData` type near the top of the file:

```ts
type QuizData = {
  type: QuizQuestionType
  result: QuizResult
  distractorDefinitions?: string[]
  distractorTitles?: string[]
  hint?: string
}
```

No change needed here — `QuizQuestionType` already includes the two new variants from Task 1, and no new fields were added to the question shape.

Then replace this existing test:

```ts
  it('gives no length hint for a qcm-title question — it would narrow the four options', () => {
    renderCardNode(testCard, false, false, {
      type: 'qcm-title',
      result: 'unanswered',
      distractorTitles: ['Autre titre'],
    })

    expect(screen.getByTestId('quiz-title')).toHaveTextContent('? ? ?')
    expect(screen.getByTestId('quiz-title')).not.toHaveTextContent('_')
  })
```

with:

```ts
  it('gives the same letter-count hint on a qcm-title question as on recall — the visual aid stays systematic across Sens A variants', () => {
    renderCardNode(testCard, false, false, {
      type: 'qcm-title',
      result: 'unanswered',
      distractorTitles: ['Autre titre'],
    })

    // "Titre initial", first letter conceded by the default ("moyen") difficulty.
    expect(screen.getByTestId('quiz-title')).toHaveTextContent('T____ _______')
  })

  it('gives the same letter-count hint on a qcm-media-title question as on recall', () => {
    const mediaCard: Card = { ...testCard, kind: 'media', content: [{ kind: 'table', header: ['A'], rows: [['1']] }] }
    renderCardNode(mediaCard, false, false, {
      type: 'qcm-media-title',
      result: 'unanswered',
      distractorTitles: ['Autre titre'],
    })

    expect(screen.getByTestId('quiz-title')).toHaveTextContent('T____ _______')
  })
```

Then, near the other `it('opens the multiple-choice dialog ...')` tests, add:

```ts
  it('opens the multiple-choice dialog for a qcm-media question, titled by the card title, options as media', async () => {
    const user = userEvent.setup()
    const mediaCard: Card = {
      ...cardWithDefinition,
      kind: 'media',
      content: [{ kind: 'table', header: ['Unité'], rows: [['m']] }],
      definition: 'Unité\nm',
    }
    renderCardNode(mediaCard, false, false, {
      type: 'qcm-media',
      result: 'unanswered',
      distractorDefinitions: ['Autre projection'],
    })

    await user.click(screen.getByTestId('answer-button'))

    expect(screen.getByRole('heading', { name: 'Titre initial' })).toBeInTheDocument()
  })

  it('opens the multiple-choice dialog for a qcm-media-title question with a table-specific heading and a rich hint', async () => {
    const user = userEvent.setup()
    const mediaCard: Card = {
      ...cardWithDefinition,
      kind: 'media',
      content: [{ kind: 'table', header: ['Unité'], rows: [['m']] }],
      definition: 'Unité\nm',
    }
    renderCardNode(mediaCard, false, false, {
      type: 'qcm-media-title',
      result: 'unanswered',
      distractorTitles: ['Autre titre'],
      hint: 'Unité\nm',
    })

    await user.click(screen.getByTestId('answer-button'))

    expect(screen.getByRole('heading', { name: /à quel titre correspond ce tableau/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Unité' })).toBeInTheDocument()
  })

  it('records the qcm-media answer in the quiz store once a choice is made', async () => {
    resetStore([
      {
        ...cardWithDefinition,
        kind: 'media',
        content: [{ kind: 'table', header: ['Unité'], rows: [['m']] }],
        definition: 'Unité\nm',
      },
    ])
    const user = userEvent.setup()
    renderCardNode(
      { ...cardWithDefinition, kind: 'media', content: [{ kind: 'table', header: ['Unité'], rows: [['m']] }], definition: 'Unité\nm' },
      false,
      false,
      { type: 'qcm-media', result: 'unanswered', distractorDefinitions: ['Fausse projection'] }
    )

    await user.click(screen.getByTestId('answer-button'))
    await user.click(screen.getByText('Fausse projection'))
    vi.advanceTimersByTime?.(700)

    expect(useQuizStore.getState().results[cardWithDefinition.id]).toBe('incorrect')
  })
```

> Adjust `resetStore`/`vi.advanceTimersByTime?.` to match whatever the neighbouring `qcm-title` "records the answer" test in this file already does for timer handling and store setup — copy its exact pattern rather than the sketch above if it differs, since this file's existing `describe` block controls fake timers per-test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/components/CardNode.test.tsx`
Expected: FAIL — `isQcmPending` does not yet include `qcm-media`/`qcm-media-title`, so the answer dialog never opens for them, and `blankPreview` is still `null` for `qcm-title`.

- [ ] **Step 3: Extend `isQcmPending` and `displayMasked`**

In `src/components/CardNode.tsx`, replace:

```ts
  const isQcmPending = (quiz?.type === 'qcm-definition' || quiz?.type === 'qcm-title') && isPending
  // `qcm-title` asks the user to pick the title out of four options, so showing
  // it on the card would hand them the answer; `qcm-definition` shows its title
  // (that IS the question) and hides nothing.
  const displayMasked = isPending && (quiz?.type === 'recall' || quiz?.type === 'qcm-title')
```

with:

```ts
  const isQcmPending =
    (quiz?.type === 'qcm-definition' ||
      quiz?.type === 'qcm-title' ||
      quiz?.type === 'qcm-media' ||
      quiz?.type === 'qcm-media-title') &&
    isPending
  // `qcm-title`/`qcm-media-title` ask the user to pick the title out of four
  // options, so showing it on the card would hand them the answer;
  // `qcm-definition`/`qcm-media` show the title (that IS the question) and
  // hide nothing.
  const displayMasked =
    isPending && (quiz?.type === 'recall' || quiz?.type === 'qcm-title' || quiz?.type === 'qcm-media-title')
```

- [ ] **Step 4: Extend the letter-hint mask (`blankPreview`) to every masked type**

Replace:

```ts
  const blankPreview =
    isRecallPending && lengthGuideEnabled
      ? (() => {
          const revealed = revealedSet(card.title, quizDifficulty, recallProgress?.extraReveals ?? 0)
          return slotsOf(card.title)
            .map(slot => (slot.fillable && !revealed.has(slot.index) ? '_' : slot.char))
            .join('')
        })()
      : null
```

with:

```ts
  // Same aid on recall, qcm-title AND qcm-media-title — the mission asked
  // for the letter-count hint to stay systematic across every Sens A
  // variant, not just recall. QCM questions have no retries, so
  // `recallProgress` naturally stays absent for them and `extraReveals`
  // falls back to 0 — the base difficulty count, never growing.
  const blankPreview =
    displayMasked && lengthGuideEnabled
      ? (() => {
          const revealed = revealedSet(card.title, quizDifficulty, recallProgress?.extraReveals ?? 0)
          return slotsOf(card.title)
            .map(slot => (slot.fillable && !revealed.has(slot.index) ? '_' : slot.char))
            .join('')
        })()
      : null
```

- [ ] **Step 5: Wire the `QcmDialog` for the two new types**

Add to the imports:

```ts
import { stripHighlightMarkers } from '../content/highlight'
import { nonTextKinds } from '../content/blocks'
import type { CardBlockKind } from '../types/cardBlock'
```

(`contentOf` is already imported.) Add this small lookup right above the `CardNode` component:

```ts
const MEDIA_TITLE_HEADINGS: Record<Exclude<CardBlockKind, 'text'>, string> = {
  table: 'À quel titre correspond ce tableau ?',
  math: 'À quel titre correspond cette formule ?',
  image: 'À quel titre correspond cette image ?',
}

function headingForMediaTitle(blocks: CardBlock[]): string {
  const [dominant] = nonTextKinds(blocks)
  return dominant ? MEDIA_TITLE_HEADINGS[dominant] : 'À quel titre correspond ce contenu ?'
}
```

Replace the whole `<QcmDialog ... />` block:

```tsx
      {isQcmPending && (
        <QcmDialog
          open={answerOpen}
          heading={quiz.type === 'qcm-definition' ? card.title : 'Quel est le titre de cette carte ?'}
          hint={quiz.type === 'qcm-title' ? quiz.hint : undefined}
          noHintNote={
            quiz.type === 'qcm-title' && !quiz.hint ? 'Aide-toi de la position de la carte dans l’arbre.' : undefined
          }
          correctOption={quiz.type === 'qcm-definition' ? (card.definition ?? '') : card.title}
          distractors={quiz.type === 'qcm-definition' ? (quiz.distractorDefinitions ?? []) : (quiz.distractorTitles ?? [])}
          // Definition options are cards' plain-text mirrors, so a formula
          // question would otherwise offer « 20/100 × 425 » while the card
          // itself shows a stacked fraction. The string stays the identity —
          // grading and pool dedupe still compare it — and only the display is
          // resolved back to the source blocks. Titles are plain by design
          // (they are the quiz's comparison key), so they get no resolver.
          renderOption={
            quiz.type === 'qcm-definition'
              ? option => {
                  const source = allCards.find(c => c.definition === option)
                  return source && source.content !== undefined ? (
                    <BlockView blocks={contentOf(source)} resolveAsset={resolveAsset} />
                  ) : (
                    option
                  )
                }
              : undefined
          }
          onAnswer={chosen => {
            if (quiz.type === 'qcm-definition') answerQcmDefinition(card.id, chosen)
            else answerQcmTitle(card.id, chosen)
            setAnswerOpen(false)
          }}
          onCancel={() => setAnswerOpen(false)}
        />
      )}
```

with:

```tsx
      {isQcmPending && (
        <QcmDialog
          open={answerOpen}
          heading={
            quiz.type === 'qcm-definition' || quiz.type === 'qcm-media'
              ? card.title
              : quiz.type === 'qcm-media-title'
                ? headingForMediaTitle(contentOf(card))
                : 'Quel est le titre de cette carte ?'
          }
          hint={quiz.type === 'qcm-title' ? quiz.hint : undefined}
          hintNode={
            quiz.type === 'qcm-media-title' && quiz.hint !== undefined ? (
              <BlockView blocks={contentOf(card)} resolveAsset={resolveAsset} highlightKeywords={false} />
            ) : undefined
          }
          noHintNote={
            (quiz.type === 'qcm-title' || quiz.type === 'qcm-media-title') && !quiz.hint
              ? 'Aide-toi de la position de la carte dans l’arbre.'
              : undefined
          }
          correctOption={
            quiz.type === 'qcm-definition' || quiz.type === 'qcm-media' ? (card.definition ?? '') : card.title
          }
          distractors={
            quiz.type === 'qcm-definition' || quiz.type === 'qcm-media'
              ? (quiz.distractorDefinitions ?? [])
              : (quiz.distractorTitles ?? [])
          }
          // Definition/media options are cards' plain-text mirrors, so a
          // formula question would otherwise offer « 20/100 × 425 » while the
          // card itself shows a stacked fraction, and a table question would
          // offer a flattened string instead of an actual table. The string
          // stays the identity — grading and pool dedupe still compare it —
          // and only the display is resolved back to the source blocks.
          // `highlightKeywords={false}`/`stripHighlightMarkers`: no option is
          // ever visually richer than another because of **markup** rather
          // than content — see the design spec. Titles get no resolver, they
          // are the quiz's comparison key and never carry markers.
          renderOption={
            quiz.type === 'qcm-definition' || quiz.type === 'qcm-media'
              ? option => {
                  const source = allCards.find(c => c.definition === option)
                  return source && source.content !== undefined ? (
                    <BlockView blocks={contentOf(source)} resolveAsset={resolveAsset} highlightKeywords={false} />
                  ) : (
                    stripHighlightMarkers(option)
                  )
                }
              : undefined
          }
          onAnswer={chosen => {
            if (quiz.type === 'qcm-definition' || quiz.type === 'qcm-media') answerQcmDefinition(card.id, chosen)
            else answerQcmTitle(card.id, chosen)
            setAnswerOpen(false)
          }}
          onCancel={() => setAnswerOpen(false)}
        />
      )}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- src/components/CardNode.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS across every file — this task touches shared rendering paths (`isQcmPending`, `blankPreview`), so a regression elsewhere would show up here.

- [ ] **Step 8: Commit**

```bash
git add src/components/CardNode.tsx src/components/CardNode.test.tsx
git commit -m "feat(quiz): wire qcm-media/qcm-media-title into CardNode, extend the letter-hint mask to Sens A"
```

---

### Task 7: `FicheBadge` — corner button replacing the inline description preview

**Files:**
- Modify: `src/content/ContentKindBadges.tsx` (export the icon map)
- Modify: `src/components/CardNode.tsx` (`DescriptionButton` → `FicheBadge`)
- Test: `src/components/CardNode.test.tsx`

**Interfaces:**
- Consumes: `Card.kind` (Task 1), `nonTextKinds`/`contentOf` (`src/content/blocks.ts`), `colors.border` (already computed in `CardNode`).
- Produces: nothing consumed elsewhere — purely a card-surface change. The click handler (`onActivate` → `openDescription`/`useCardDetailStore`) is unchanged, so the fiche sidebar itself needs no changes.

- [ ] **Step 1: Export the icon map from `ContentKindBadges`**

In `src/content/ContentKindBadges.tsx`, change:

```ts
const BADGES = {
  math: { icon: Sigma, label: 'Contient une formule' },
  image: { icon: ImageIcon, label: 'Contient une image' },
  table: { icon: Table2, label: 'Contient un tableau' },
} as const
```

to:

```ts
/** Exported so the fiche corner badge (`CardNode.tsx`) can reuse the exact same icon per content kind, rather than maintaining a second mapping that could drift from this one. */
export const CONTENT_KIND_ICONS = {
  math: { icon: Sigma, label: 'Contient une formule' },
  image: { icon: ImageIcon, label: 'Contient une image' },
  table: { icon: Table2, label: 'Contient un tableau' },
} as const

const BADGES = CONTENT_KIND_ICONS
```

- [ ] **Step 2: Write the failing tests**

Add to `src/components/CardNode.test.tsx`, in a new `describe` block near the other footer/description tests:

```ts
describe('the fiche corner badge', () => {
  it('shows a BookOpen icon for a definition card, with an accessible label', () => {
    renderCardNode(cardWithDefinition)
    expect(screen.getByRole('button', { name: /afficher la définition/i })).toBeInTheDocument()
  })

  it('shows the content-kind icon (e.g. table) for a media card, not the definition label', () => {
    const mediaCard: Card = {
      ...cardWithDefinition,
      kind: 'media',
      content: [{ kind: 'table', header: ['A'], rows: [['1']] }],
      definition: 'A\n1',
    }
    renderCardNode(mediaCard)
    expect(screen.getByRole('button', { name: /afficher le média/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /afficher la définition/i })).not.toBeInTheDocument()
  })

  it('shows the "add" label and stays enabled on a card with no content yet', () => {
    renderCardNode(testCard)
    expect(screen.getByRole('button', { name: /ajouter une description/i })).toBeInTheDocument()
  })

  it('no longer shows any text preview of the definition on the card face', () => {
    renderCardNode(cardWithDefinition)
    expect(screen.queryByText('Définition existante')).not.toBeInTheDocument()
  })

  it('opens the fiche when clicked, and reflects the open state via aria-pressed', async () => {
    const user = userEvent.setup()
    renderCardNode(cardWithDefinition)

    const badge = screen.getByRole('button', { name: /afficher la définition/i })
    expect(badge).toHaveAttribute('aria-pressed', 'false')

    await user.click(badge)

    expect(useCardDetailStore.getState().open.some(entry => entry.cardId === cardWithDefinition.id)).toBe(true)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- src/components/CardNode.test.tsx`
Expected: FAIL — the current `DescriptionButton` uses labels `"Afficher la description"`/`"Ajouter une description"` (no distinction between definition/media) and still renders the one-line text preview.

- [ ] **Step 4: Replace `DescriptionButton` with `FicheBadge`**

In `src/components/CardNode.tsx`, add to the imports:

```ts
import { BookOpen } from 'lucide-react'
import { CONTENT_KIND_ICONS } from '../content/ContentKindBadges'
```

`contentOf` is already imported. **If Task 6 landed first**, `nonTextKinds` is already imported from `'../content/blocks'` — add it to that existing import instead of a new line; only add a fresh `import { nonTextKinds } from '../content/blocks'` line if Task 6 has not run yet. Either way, `nonTextKinds` must appear in the import list exactly once.

Replace the entire `DescriptionButton` function (from its doc comment through its closing `}`) with:

```tsx
/**
 * The card's one door into its fiche — a fixed-size badge, not a text
 * preview: `règle anti-décalage 1` (a card's footprint never depends on its
 * content) is easier to keep with NO content-dependent sizing at all than
 * with an ellipsed line. Position and colour read as an ACTION (bottom-right,
 * the card's own level colour), distinct from the emoji identity badge
 * (top-right, inset) and from the ghost footer row (Détacher/Retourner/
 * Supprimer) it sits just outside of.
 */
function FicheBadge({
  card,
  locked,
  active,
  borderColor,
  onActivate,
}: {
  card: Card
  locked: boolean
  active: boolean
  borderColor: string
  onActivate: () => void
}) {
  const blocks = contentOf(card)
  const hasContent = blocks.length > 0
  const dominant = card.kind === 'media' ? nonTextKinds(blocks)[0] : undefined
  const Icon = dominant ? CONTENT_KIND_ICONS[dominant].icon : BookOpen
  const label = !hasContent ? 'Ajouter une description' : card.kind === 'media' ? 'Afficher le média' : 'Afficher la définition'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={locked && !hasContent}
          onClick={event => {
            event.stopPropagation()
            onActivate()
          }}
          style={{
            position: 'absolute',
            bottom: -9,
            right: -9,
            width: 24,
            height: 24,
            borderRadius: '9999px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1.5px solid ${borderColor}`,
            background: 'var(--background)',
            color: borderColor,
            boxShadow: hasContent ? '0 1px 3px rgba(0, 0, 0, 0.15)' : 'none',
            opacity: hasContent ? 1 : 0.55,
            cursor: locked && !hasContent ? 'default' : 'pointer',
          }}
        >
          <Icon size={13} strokeWidth={2.3} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
```

Replace its usage (previously `<DescriptionButton blocks={contentOf(card)} locked={locked} active={ficheOpen} onActivate={openDescription} />`, immediately followed by the `<div className="card-footer" ...>` row) with:

```tsx
        <span style={{ position: 'relative' }}>
          <FicheBadge card={card} locked={locked} active={ficheOpen} borderColor={toCss(colors.border)} onActivate={openDescription} />
        </span>

        <div className="card-footer" style={{ display: 'flex', gap: '0.25rem', marginTop: 'auto' }}>
```

`FicheBadge` is `position: absolute`, so it needs a positioned ancestor — the surrounding `CardNode` root already establishes one for the existing top-corner elements (drag handle, emoji badge), but those are direct children of that root; the badge is emitted from deeper in the JSX tree (inside the `!quizActive` block, alongside the footer row), so the `<span style={{ position: 'relative' }}>` wrapper above gives it its own positioning context without disturbing that root's existing absolutely-positioned children. Confirm this visually (`npm run tauri dev` or the browser preview) once the change compiles — if the root container's existing `position: relative` already covers this depth in practice, the wrapper span is still harmless (an extra zero-size relative box changes nothing when there is nothing else inside it to position against).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/components/CardNode.test.tsx`
Expected: PASS, including every pre-existing test that referenced the old `"Afficher la description"`/`"Ajouter une description"` labels — the "add" label is unchanged, only the "has content" labels split by `kind`.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Visually verify**

Run the app (see the project's own `run` skill/dev script), open a card with a definition and a card with `kind: 'media'` content, and confirm the badge sits bottom-right, floating on the border, in the card's level colour, with the icon matching definition-vs-media — matching the mockup approved during brainstorming.

- [ ] **Step 8: Commit**

```bash
git add src/content/ContentKindBadges.tsx src/components/CardNode.tsx src/components/CardNode.test.tsx
git commit -m "feat(canvas): replace the card's text-preview description button with a corner FicheBadge"
```

---

### Task 8: Update the `transformer-cours-en-carte-mentale` skill

**Files:**
- Modify: `.claude/skills/transformer-cours-en-carte-mentale/SKILL.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing consumed by code — this is the authoring-side half of the fix for the duplicate-title bug and the definition/media split, for every course converted from now on.

- [ ] **Step 1: Update the target schema block**

In the `## Le schéma cible` section, change:

```ts
type CardLevel = 1 | 2 | 3 | 4
interface Card {
  id: string
  level: CardLevel        // 1=Titre principal 2=Sous-titre 3=Sous-partie 4=Info
  title: string
  definition?: string      // texte brut ; miroir DÉRIVÉ dès que `content` existe
  content?: CardBlock[]    // optionnel : définition riche (formules, tableaux)
  parentId: string | null  // null uniquement pour la racine
  order: number             // position parmi les frères/sœurs
}
```

to:

```ts
type CardLevel = 1 | 2 | 3 | 4
type CardKind = 'definition' | 'media'   // absent = 'definition'
interface Card {
  id: string
  level: CardLevel        // 1=Titre principal 2=Sous-titre 3=Sous-partie 4=Info
  title: string
  kind?: CardKind          // 'media' pour un tableau/formule/exemple chiffré qui N'EST PAS une vraie définition
  definition?: string      // texte brut ; miroir DÉRIVÉ dès que `content` existe — reste obligatoire même pour une carte média, mais mécaniquement, jamais rédigé à la main
  content?: CardBlock[]    // optionnel pour une définition, obligatoire (≥ 1 bloc non-text) pour un média
  parentId: string | null  // null uniquement pour la racine
  order: number             // position parmi les frères/sœurs
}
```

- [ ] **Step 2: Add the `kind` decision rule, right after the schema block, before "## Écrire les maths en blocs, pas en texte"**

Insert a new section:

```markdown
## Définition ou média : la carte est l'un OU l'autre

Une carte est `kind: 'media'` quand son contenu n'énonce pas un fait ou une
règle mais un calcul déjà résolu, une formule, un tableau, ou une
illustration — pas de phrase de définition à rédiger autour, la projection
texte de `content` suffit et se calcule mécaniquement (voir ci-dessus).
Sinon, elle est une définition (`kind` absent).

Test à faire mentalement sur chaque card : *si je devais expliquer cette
carte à quelqu'un, est-ce que je dirais « ça définit X » ou « ça montre
comment calculer/représenter X » ?* Le premier cas est `definition`, le
second `media`.

```json
// MÉDIA — un calcul déjà résolu, pas une définition
{
  "id": "ex-avec-calculatrice", "level": 4, "title": "Exemple avec calculatrice",
  "kind": "media",
  "parentId": "avec-calculatrice", "order": 0,
  "content": [
    { "kind": "math", "latex": "\\frac{20}{100} \\times 425 = 85" },
    { "kind": "text", "text": "Il y a 85 élèves demi-pensionnaires." }
  ],
  "definition": "20/100 × 425 = 85\nIl y a 85 élèves demi-pensionnaires."
}

// DÉFINITION — énonce une règle, même avec une formule dedans
{
  "id": "signes-contraires", "level": 3, "title": "Signes contraires",
  "parentId": "…", "order": 0,
  "content": [
    { "kind": "text", "text": "On garde le signe du nombre le plus éloigné de zéro, puis on soustrait les distances à zéro." },
    { "kind": "math", "latex": "(+10) + (-4) = +(10-4) = +6" }
  ],
  "definition": "On garde le signe du nombre le plus éloigné de zéro, puis on soustrait les distances à zéro.\n(+10) + (-4) = +6"
}
```

Formules physique/chimie (`\\ce{}`, `\\pu{}`) et tableaux suivent exactement
les mêmes règles de bloc que déjà décrites plus bas — la seule différence est
de leur donner `kind: 'media'` plutôt que de forcer une phrase de définition
autour quand il n'y en a pas de naturelle.

**Hors périmètre** : les schémas labellisés (coupe de sol, cellule, chaîne
alimentaire...) n'ont pas de type de bloc dédié aujourd'hui. Route une
légende/schéma SVT vers un bloc `table` (numéro / nom / rôle) plutôt que de
l'omettre — moins fidèle visuellement, mais dans le périmètre du modèle
actuel.
```

- [ ] **Step 3: Add the `**mot-clé**` convention, right after "### 1. Titre et définition doivent se déterminer l'un l'autre"**

Insert a new subsection right after that one, renumbering the following ones (old "2." becomes "3.", etc. — renumber every subsequent `###` heading in `## Écrire pour le mode quiz` by one):

```markdown
### 2. Marquer les mots-clés d'une définition

Dans le texte d'une `definition` (ou d'un bloc `text`), encadrer les mots ou
groupes de mots essentiels avec des doubles astérisques : `**mot-clé**`.
L'application les affiche en couleur dans la fiche de lecture — jamais dans
le quiz, où toute option s'affiche en texte plat, y compris pour cette
carte-là si elle sert de distracteur ailleurs.

```json
// BON — les mots qui portent le sens sont marqués, la phrase reste lisible sans eux
{ "title": "Addition de fractions", "definition": "**Mettre au même dénominateur**, puis additionner les numérateurs en gardant le dénominateur commun." }
```

Ne pas marquer une phrase entière ni un mot sur deux — deux ou trois termes
par définition, ceux qu'un élève chercherait à retenir en premier.
```

- [ ] **Step 4: Extend the title-uniqueness rule, in the renumbered "Les sœurs doivent être distinguables" subsection**

At the end of that subsection (after "Viser des sœurs de longueur et de registre comparables..."), add:

```markdown
**Le titre lui-même doit être unique sur TOUT le fichier, pas seulement
entre sœurs.** Deux cartes de branches différentes partageant un titre (ex.
« Avec calculatrice » sous deux thèmes distincts) rendent le QCM titre→
définition réellement ambigu : la question n'affiche que le titre nu, sans
le thème parent, donc rien ne dit laquelle des deux définitions est la
bonne — un élève qui connaît les deux méthodes n'a aucun moyen de choisir.
Si deux cartes décrivent la même méthode sous deux thèmes, différencier
leurs titres (« Avec calculatrice, en appliquant » / « Avec calculatrice, en
calculant ») plutôt que les laisser identiques.
```

- [ ] **Step 5: Update the question-type table, in "## Écrire pour le mode quiz"**

Replace:

```markdown
| Question | Ce que l'app montre | Ce que l'utilisateur fournit | Déclenchée quand |
|---|---|---|---|
| `qcm-definition` | le `title` de la card | il choisit la bonne `definition` parmi 4 | la card A une `definition` |
| `recall` | le `title` en texte à trous | il écrit le titre lettre par lettre | la card n'a PAS de `definition` |
| `qcm-title` | la `definition` (comme indice) | il choisit le bon `title` parmi 4 | mode QCM activé |
```

with:

```markdown
| Question | Ce que l'app montre | Ce que l'utilisateur fournit | Déclenchée quand |
|---|---|---|---|
| `qcm-definition` | le `title` de la card | il choisit la bonne `definition` parmi 4 | `kind` absent/`definition`, la card a une `definition` |
| `recall` | le `title` en texte à trous | il écrit le titre lettre par lettre | `kind` absent/`definition`, la card n'a PAS de `definition` |
| `qcm-title` | la `definition` en entier (comme indice) | il choisit le bon `title` parmi 4 | `kind` absent/`definition`, mode QCM activé |
| `qcm-media` | le `title` de la card | il choisit le bon média (tableau/formule/image) parmi 4 | `kind: 'media'` |
| `qcm-media-title` | le média en entier (comme indice) | il choisit le bon `title` parmi 4 | `kind: 'media'`, mode QCM activé |
```

Also update the paragraph just below the table that begins "En mode QCM, la `definition` sert d'indice pour retrouver le titre, gradué par difficulté : intégrale en facile, tronquée à la moitié en moyen, absente en difficile" — replace it with:

```markdown
En mode QCM, la `definition` (ou le média) sert d'indice pour retrouver le
titre : affichée intégralement en facile et en moyen, absente en difficile
(il ne reste que la position dans l'arbre). Elle n'est plus jamais coupée en
plein milieu — écrire l'information qui rattache la définition à son titre
n'importe où dans le texte, pas seulement au début, reste malgré tout une
bonne pratique : une définition lisible d'un coup d'œil sert mieux l'élève
qu'une définition optimisée pour une troncature qui n'existe plus.
```

- [ ] **Step 6: Self-review the edited skill file**

Read the full updated `SKILL.md` once, end to end, checking: no leftover reference to "tronquée à la moitié en moyen" anywhere else in the file (search for `tronqu`), the renumbered subsections under "Écrire pour le mode quiz" are sequential with no gap or duplicate, and the "Erreurs fréquentes" table's row about "definition très inégales entre cards sœurs" still reads correctly with the new title-uniqueness rule alongside it (add one more row to that table: `| Titre identique à celui d'une carte d'une autre branche | Rend le QCM titre→définition réellement ambigu — aucune des deux définitions n'est reconnaissable comme LA bonne réponse |`).

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/transformer-cours-en-carte-mentale/SKILL.md
git commit -m "docs(skill): teach kind, **keyword** highlighting, and whole-file title uniqueness"
```
