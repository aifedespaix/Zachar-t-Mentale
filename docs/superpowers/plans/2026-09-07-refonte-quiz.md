# Refonte du mode quiz — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the quiz's masked-title interaction bug, replace random question typing with a deterministic rule (recall / QCM-définition / QCM-titre), redesign the config modal, QCM modal and definition display, and add a persisted Paramètres screen for typo tolerance and a length guide.

**Architecture:** Pure logic (question selection, text similarity, length-guide masking) lives in small, independently-tested modules under `src/state` and `src/utils`. `CardNode` stays the single place that renders a card's quiz state, but delegates the definition popup to a new `DefinitionPopover` and the answer-flip visual to a new `FlipCard` primitive. A second Zustand store (`useQuizSettingsStore`), persisted the same way `useWorkspaceStore` already is, holds the two cross-session preferences (similarity threshold, length-guide toggle).

**Tech Stack:** React 19, TypeScript, Zustand, Radix UI (via the unified `radix-ui` package), Tailwind v4 + `cva` (shadcn conventions), `@xyflow/react`, Vitest + Testing Library, Tauri `plugin-fs`/`api/path` for on-disk persistence.

**Spec:** [docs/superpowers/specs/2026-09-07-refonte-quiz-design.md](../specs/2026-09-07-refonte-quiz-design.md)

## Global Constraints

- Difficulty ratios are **20% / 50% / 75%** (facile/moyen/difficile) — not the old 30/60/100.
- Similarity threshold default is **100** (exact match after case/accent normalization); persisted, user-configurable 50–100.
- Length guide is **enabled by default**; masks `\p{L}` and `\p{Nd}` only (letters and decimal digits) — never spaces, punctuation, or non-decimal number categories like superscripts.
- No new dependencies: `radix-ui`, `lucide-react`, `class-variance-authority`, `cn`, `zustand` are all already installed — reuse them, mirroring `src/components/ui/button.tsx` and `src/components/ui/dialog.tsx` conventions.
- Every store/persistence pair follows the existing `useWorkspaceStore` / `workspaceConfig.ts` pattern exactly (same test-mocking style too).
- Run tests with `npm test` (`vitest run`); there is no `--watch` flag needed for one-off runs. Type-check with `npx tsc --noEmit`.

---

## Task 1: Quiz types — split `qcm` into `qcm-definition`/`qcm-title`, add `qcmMode`

**Files:**
- Modify: `src/types/quiz.ts`

**Interfaces:**
- Produces: `QuizConfig { levels, difficulty, qcmMode: boolean }`, `QuizQuestionType = 'recall' | 'qcm-definition' | 'qcm-title'`, `QuizQuestion { cardId, type, distractorDefinitions?, distractorTitles?, hint? }` — every later task imports these.

This is a type-only change. `npm test` will still pass afterwards (Vitest transforms TypeScript without type-checking), but `npx tsc --noEmit` will show errors in `quizReducer.ts`, `useQuizStore.ts`, `CardNode.tsx`, `QuizConfigModal.tsx` and their tests until Tasks 4, 5, 8, 10 and 12 land — that's expected, and Task 14 is the final type-check gate.

- [ ] **Step 1: Update the type definitions**

Replace the full contents of `src/types/quiz.ts`:

```ts
import type { CardLevel } from './card'

export type QuizDifficulty = 'facile' | 'moyen' | 'difficile'

export interface QuizConfig {
  levels: CardLevel[]
  difficulty: QuizDifficulty
  /** When true, every drawn card is quizzed on its TITLE via QCM (with its
   * definition as a difficulty-graded hint, if it has one) instead of the
   * default recall-title / QCM-definition split. */
  qcmMode: boolean
}

export type QuizQuestionType = 'recall' | 'qcm-definition' | 'qcm-title'

export interface QuizQuestion {
  cardId: string
  type: QuizQuestionType
  /** qcm-definition only. */
  distractorDefinitions?: string[]
  /** qcm-title only. */
  distractorTitles?: string[]
  /** qcm-title only; absent means "no textual hint, context of the graph only". */
  hint?: string
}

export type QuizResult = 'unanswered' | 'correct' | 'incorrect'
```

- [ ] **Step 2: Commit**

```bash
git add src/types/quiz.ts
git commit -m "feat(quiz): split qcm question type into qcm-definition/qcm-title, add qcmMode"
```

---

## Task 2: `QuizSettings` type, persistence, and store

**Files:**
- Create: `src/types/quizSettings.ts`
- Create: `src/persistence/quizSettings.ts`
- Create: `src/persistence/quizSettings.test.ts`
- Create: `src/state/useQuizSettingsStore.ts`
- Create: `src/state/useQuizSettingsStore.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `QuizSettings`, `DEFAULT_QUIZ_SETTINGS`, `loadQuizSettings()`, `saveQuizSettings(settings)`, `useQuizSettingsStore` (fields `similarityThreshold: number`, `lengthGuideEnabled: boolean`, actions `init()`, `setSimilarityThreshold(value)`, `setLengthGuideEnabled(value)`) — consumed by Tasks 9, 10, 12.

- [ ] **Step 1: Add the type**

```ts
// src/types/quizSettings.ts
export interface QuizSettings {
  similarityThreshold: number
  lengthGuideEnabled: boolean
}

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = {
  similarityThreshold: 100,
  lengthGuideEnabled: true,
}
```

- [ ] **Step 2: Write the failing persistence tests**

```ts
// src/persistence/quizSettings.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadQuizSettings, saveQuizSettings } from './quizSettings'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn().mockResolvedValue('/fake/config'),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'

describe('loadQuizSettings', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
  })

  it('returns the defaults when no settings file exists yet', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const settings = await loadQuizSettings()
    expect(settings).toEqual({ similarityThreshold: 100, lengthGuideEnabled: true })
  })

  it('reads and parses an existing settings file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ similarityThreshold: 85, lengthGuideEnabled: false }))
    const settings = await loadQuizSettings()
    expect(readTextFile).toHaveBeenCalledWith('/fake/config/quiz-settings.json')
    expect(settings).toEqual({ similarityThreshold: 85, lengthGuideEnabled: false })
  })

  it('fills in a default for a field missing from an older settings file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ similarityThreshold: 85 }))
    const settings = await loadQuizSettings()
    expect(settings).toEqual({ similarityThreshold: 85, lengthGuideEnabled: true })
  })
})

describe('saveQuizSettings', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(writeTextFile).mockReset()
    vi.mocked(mkdir).mockReset()
  })

  it('creates the app config directory if missing, then writes the settings file', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    await saveQuizSettings({ similarityThreshold: 90, lengthGuideEnabled: false })
    expect(mkdir).toHaveBeenCalledWith('/fake/config', { recursive: true })
    expect(writeTextFile).toHaveBeenCalledWith(
      '/fake/config/quiz-settings.json',
      JSON.stringify({ similarityThreshold: 90, lengthGuideEnabled: false }, null, 2)
    )
  })

  it('does not recreate the config directory when it already exists', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    await saveQuizSettings({ similarityThreshold: 100, lengthGuideEnabled: true })
    expect(mkdir).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- src/persistence/quizSettings.test.ts`
Expected: FAIL — `./quizSettings` has no exports yet.

- [ ] **Step 4: Implement the persistence module**

```ts
// src/persistence/quizSettings.ts
import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'
import type { QuizSettings } from '../types/quizSettings'
import { DEFAULT_QUIZ_SETTINGS } from '../types/quizSettings'

const SETTINGS_FILE_NAME = 'quiz-settings.json'

async function settingsFilePath(): Promise<string> {
  return join(await appConfigDir(), SETTINGS_FILE_NAME)
}

export async function loadQuizSettings(): Promise<QuizSettings> {
  const path = await settingsFilePath()
  if (!(await exists(path))) return DEFAULT_QUIZ_SETTINGS
  const json = await readTextFile(path)
  return { ...DEFAULT_QUIZ_SETTINGS, ...(JSON.parse(json) as Partial<QuizSettings>) }
}

export async function saveQuizSettings(settings: QuizSettings): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const path = await settingsFilePath()
  await writeTextFile(path, JSON.stringify(settings, null, 2))
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/persistence/quizSettings.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Write the failing store tests**

```ts
// src/state/useQuizSettingsStore.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createQuizSettingsStore } from './useQuizSettingsStore'

vi.mock('../persistence/quizSettings', () => ({
  loadQuizSettings: vi.fn(),
  saveQuizSettings: vi.fn(),
}))

import { loadQuizSettings, saveQuizSettings } from '../persistence/quizSettings'

describe('useQuizSettingsStore', () => {
  beforeEach(() => {
    vi.mocked(loadQuizSettings).mockReset()
    vi.mocked(saveQuizSettings).mockReset().mockResolvedValue(undefined)
  })

  it('starts with the defaults before init resolves', () => {
    const store = createQuizSettingsStore()
    expect(store.getState().similarityThreshold).toBe(100)
    expect(store.getState().lengthGuideEnabled).toBe(true)
  })

  it('init loads persisted settings into the store', async () => {
    vi.mocked(loadQuizSettings).mockResolvedValue({ similarityThreshold: 90, lengthGuideEnabled: false })
    const store = createQuizSettingsStore()

    await store.getState().init()

    expect(store.getState().similarityThreshold).toBe(90)
    expect(store.getState().lengthGuideEnabled).toBe(false)
  })

  it('setSimilarityThreshold updates the store and persists both fields', async () => {
    const store = createQuizSettingsStore()

    await store.getState().setSimilarityThreshold(80)

    expect(store.getState().similarityThreshold).toBe(80)
    expect(saveQuizSettings).toHaveBeenCalledWith({ similarityThreshold: 80, lengthGuideEnabled: true })
  })

  it('setLengthGuideEnabled updates the store and persists both fields', async () => {
    const store = createQuizSettingsStore()

    await store.getState().setLengthGuideEnabled(false)

    expect(store.getState().lengthGuideEnabled).toBe(false)
    expect(saveQuizSettings).toHaveBeenCalledWith({ similarityThreshold: 100, lengthGuideEnabled: false })
  })
})
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npm test -- src/state/useQuizSettingsStore.test.ts`
Expected: FAIL — `./useQuizSettingsStore` has no exports yet.

- [ ] **Step 8: Implement the store**

```ts
// src/state/useQuizSettingsStore.ts
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { QuizSettings } from '../types/quizSettings'
import { DEFAULT_QUIZ_SETTINGS } from '../types/quizSettings'
import { loadQuizSettings, saveQuizSettings } from '../persistence/quizSettings'

interface QuizSettingsState extends QuizSettings {
  init: () => Promise<void>
  setSimilarityThreshold: (value: number) => Promise<void>
  setLengthGuideEnabled: (value: boolean) => Promise<void>
}

export type QuizSettingsStore = UseBoundStore<StoreApi<QuizSettingsState>>

export function createQuizSettingsStore(): QuizSettingsStore {
  return create<QuizSettingsState>((set, get) => ({
    ...DEFAULT_QUIZ_SETTINGS,
    init: async () => {
      const settings = await loadQuizSettings()
      set(settings)
    },
    setSimilarityThreshold: async value => {
      const next = { similarityThreshold: value, lengthGuideEnabled: get().lengthGuideEnabled }
      set(next)
      await saveQuizSettings(next)
    },
    setLengthGuideEnabled: async value => {
      const next = { similarityThreshold: get().similarityThreshold, lengthGuideEnabled: value }
      set(next)
      await saveQuizSettings(next)
    },
  }))
}

export const useQuizSettingsStore = createQuizSettingsStore()
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test -- src/state/useQuizSettingsStore.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 10: Commit**

```bash
git add src/types/quizSettings.ts src/persistence/quizSettings.ts src/persistence/quizSettings.test.ts src/state/useQuizSettingsStore.ts src/state/useQuizSettingsStore.test.ts
git commit -m "feat(quiz): add persisted QuizSettings (similarity threshold, length guide)"
```

---

## Task 3: Text utilities — similarity scoring and the length guide

**Files:**
- Create: `src/utils/textSimilarity.ts`
- Create: `src/utils/textSimilarity.test.ts`
- Create: `src/utils/lengthGuide.ts`
- Create: `src/utils/lengthGuide.test.ts`

**Interfaces:**
- Consumes: none (pure functions).
- Produces: `normalizeForComparison(value)`, `computeTitleSimilarity(typed, real): number` (0-100), `similarityColor(pct): string`, `buildLengthGuide(realTitle): string` — consumed by Task 10 (CardNode).

- [ ] **Step 1: Write the failing similarity tests**

```ts
// src/utils/textSimilarity.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeForComparison, computeTitleSimilarity, similarityColor } from './textSimilarity'

describe('normalizeForComparison', () => {
  it('lowercases, strips accents, and trims', () => {
    expect(normalizeForComparison('  Photosynthèse  ')).toBe('photosynthese')
  })
})

describe('computeTitleSimilarity', () => {
  it('returns 100 for an exact match', () => {
    expect(computeTitleSimilarity('Chat', 'Chat')).toBe(100)
  })

  it('returns 100 for a match differing only by case and accents', () => {
    expect(computeTitleSimilarity('photosynthese', 'Photosynthèse')).toBe(100)
  })

  it('returns a partial percentage for a near match (one substitution out of 4 chars)', () => {
    expect(computeTitleSimilarity('Chah', 'Chat')).toBe(75)
  })

  it('returns 0 for a completely different, same-length string', () => {
    expect(computeTitleSimilarity('Xyzw', 'Chat')).toBe(0)
  })
})

describe('similarityColor', () => {
  it('is green at or above 85%', () => {
    expect(similarityColor(85)).toBe('#16a34a')
    expect(similarityColor(100)).toBe('#16a34a')
  })

  it('is amber between 50% and 85%', () => {
    expect(similarityColor(50)).toBe('#d97706')
    expect(similarityColor(84)).toBe('#d97706')
  })

  it('is red below 50%', () => {
    expect(similarityColor(0)).toBe('#dc2626')
    expect(similarityColor(49)).toBe('#dc2626')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/utils/textSimilarity.test.ts`
Expected: FAIL — `./textSimilarity` has no exports yet.

- [ ] **Step 3: Implement `textSimilarity.ts`**

```ts
// src/utils/textSimilarity.ts
export function normalizeForComparison(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const distances: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0))
  for (let i = 0; i < rows; i++) distances[i][0] = i
  for (let j = 0; j < cols; j++) distances[0][j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      distances[i][j] = Math.min(distances[i - 1][j] + 1, distances[i][j - 1] + 1, distances[i - 1][j - 1] + cost)
    }
  }
  return distances[rows - 1][cols - 1]
}

/** Percentage similarity (0-100) between two strings, after accent/case normalization. */
export function computeTitleSimilarity(typed: string, real: string): number {
  const a = normalizeForComparison(typed)
  const b = normalizeForComparison(real)
  if (a === b) return 100
  const maxLength = Math.max(a.length, b.length)
  if (maxLength === 0) return 100
  const distance = levenshteinDistance(a, b)
  return Math.max(0, Math.round((1 - distance / maxLength) * 100))
}

/** Feedback-badge color for a similarity percentage: green (close) -> amber -> red (far). */
export function similarityColor(pct: number): string {
  if (pct >= 85) return '#16a34a'
  if (pct >= 50) return '#d97706'
  return '#dc2626'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/utils/textSimilarity.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Write the failing length-guide tests**

```ts
// src/utils/lengthGuide.test.ts
import { describe, it, expect } from 'vitest'
import { buildLengthGuide } from './lengthGuide'

describe('buildLengthGuide', () => {
  it('masks every letter and keeps spaces visible', () => {
    expect(buildLengthGuide('Chat')).toBe('____')
    expect(buildLengthGuide('La photosynthèse')).toBe('__ _____________')
  })

  it('masks decimal digits but keeps exponents, operators and punctuation visible', () => {
    // (A+B)² = A² + 2AB + B² : letters and the plain digit "2" are hidden,
    // parentheses/operators/"=" and the superscript "²" (not a decimal digit
    // in Unicode) stay visible so (A+B)² reads differently from (A-B)².
    expect(buildLengthGuide('(A+B)²=A²+2AB+B²')).toBe('(_+_)²=_²+___+_²')
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- src/utils/lengthGuide.test.ts`
Expected: FAIL — `./lengthGuide` has no exports yet.

- [ ] **Step 7: Implement `lengthGuide.ts`**

```ts
// src/utils/lengthGuide.ts
/**
 * Hangman-style guide: letters and decimal digits become blanks; everything
 * else (spaces, punctuation, operators, exponents like "²") stays visible —
 * `\p{Nd}` deliberately excludes superscript/other Unicode number categories.
 */
export function buildLengthGuide(realTitle: string): string {
  return Array.from(realTitle)
    .map(char => (/[\p{L}\p{Nd}]/u.test(char) ? '_' : char))
    .join('')
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -- src/utils/lengthGuide.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add src/utils/textSimilarity.ts src/utils/textSimilarity.test.ts src/utils/lengthGuide.ts src/utils/lengthGuide.test.ts
git commit -m "feat(quiz): add typed-answer similarity scoring and hangman-style length guide"
```

---

## Task 4: `quizReducer.ts` — new ratios, deterministic question typing, title distractors/hints

**Files:**
- Modify: `src/state/quizReducer.ts`
- Modify: `src/state/quizReducer.test.ts`

**Interfaces:**
- Consumes: `QuizConfig`, `QuizQuestion`, `QuizQuestionType` from Task 1.
- Produces: `selectQuizQuestions(cards, config, random?)`, `buildDistractorPool(cards, target, difficulty, random?)` (unchanged signature), `buildTitleDistractorPool(cards, target, difficulty, random?)` (new), `attachDistractors(cards, questions, difficulty, random?)`, `computeScore(results)` (unchanged) — consumed by Task 5 (`useQuizStore`).

- [ ] **Step 1: Replace `quizReducer.test.ts` with the updated suite**

```ts
// src/state/quizReducer.test.ts
import { describe, it, expect } from 'vitest'
import { selectQuizQuestions, buildDistractorPool, buildTitleDistractorPool, attachDistractors, computeScore } from './quizReducer'
import type { Card } from '../types/card'
import type { QuizConfig } from '../types/quiz'

const root: Card = { id: 'root', level: 1, title: 'Racine', parentId: null, order: 0 }
function makeLevel2(n: number): Card[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `l2-${i}`,
    level: 2 as const,
    title: `Sous-titre ${i}`,
    parentId: 'root',
    order: i,
  }))
}

/** Cycles deterministically through fixed values instead of Math.random(). */
function sequence(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

function baseConfig(overrides: Partial<QuizConfig> = {}): QuizConfig {
  return { levels: [2], difficulty: 'moyen', qcmMode: false, ...overrides }
}

describe('selectQuizQuestions', () => {
  it('draws round(levelCount * sampleRatio) cards for a level, with "moyen" at 50%', () => {
    const cards = [root, ...makeLevel2(10)]
    const questions = selectQuizQuestions(cards, baseConfig(), sequence([0.1]))
    expect(questions).toHaveLength(5)
  })

  it('draws 75% of the perimeter for "difficile"', () => {
    const cards = [root, ...makeLevel2(4)]
    const questions = selectQuizQuestions(cards, baseConfig({ difficulty: 'difficile' }), sequence([0.9]))
    expect(questions).toHaveLength(3)
  })

  it('draws 20% of the perimeter for "facile"', () => {
    const cards = [root, ...makeLevel2(10)]
    const questions = selectQuizQuestions(cards, baseConfig({ difficulty: 'facile' }), sequence([0.9]))
    expect(questions).toHaveLength(2)
  })

  it('never draws the same card twice', () => {
    const cards = [root, ...makeLevel2(8)]
    const questions = selectQuizQuestions(cards, baseConfig({ difficulty: 'difficile' }), sequence([0.1, 0.4, 0.7, 0.2, 0.9]))
    const ids = questions.map(q => q.cardId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only draws from the levels listed in the config', () => {
    const cards = [root, ...makeLevel2(4)]
    const questions = selectQuizQuestions(cards, baseConfig({ levels: [1], difficulty: 'difficile' }))
    expect(questions).toEqual([{ cardId: 'root', type: 'recall' }])
  })

  it('types a card with no definition as "recall" in normal mode', () => {
    const questions = selectQuizQuestions([root], baseConfig({ levels: [1], difficulty: 'difficile' }))
    expect(questions).toEqual([{ cardId: 'root', type: 'recall' }])
  })

  it('types a card WITH a definition as "qcm-definition" in normal mode', () => {
    const withDefinition: Card = { ...root, definition: 'Une définition' }
    const questions = selectQuizQuestions([withDefinition], baseConfig({ levels: [1], difficulty: 'difficile' }))
    expect(questions).toEqual([{ cardId: 'root', type: 'qcm-definition' }])
  })

  it('types every drawn card as "qcm-title" when qcmMode is on, definition or not', () => {
    const withDefinition: Card = { ...root, definition: 'Une définition' }
    const withoutDefinition: Card = { id: 'other', level: 1, title: 'Autre', parentId: null, order: 0 }

    expect(
      selectQuizQuestions([withDefinition], baseConfig({ levels: [1], difficulty: 'difficile', qcmMode: true }))
    ).toEqual([{ cardId: 'root', type: 'qcm-title' }])

    expect(
      selectQuizQuestions([withoutDefinition], baseConfig({ levels: [1], difficulty: 'difficile', qcmMode: true }))
    ).toEqual([{ cardId: 'other', type: 'qcm-title' }])
  })

  it('still draws the single card of a level with exactly 1 card at "facile" (round-to-zero must not drop it)', () => {
    const questions = selectQuizQuestions([root], baseConfig({ levels: [1], difficulty: 'facile' }))
    expect(questions).toEqual([{ cardId: 'root', type: 'recall' }])
  })

  it('draws 0 cards for an empty level (no cards to guarantee a minimum from)', () => {
    const questions = selectQuizQuestions([root, ...makeLevel2(2)], baseConfig({ levels: [3], difficulty: 'facile' }))
    expect(questions).toEqual([])
  })
})

describe('buildDistractorPool', () => {
  const target: Card = { id: 'target', level: 3, title: 'Cible', definition: 'Bonne définition', parentId: 'p1', order: 0 }
  const sibling: Card = { id: 'sibling', level: 3, title: 'Frère', definition: 'Def frère', parentId: 'p1', order: 1 }
  const sameLevelOtherBranch: Card = { id: 'other-branch', level: 3, title: 'Autre branche', definition: 'Def autre branche', parentId: 'p2', order: 0 }
  const otherLevel: Card = { id: 'other-level', level: 2, title: 'Autre niveau', definition: 'Def autre niveau', parentId: 'root', order: 0 }
  const noDefinition: Card = { id: 'no-def', level: 3, title: 'Sans définition', parentId: 'p1', order: 2 }
  const allCards = [target, sibling, sameLevelOtherBranch, otherLevel, noDefinition]

  it('never includes the target card itself or cards without a definition', () => {
    const pool = buildDistractorPool(allCards, target, 'facile')
    expect(pool).not.toContain('Bonne définition')
    expect(pool.length).toBeLessThanOrEqual(3)
  })

  it('"facile" pulls distractors from anywhere in the map', () => {
    const pool = buildDistractorPool(allCards, target, 'facile')
    expect(pool.sort()).toEqual(['Def autre branche', 'Def autre niveau', 'Def frère'].sort())
  })

  it('"difficile" prioritizes the same branch (same parent) first', () => {
    const pool = buildDistractorPool(allCards, target, 'difficile')
    expect(pool[0]).toBe('Def frère')
  })

  it('degrades to the whole map when the branch/level do not have enough distractors', () => {
    const onlyTarget = [target, otherLevel]
    const pool = buildDistractorPool(onlyTarget, target, 'difficile')
    expect(pool).toEqual(['Def autre niveau'])
  })

  it('returns an empty pool when no other card in the map has a definition', () => {
    const pool = buildDistractorPool([target, noDefinition], target, 'facile')
    expect(pool).toEqual([])
  })

  it('never includes a distractor whose definition TEXT duplicates the target\'s (even from a different card id)', () => {
    const duplicateText: Card = {
      id: 'duplicate',
      level: 3,
      title: 'Doublon',
      definition: 'Bonne définition',
      parentId: 'p1',
      order: 3,
    }
    const pool = buildDistractorPool([target, duplicateText], target, 'facile')
    expect(pool).not.toContain('Bonne définition')
    expect(pool).toEqual([])
  })
})

describe('buildTitleDistractorPool', () => {
  const target: Card = { id: 'target', level: 3, title: 'Cible', parentId: 'p1', order: 0 }
  const sibling: Card = { id: 'sibling', level: 3, title: 'Frère', parentId: 'p1', order: 1 }
  const sameLevelOtherBranch: Card = { id: 'other-branch', level: 3, title: 'Autre branche', parentId: 'p2', order: 0 }
  const otherLevel: Card = { id: 'other-level', level: 2, title: 'Autre niveau', parentId: 'root', order: 0 }
  const allCards = [target, sibling, sameLevelOtherBranch, otherLevel]

  it('never includes the target card itself', () => {
    const pool = buildTitleDistractorPool(allCards, target, 'facile')
    expect(pool).not.toContain('Cible')
  })

  it('"facile" pulls distractors from anywhere in the map', () => {
    const pool = buildTitleDistractorPool(allCards, target, 'facile')
    expect(pool.sort()).toEqual(['Autre branche', 'Autre niveau', 'Frère'].sort())
  })

  it('"difficile" prioritizes the same branch (same parent) first', () => {
    const pool = buildTitleDistractorPool(allCards, target, 'difficile')
    expect(pool[0]).toBe('Frère')
  })

  it('returns an empty pool when no other card exists', () => {
    const pool = buildTitleDistractorPool([target], target, 'facile')
    expect(pool).toEqual([])
  })
})

describe('attachDistractors', () => {
  const cardWithDef: Card = { id: 'a', level: 1, title: 'A', definition: 'Def A', parentId: null, order: 0 }
  const otherWithDef: Card = { id: 'b', level: 2, title: 'B', definition: 'Def B', parentId: 'a', order: 0 }
  const cardNoDef: Card = { id: 'c', level: 1, title: 'C', parentId: null, order: 0 }
  const otherNoDef: Card = { id: 'd', level: 2, title: 'D', parentId: 'c', order: 0 }

  it('fills distractorDefinitions for a qcm-definition question when distractors exist', () => {
    const questions = attachDistractors([cardWithDef, otherWithDef], [{ cardId: 'a', type: 'qcm-definition' }], 'facile')
    expect(questions).toEqual([{ cardId: 'a', type: 'qcm-definition', distractorDefinitions: ['Def B'] }])
  })

  it('falls back to "recall" when a qcm-definition question has no possible distractor', () => {
    const questions = attachDistractors([cardWithDef], [{ cardId: 'a', type: 'qcm-definition' }], 'facile')
    expect(questions).toEqual([{ cardId: 'a', type: 'recall' }])
  })

  it('fills distractorTitles and a full-definition hint for "facile" qcm-title', () => {
    const questions = attachDistractors([cardWithDef, otherWithDef], [{ cardId: 'a', type: 'qcm-title' }], 'facile')
    expect(questions).toEqual([{ cardId: 'a', type: 'qcm-title', distractorTitles: ['B'], hint: 'Def A' }])
  })

  it('truncates the hint for "moyen" qcm-title', () => {
    const longDef: Card = { ...cardWithDef, definition: 'Un long texte de définition pour vérifier la troncature' }
    const questions = attachDistractors([longDef, otherWithDef], [{ cardId: 'a', type: 'qcm-title' }], 'moyen')
    const [question] = questions
    expect(question.type).toBe('qcm-title')
    expect(question.hint).toMatch(/…$/)
    expect(question.hint!.length).toBeLessThan(longDef.definition!.length)
  })

  it('gives no hint for "difficile" qcm-title even when a definition exists', () => {
    const questions = attachDistractors([cardWithDef, otherWithDef], [{ cardId: 'a', type: 'qcm-title' }], 'difficile')
    expect(questions[0].hint).toBeUndefined()
  })

  it('gives no hint for qcm-title when the card has no definition at all', () => {
    const questions = attachDistractors([cardNoDef, otherNoDef], [{ cardId: 'c', type: 'qcm-title' }], 'facile')
    expect(questions[0].hint).toBeUndefined()
  })

  it('falls back to "recall" when a qcm-title question has no possible title distractor', () => {
    const questions = attachDistractors([cardWithDef], [{ cardId: 'a', type: 'qcm-title' }], 'facile')
    expect(questions).toEqual([{ cardId: 'a', type: 'recall' }])
  })

  it('leaves recall questions untouched', () => {
    const questions = attachDistractors([cardWithDef, otherWithDef], [{ cardId: 'a', type: 'recall' }], 'facile')
    expect(questions).toEqual([{ cardId: 'a', type: 'recall' }])
  })
})

describe('computeScore', () => {
  it('counts correct answers against the total number of results', () => {
    expect(computeScore({ a: 'correct', b: 'incorrect', c: 'correct', d: 'unanswered' })).toEqual({
      correct: 2,
      total: 4,
    })
  })

  it('returns zero/zero for no results', () => {
    expect(computeScore({})).toEqual({ correct: 0, total: 0 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/state/quizReducer.test.ts`
Expected: FAIL — old exports don't match the new expectations (`buildTitleDistractorPool` missing, `type: 'qcm'` no longer produced, ratios wrong).

- [ ] **Step 3: Replace `quizReducer.ts`**

```ts
// src/state/quizReducer.ts
import type { Card } from '../types/card'
import type { QuizConfig, QuizDifficulty, QuizQuestion, QuizQuestionType, QuizResult } from '../types/quiz'

const DIFFICULTY_SETTINGS: Record<QuizDifficulty, { sampleRatio: number }> = {
  facile: { sampleRatio: 0.2 },
  moyen: { sampleRatio: 0.5 },
  difficile: { sampleRatio: 0.75 },
}

const HINT_TRUNCATE_RATIO = 0.5
const MAX_DISTRACTORS = 3

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function selectQuizQuestions(
  cards: Card[],
  config: QuizConfig,
  random: () => number = Math.random
): QuizQuestion[] {
  const { sampleRatio } = DIFFICULTY_SETTINGS[config.difficulty]

  const drawn: Card[] = []
  for (const level of config.levels) {
    const levelCards = cards.filter(c => c.level === level)
    // A plain round() can hit 0 for a small non-empty level (e.g. exactly 1
    // card at "facile", 1 * 0.2 rounds to 0) — level 1 (the root) always has
    // exactly 1 card, so a fresh mind map's only card would never be drawn.
    // Guarantee at least 1 card from any level that has cards at all.
    const count = levelCards.length === 0 ? 0 : Math.max(1, Math.round(levelCards.length * sampleRatio))
    drawn.push(...shuffle(levelCards, random).slice(0, count))
  }

  return drawn.map(card => {
    if (config.qcmMode) return { cardId: card.id, type: 'qcm-title' as QuizQuestionType }
    const type: QuizQuestionType = card.definition ? 'qcm-definition' : 'recall'
    return { cardId: card.id, type }
  })
}

function distractorScopes(cards: Card[], targetCard: Card, difficulty: QuizDifficulty): Card[][] {
  const branch = cards.filter(c => c.parentId === targetCard.parentId)
  const level = cards.filter(c => c.level === targetCard.level)
  const whole = cards
  const scopesByDifficulty: Record<QuizDifficulty, Card[][]> = {
    facile: [whole],
    moyen: [level, whole],
    difficile: [branch, level, whole],
  }
  return scopesByDifficulty[difficulty]
}

/** Shared branch->level->whole-map degradation, parameterized over which text field to pool. */
function buildDistractorPoolFrom(
  cards: Card[],
  targetCard: Card,
  difficulty: QuizDifficulty,
  pick: (card: Card) => string | undefined,
  exclude: string,
  random: () => number
): string[] {
  const seen = new Set<string>([exclude])
  const pool: string[] = []
  for (const scope of distractorScopes(cards, targetCard, difficulty)) {
    for (const card of shuffle(scope, random)) {
      if (pool.length >= MAX_DISTRACTORS) break
      if (card.id === targetCard.id) continue
      const value = pick(card)
      if (!value || seen.has(value)) continue
      seen.add(value)
      pool.push(value)
    }
    if (pool.length >= MAX_DISTRACTORS) break
  }
  return pool
}

export function buildDistractorPool(
  cards: Card[],
  targetCard: Card,
  difficulty: QuizDifficulty,
  random: () => number = Math.random
): string[] {
  return buildDistractorPoolFrom(cards, targetCard, difficulty, c => c.definition, targetCard.definition ?? '', random)
}

export function buildTitleDistractorPool(
  cards: Card[],
  targetCard: Card,
  difficulty: QuizDifficulty,
  random: () => number = Math.random
): string[] {
  return buildDistractorPoolFrom(cards, targetCard, difficulty, c => c.title, targetCard.title, random)
}

function truncateAtWordBoundary(text: string, ratio: number): string {
  const targetLength = Math.max(1, Math.round(text.length * ratio))
  if (targetLength >= text.length) return text
  const cut = text.lastIndexOf(' ', targetLength)
  const truncated = cut > 0 ? text.slice(0, cut) : text.slice(0, targetLength)
  return `${truncated}…`
}

/** facile = full definition, moyen = truncated, difficile = no textual hint. */
function buildHint(card: Card, difficulty: QuizDifficulty): string | undefined {
  if (!card.definition) return undefined
  if (difficulty === 'facile') return card.definition
  if (difficulty === 'moyen') return truncateAtWordBoundary(card.definition, HINT_TRUNCATE_RATIO)
  return undefined
}

export function attachDistractors(
  cards: Card[],
  questions: QuizQuestion[],
  difficulty: QuizDifficulty,
  random: () => number = Math.random
): QuizQuestion[] {
  return questions.map(question => {
    const card = cards.find(c => c.id === question.cardId)
    // Defensive only (should not happen in practice): always degrade to
    // recall rather than returning the original, unmodified question.
    if (!card) return { cardId: question.cardId, type: 'recall' }

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

    return question
  })
}

export function computeScore(results: Record<string, QuizResult>): { correct: number; total: number } {
  const values = Object.values(results)
  return { correct: values.filter(r => r === 'correct').length, total: values.length }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/state/quizReducer.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/state/quizReducer.ts src/state/quizReducer.test.ts
git commit -m "feat(quiz): deterministic question typing, 20/50/75 ratios, title distractors+hints"
```

---

## Task 5: `useQuizStore.ts` — split `answerQcm` into definition/title variants

**Files:**
- Modify: `src/state/useQuizStore.ts`
- Modify: `src/state/useQuizStore.test.ts`
- Modify: `src/components/CardNode.tsx` (mechanical rename of its one call site — see Step 6)

**Interfaces:**
- Consumes: `selectQuizQuestions`, `attachDistractors` from Task 4.
- Produces: `answerQcmDefinition(cardId, chosenDefinition)`, `answerQcmTitle(cardId, chosenTitle)` (replaces `answerQcm`) — `answerQcmTitle` is wired up for real in Task 12; `answerQcmDefinition` is CardNode's only consumer today and must be renamed in lockstep (Step 6) so `CardNode.test.tsx`'s existing qcm tests don't silently start calling an undefined store action.

- [ ] **Step 1: Update `useQuizStore.test.ts`**

Add `qcmMode: false` to every existing `startQuiz(...)` call, and replace the `answerQcm` describe block:

```ts
// src/state/useQuizStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createQuizStore } from './useQuizStore'
import { useCardsStore, createCardsStore } from './useCardsStore'
import type { Card } from '../types/card'

const root: Card = { id: 'root', level: 1, title: 'Racine', definition: 'Def racine', parentId: null, order: 0 }
const child: Card = { id: 'child', level: 2, title: 'Enfant', definition: 'Def enfant', parentId: 'root', order: 0 }

describe('useQuizStore', () => {
  beforeEach(() => {
    const pristine = createCardsStore().getState()
    useCardsStore.setState({ history: pristine.history, locked: pristine.locked })
    useCardsStore.getState().loadCards([root, child])
  })

  it('starts inactive with no questions', () => {
    const store = createQuizStore()
    expect(store.getState().active).toBe(false)
    expect(store.getState().questions).toEqual([])
  })

  it('startQuiz populates questions/results and marks the quiz active', () => {
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1, 2], difficulty: 'difficile', qcmMode: false })

    expect(store.getState().active).toBe(true)
    expect(store.getState().questions).toHaveLength(2)
    expect(store.getState().results).toEqual({ root: 'unanswered', child: 'unanswered' })
  })

  it('startQuiz locks the mind map if it was not already locked', () => {
    const store = createQuizStore()
    expect(useCardsStore.getState().locked).toBe(false)

    store.getState().startQuiz({ levels: [1], difficulty: 'facile', qcmMode: false })

    expect(useCardsStore.getState().locked).toBe(true)
  })

  it('answerRecall records a correct/incorrect result for that card', () => {
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1, 2], difficulty: 'difficile', qcmMode: false })

    store.getState().answerRecall('root', true)
    store.getState().answerRecall('child', false)

    expect(store.getState().results).toEqual({ root: 'correct', child: 'incorrect' })
  })

  it('answerQcmDefinition compares the chosen definition against the card\'s real definition', () => {
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1, 2], difficulty: 'difficile', qcmMode: false })

    store.getState().answerQcmDefinition('root', 'Def racine')
    store.getState().answerQcmDefinition('child', 'Une définition fausse')

    expect(store.getState().results).toEqual({ root: 'correct', child: 'incorrect' })
  })

  it('answerQcmTitle compares the chosen title against the card\'s real title', () => {
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1, 2], difficulty: 'difficile', qcmMode: true })

    store.getState().answerQcmTitle('root', 'Racine')
    store.getState().answerQcmTitle('child', 'Un titre faux')

    expect(store.getState().results).toEqual({ root: 'correct', child: 'incorrect' })
  })

  it('finishQuiz opens the summary without ending the session', () => {
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1], difficulty: 'facile', qcmMode: false })

    store.getState().finishQuiz()

    expect(store.getState().showSummary).toBe(true)
    expect(store.getState().active).toBe(true)
  })

  it('endQuiz clears the session and re-locks/unlocks to the pre-quiz state', () => {
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1], difficulty: 'facile', qcmMode: false })

    store.getState().endQuiz()

    expect(store.getState().active).toBe(false)
    expect(store.getState().questions).toEqual([])
    expect(useCardsStore.getState().locked).toBe(false)
  })

  it('endQuiz leaves the mind map locked if the user had locked it before starting the quiz', () => {
    useCardsStore.getState().toggleLock()
    const store = createQuizStore()
    store.getState().startQuiz({ levels: [1], difficulty: 'facile', qcmMode: false })

    store.getState().endQuiz()

    expect(useCardsStore.getState().locked).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/state/useQuizStore.test.ts`
Expected: FAIL — `answerQcmDefinition`/`answerQcmTitle` don't exist yet, `qcmMode` missing from the type.

- [ ] **Step 3: Update `useQuizStore.ts`**

Replace the `answerQcm` field/action with the two split ones:

```ts
// src/state/useQuizStore.ts
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { QuizConfig, QuizQuestion, QuizResult } from '../types/quiz'
import { selectQuizQuestions, attachDistractors } from './quizReducer'
import { useCardsStore } from './useCardsStore'

interface QuizState {
  active: boolean
  showSummary: boolean
  config: QuizConfig | null
  questions: QuizQuestion[]
  results: Record<string, QuizResult>
  wasLockedBeforeQuiz: boolean
  startQuiz: (config: QuizConfig) => void
  answerRecall: (cardId: string, correct: boolean) => void
  answerQcmDefinition: (cardId: string, chosenDefinition: string) => void
  answerQcmTitle: (cardId: string, chosenTitle: string) => void
  finishQuiz: () => void
  endQuiz: () => void
}

export type QuizStore = UseBoundStore<StoreApi<QuizState>>

export function createQuizStore(): QuizStore {
  return create<QuizState>((set, get) => ({
    active: false,
    showSummary: false,
    config: null,
    questions: [],
    results: {},
    wasLockedBeforeQuiz: false,
    startQuiz: config => {
      // Floating cards are a scratch area, not revision material: they are kept
      // out of both the drawn questions and the distractor pool.
      const cards = useCardsStore.getState().history.present.filter(c => !c.detached)
      const questions = attachDistractors(cards, selectQuizQuestions(cards, config), config.difficulty)
      const results: Record<string, QuizResult> = {}
      for (const q of questions) results[q.cardId] = 'unanswered'

      const wasLocked = useCardsStore.getState().locked
      if (!wasLocked) useCardsStore.getState().toggleLock()

      set({ active: true, showSummary: false, config, questions, results, wasLockedBeforeQuiz: wasLocked })
    },
    answerRecall: (cardId, correct) =>
      set(state => ({ results: { ...state.results, [cardId]: correct ? 'correct' : 'incorrect' } })),
    answerQcmDefinition: (cardId, chosenDefinition) => {
      const card = useCardsStore.getState().history.present.find(c => c.id === cardId)
      const correct = card?.definition === chosenDefinition
      set(state => ({ results: { ...state.results, [cardId]: correct ? 'correct' : 'incorrect' } }))
    },
    answerQcmTitle: (cardId, chosenTitle) => {
      const card = useCardsStore.getState().history.present.find(c => c.id === cardId)
      const correct = card?.title === chosenTitle
      set(state => ({ results: { ...state.results, [cardId]: correct ? 'correct' : 'incorrect' } }))
    },
    finishQuiz: () => set({ showSummary: true }),
    endQuiz: () => {
      if (!get().wasLockedBeforeQuiz && useCardsStore.getState().locked) useCardsStore.getState().toggleLock()
      set({ active: false, showSummary: false, config: null, questions: [], results: {} })
    },
  }))
}

export const useQuizStore = createQuizStore()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/state/useQuizStore.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Verify CardNode's usage is now broken**

Run: `npm test -- src/components/CardNode.test.tsx`
Expected: FAIL — `CardNode.tsx` still reads `s.answerQcm`, which no longer exists on the store, so its two existing qcm-answer tests error out.

- [ ] **Step 6: Rename CardNode's call site (mechanical rename only, no behavior change)**

In `src/components/CardNode.tsx`, change:

```ts
const answerQcm = useQuizStore(s => s.answerQcm)
```

to:

```ts
const answerQcmDefinition = useQuizStore(s => s.answerQcmDefinition)
```

and change the one call site inside the `QcmDialog`'s `onAnswer`:

```ts
answerQcm(card.id, chosen)
```

to:

```ts
answerQcmDefinition(card.id, chosen)
```

Nothing else in `CardNode.tsx` changes here — `isQcmPending`, the `QcmDialog` props (`title`/`correctDefinition`), and everything else stay exactly as they are today. This is purely a rename to keep the existing qcm-definition flow working; Task 11 renames the `QcmDialog` props themselves, and Task 12 adds `qcm-title` support on top.

- [ ] **Step 7: Run the CardNode suite again to confirm it's green**

Run: `npm test -- src/components/CardNode.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/state/useQuizStore.ts src/state/useQuizStore.test.ts src/components/CardNode.tsx
git commit -m "feat(quiz): split answerQcm into answerQcmDefinition/answerQcmTitle"
```

---

## Task 6: UI primitives — `Switch` and `Slider`

**Files:**
- Create: `src/components/ui/switch.tsx`
- Create: `src/components/ui/switch.test.tsx`
- Create: `src/components/ui/slider.tsx`
- Create: `src/components/ui/slider.test.tsx`

**Interfaces:**
- Consumes: `radix-ui`'s `Switch`/`Slider` primitives (already installed), `cn` from `"cn"` (same import convention as `button.tsx`).
- Produces: `Switch` (props: standard Radix `Switch.Root` props — `checked`, `onCheckedChange`, etc.), `Slider` (props: standard Radix `Slider.Root` props — `value`, `defaultValue`, `min`, `max`, `step`, `onValueChange`) — consumed by Task 9 (`QuizSettingsDialog`).

- [ ] **Step 1: Write the failing `Switch` test**

```tsx
// src/components/ui/switch.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Switch } from './switch'

describe('Switch', () => {
  it('reports the new checked state on click', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Switch onCheckedChange={onCheckedChange} />)

    await user.click(screen.getByRole('switch'))

    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('reflects a controlled checked prop', () => {
    render(<Switch checked aria-label="test" />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/ui/switch.test.tsx`
Expected: FAIL — `./switch` has no exports yet.

- [ ] **Step 3: Implement `switch.tsx`**

```tsx
// src/components/ui/switch.tsx
import * as React from "react"
import { cn } from "cn"
import { Switch as SwitchPrimitive } from "radix-ui"

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/ui/switch.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing `Slider` test**

```tsx
// src/components/ui/slider.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Slider } from './slider'

describe('Slider', () => {
  it('calls onValueChange when the focused thumb is moved with arrow keys', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Slider defaultValue={[50]} min={0} max={100} step={5} onValueChange={onValueChange} />)

    screen.getByRole('slider').focus()
    await user.keyboard('{ArrowRight}')

    expect(onValueChange).toHaveBeenCalledWith([55])
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- src/components/ui/slider.test.tsx`
Expected: FAIL — `./slider` has no exports yet.

- [ ] **Step 7: Implement `slider.tsx`**

```tsx
// src/components/ui/slider.tsx
import * as React from "react"
import { cn } from "cn"
import { Slider as SliderPrimitive } from "radix-ui"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const values = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]),
    [value, defaultValue, min, max]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn("relative flex w-full touch-none items-center select-none", className)}
      {...props}
    >
      <SliderPrimitive.Track data-slot="slider-track" className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {values.map((_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          data-slot="slider-thumb"
          className="block size-4 shrink-0 rounded-full border border-primary bg-background shadow transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -- src/components/ui/slider.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/switch.tsx src/components/ui/switch.test.tsx src/components/ui/slider.tsx src/components/ui/slider.test.tsx
git commit -m "feat(ui): add shadcn Switch and Slider components"
```

---

## Task 7: `FlipCard` primitive + fix the mirrored-text "Retourner" animation

**Files:**
- Create: `src/components/FlipCard.tsx`
- Create: `src/components/FlipCard.test.tsx`
- Modify: `src/components/CardNode.tsx`

**Interfaces:**
- Consumes: none.
- Produces: `FlipCard({ flipped, front, back })` — consumed only here (generic "Retourner" button). Task 10's graded-recall reveal deliberately does NOT reuse it: once a quiz auto-locks the mind map, the title `<input>` is already `readOnly`, so showing the real title is just a normal re-render (no distinct "back face" content to flip to) — a 3D flip there would need a second, duplicate `<input>` purely to have something to flip to, which would break every test that does `getByRole('textbox', { name: /titre/i })` expecting exactly one match. Task 10 uses a plain color transition instead, which is also calmer/more TSA-appropriate than a flip.

The current bug: `CardNode` animates `rotateY` on the motion.div wrapping the title, with no distinct back face — past 90° the SAME text renders mirrored. `FlipCard` renders two stacked faces with `backfaceVisibility: hidden`, so only one is ever legible; this task scopes the fix to the title row specifically (the only place with readable text that was rotating), not the whole card chrome.

- [ ] **Step 1: Write the failing `FlipCard` test**

```tsx
// src/components/FlipCard.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { FlipCard } from './FlipCard'

describe('FlipCard', () => {
  it('renders both faces and rotates the inner wrapper based on `flipped`', () => {
    const { rerender } = render(<FlipCard flipped={false} front={<span>Front</span>} back={<span>Back</span>} />)

    expect(screen.getByText('Front')).toBeInTheDocument()
    expect(screen.getByText('Back')).toBeInTheDocument()
    expect(screen.getByTestId('flip-card-inner')).toHaveStyle({ transform: 'rotateY(0deg)' })

    rerender(<FlipCard flipped front={<span>Front</span>} back={<span>Back</span>} />)

    expect(screen.getByTestId('flip-card-inner')).toHaveStyle({ transform: 'rotateY(180deg)' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/FlipCard.test.tsx`
Expected: FAIL — `./FlipCard` has no exports yet.

- [ ] **Step 3: Implement `FlipCard.tsx`**

```tsx
// src/components/FlipCard.tsx
import type { ReactNode } from 'react'

export interface FlipCardProps {
  flipped: boolean
  front: ReactNode
  back: ReactNode
}

/**
 * A literal rotateY on a single face shows the SAME content mirrored past
 * 90deg — there is no true back face to swap to. This stacks two faces with
 * `backfaceVisibility: hidden`, so only ever one is legible at a time.
 */
export function FlipCard({ flipped, front, back }: FlipCardProps) {
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div
        data-testid="flip-card-inner"
        style={{
          position: 'relative',
          width: '100%',
          transformStyle: 'preserve-3d',
          transition: 'transform 0.4s',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        <div style={{ backfaceVisibility: 'hidden' }}>{front}</div>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          {back}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/FlipCard.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Wire `FlipCard` into `CardNode`'s generic "Retourner" button**

In `src/components/CardNode.tsx`:

1. Add the import: `import { FlipCard } from './FlipCard'`.
2. On the root `motion.div`, remove the two props that drove the old broken animation — `animate={{ rotateY: flipped ? 180 : 0 }}` and `transition={{ duration: 0.4 }}` — but **keep** `data-flipped={flipped}` (existing tests assert on it).
3. Wrap the title `<input>` (the element with `ref={titleInputRef}`, currently a direct child) in a `FlipCard`, keeping every existing prop on the `<input>` unchanged:

```tsx
<FlipCard
  flipped={flipped}
  front={
    <input
      ref={titleInputRef}
      aria-label="Titre"
      readOnly={locked}
      value={titleFocused ? draftTitle : displayMasked ? '???' : card.title}
      onFocus={handleTitleFocus}
      onChange={e => setDraftTitle(e.target.value)}
      onBlur={commitTitle}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          titleInputRef.current?.blur()
        }
        if (e.key === 'Escape') cancelTitle()
      }}
      style={{
        display: 'block',
        width: '100%',
        font: 'inherit',
        color: 'inherit',
        background: titleFocused ? 'rgba(0, 0, 0, 0.04)' : 'transparent',
        border: `2px solid ${titleFocused ? toCss(colors.border) : 'transparent'}`,
        borderRadius: 4,
        padding: '0.1rem 0.3rem',
        margin: '-0.1rem -0.3rem',
        outline: 'none',
        cursor: 'text',
        transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
    />
  }
  back={
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: '1.4rem',
        borderRadius: 4,
        background: toCss(colors.border),
      }}
    />
  }
/>
```

(`onBlur`/`maxLength` and the recall-specific branching are added in Task 10 — this step only relocates the existing input, unchanged, into `FlipCard`'s `front` slot.)

- [ ] **Step 6: Run the full `CardNode` suite to confirm nothing broke**

Run: `npm test -- src/components/CardNode.test.tsx`
Expected: PASS — the title input keeps the same role/label/value contract (just nested one level deeper), so none of the ~40 existing assertions on it should change behavior. The `'flips the card visually...'` test in particular still passes: `data-flipped` and "no store change" are untouched.

- [ ] **Step 7: Commit**

```bash
git add src/components/FlipCard.tsx src/components/FlipCard.test.tsx src/components/CardNode.tsx
git commit -m "fix(card): replace mirrored rotateY flip with a real two-face FlipCard"
```

---

## Task 8: `QuizConfigModal` redesign — level squares, difficulty cards, QCM toggle card

**Files:**
- Modify: `src/colors/contrast.ts`
- Modify: `src/colors/contrast.test.ts`
- Modify: `src/components/quiz/QuizConfigModal.tsx`
- Modify: `src/components/quiz/QuizConfigModal.test.tsx`

**Interfaces:**
- Consumes: `levelColor` from `src/colors/levelColors.ts`, `useQuizStore().startQuiz`.
- Produces: `pickReadableTextColor(bg): Oklch` (new export from `contrast.ts`) — used here only, but general-purpose enough to belong in the shared colors module.

- [ ] **Step 1: Write the failing `pickReadableTextColor` test**

Add to the end of `src/colors/contrast.test.ts`:

```ts
describe('pickReadableTextColor', () => {
  it('picks near-black text against a light background', () => {
    expect(pickReadableTextColor({ l: 0.95, c: 0.03, h: 90 })).toEqual({ l: 0.18, c: 0, h: 0 })
  })

  it('picks white text against a dark, saturated background', () => {
    expect(pickReadableTextColor({ l: 0.3, c: 0.15, h: 25 })).toEqual({ l: 1, c: 0, h: 0 })
  })
})
```

(Add the matching `import { pickReadableTextColor } from './contrast'` to the existing import line at the top of the file.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/colors/contrast.test.ts`
Expected: FAIL — `pickReadableTextColor` is not exported yet.

- [ ] **Step 3: Add `pickReadableTextColor` to `contrast.ts`**

Append to `src/colors/contrast.ts`:

```ts
const WHITE: Oklch = { l: 1, c: 0, h: 0 }
const NEAR_BLACK: Oklch = { l: 0.18, c: 0, h: 0 }

/** Picks whichever of white/near-black text reads better (higher WCAG contrast) against `bg`. */
export function pickReadableTextColor(bg: Oklch): Oklch {
  return oklchWcagContrast(bg, WHITE) >= oklchWcagContrast(bg, NEAR_BLACK) ? WHITE : NEAR_BLACK
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/colors/contrast.test.ts`
Expected: PASS

- [ ] **Step 5: Replace `QuizConfigModal.test.tsx`**

```tsx
// src/components/quiz/QuizConfigModal.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { QuizConfigModal } from './QuizConfigModal'
import { useQuizStore, createQuizStore } from '../../state/useQuizStore'

describe('QuizConfigModal', () => {
  beforeEach(() => {
    const pristine = createQuizStore().getState()
    useQuizStore.setState({
      active: pristine.active,
      showSummary: pristine.showSummary,
      config: pristine.config,
      questions: pristine.questions,
      results: pristine.results,
      wasLockedBeforeQuiz: pristine.wasLockedBeforeQuiz,
    })
  })

  it('starts the quiz with all levels checked, "moyen" difficulty and QCM off by default', async () => {
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: /lancer le quiz/i }))

    expect(useQuizStore.getState().config).toEqual({ levels: [1, 2, 3, 4], difficulty: 'moyen', qcmMode: false })
  })

  it('excludes an unchecked level from the launched config', async () => {
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('checkbox', { name: /titre/i }))
    await user.click(screen.getByRole('button', { name: /lancer le quiz/i }))

    expect(useQuizStore.getState().config?.levels).toEqual([2, 3, 4])
  })

  it('uses the selected difficulty preset', async () => {
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: /^difficile$/i }))
    await user.click(screen.getByRole('button', { name: /lancer le quiz/i }))

    expect(useQuizStore.getState().config?.difficulty).toBe('difficile')
  })

  it('turns qcmMode on when the QCM toggle is switched', async () => {
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('switch', { name: /mode qcm/i }))
    await user.click(screen.getByRole('button', { name: /lancer le quiz/i }))

    expect(useQuizStore.getState().config?.qcmMode).toBe(true)
  })

  it('disables the launch button when no level is checked', async () => {
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    for (const name of [/titre/i, /sous-titre/i, /sous-partie/i, /^info$/i]) {
      await user.click(screen.getByRole('checkbox', { name }))
    }

    expect(screen.getByRole('button', { name: /lancer le quiz/i })).toBeDisabled()
  })

  it('closes the modal after launching', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<QuizConfigModal open onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('button', { name: /lancer le quiz/i }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npm test -- src/components/quiz/QuizConfigModal.test.tsx`
Expected: FAIL — old labels ("Rouge"/"Orange"/...) and missing `switch` role.

- [ ] **Step 7: Replace `QuizConfigModal.tsx`**

```tsx
// src/components/quiz/QuizConfigModal.tsx
import { useState } from 'react'
import { Sprout, Zap, Flame, type LucideIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { useQuizStore } from '../../state/useQuizStore'
import { levelColor } from '../../colors/levelColors'
import { toCss, pickReadableTextColor } from '../../colors/contrast'
import type { CardLevel } from '../../types/card'
import type { QuizDifficulty } from '../../types/quiz'

const ALL_LEVELS: CardLevel[] = [1, 2, 3, 4]
const LEVEL_LABELS: Record<CardLevel, string> = {
  1: 'Titre',
  2: 'Sous-titre',
  3: 'Sous-partie',
  4: 'Info',
}

interface DifficultyOption {
  value: QuizDifficulty
  label: string
  icon: LucideIcon
  hidePercent: number
  color: string
}

const DIFFICULTIES: DifficultyOption[] = [
  { value: 'facile', label: 'Facile', icon: Sprout, hidePercent: 20, color: '#16a34a' },
  { value: 'moyen', label: 'Moyen', icon: Zap, hidePercent: 50, color: '#d97706' },
  { value: 'difficile', label: 'Difficile', icon: Flame, hidePercent: 75, color: '#dc2626' },
]

interface QuizConfigModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function QuizConfigModal({ open, onOpenChange }: QuizConfigModalProps) {
  const startQuiz = useQuizStore(s => s.startQuiz)
  const [levels, setLevels] = useState<CardLevel[]>(ALL_LEVELS)
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('moyen')
  const [qcmMode, setQcmMode] = useState(false)

  function toggleLevel(level: CardLevel) {
    setLevels(current => (current.includes(level) ? current.filter(l => l !== level) : [...current, level].sort()))
  }

  function handleLaunch() {
    startQuiz({ levels, difficulty, qcmMode })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configurer le quiz</DialogTitle>
        </DialogHeader>

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
            Niveaux inclus
          </legend>
          <div style={{ display: 'flex', gap: 8 }}>
            {ALL_LEVELS.map(level => {
              const checked = levels.includes(level)
              const bg = toCss(levelColor(level).border)
              const text = toCss(pickReadableTextColor(levelColor(level).border))
              return (
                <label
                  key={level}
                  style={{
                    flex: 1,
                    aspectRatio: '1 / 1',
                    borderRadius: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: checked ? bg : '#eee',
                    color: checked ? text : '#aaa',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLevel(level)}
                    aria-label={LEVEL_LABELS[level]}
                    style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
                  />
                  {LEVEL_LABELS[level]}
                </label>
              )
            })}
          </div>
        </fieldset>

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
            Difficulté
          </legend>
          <div style={{ display: 'flex', gap: 8 }}>
            {DIFFICULTIES.map(({ value, label, icon: Icon, hidePercent, color }) => (
              <button
                key={value}
                type="button"
                aria-label={label}
                aria-pressed={difficulty === value}
                onClick={() => setDifficulty(value)}
                style={{
                  flex: 1,
                  borderRadius: 12,
                  padding: '12px 8px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  border: `${difficulty === value ? 3 : 2}px solid ${color}`,
                  background: 'var(--background)',
                  color: 'inherit',
                }}
              >
                <Icon style={{ color, width: 24, height: 24, margin: '0 auto 4px', display: 'block' }} />
                <div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>
                <div style={{ fontSize: 10.5, opacity: 0.75 }}>Cache {hidePercent}% des cartes</div>
              </button>
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          role="switch"
          aria-checked={qcmMode}
          aria-label="Mode QCM"
          onClick={() => setQcmMode(v => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 14,
            borderRadius: 12,
            border: `2px solid ${toCss(levelColor(3).border)}`,
            background: qcmMode ? toCss(levelColor(3).bg) : 'var(--background)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Mode QCM</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>
              Propose aussi des choix pour deviner les titres (sinon, tu les écris)
            </div>
          </div>
          <span
            aria-hidden
            style={{
              width: 36,
              height: 21,
              borderRadius: 11,
              flexShrink: 0,
              position: 'relative',
              background: qcmMode ? toCss(levelColor(3).border) : '#ccc',
              transition: 'background 0.15s ease',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 2,
                left: qcmMode ? 17 : 2,
                width: 17,
                height: 17,
                borderRadius: '50%',
                background: '#fff',
                transition: 'left 0.15s ease',
              }}
            />
          </span>
        </button>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button disabled={levels.length === 0} onClick={handleLaunch}>
            Lancer le quiz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

Note: the QCM toggle is a real `<button role="switch">` with a **purely decorative** pill/thumb (plain `<span>`s, `aria-hidden`), not the shared `Switch` component from Task 6 — nesting a real Radix `Switch.Root` (itself a `<button>`) inside this button would produce invalid nested-interactive-element markup. The shared `Switch` is used standalone in Task 9's Paramètres dialog instead.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -- src/components/quiz/QuizConfigModal.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 9: Commit**

```bash
git add src/colors/contrast.ts src/colors/contrast.test.ts src/components/quiz/QuizConfigModal.tsx src/components/quiz/QuizConfigModal.test.tsx
git commit -m "feat(quiz): redesign config modal — level squares, difficulty cards, QCM toggle"
```

---

## Task 9: `QuizSettingsDialog` + `QuizSettingsButton`, wired into the app header

**Files:**
- Create: `src/components/quiz/QuizSettingsDialog.tsx`
- Create: `src/components/quiz/QuizSettingsDialog.test.tsx`
- Create: `src/components/quiz/QuizSettingsButton.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useQuizSettingsStore` from Task 2, `Switch`/`Slider` from Task 6.
- Produces: `QuizSettingsButton` (no props) — rendered in `App.tsx`'s header, next to `QuizButton`.

- [ ] **Step 1: Write the failing `QuizSettingsDialog` tests**

```tsx
// src/components/quiz/QuizSettingsDialog.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { QuizSettingsDialog } from './QuizSettingsDialog'
import { useQuizSettingsStore } from '../../state/useQuizSettingsStore'

vi.mock('../../persistence/quizSettings', () => ({
  loadQuizSettings: vi.fn(),
  saveQuizSettings: vi.fn().mockResolvedValue(undefined),
}))

describe('QuizSettingsDialog', () => {
  beforeEach(() => {
    useQuizSettingsStore.setState({ similarityThreshold: 100, lengthGuideEnabled: true })
  })

  it('shows the current similarity threshold', () => {
    render(<QuizSettingsDialog open onOpenChange={() => {}} />)
    expect(screen.getByText(/100%/)).toBeInTheDocument()
  })

  it('lowers the similarity threshold in the store when the slider moves left', async () => {
    const user = userEvent.setup()
    render(<QuizSettingsDialog open onOpenChange={() => {}} />)

    screen.getByRole('slider').focus()
    await user.keyboard('{ArrowLeft}')

    expect(useQuizSettingsStore.getState().similarityThreshold).toBe(95)
  })

  it('toggles the length guide setting in the store', async () => {
    const user = userEvent.setup()
    render(<QuizSettingsDialog open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('switch'))

    expect(useQuizSettingsStore.getState().lengthGuideEnabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/components/quiz/QuizSettingsDialog.test.tsx`
Expected: FAIL — `./QuizSettingsDialog` has no exports yet.

- [ ] **Step 3: Implement `QuizSettingsDialog.tsx`**

```tsx
// src/components/quiz/QuizSettingsDialog.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Slider } from '../ui/slider'
import { Switch } from '../ui/switch'
import { useQuizSettingsStore } from '../../state/useQuizSettingsStore'

interface QuizSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function QuizSettingsDialog({ open, onOpenChange }: QuizSettingsDialogProps) {
  const similarityThreshold = useQuizSettingsStore(s => s.similarityThreshold)
  const lengthGuideEnabled = useQuizSettingsStore(s => s.lengthGuideEnabled)
  const setSimilarityThreshold = useQuizSettingsStore(s => s.setSimilarityThreshold)
  const setLengthGuideEnabled = useQuizSettingsStore(s => s.setLengthGuideEnabled)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Paramètres du quiz</DialogTitle>
        </DialogHeader>

        <div>
          <label id="similarity-threshold-label" style={{ fontWeight: 700, fontSize: 13, display: 'block', marginBottom: 8 }}>
            Précision exigée pour "correct" : {similarityThreshold}%
          </label>
          <Slider
            aria-labelledby="similarity-threshold-label"
            min={50}
            max={100}
            step={5}
            value={[similarityThreshold]}
            onValueChange={([value]) => setSimilarityThreshold(value)}
          />
          <p style={{ fontSize: 11, opacity: 0.7, marginTop: 8 }}>
            100% = réponse exacte (recommandé pour les formules, où "+" et "−" changent tout).
          </p>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1, fontSize: 13 }}>
            Guide de longueur — affiche des tirets à la place des lettres cachées
          </span>
          <Switch checked={lengthGuideEnabled} onCheckedChange={setLengthGuideEnabled} />
        </label>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/components/quiz/QuizSettingsDialog.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Implement `QuizSettingsButton.tsx`**

```tsx
// src/components/quiz/QuizSettingsButton.tsx
import { useState } from 'react'
import { Settings } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { QuizSettingsDialog } from './QuizSettingsDialog'

export function QuizSettingsButton() {
  const [open, setOpen] = useState(false)

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Paramètres du quiz" onClick={() => setOpen(true)}>
            <Settings />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Paramètres du quiz</TooltipContent>
      </Tooltip>
      <QuizSettingsDialog open={open} onOpenChange={setOpen} />
    </TooltipProvider>
  )
}
```

- [ ] **Step 6: Wire it into `App.tsx`**

Add the import next to the other quiz imports:

```ts
import { QuizSettingsButton } from './components/quiz/QuizSettingsButton'
import { useQuizSettingsStore } from './state/useQuizSettingsStore'
```

Render it next to `QuizButton` (same visibility rule — hidden during an active quiz):

```tsx
{!quizActive && <QuizButton />}
{!quizActive && <QuizSettingsButton />}
```

Load persisted settings once on mount, alongside the other top-level effects already in `App.tsx`:

```tsx
useEffect(() => {
  useQuizSettingsStore.getState().init()
}, [])
```

- [ ] **Step 7: Manually verify the app still builds**

Run: `npx tsc --noEmit`
Expected: no NEW errors introduced by this task (pre-existing errors from Tasks 1 not yet consumed elsewhere are fine at this point — they're resolved by Task 12).

- [ ] **Step 8: Commit**

```bash
git add src/components/quiz/QuizSettingsDialog.tsx src/components/quiz/QuizSettingsDialog.test.tsx src/components/quiz/QuizSettingsButton.tsx src/App.tsx
git commit -m "feat(quiz): add a persisted Paramètres dialog, reachable from the header"
```

---

## Task 10: `CardNode` — fix the masked-title bug, auto-grade typed answers, length guide, feedback badge

**Files:**
- Modify: `src/components/CardNode.tsx`
- Modify: `src/components/CardNode.test.tsx`

**Interfaces:**
- Consumes: `computeTitleSimilarity`, `similarityColor` from Task 3, `buildLengthGuide` from Task 3, `useQuizSettingsStore` from Task 2.
- Produces: no new exports — this is the core bug fix and UX change for `recall` questions specifically.

This is the biggest behavioral change: clicking a masked title now opens it for typing (the reported bug) instead of blurring it away, and the old manual "reveal then self-grade with ✓/✗ buttons" flow is replaced by automatic grading against `useQuizSettingsStore`'s similarity threshold.

- [ ] **Step 1: Remove the old self-grade tests from `CardNode.test.tsx`**

Delete these six `it(...)` blocks entirely from the `'CardNode footer'` describe block (they test a UI that no longer exists):
- `'reveals the real title after clicking "Révéler la réponse"'`
- `'resets quizRevealed when the quiz ends, so a second quiz session drawing the same card masks it again'`
- `'does not reveal the real title or show grading buttons when the masked title field is focused'`
- `'shows self-grade buttons once a revealed recall question is unanswered'`
- `'clicking "Je savais" records a correct answer in the quiz store'`
- `'clicking "Je ne savais pas" records an incorrect answer in the quiz store'`

Also simplify `'shows a green border and no grading buttons once graded correct'` to just check the border (the "Révéler la réponse" button it also referenced is gone):

```tsx
it('shows a green border once graded correct', () => {
  renderCardNode(testCard, false, false, { type: 'recall', result: 'correct' })
  expect(screen.getByTestId(`card-${testCard.id}`)).toHaveStyle({ borderColor: '#16a34a' })
})
```

- [ ] **Step 2: Write the new failing recall tests**

Add these to the `'CardNode footer'` describe block, in place of the ones removed above:

```tsx
it('opens the title for typing when a masked (pending recall) title is clicked, with an empty draft', async () => {
  const user = userEvent.setup()
  renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

  const input = screen.getByRole('textbox', { name: /titre/i })
  await user.click(input)

  expect(input).toHaveValue('')
})

it('grades an exact typed answer as correct and reveals the real title', async () => {
  const user = userEvent.setup()
  renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

  const input = screen.getByRole('textbox', { name: /titre/i })
  await user.click(input)
  await user.type(input, `${testCard.title}{Enter}`)

  expect(useQuizStore.getState().results[testCard.id]).toBe('correct')
  expect(screen.getByRole('textbox', { name: /titre/i })).toHaveValue(testCard.title)
})

it('grades a wrong typed answer as incorrect', async () => {
  const user = userEvent.setup()
  renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

  const input = screen.getByRole('textbox', { name: /titre/i })
  await user.click(input)
  await user.type(input, 'Complètement faux{Enter}')

  expect(useQuizStore.getState().results[testCard.id]).toBe('incorrect')
})

it('never writes the typed guess back into the card title, whatever the grading outcome', async () => {
  const user = userEvent.setup()
  renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

  const input = screen.getByRole('textbox', { name: /titre/i })
  await user.click(input)
  await user.type(input, 'Une tentative{Enter}')

  expect(useCardsStore.getState().history.present[0].title).toBe('Titre initial')
})

it('cancels on Escape without grading anything', async () => {
  const user = userEvent.setup()
  renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

  const input = screen.getByRole('textbox', { name: /titre/i })
  await user.click(input)
  await user.type(input, 'Brouillon{Escape}')

  expect(useQuizStore.getState().results[testCard.id]).toBe('unanswered')
  expect(input).not.toHaveValue(testCard.title)
})

it('limits how many characters can be typed to the length of the real title', () => {
  renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })
  expect(screen.getByRole('textbox', { name: /titre/i })).toHaveAttribute('maxLength', String(testCard.title.length))
})

it('shows a length-guide row of blanks above the masked title by default', () => {
  renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })
  // "Titre initial" -> letters blanked, the space between the two words kept.
  expect(screen.getByText('_____ _______')).toBeInTheDocument()
})

it('shows a similarity badge when the typed answer is close but not exact', async () => {
  const user = userEvent.setup()
  const card: Card = { ...testCard, title: 'Chat' }
  resetStore([card])
  renderCardNode(card, false, false, { type: 'recall', result: 'unanswered' })

  const input = screen.getByRole('textbox', { name: /titre/i })
  await user.click(input)
  await user.type(input, 'Chah{Enter}')

  expect(screen.getByText(/75%/)).toBeInTheDocument()
})

it('shows no similarity badge for an exact match', async () => {
  const user = userEvent.setup()
  renderCardNode(testCard, false, false, { type: 'recall', result: 'unanswered' })

  const input = screen.getByRole('textbox', { name: /titre/i })
  await user.click(input)
  await user.type(input, `${testCard.title}{Enter}`)

  expect(screen.queryByText(/%/)).not.toBeInTheDocument()
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- src/components/CardNode.test.tsx`
Expected: FAIL — masked focus still blurs away, no `maxLength`/length guide/badge yet.

- [ ] **Step 4: Update `CardNode.tsx`**

Add imports:

```ts
import { computeTitleSimilarity, similarityColor } from '../utils/textSimilarity'
import { buildLengthGuide } from '../utils/lengthGuide'
import { useQuizSettingsStore } from '../state/useQuizSettingsStore'
```

Remove `quizRevealed` state, `handleReveal`, and its reset effect; replace `isRecallPending`/`displayMasked` and add the new state/effect:

```ts
const isRecallPending = quiz?.type === 'recall' && quiz.result === 'unanswered'
const displayMasked = isRecallPending
const similarityThreshold = useQuizSettingsStore(s => s.similarityThreshold)
const lengthGuideEnabled = useQuizSettingsStore(s => s.lengthGuideEnabled)
const [recallFeedback, setRecallFeedback] = useState<{ typed: string; similarity: number } | null>(null)

// React Flow keeps CardNode mounted for the life of the app (nodes are
// keyed by card id, not remounted between quizzes), so feedback from a
// PREVIOUS quiz's recall question must not leak into a later one drawing
// the same card again.
useEffect(() => {
  if (!quiz) setRecallFeedback(null)
}, [quiz])
```

Remove the whole self-grade `EdgeButton` block (the `{isRecallPending && quizRevealed && (<>...✓/✗...</>)}` block) — it has no replacement.

Update `handleTitleFocus`:

```ts
function handleTitleFocus() {
  if (isRecallPending) {
    setDraftTitle('')
    setTitleFocused(true)
    return
  }
  setDraftTitle(card.title)
  setTitleFocused(true)
}
```

Update `cancelTitle` (only the seeded value changes):

```ts
function cancelTitle() {
  cancellingTitleRef.current = true
  setDraftTitle(isRecallPending ? '' : card.title)
  titleInputRef.current?.blur()
}
```

Add `commitRecallAnswer` next to `commitTitle`:

```ts
function commitRecallAnswer() {
  if (cancellingTitleRef.current) {
    cancellingTitleRef.current = false
  } else {
    const similarity = computeTitleSimilarity(draftTitle, card.title)
    setRecallFeedback({ typed: draftTitle, similarity })
    answerRecall(card.id, similarity >= similarityThreshold)
  }
  setTitleFocused(false)
}
```

On the `<input>` inside `FlipCard`'s `front` (added in Task 7), change `onBlur` and add `maxLength`:

```tsx
onBlur={isRecallPending ? commitRecallAnswer : commitTitle}
maxLength={isRecallPending ? card.title.length : undefined}
```

Render the length guide immediately above the `FlipCard`, and the feedback badge immediately below it:

```tsx
{displayMasked && lengthGuideEnabled && (
  <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', letterSpacing: '0.1em', opacity: 0.6 }}>
    {buildLengthGuide(card.title)}
  </div>
)}
<FlipCard /* ...as set up in Task 7... */ />
{quiz?.type === 'recall' && quiz.result !== 'unanswered' && recallFeedback && recallFeedback.similarity < 100 && (
  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: similarityColor(recallFeedback.similarity) }}>
    {recallFeedback.similarity}% — ta réponse : « {recallFeedback.typed} »
  </div>
)}
```

Finally, in the footer, remove the `quiz.type === 'recall'` branch that rendered the "Révéler la réponse" flip button — a `recall` question is now answered by clicking the title directly, no footer affordance needed:

```tsx
{quiz && quiz.result === 'unanswered' ? (
  quiz.type !== 'recall' && (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Répondre" onClick={() => setQcmOpen(true)}>
          <FlipHorizontal2 />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Répondre</TooltipContent>
    </Tooltip>
  )
) : !quiz ? (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon-sm" aria-label="Retourner" onClick={() => setFlipped(v => !v)}>
        <FlipHorizontal2 />
      </Button>
    </TooltipTrigger>
    <TooltipContent>Retourner</TooltipContent>
  </Tooltip>
) : null}
```

(The `quiz.type !== 'recall'` check above is already correct against the Task 1 types — it matches both `qcm-definition` and `qcm-title`. Elsewhere in the file, `isQcmPending` and the `QcmDialog` invocation are untouched by this task and still compare against the old `'qcm'` literal (Task 5's Step 6 already renamed the store action they call, but not that comparison) — `npx tsc --noEmit` will flag it until Task 12 rewrites `isQcmPending`; `npm test` is unaffected since CardNode's qcm-definition tests don't depend on that comparison's TYPE, only its runtime string value, which hasn't changed.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/components/CardNode.test.tsx`
Expected: PASS — all recall-related tests green; unrelated tests (structural buttons, delete, detach, definition toggle, QCM) still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/CardNode.tsx src/components/CardNode.test.tsx
git commit -m "fix(quiz): clicking a masked title now opens it for typing, auto-graded"
```

---

## Task 11: `QcmDialog` — generalize for title-guessing, restyle as "Grille Carnet"

**Files:**
- Modify: `src/components/quiz/QcmDialog.tsx`
- Modify: `src/components/quiz/QcmDialog.test.tsx`
- Modify: `src/components/CardNode.tsx` (mechanical prop rename at its one call site — see Step 6)

**Interfaces:**
- Consumes: none new.
- Produces: `QcmDialog({ open, heading, hint?, noHintNote?, correctOption, distractors, onAnswer, onCancel, random? })` (renamed from `{ title, correctDefinition }`) — `CardNode.tsx` is `QcmDialog`'s only consumer today and must be renamed in lockstep (Step 6) so its existing qcm-definition tests don't break; Task 12 adds the `qcm-title` branch on top.

- [ ] **Step 1: Replace `QcmDialog.test.tsx`**

```tsx
// src/components/quiz/QcmDialog.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QcmDialog } from './QcmDialog'

describe('QcmDialog', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the heading and all four options (correct + distractors)', () => {
    render(
      <QcmDialog
        open
        heading="Photosynthèse"
        correctOption="Bonne définition"
        distractors={['Fausse A', 'Fausse B', 'Fausse C']}
        onAnswer={() => {}}
        onCancel={() => {}}
      />
    )

    expect(screen.getByRole('heading', { name: 'Photosynthèse' })).toBeInTheDocument()
    for (const text of ['Bonne définition', 'Fausse A', 'Fausse B', 'Fausse C']) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
  })

  it('shows a hint box when a hint is provided', () => {
    render(
      <QcmDialog
        open
        heading="Quel est le titre de cette carte ?"
        hint="Processus par lequel les plantes..."
        correctOption="La photosynthèse"
        distractors={['La respiration']}
        onAnswer={() => {}}
        onCancel={() => {}}
      />
    )

    expect(screen.getByText(/processus par lequel les plantes/i)).toBeInTheDocument()
  })

  it('shows the no-hint note instead when there is no hint', () => {
    render(
      <QcmDialog
        open
        heading="Quel est le titre de cette carte ?"
        noHintNote="Aide-toi de la position de la carte dans l'arbre."
        correctOption="La photosynthèse"
        distractors={['La respiration']}
        onAnswer={() => {}}
        onCancel={() => {}}
      />
    )

    expect(screen.getByText(/aide-toi de la position/i)).toBeInTheDocument()
  })

  it('disables every option once one has been chosen', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <QcmDialog open heading="T" correctOption="Bonne" distractors={['Fausse']} onAnswer={() => {}} onCancel={() => {}} />
    )

    await user.click(screen.getByText('Fausse'))

    expect(screen.getByText('Bonne').closest('button')).toBeDisabled()
    expect(screen.getByText('Fausse').closest('button')).toBeDisabled()
  })

  it('calls onAnswer with the chosen option after a short delay', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onAnswer = vi.fn()
    render(
      <QcmDialog open heading="T" correctOption="Bonne" distractors={['Fausse']} onAnswer={onAnswer} onCancel={() => {}} />
    )

    await user.click(screen.getByText('Fausse'))
    expect(onAnswer).not.toHaveBeenCalled()

    vi.advanceTimersByTime(700)
    expect(onAnswer).toHaveBeenCalledWith('Fausse')
  })

  it('calls onCancel (not onAnswer) when dismissed via Escape before any choice is made', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onAnswer = vi.fn()
    const onCancel = vi.fn()
    render(
      <QcmDialog open heading="T" correctOption="Bonne" distractors={['Fausse']} onAnswer={onAnswer} onCancel={onCancel} />
    )

    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('shows green/red visual feedback immediately after choosing a wrong option, and shows neither before any choice', () => {
    render(
      <QcmDialog open heading="T" correctOption="Bonne" distractors={['Fausse']} onAnswer={() => {}} onCancel={() => {}} />
    )

    const correctButton = screen.getByText('Bonne').closest('button') as HTMLButtonElement
    const wrongButton = screen.getByText('Fausse').closest('button') as HTMLButtonElement

    expect(correctButton.querySelector('svg.lucide-check')).toBeNull()
    expect(wrongButton.querySelector('svg.lucide-x')).toBeNull()

    fireEvent.click(wrongButton)

    expect(correctButton).toHaveStyle({ borderColor: '#16a34a' })
    expect(wrongButton).toHaveStyle({ borderColor: '#dc2626' })
    expect(correctButton.querySelector('svg.lucide-check')).toBeInTheDocument()
    expect(wrongButton.querySelector('svg.lucide-x')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/components/quiz/QcmDialog.test.tsx`
Expected: FAIL — `title`/`correctDefinition` props no longer match, hint/noHintNote unsupported.

- [ ] **Step 3: Replace `QcmDialog.tsx`**

```tsx
// src/components/quiz/QcmDialog.tsx
import { useState } from 'react'
import { Check, X, Lightbulb, Network } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'

interface QcmDialogProps {
  open: boolean
  heading: string
  hint?: string
  noHintNote?: string
  correctOption: string
  distractors: string[]
  onAnswer: (chosen: string) => void
  onCancel: () => void
  random?: () => number
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const LETTERS = ['A', 'B', 'C', 'D']

export function QcmDialog({
  open,
  heading,
  hint,
  noHintNote,
  correctOption,
  distractors,
  onAnswer,
  onCancel,
  random = Math.random,
}: QcmDialogProps) {
  const [options] = useState(() => shuffle([correctOption, ...distractors], random))
  const [chosen, setChosen] = useState<string | null>(null)

  function handleChoose(option: string) {
    if (chosen) return
    setChosen(option)
    setTimeout(() => onAnswer(option), 700)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        // Radix routes both Escape and outside-click through onOpenChange.
        // Only treat it as a dismissal (not a call) when no answer has been
        // chosen yet — once answered, the dialog also closes itself via the
        // timeout above, and that path must not also fire onCancel.
        if (!next && chosen === null) onCancel()
      }}
    >
      <DialogContent showCloseButton={false} style={{ maxWidth: 480, overflow: 'hidden' }}>
        <div
          style={{
            height: 5,
            margin: '-1rem -1rem 0',
            background:
              'linear-gradient(90deg, oklch(0.55 0.18 25), oklch(0.6 0.19 70), oklch(0.55 0.14 235), oklch(0.62 0.17 105))',
          }}
        />
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
        </DialogHeader>

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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {options.map((option, index) => {
            const isCorrectOption = option === correctOption
            const revealCorrect = chosen !== null && isCorrectOption
            const revealWrong = chosen === option && !isCorrectOption
            return (
              <button
                key={option}
                type="button"
                disabled={chosen !== null}
                onClick={() => handleChoose(option)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: `2px solid ${revealCorrect ? '#16a34a' : revealWrong ? '#dc2626' : 'var(--border)'}`,
                  background: 'var(--background)',
                  opacity: chosen !== null && !revealCorrect && !revealWrong ? 0.55 : 1,
                  cursor: chosen === null ? 'pointer' : 'default',
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    border: `2px solid ${revealCorrect ? '#16a34a' : 'var(--border)'}`,
                    background: revealCorrect ? '#16a34a' : 'var(--muted)',
                    color: revealCorrect ? '#fff' : 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {revealCorrect ? <Check size={16} /> : revealWrong ? <X size={16} /> : LETTERS[index]}
                </span>
                <span>{option}</span>
              </button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/components/quiz/QcmDialog.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Verify CardNode's usage is now broken**

Run: `npm test -- src/components/CardNode.test.tsx`
Expected: FAIL — `CardNode.tsx` still passes `title`/`correctDefinition` to `QcmDialog`, which no longer accepts them, so its qcm-definition tests can't find the heading/options.

- [ ] **Step 6: Rename CardNode's `QcmDialog` props (mechanical rename only, no new behavior)**

In `src/components/CardNode.tsx`, inside the `{isQcmPending && (<QcmDialog ... />)}` block, change:

```tsx
<QcmDialog
  open={qcmOpen}
  title={card.title}
  correctDefinition={card.definition ?? ''}
  distractors={quiz.distractorDefinitions ?? []}
  onAnswer={chosen => {
    answerQcmDefinition(card.id, chosen)
    setQcmOpen(false)
  }}
  onCancel={() => setQcmOpen(false)}
/>
```

to:

```tsx
<QcmDialog
  open={qcmOpen}
  heading={card.title}
  correctOption={card.definition ?? ''}
  distractors={quiz.distractorDefinitions ?? []}
  onAnswer={chosen => {
    answerQcmDefinition(card.id, chosen)
    setQcmOpen(false)
  }}
  onCancel={() => setQcmOpen(false)}
/>
```

`isQcmPending` (still `quiz?.type === 'qcm' && ...` at this point) is untouched — Task 12 replaces it with the two-type check and adds the `hint`/`noHintNote`/title-guessing branch.

- [ ] **Step 7: Run the CardNode suite again to confirm it's green**

Run: `npm test -- src/components/CardNode.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/components/quiz/QcmDialog.tsx src/components/quiz/QcmDialog.test.tsx src/components/CardNode.tsx
git commit -m "feat(quiz): generalize QcmDialog for title-guessing, restyle as Grille Carnet"
```

---

## Task 12: Wire `qcm-title` through `CardNode` and `MindMapCanvas`

**Files:**
- Modify: `src/components/CardNode.tsx`
- Modify: `src/components/CardNode.test.tsx`
- Modify: `src/components/MindMapCanvas.tsx`

**Interfaces:**
- Consumes: `QcmDialog` (Task 11), `answerQcmDefinition`/`answerQcmTitle` (Task 5).
- Produces: none new — this task makes `qcm-title` questions actually playable end to end.

- [ ] **Step 1: Update the two existing qcm-definition tests and add qcm-title tests**

In `CardNode.test.tsx`, update the local `QuizData` type alias near the top of the file:

```tsx
type QuizData = {
  type: QuizQuestionType
  result: QuizResult
  distractorDefinitions?: string[]
  distractorTitles?: string[]
  hint?: string
}
```

Replace the two `type: 'qcm'` tests at the end of the `'CardNode footer'` describe block with:

```tsx
it('opens the QCM dialog when a pending qcm-definition question\'s "Répondre" button is clicked', async () => {
  const user = userEvent.setup()
  const cardWithDef: Card = { ...testCard, definition: 'Bonne définition' }
  resetStore([cardWithDef])
  renderCardNode(cardWithDef, false, false, {
    type: 'qcm-definition',
    result: 'unanswered',
    distractorDefinitions: ['Fausse A', 'Fausse B'],
  })

  await user.click(screen.getByRole('button', { name: /répondre/i }))

  expect(screen.getByRole('heading', { name: cardWithDef.title })).toBeInTheDocument()
  expect(screen.getByText('Bonne définition')).toBeInTheDocument()
  expect(screen.getByText('Fausse A')).toBeInTheDocument()
})

it('records the qcm-definition answer in the quiz store once a choice is made', async () => {
  vi.useFakeTimers()
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const cardWithDef: Card = { ...testCard, definition: 'Bonne définition' }
  resetStore([cardWithDef])
  renderCardNode(cardWithDef, false, false, {
    type: 'qcm-definition',
    result: 'unanswered',
    distractorDefinitions: ['Fausse A'],
  })

  await user.click(screen.getByRole('button', { name: /répondre/i }))
  await user.click(screen.getByText('Bonne définition'))
  vi.advanceTimersByTime(700)

  expect(useQuizStore.getState().results[cardWithDef.id]).toBe('correct')
  vi.useRealTimers()
})

it('opens a qcm-title question showing the hint and title options, without leaking the real title as the heading', async () => {
  const user = userEvent.setup()
  renderCardNode(testCard, false, false, {
    type: 'qcm-title',
    result: 'unanswered',
    distractorTitles: ['Autre titre'],
    hint: 'Un indice',
  })

  await user.click(screen.getByRole('button', { name: /répondre/i }))

  expect(screen.queryByRole('heading', { name: testCard.title })).not.toBeInTheDocument()
  expect(screen.getByText('Un indice')).toBeInTheDocument()
  expect(screen.getByText(testCard.title)).toBeInTheDocument()
  expect(screen.getByText('Autre titre')).toBeInTheDocument()
})

it('records the qcm-title answer in the quiz store once a choice is made', async () => {
  vi.useFakeTimers()
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  renderCardNode(testCard, false, false, {
    type: 'qcm-title',
    result: 'unanswered',
    distractorTitles: ['Autre titre'],
  })

  await user.click(screen.getByRole('button', { name: /répondre/i }))
  await user.click(screen.getByText(testCard.title))
  vi.advanceTimersByTime(700)

  expect(useQuizStore.getState().results[testCard.id]).toBe('correct')
  vi.useRealTimers()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/components/CardNode.test.tsx`
Expected: FAIL — `isQcmPending`/`QcmDialog` wiring still uses the old `'qcm'` type and old prop names.

- [ ] **Step 3: Update `CardNode.tsx`**

Replace the store bindings:

```ts
const answerQcmDefinition = useQuizStore(s => s.answerQcmDefinition)
const answerQcmTitle = useQuizStore(s => s.answerQcmTitle)
```

Replace `isQcmPending`:

```ts
const isQcmPending = (quiz?.type === 'qcm-definition' || quiz?.type === 'qcm-title') && quiz.result === 'unanswered'
```

Update the footer's "Répondre" condition to match both QCM types (the recall branch was already narrowed to `quiz.type !== 'recall'` in Task 10, so no change needed there — it already covers both `qcm-definition` and `qcm-title`).

Replace the `QcmDialog` render block:

```tsx
{isQcmPending && (
  <QcmDialog
    open={qcmOpen}
    heading={quiz.type === 'qcm-definition' ? card.title : 'Quel est le titre de cette carte ?'}
    hint={quiz.type === 'qcm-title' ? quiz.hint : undefined}
    noHintNote={
      quiz.type === 'qcm-title' && !quiz.hint ? 'Aide-toi de la position de la carte dans l’arbre.' : undefined
    }
    correctOption={quiz.type === 'qcm-definition' ? (card.definition ?? '') : card.title}
    distractors={quiz.type === 'qcm-definition' ? (quiz.distractorDefinitions ?? []) : (quiz.distractorTitles ?? [])}
    onAnswer={chosen => {
      if (quiz.type === 'qcm-definition') answerQcmDefinition(card.id, chosen)
      else answerQcmTitle(card.id, chosen)
      setQcmOpen(false)
    }}
    onCancel={() => setQcmOpen(false)}
  />
)}
```

Add `distractorTitles?: string[]` and `hint?: string` to the local `QuizData` interface at the top of the file (mirrors the change already made to the test file in Step 1):

```ts
interface QuizData {
  type: QuizQuestionType
  result: QuizResult
  distractorDefinitions?: string[]
  distractorTitles?: string[]
  hint?: string
}
```

- [ ] **Step 4: Update `MindMapCanvas.tsx`**

In `buildNodes`, extend the `quiz` object built from each drawn question:

```ts
const quiz = question
  ? {
      type: question.type,
      result: quizResults[card.id] ?? 'unanswered',
      distractorDefinitions: question.distractorDefinitions,
      distractorTitles: question.distractorTitles,
      hint: question.hint,
    }
  : undefined
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/components/CardNode.test.tsx src/components/MindMapCanvas.test.tsx`
Expected: PASS — the existing `'MindMapCanvas quiz mode'` test uses `type: 'recall'`, unaffected by this change.

- [ ] **Step 6: Commit**

```bash
git add src/components/CardNode.tsx src/components/CardNode.test.tsx src/components/MindMapCanvas.tsx
git commit -m "feat(quiz): play qcm-title questions end to end (hint, distractors, grading)"
```

---

## Task 13: `DefinitionPopover` — replace the broken inline definition toggle

**Files:**
- Create: `src/components/DefinitionPopover.tsx`
- Create: `src/components/DefinitionPopover.test.tsx`
- Modify: `src/components/CardNode.tsx`
- Modify: `src/components/CardNode.test.tsx`

**Interfaces:**
- Consumes: `radix-ui`'s `Popover` primitive.
- Produces: `DefinitionPopover({ definition, locked, onCommit })` — consumed by `CardNode` for cards that already have a definition. Cards **without** a definition keep using `CardNode`'s existing inline "add definition" textarea flow unchanged.

- [ ] **Step 1: Write the failing `DefinitionPopover` tests**

```tsx
// src/components/DefinitionPopover.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { DefinitionPopover } from './DefinitionPopover'

describe('DefinitionPopover', () => {
  it('shows the definition text once opened', async () => {
    const user = userEvent.setup()
    render(<DefinitionPopover definition="Une définition" locked={false} onCommit={() => {}} />)

    expect(screen.queryByText('Une définition')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /afficher la définition/i }))
    expect(screen.getByText('Une définition')).toBeInTheDocument()
  })

  it('opens an editable field when the definition text is clicked, and commits on Enter', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<DefinitionPopover definition="Une définition" locked={false} onCommit={onCommit} />)

    await user.click(screen.getByRole('button', { name: /afficher la définition/i }))
    await user.click(screen.getByText('Une définition'))
    const field = screen.getByRole('textbox', { name: /définition/i })
    await user.clear(field)
    await user.type(field, 'Nouvelle définition{Enter}')

    expect(onCommit).toHaveBeenCalledWith('Nouvelle définition')
  })

  it('does not open the definition for editing when the mind map is locked', async () => {
    const user = userEvent.setup()
    render(<DefinitionPopover definition="Une définition" locked onCommit={() => {}} />)

    await user.click(screen.getByRole('button', { name: /afficher la définition/i }))
    await user.click(screen.getByText('Une définition'))

    expect(screen.queryByRole('textbox', { name: /définition/i })).not.toBeInTheDocument()
  })

  it('cancels the edit on Escape without calling onCommit', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<DefinitionPopover definition="Une définition" locked={false} onCommit={onCommit} />)

    await user.click(screen.getByRole('button', { name: /afficher la définition/i }))
    await user.click(screen.getByText('Une définition'))
    await user.type(screen.getByRole('textbox', { name: /définition/i }), ' texte annulé{Escape}')

    expect(onCommit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/components/DefinitionPopover.test.tsx`
Expected: FAIL — `./DefinitionPopover` has no exports yet.

- [ ] **Step 3: Implement `DefinitionPopover.tsx`**

```tsx
// src/components/DefinitionPopover.tsx
import { useState } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { AlignLeft } from 'lucide-react'
import { Button } from './ui/button'

interface DefinitionPopoverProps {
  definition: string
  locked: boolean
  onCommit: (next: string) => void
}

/**
 * Replaces the old inline "toggle a <p> under the title" definition display:
 * that block resized the card to fit the text and never worked reliably.
 * A popover keeps the card's size constant regardless of definition length,
 * and Radix's collision-aware positioning keeps it from running off-canvas.
 */
export function DefinitionPopover({ definition, locked, onCommit }: DefinitionPopoverProps) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(definition)

  function commit() {
    if (draft !== definition) onCommit(draft)
    setEditing(false)
  }

  function cancel() {
    setDraft(definition)
    setEditing(false)
  }

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={next => {
        setOpen(next)
        if (!next) setEditing(false)
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={open ? 'Masquer la définition' : 'Afficher la définition'}>
          <AlignLeft />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          sideOffset={8}
          style={{
            maxWidth: 260,
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '12px 14px',
            fontSize: 13,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              opacity: 0.6,
              marginBottom: 6,
            }}
          >
            Définition
          </div>
          {editing ? (
            <textarea
              autoFocus
              aria-label="Définition"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  commit()
                }
                if (e.key === 'Escape') cancel()
              }}
              style={{ width: '100%', minHeight: 60 }}
            />
          ) : (
            <p onClick={() => !locked && setEditing(true)} style={{ margin: 0, cursor: locked ? 'default' : 'text' }}>
              {definition}
            </p>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/components/DefinitionPopover.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Update `CardNode.test.tsx`**

Remove these three tests (they test the old inline toggle, now replaced):
- `'toggles an existing definition between hidden and shown'`
- `'opens the definition for editing when the shown definition text is clicked'`
- `'does not open the definition for editing when the mind map is locked'`

Replace them with one integration test confirming the wiring to `updateDefinition`:

```tsx
it('wires the definition popover to updateDefinition when a new value is committed', async () => {
  const user = userEvent.setup()
  resetStore([cardWithDefinition])
  renderCardNode(cardWithDefinition)

  await user.click(screen.getByRole('button', { name: /afficher la définition/i }))
  await user.click(screen.getByText('Définition existante'))
  const field = screen.getByRole('textbox', { name: /définition/i })
  await user.clear(field)
  await user.type(field, 'Définition modifiée{Enter}')

  expect(useCardsStore.getState().history.present.find(c => c.id === cardWithDefinition.id)?.definition).toBe(
    'Définition modifiée'
  )
})
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npm test -- src/components/CardNode.test.tsx`
Expected: FAIL — `CardNode` still renders the old inline toggle, `DefinitionPopover` isn't wired in yet.

- [ ] **Step 7: Update `CardNode.tsx`**

Add the import: `import { DefinitionPopover } from './DefinitionPopover'`.

Remove the `definitionShown` state (`const [definitionShown, setDefinitionShown] = useState(false)`) — it becomes unused.

Replace the footer's `card.definition ? (...) : (...)` block's TRUE branch — the `<Tooltip>` wrapping the `AlignLeft` toggle button — with:

```tsx
{card.definition ? (
  <DefinitionPopover
    definition={card.definition}
    locked={locked}
    onCommit={next => updateDefinition(card.id, next)}
  />
) : (
  // ...unchanged "Ajouter une définition" Tooltip/Button block...
)}
```

Remove the old display block entirely — it is now inside `DefinitionPopover`:

```tsx
{definitionShown && card.definition && (
  <p onClick={startEditingDefinition} style={{ cursor: locked ? 'default' : 'text', margin: 0 }}>
    {card.definition}
  </p>
)}
```

`editingDefinition`, `draftDefinition`, `startEditingDefinition`, `commitDefinition`, and `cancelDefinition` all stay — they are still used by the "add a definition" (no definition yet) flow's own textarea, unchanged.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -- src/components/CardNode.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/components/DefinitionPopover.tsx src/components/DefinitionPopover.test.tsx src/components/CardNode.tsx src/components/CardNode.test.tsx
git commit -m "feat(card): show the definition in an anchored popover instead of a broken inline toggle"
```

---

## Task 14: Full regression pass — type-check and full test suite

**Files:** none new; this task only runs verification and fixes any fallout.

**Interfaces:** none — this is the final gate confirming every task's changes compose correctly.

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors. If any remain, they will be leftover references to the old `'qcm'` literal or the pre-`qcmMode` `QuizConfig` shape that this plan's grep (`grep -rn "'qcm'\|answerQcm\b" src`) already accounted for in Tasks 1–13 — fix by applying the same rename pattern used in the task that touched that file.

- [ ] **Step 2: Run the entire test suite**

Run: `npm test`
Expected: all tests pass (no `.only`/`.skip` left over from development).

- [ ] **Step 3: Manually smoke-test the quiz flow**

Since Radix's Popper-based positioning (used by `DefinitionPopover`) and CSS 3D transforms (used by `FlipCard`) aren't meaningfully exercised by jsdom, verify by running the app (`npm run tauri dev` or `npm run dev`):
- Open a mind map, click the Quiz button, launch with QCM off — confirm clicking a masked title (a card with no definition) opens it for typing, and typing the exact title grades it correct.
- Launch a quiz with QCM on — confirm a card with a definition shows the hint (full at "Facile", truncated at "Moyen", none at "Difficile") and offers title choices instead of its definition.
- Click "Retourner" on a card outside quiz mode — confirm the flip no longer shows mirrored text.
- Click "Afficher la définition" on a card that has one — confirm the popover appears near the card without resizing it, and that clicking its text lets you edit and save.
- Open the new ⚙️ Paramètres dialog, lower the similarity threshold, and confirm a near-miss typed answer during a quiz is graded correct/incorrect accordingly, with the percentage badge shown when not exact.

- [ ] **Step 4: Commit only if Step 1 or 2 required fixes**

```bash
git add -A
git commit -m "fix(quiz): resolve type-check/test fallout from the quiz redesign"
```

(Skip this step entirely if Steps 1–2 were already clean — there is nothing to commit.)
