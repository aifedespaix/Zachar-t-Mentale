# Configuration d'apparence (lot 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 4 card-level labels/colors and the app font editable from an in-app settings dialog, and add a light/dark/system theme with a circular-reveal toggle.

**Architecture:** A new global settings file (`appearance-settings.json` under Tauri's `appConfigDir()`), loaded into a zustand store at startup — the same shape as the existing `QuizSettings`/`useQuizSettingsStore`. Every place that currently reads level colors from the static `levelColors.ts` module switches to reading the store instead, resolved against the live theme via a new `useResolvedTheme()` hook. `levelColors.ts` itself is restructured to hold light+dark variants and becomes purely the source of the store's defaults.

**Tech Stack:** React 19, TypeScript, zustand, Tailwind v4 (OKLCH tokens), `@tauri-apps/plugin-fs`/`api/path`, Radix `Slider` (already in the repo), native View Transitions API (`document.startViewTransition`, feature-detected).

**Spec:** `docs/superpowers/specs/2026-09-08-lot4-configuration-design.md`

## Global Constraints

- Exactly 4 card levels, fixed (`CardLevel = 1 | 2 | 3 | 4`) — no task in this plan changes that type.
- The app font is a single global choice — never per-level.
- `detachedColors` (floating/"volante" cards) is never exposed in the settings UI — only its light/dark default values are added.
- Every level color (light and dark) must keep text/background contrast ≥ 4.5:1 (WCAG AA), verified via the existing `oklchWcagContrast` in `src/colors/contrast.ts`.
- `npm test` = `vitest run` — no separate type-check step is wired into it (`tsc` only runs via `npm run build`), so a task's own test file is the authority on whether that task is done; Task 18 does the final whole-suite + build check.
- Exports (PDF/Image, `StaticCardView.tsx`) always render in the **light** palette regardless of the app's live theme.

---

## Task 1: `levelColors.ts` gains light/dark variants

**Files:**
- Modify: `src/colors/levelColors.ts`
- Modify: `src/colors/levelColors.test.ts`
- Modify: `src/components/CardNode.tsx:162-163`
- Modify: `src/components/MindMapCanvas.tsx:368,381` (and its import at line 23)
- Modify: `src/export/StaticCardView.tsx:19`
- Modify: `src/components/quiz/QuizConfigModal.tsx:68-69,145-146,165`

**Interfaces:**
- Produces: `export interface LevelColorPair { light: LevelColor; dark: LevelColor }`, `export const levelColors: Record<CardLevel, LevelColorPair>`, `export function levelColor(level: number, theme: 'light' | 'dark'): LevelColor`, `export const detachedColors: LevelColorPair`.

- [ ] **Step 1: Write the failing test**

Replace the full contents of `src/colors/levelColors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { oklchWcagContrast } from './contrast'
import { detachedColors, levelColor, levelColors } from './levelColors'

describe('levelColors', () => {
  it.each(Object.entries(levelColors))('level %s light text meets WCAG AA (>=4.5) against its background', (_level, pair) => {
    expect(oklchWcagContrast(pair.light.bg, pair.light.text)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(Object.entries(levelColors))('level %s dark text meets WCAG AA (>=4.5) against its background', (_level, pair) => {
    expect(oklchWcagContrast(pair.dark.bg, pair.dark.text)).toBeGreaterThanOrEqual(4.5)
  })

  // Rouge (1), orange (2) and jaune (4) all sit in the warm part of the hue
  // wheel and used to be bunched within 40° of each other — hard to tell
  // apart at a glance, especially for a colorblind reader. Bleu (3) is
  // already far away (h=235) so it is excluded from this pairwise check.
  it.each([
    [1, 2],
    [2, 4],
    [1, 4],
  ] as const)('level %s and level %s borders are at least 30° apart in hue', (a, b) => {
    const diff = Math.abs(levelColors[a].light.border.h - levelColors[b].light.border.h)
    expect(diff).toBeGreaterThanOrEqual(30)
  })

  it.each([1, 2, 4] as const)('level %s border keeps enough chroma to stay distinguishable', level => {
    expect(levelColors[level].light.border.c).toBeGreaterThanOrEqual(0.16)
  })

  // The dark variant is built from the same hue as light — only lightness
  // (and slightly chroma) changes — so distinguishability between levels
  // carries over automatically. Guards against a future edit accidentally
  // picking a different hue for one theme.
  it.each([1, 2, 3, 4] as const)('level %s keeps the same hue in light and dark', level => {
    expect(levelColors[level].dark.border.h).toBe(levelColors[level].light.border.h)
    expect(levelColors[level].dark.bg.h).toBe(levelColors[level].light.bg.h)
    expect(levelColors[level].dark.text.h).toBe(levelColors[level].light.text.h)
  })

  it('the detached (floating card) palette is achromatic and meets WCAG AA in both themes', () => {
    expect(detachedColors.light.bg.c).toBe(0)
    expect(detachedColors.light.border.c).toBe(0)
    expect(detachedColors.dark.bg.c).toBe(0)
    expect(detachedColors.dark.border.c).toBe(0)
    expect(oklchWcagContrast(detachedColors.light.bg, detachedColors.light.text)).toBeGreaterThanOrEqual(4.5)
    expect(oklchWcagContrast(detachedColors.dark.bg, detachedColors.dark.text)).toBeGreaterThanOrEqual(4.5)
  })

  // `levelColors[5]` is `undefined`, and the `.bg` read that follows throws
  // during render — which unmounts the app instead of showing one odd card.
  it('falls back to a real palette for a level a corrupt file made up', () => {
    expect(levelColor(5, 'light')).toEqual(levelColors[4].light)
    expect(levelColor(0, 'light')).toEqual(levelColors[1].light)
    expect(levelColor(Number.NaN, 'light')).toEqual(levelColors[1].light)
  })

  it('returns the exact palette for every real level, per theme', () => {
    for (const level of [1, 2, 3, 4] as const) {
      expect(levelColor(level, 'light')).toBe(levelColors[level].light)
      expect(levelColor(level, 'dark')).toBe(levelColors[level].dark)
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/colors/levelColors.test.ts`
Expected: FAIL — `levelColors[1].light` is `undefined` (current shape has no `.light`/`.dark`), and `levelColor` is called with one argument in the old signature.

- [ ] **Step 3: Implement the new `levelColors.ts`**

Replace the full contents of `src/colors/levelColors.ts`:

```ts
import type { Oklch } from './contrast'
import type { CardLevel } from '../types/card'

export interface LevelColor {
  bg: Oklch
  border: Oklch
  text: Oklch
}

export interface LevelColorPair {
  light: LevelColor
  dark: LevelColor
}

export const levelColors: Record<CardLevel, LevelColorPair> = {
  1: {
    // Rouge — Titre
    light: {
      bg: { l: 0.96, c: 0.03, h: 25 },
      border: { l: 0.55, c: 0.18, h: 25 },
      text: { l: 0.32, c: 0.15, h: 25 },
    },
    dark: {
      bg: { l: 0.22, c: 0.035, h: 25 },
      border: { l: 0.62, c: 0.16, h: 25 },
      text: { l: 0.88, c: 0.05, h: 25 },
    },
  },
  2: {
    // Orange — Sous-titre. Hue pushed from 55° to 70° and chroma raised so it
    // reads apart from both rouge and jaune at a glance (they used to sit
    // within 40° of each other).
    light: {
      bg: { l: 0.96, c: 0.03, h: 70 },
      border: { l: 0.6, c: 0.19, h: 70 },
      text: { l: 0.34, c: 0.16, h: 70 },
    },
    dark: {
      bg: { l: 0.22, c: 0.035, h: 70 },
      border: { l: 0.66, c: 0.17, h: 70 },
      text: { l: 0.88, c: 0.06, h: 70 },
    },
  },
  3: {
    // Bleu — Sous-partie
    light: {
      bg: { l: 0.96, c: 0.03, h: 235 },
      border: { l: 0.55, c: 0.14, h: 235 },
      text: { l: 0.32, c: 0.13, h: 235 },
    },
    dark: {
      bg: { l: 0.2, c: 0.035, h: 235 },
      border: { l: 0.62, c: 0.13, h: 235 },
      text: { l: 0.88, c: 0.05, h: 235 },
    },
  },
  4: {
    // Jaune — Info. Hue pushed from 95° to 105° and chroma raised, same
    // reason as orange above.
    light: {
      bg: { l: 0.96, c: 0.03, h: 105 },
      border: { l: 0.62, c: 0.17, h: 105 },
      text: { l: 0.3, c: 0.15, h: 105 },
    },
    dark: {
      bg: { l: 0.22, c: 0.035, h: 105 },
      border: { l: 0.68, c: 0.15, h: 105 },
      text: { l: 0.86, c: 0.06, h: 105 },
    },
  },
}

/**
 * Palette for a card level, safe against a level a hand-edited file made up.
 *
 * `levelColors[card.level]` is `undefined` for anything outside 1..4, and the
 * `.bg` / `.border` read that follows throws mid-render — which unmounts the
 * whole app rather than showing one odd card. `validateCards` stops such a file
 * before it ever reaches the canvas; this keeps the rendering path itself
 * total, so a bad level can only ever look wrong, never break.
 */
export function levelColor(level: number, theme: 'light' | 'dark'): LevelColor {
  const clamped = Math.min(Math.max(Math.round(level) || 1, 1), 4) as CardLevel
  return levelColors[clamped][theme]
}

/**
 * Floating ("volante") cards: deliberately achromatic, so a detached card reads
 * as OUT of the four-level hierarchy at a glance rather than as a fifth level.
 * Kept above the WCAG AA text/background ratio like every level palette, in
 * both themes.
 */
export const detachedColors: LevelColorPair = {
  light: {
    bg: { l: 0.95, c: 0, h: 0 },
    border: { l: 0.72, c: 0, h: 0 },
    text: { l: 0.42, c: 0, h: 0 },
  },
  dark: {
    bg: { l: 0.24, c: 0, h: 0 },
    border: { l: 0.55, c: 0, h: 0 },
    text: { l: 0.85, c: 0, h: 0 },
  },
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/colors/levelColors.test.ts`
Expected: PASS (all cases)

- [ ] **Step 5: Update the 4 call sites to pass an explicit `'light'` theme**

This is a mechanical, behavior-preserving change (every call site rendered light-only before this plan; `useResolvedTheme` wiring in later tasks replaces the literal `'light'` with the live theme where appropriate). Each edit below only touches the `levelColor(...)`/`detachedColors` call, nothing else in the surrounding code.

In `src/components/CardNode.tsx`, replace lines 162-163:

```ts
  const colors = isDetached ? detachedColors.light : levelColor(card.level, 'light')
  const childColors = !isDetached && card.level < 4 ? levelColor(card.level + 1, 'light') : null
```

In `src/components/MindMapCanvas.tsx`, replace line 368:

```ts
            stroke: toCss(levelColor(card.level, 'light').border),
```

and line 381:

```ts
          style: { stroke: toCss(levelColor(draggedCard.level, 'light').border), opacity: 1 },
```

In `src/export/StaticCardView.tsx`, replace line 19:

```ts
  const colors = card.detached ? detachedColors.light : levelColor(card.level, 'light')
```

In `src/components/quiz/QuizConfigModal.tsx`, replace lines 68-69:

```ts
              const bg = toCss(levelColor(level, 'light').border)
              const text = toCss(pickReadableTextColor(levelColor(level, 'light').border))
```

replace lines 145-146:

```ts
          border: `2px solid ${toCss(levelColor(3, 'light').border)}`,
          background: qcmMode ? toCss(levelColor(3, 'light').bg) : 'var(--background)',
```

and line 165:

```ts
            background: qcmMode ? toCss(levelColor(3, 'light').border) : '#ccc',
```

- [ ] **Step 6: Run the affected component test suites to confirm no regression**

Run: `npx vitest run src/colors/levelColors.test.ts src/components/CardNode.test.tsx src/components/MindMapCanvas.test.tsx src/export/StaticCardView.test.tsx src/components/quiz/QuizConfigModal.test.tsx`
Expected: PASS (all files) — none of these tests assert on the `levelColor`/`detachedColors` call shape, only on rendered behavior, which is unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/colors/levelColors.ts src/colors/levelColors.test.ts src/components/CardNode.tsx src/components/MindMapCanvas.tsx src/export/StaticCardView.tsx src/components/quiz/QuizConfigModal.tsx
git commit -m "feat(colors): give every level palette a light and dark variant"
```

---

## Task 2: `appearanceSettings.ts` — types, defaults, and merge

**Files:**
- Create: `src/types/appearanceSettings.ts`
- Test: `src/types/appearanceSettings.test.ts`

**Interfaces:**
- Consumes: `LevelColor` from `src/colors/levelColors.ts` (Task 1), `levelColors` from the same module, `CardLevel` from `src/types/card.ts`.
- Produces: `ThemeMode`, `LevelAppearance`, `AppearanceSettings`, `DEFAULT_APPEARANCE_SETTINGS`, `DEFAULT_FONT_FAMILY`, `FONT_OPTIONS`, `mergeAppearanceSettings(partial)`.

- [ ] **Step 1: Write the failing test**

Create `src/types/appearanceSettings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { oklchWcagContrast } from '../colors/contrast'
import { DEFAULT_APPEARANCE_SETTINGS, mergeAppearanceSettings } from './appearanceSettings'

describe('DEFAULT_APPEARANCE_SETTINGS', () => {
  it.each([1, 2, 3, 4] as const)('level %s light and dark text meet WCAG AA against their background', level => {
    const { light, dark } = DEFAULT_APPEARANCE_SETTINGS.levels[level].color
    expect(oklchWcagContrast(light.bg, light.text)).toBeGreaterThanOrEqual(4.5)
    expect(oklchWcagContrast(dark.bg, dark.text)).toBeGreaterThanOrEqual(4.5)
  })

  it('defaults to the system theme', () => {
    expect(DEFAULT_APPEARANCE_SETTINGS.themeMode).toBe('system')
  })

  it('has the expected default labels', () => {
    expect(DEFAULT_APPEARANCE_SETTINGS.levels[1].label).toBe('Titre')
    expect(DEFAULT_APPEARANCE_SETTINGS.levels[2].label).toBe('Sous-titre')
    expect(DEFAULT_APPEARANCE_SETTINGS.levels[3].label).toBe('Sous-partie')
    expect(DEFAULT_APPEARANCE_SETTINGS.levels[4].label).toBe('Info')
  })
})

describe('mergeAppearanceSettings', () => {
  it('returns the defaults when given null or undefined', () => {
    expect(mergeAppearanceSettings(null)).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(mergeAppearanceSettings(undefined)).toEqual(DEFAULT_APPEARANCE_SETTINGS)
  })

  it('keeps defaults for levels/fields absent from a partial file', () => {
    const merged = mergeAppearanceSettings({ levels: { 2: { label: 'Custom' } } })
    expect(merged.levels[2].label).toBe('Custom')
    expect(merged.levels[2].color).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[2].color)
    expect(merged.levels[1]).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[1])
    expect(merged.levels[3]).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[3])
    expect(merged.levels[4]).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[4])
  })

  it('keeps the default dark color when a file only overrides the light color', () => {
    const merged = mergeAppearanceSettings({ levels: { 1: { color: { light: { h: 10 } } } } })
    expect(merged.levels[1].color.light.h).toBe(10)
    expect(merged.levels[1].color.light.l).toBe(DEFAULT_APPEARANCE_SETTINGS.levels[1].color.light.l)
    expect(merged.levels[1].color.dark).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[1].color.dark)
  })

  it('keeps default fontFamily/themeMode when absent', () => {
    const merged = mergeAppearanceSettings({ levels: {} })
    expect(merged.fontFamily).toBe(DEFAULT_APPEARANCE_SETTINGS.fontFamily)
    expect(merged.themeMode).toBe('system')
  })

  it('applies an explicit fontFamily and themeMode override', () => {
    const merged = mergeAppearanceSettings({ fontFamily: 'Georgia, serif', themeMode: 'dark' })
    expect(merged.fontFamily).toBe('Georgia, serif')
    expect(merged.themeMode).toBe('dark')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/types/appearanceSettings.test.ts`
Expected: FAIL with "Cannot find module './appearanceSettings'" (file does not exist yet)

- [ ] **Step 3: Implement `appearanceSettings.ts`**

Create `src/types/appearanceSettings.ts`:

```ts
import type { CardLevel } from './card'
import type { LevelColor, LevelColorPair } from '../colors/levelColors'
import { levelColors } from '../colors/levelColors'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface LevelAppearance {
  label: string
  color: LevelColorPair
}

export interface AppearanceSettings {
  levels: Record<CardLevel, LevelAppearance>
  fontFamily: string
  themeMode: ThemeMode
}

const DEFAULT_LEVEL_LABELS: Record<CardLevel, string> = {
  1: 'Titre',
  2: 'Sous-titre',
  3: 'Sous-partie',
  4: 'Info',
}

export const DEFAULT_FONT_FAMILY = "'Geist Variable', sans-serif"

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  levels: {
    1: { label: DEFAULT_LEVEL_LABELS[1], color: levelColors[1] },
    2: { label: DEFAULT_LEVEL_LABELS[2], color: levelColors[2] },
    3: { label: DEFAULT_LEVEL_LABELS[3], color: levelColors[3] },
    4: { label: DEFAULT_LEVEL_LABELS[4], color: levelColors[4] },
  },
  fontFamily: DEFAULT_FONT_FAMILY,
  themeMode: 'system',
}

export const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Geist (par défaut)', value: DEFAULT_FONT_FAMILY },
  { label: 'Système', value: 'system-ui, sans-serif' },
  { label: 'Georgia (avec empattements)', value: 'Georgia, serif' },
  { label: 'Monospace', value: 'ui-monospace, monospace' },
]

interface PartialLevelAppearance {
  label?: string
  color?: Partial<LevelColorPair>
}

interface PartialAppearanceSettings {
  levels?: Partial<Record<CardLevel, PartialLevelAppearance>>
  fontFamily?: string
  themeMode?: ThemeMode
}

function mergeLevelColor(defaults: LevelColor, partial: Partial<LevelColor> | undefined): LevelColor {
  return { ...defaults, ...partial }
}

function mergeLevelAppearance(defaults: LevelAppearance, partial: PartialLevelAppearance | undefined): LevelAppearance {
  return {
    label: partial?.label ?? defaults.label,
    color: {
      light: mergeLevelColor(defaults.color.light, partial?.color?.light),
      dark: mergeLevelColor(defaults.color.dark, partial?.color?.dark),
    },
  }
}

/**
 * Merges a settings file (possibly from an older schema version, or
 * hand-edited and missing fields) onto the defaults, field by field and
 * level by level. A plain object spread would replace the whole `levels`
 * record — or a whole level's `color` — the moment any part of it is
 * present, silently dropping the defaults for the levels/fields the file
 * didn't mention.
 */
export function mergeAppearanceSettings(partial: PartialAppearanceSettings | null | undefined): AppearanceSettings {
  if (!partial) return DEFAULT_APPEARANCE_SETTINGS
  const levels = {} as Record<CardLevel, LevelAppearance>
  for (const level of [1, 2, 3, 4] as const) {
    levels[level] = mergeLevelAppearance(DEFAULT_APPEARANCE_SETTINGS.levels[level], partial.levels?.[level])
  }
  return {
    levels,
    fontFamily: partial.fontFamily ?? DEFAULT_APPEARANCE_SETTINGS.fontFamily,
    themeMode: partial.themeMode ?? DEFAULT_APPEARANCE_SETTINGS.themeMode,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/types/appearanceSettings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/appearanceSettings.ts src/types/appearanceSettings.test.ts
git commit -m "feat(appearance): add AppearanceSettings type, defaults and merge"
```

---

## Task 3: Persistence — `appearanceSettings.ts`

**Files:**
- Create: `src/persistence/appearanceSettings.ts`
- Test: `src/persistence/appearanceSettings.test.ts`

**Interfaces:**
- Consumes: `AppearanceSettings`, `mergeAppearanceSettings`, `DEFAULT_APPEARANCE_SETTINGS` from Task 2.
- Produces: `loadAppearanceSettings(): Promise<AppearanceSettings>`, `saveAppearanceSettings(settings: AppearanceSettings): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `src/persistence/appearanceSettings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadAppearanceSettings, saveAppearanceSettings } from './appearanceSettings'
import { DEFAULT_APPEARANCE_SETTINGS } from '../types/appearanceSettings'

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

describe('loadAppearanceSettings', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
  })

  it('returns the defaults when no settings file exists yet', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const settings = await loadAppearanceSettings()
    expect(settings).toEqual(DEFAULT_APPEARANCE_SETTINGS)
  })

  it('reads and parses an existing settings file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ fontFamily: 'Georgia, serif', themeMode: 'dark' }))
    const settings = await loadAppearanceSettings()
    expect(readTextFile).toHaveBeenCalledWith('/fake/config/appearance-settings.json')
    expect(settings.fontFamily).toBe('Georgia, serif')
    expect(settings.themeMode).toBe('dark')
    expect(settings.levels).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels)
  })

  it('fills in defaults for a level missing from an older settings file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ levels: { 1: { label: 'Chapitre' } } }))
    const settings = await loadAppearanceSettings()
    expect(settings.levels[1].label).toBe('Chapitre')
    expect(settings.levels[1].color).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[1].color)
    expect(settings.levels[2]).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[2])
  })
})

describe('saveAppearanceSettings', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(writeTextFile).mockReset()
    vi.mocked(mkdir).mockReset()
  })

  it('creates the app config directory if missing, then writes the settings file', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    await saveAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)
    expect(mkdir).toHaveBeenCalledWith('/fake/config', { recursive: true })
    expect(writeTextFile).toHaveBeenCalledWith(
      '/fake/config/appearance-settings.json',
      JSON.stringify(DEFAULT_APPEARANCE_SETTINGS, null, 2)
    )
  })

  it('does not recreate the config directory when it already exists', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    await saveAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)
    expect(mkdir).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/persistence/appearanceSettings.test.ts`
Expected: FAIL with "Cannot find module './appearanceSettings'"

- [ ] **Step 3: Implement `appearanceSettings.ts`**

Create `src/persistence/appearanceSettings.ts`:

```ts
import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'
import type { AppearanceSettings } from '../types/appearanceSettings'
import { mergeAppearanceSettings } from '../types/appearanceSettings'

const SETTINGS_FILE_NAME = 'appearance-settings.json'

async function settingsFilePath(): Promise<string> {
  return join(await appConfigDir(), SETTINGS_FILE_NAME)
}

export async function loadAppearanceSettings(): Promise<AppearanceSettings> {
  const path = await settingsFilePath()
  if (!(await exists(path))) return mergeAppearanceSettings(null)
  const json = await readTextFile(path)
  return mergeAppearanceSettings(JSON.parse(json))
}

export async function saveAppearanceSettings(settings: AppearanceSettings): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const path = await settingsFilePath()
  await writeTextFile(path, JSON.stringify(settings, null, 2))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/persistence/appearanceSettings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/persistence/appearanceSettings.ts src/persistence/appearanceSettings.test.ts
git commit -m "feat(appearance): persist AppearanceSettings under appConfigDir"
```

---

## Task 4: `useAppearanceSettingsStore.ts`

**Files:**
- Create: `src/state/useAppearanceSettingsStore.ts`
- Test: `src/state/useAppearanceSettingsStore.test.ts`

**Interfaces:**
- Consumes: `AppearanceSettings`, `ThemeMode`, `DEFAULT_APPEARANCE_SETTINGS` (Task 2); `loadAppearanceSettings`, `saveAppearanceSettings` (Task 3); `LevelColor` (Task 1); `CardLevel` (`src/types/card.ts`).
- Produces: `useAppearanceSettingsStore` — state shape `AppearanceSettings & { init, setLevelLabel, setLevelColor, setFontFamily, setThemeMode }`.

- [ ] **Step 1: Write the failing test**

Create `src/state/useAppearanceSettingsStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAppearanceSettingsStore } from './useAppearanceSettingsStore'
import { DEFAULT_APPEARANCE_SETTINGS } from '../types/appearanceSettings'

vi.mock('../persistence/appearanceSettings', () => ({
  loadAppearanceSettings: vi.fn(),
  saveAppearanceSettings: vi.fn(),
}))

import { loadAppearanceSettings, saveAppearanceSettings } from '../persistence/appearanceSettings'

describe('useAppearanceSettingsStore', () => {
  beforeEach(() => {
    vi.mocked(loadAppearanceSettings).mockReset()
    vi.mocked(saveAppearanceSettings).mockReset().mockResolvedValue(undefined)
  })

  it('starts with the defaults before init resolves', () => {
    const store = createAppearanceSettingsStore()
    expect(store.getState().levels).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels)
    expect(store.getState().fontFamily).toBe(DEFAULT_APPEARANCE_SETTINGS.fontFamily)
    expect(store.getState().themeMode).toBe('system')
  })

  it('init loads persisted settings into the store', async () => {
    const persisted = { ...DEFAULT_APPEARANCE_SETTINGS, themeMode: 'dark' as const }
    vi.mocked(loadAppearanceSettings).mockResolvedValue(persisted)
    const store = createAppearanceSettingsStore()

    await store.getState().init()

    expect(store.getState().themeMode).toBe('dark')
  })

  it('falls back to defaults if loading settings throws', async () => {
    vi.mocked(loadAppearanceSettings).mockRejectedValue(new Error('disk error'))
    const store = createAppearanceSettingsStore()

    await store.getState().init()

    expect(store.getState().themeMode).toBe('system')
  })

  it('setLevelLabel updates only the targeted level and persists the full settings', async () => {
    const store = createAppearanceSettingsStore()

    await store.getState().setLevelLabel(2, 'Chapitre')

    expect(store.getState().levels[2].label).toBe('Chapitre')
    expect(store.getState().levels[1].label).toBe(DEFAULT_APPEARANCE_SETTINGS.levels[1].label)
    expect(saveAppearanceSettings).toHaveBeenCalledWith(
      expect.objectContaining({ levels: expect.objectContaining({ 2: expect.objectContaining({ label: 'Chapitre' }) }) })
    )
  })

  it('setLevelColor patches only the targeted theme and field, leaving the rest of the level alone', async () => {
    const store = createAppearanceSettingsStore()

    await store.getState().setLevelColor(1, 'dark', { border: { l: 0.5, c: 0.1, h: 40 } })

    expect(store.getState().levels[1].color.dark.border).toEqual({ l: 0.5, c: 0.1, h: 40 })
    expect(store.getState().levels[1].color.dark.bg).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[1].color.dark.bg)
    expect(store.getState().levels[1].color.dark.text).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[1].color.dark.text)
    expect(store.getState().levels[1].color.light).toEqual(DEFAULT_APPEARANCE_SETTINGS.levels[1].color.light)
  })

  it('setFontFamily updates the store and persists it', async () => {
    const store = createAppearanceSettingsStore()

    await store.getState().setFontFamily('Georgia, serif')

    expect(store.getState().fontFamily).toBe('Georgia, serif')
    expect(saveAppearanceSettings).toHaveBeenCalledWith(expect.objectContaining({ fontFamily: 'Georgia, serif' }))
  })

  it('setThemeMode updates the store and persists it', async () => {
    const store = createAppearanceSettingsStore()

    await store.getState().setThemeMode('dark')

    expect(store.getState().themeMode).toBe('dark')
    expect(saveAppearanceSettings).toHaveBeenCalledWith(expect.objectContaining({ themeMode: 'dark' }))
  })

  it('keeps the in-memory value even if persisting it fails', async () => {
    vi.mocked(saveAppearanceSettings).mockRejectedValue(new Error('disk error'))
    const store = createAppearanceSettingsStore()

    await store.getState().setThemeMode('dark')

    expect(store.getState().themeMode).toBe('dark')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/state/useAppearanceSettingsStore.test.ts`
Expected: FAIL with "Cannot find module './useAppearanceSettingsStore'"

- [ ] **Step 3: Implement `useAppearanceSettingsStore.ts`**

Create `src/state/useAppearanceSettingsStore.ts`:

```ts
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { AppearanceSettings, ThemeMode } from '../types/appearanceSettings'
import { DEFAULT_APPEARANCE_SETTINGS } from '../types/appearanceSettings'
import type { LevelColor } from '../colors/levelColors'
import type { CardLevel } from '../types/card'
import { loadAppearanceSettings, saveAppearanceSettings } from '../persistence/appearanceSettings'

interface AppearanceSettingsState extends AppearanceSettings {
  init: () => Promise<void>
  setLevelLabel: (level: CardLevel, label: string) => Promise<void>
  setLevelColor: (level: CardLevel, theme: 'light' | 'dark', patch: Partial<LevelColor>) => Promise<void>
  setFontFamily: (fontFamily: string) => Promise<void>
  setThemeMode: (themeMode: ThemeMode) => Promise<void>
}

export type AppearanceSettingsStore = UseBoundStore<StoreApi<AppearanceSettingsState>>

export function createAppearanceSettingsStore(): AppearanceSettingsStore {
  return create<AppearanceSettingsState>((set, get) => ({
    ...DEFAULT_APPEARANCE_SETTINGS,
    // Same shape as `useQuizSettingsStore.init`: a corrupt or unreadable
    // settings file must degrade to the defaults, never surface as an
    // unhandled rejection from the `init()` App fires on mount.
    init: async () => {
      try {
        const settings = await loadAppearanceSettings()
        set(settings)
      } catch {
        set(DEFAULT_APPEARANCE_SETTINGS)
      }
    },
    setLevelLabel: async (level, label) => {
      const current = get()
      const next: AppearanceSettings = {
        ...current,
        levels: { ...current.levels, [level]: { ...current.levels[level], label } },
      }
      set(next)
      try {
        await saveAppearanceSettings(next)
      } catch {
        // Best-effort persistence: the in-memory value is already applied, and
        // a failed write must not throw into the input's change handler.
      }
    },
    setLevelColor: async (level, theme, patch) => {
      const current = get()
      const currentLevel = current.levels[level]
      const next: AppearanceSettings = {
        ...current,
        levels: {
          ...current.levels,
          [level]: {
            ...currentLevel,
            color: { ...currentLevel.color, [theme]: { ...currentLevel.color[theme], ...patch } },
          },
        },
      }
      set(next)
      try {
        await saveAppearanceSettings(next)
      } catch {
        // Best-effort persistence; see `setLevelLabel`.
      }
    },
    setFontFamily: async fontFamily => {
      const next: AppearanceSettings = { ...get(), fontFamily }
      set(next)
      try {
        await saveAppearanceSettings(next)
      } catch {
        // Best-effort persistence; see `setLevelLabel`.
      }
    },
    setThemeMode: async themeMode => {
      const next: AppearanceSettings = { ...get(), themeMode }
      set(next)
      try {
        await saveAppearanceSettings(next)
      } catch {
        // Best-effort persistence; see `setLevelLabel`.
      }
    },
  }))
}

export const useAppearanceSettingsStore = createAppearanceSettingsStore()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/state/useAppearanceSettingsStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/state/useAppearanceSettingsStore.ts src/state/useAppearanceSettingsStore.test.ts
git commit -m "feat(appearance): add useAppearanceSettingsStore"
```

---

## Task 5: `useResolvedTheme` + `useThemeDomSync`

**Files:**
- Create: `src/hooks/useResolvedTheme.ts`
- Test: `src/hooks/useResolvedTheme.test.ts`

**Interfaces:**
- Consumes: `useAppearanceSettingsStore` (Task 4).
- Produces: `useResolvedTheme(): 'light' | 'dark'`, `useThemeDomSync(): void`.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useResolvedTheme.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResolvedTheme, useThemeDomSync } from './useResolvedTheme'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'
import { DEFAULT_APPEARANCE_SETTINGS } from '../types/appearanceSettings'

function mockMatchMedia(initialMatches: boolean) {
  let handler: ((event: MediaQueryListEvent) => void) | null = null
  const mql = {
    matches: initialMatches,
    addEventListener: vi.fn((_event: string, cb: (event: MediaQueryListEvent) => void) => {
      handler = cb
    }),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql))
  return {
    mql,
    fireChange(matches: boolean) {
      mql.matches = matches
      handler?.({ matches } as MediaQueryListEvent)
    },
  }
}

describe('useResolvedTheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useAppearanceSettingsStore.setState(DEFAULT_APPEARANCE_SETTINGS)
  })

  it('returns the explicit mode without consulting the system preference', () => {
    mockMatchMedia(true)
    useAppearanceSettingsStore.setState({ themeMode: 'light' })
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('light')
  })

  it('follows the system preference when mode is "system"', () => {
    mockMatchMedia(true)
    useAppearanceSettingsStore.setState({ themeMode: 'system' })
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('dark')
  })

  it('reacts to a live system preference change while in "system" mode', () => {
    const media = mockMatchMedia(false)
    useAppearanceSettingsStore.setState({ themeMode: 'system' })
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('light')

    act(() => media.fireChange(true))

    expect(result.current).toBe('dark')
  })

  it('unsubscribes from the media query listener on unmount', () => {
    const { mql } = mockMatchMedia(false)
    const { unmount } = renderHook(() => useResolvedTheme())
    unmount()
    expect(mql.removeEventListener).toHaveBeenCalled()
  })
})

describe('useThemeDomSync', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useAppearanceSettingsStore.setState(DEFAULT_APPEARANCE_SETTINGS)
    document.documentElement.classList.remove('dark')
  })

  it('adds the dark class when the resolved theme is dark', () => {
    mockMatchMedia(false)
    useAppearanceSettingsStore.setState({ themeMode: 'dark' })
    renderHook(() => useThemeDomSync())
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes the dark class when the resolved theme is light', () => {
    mockMatchMedia(false)
    document.documentElement.classList.add('dark')
    useAppearanceSettingsStore.setState({ themeMode: 'light' })
    renderHook(() => useThemeDomSync())
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/useResolvedTheme.test.ts`
Expected: FAIL with "Cannot find module './useResolvedTheme'"

- [ ] **Step 3: Implement `useResolvedTheme.ts`**

Create `src/hooks/useResolvedTheme.ts`:

```ts
import { useEffect, useState } from 'react'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'

function systemPrefersDarkNow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
}

/**
 * Resolves `themeMode` ('light' | 'dark' | 'system') to an actual
 * 'light' | 'dark', tracking the OS preference live while in 'system' mode.
 */
export function useResolvedTheme(): 'light' | 'dark' {
  const themeMode = useAppearanceSettingsStore(s => s.themeMode)
  const [systemPrefersDark, setSystemPrefersDark] = useState(systemPrefersDarkNow)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])

  if (themeMode === 'system') return systemPrefersDark ? 'dark' : 'light'
  return themeMode
}

/**
 * Applies the resolved theme to `<html>` as the `dark` class shadcn's tokens
 * key off (`src/index.css`'s `.dark { ... }` block). Call once, near the app
 * root — every other consumer of the theme should read `useResolvedTheme()`
 * for the value, not re-run this side effect.
 */
export function useThemeDomSync(): void {
  const resolved = useResolvedTheme()
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [resolved])
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/useResolvedTheme.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useResolvedTheme.ts src/hooks/useResolvedTheme.test.ts
git commit -m "feat(theme): add useResolvedTheme and useThemeDomSync"
```

---

## Task 6: `useAppliedFontFamily`

**Files:**
- Create: `src/hooks/useAppliedFontFamily.ts`
- Test: `src/hooks/useAppliedFontFamily.test.ts`

**Interfaces:**
- Consumes: `useAppearanceSettingsStore` (Task 4).
- Produces: `useAppliedFontFamily(): void`.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useAppliedFontFamily.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAppliedFontFamily } from './useAppliedFontFamily'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'
import { DEFAULT_APPEARANCE_SETTINGS } from '../types/appearanceSettings'

describe('useAppliedFontFamily', () => {
  beforeEach(() => {
    useAppearanceSettingsStore.setState(DEFAULT_APPEARANCE_SETTINGS)
    document.documentElement.style.removeProperty('--font-sans')
  })
  afterEach(() => {
    document.documentElement.style.removeProperty('--font-sans')
  })

  it('sets --font-sans to the store default on mount', () => {
    renderHook(() => useAppliedFontFamily())
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe(DEFAULT_APPEARANCE_SETTINGS.fontFamily)
  })

  it('updates --font-sans when the store value changes', () => {
    renderHook(() => useAppliedFontFamily())
    act(() => {
      useAppearanceSettingsStore.setState({ fontFamily: 'Georgia, serif' })
    })
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe('Georgia, serif')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/useAppliedFontFamily.test.ts`
Expected: FAIL with "Cannot find module './useAppliedFontFamily'"

- [ ] **Step 3: Implement `useAppliedFontFamily.ts`**

Create `src/hooks/useAppliedFontFamily.ts`:

```ts
import { useEffect } from 'react'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'

/**
 * Syncs the `--font-sans` CSS variable (consumed by `--font-heading` and
 * `html`'s `font-sans` utility in `src/index.css`) with the store. Call once,
 * near the app root.
 */
export function useAppliedFontFamily(): void {
  const fontFamily = useAppearanceSettingsStore(s => s.fontFamily)
  useEffect(() => {
    document.documentElement.style.setProperty('--font-sans', fontFamily)
  }, [fontFamily])
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/useAppliedFontFamily.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAppliedFontFamily.ts src/hooks/useAppliedFontFamily.test.ts
git commit -m "feat(theme): apply the configured font family to --font-sans"
```

---

## Task 7: Wire `CardNode.tsx` to the appearance store

**Files:**
- Modify: `src/components/CardNode.tsx`

**Interfaces:**
- Consumes: `useResolvedTheme` (Task 5), `useAppearanceSettingsStore` (Task 4).

- [ ] **Step 1: Update imports**

In `src/components/CardNode.tsx`, replace line 13:

```ts
import { detachedColors, levelColor } from '../colors/levelColors'
```

with:

```ts
import { detachedColors } from '../colors/levelColors'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'
import { useResolvedTheme } from '../hooks/useResolvedTheme'
```

and add `CardLevel` to the existing `Card` type import (line 5-6):

```ts
import type { Card, CardLevel } from '../types/card'
import { isRootCard } from '../types/card'
```

- [ ] **Step 2: Replace the color resolution lines**

Replace lines 162-163 (already rewritten once in Task 1 to pass `'light'` — this step removes that literal in favor of the live theme and the store):

```ts
  const theme = useResolvedTheme()
  const levelAppearance = useAppearanceSettingsStore(s => s.levels[card.level])
  const childLevelAppearance = useAppearanceSettingsStore(s =>
    card.level < 4 ? s.levels[(card.level + 1) as CardLevel] : null
  )
  const colors = isDetached ? detachedColors[theme] : levelAppearance.color[theme]
  const childColors = !isDetached && childLevelAppearance ? childLevelAppearance.color[theme] : null
```

- [ ] **Step 3: Run the existing test suite to confirm no regression**

Run: `npx vitest run src/components/CardNode.test.tsx`
Expected: PASS — `DEFAULT_APPEARANCE_SETTINGS.levels[level].color.light` is byte-for-byte the same palette `CardNode` rendered before this task, and the store resolves to `'light'` by default in a jsdom test environment (no `matchMedia`, `themeMode` defaults to `'system'` → `useResolvedTheme` falls back to `'light'`).

- [ ] **Step 4: Commit**

```bash
git add src/components/CardNode.tsx
git commit -m "feat(card): read level colors from the appearance store"
```

---

## Task 8: Wire `MindMapCanvas.tsx` edges to the appearance store

**Files:**
- Modify: `src/components/MindMapCanvas.tsx`

**Interfaces:**
- Consumes: `useResolvedTheme` (Task 5), `useAppearanceSettingsStore` (Task 4).

- [ ] **Step 1: Update imports**

In `src/components/MindMapCanvas.tsx`, replace line 23:

```ts
import { levelColor } from '../colors/levelColors'
```

with:

```ts
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'
import { useResolvedTheme } from '../hooks/useResolvedTheme'
```

- [ ] **Step 2: Add the theme/appearance selectors**

In the `MindMapCanvasInner` component, add after line 268 (`const quizResults = useQuizStore(s => s.results)`):

```ts
  const theme = useResolvedTheme()
  const levelAppearance = useAppearanceSettingsStore(s => s.levels)
```

- [ ] **Step 3: Update the edges `useMemo`**

Replace the `edges` `useMemo` (lines 353-386):

```ts
  const edges: Edge[] = useMemo(() => {
    const realEdges = cards
      // `!card.detached` is belt and braces: detaching always nulls `parentId`,
      // but a hand-edited file could carry both and would draw an edge from the
      // floating zone back into the tree.
      .filter((card): card is typeof card & { parentId: string } => card.parentId !== null && !card.detached)
      .map(
        (card): Edge => ({
          id: `e-${card.parentId}-${card.id}`,
          source: card.parentId,
          target: card.id,
          // The real edge from the current parent fades out while a valid
          // reparent target is active, so it doesn't compete with the dashed
          // ghost edge previewing the future link (added below).
          style: {
            stroke: toCss(levelAppearance[card.level].color[theme].border),
            opacity: reparentTargetId && card.id === draggingId ? 0.15 : 1,
          },
        })
      )
    if (reparentTargetId && draggingId) {
      const draggedCard = cards.find(c => c.id === draggingId)
      if (draggedCard) {
        realEdges.push({
          id: 'reparent-ghost-edge',
          source: reparentTargetId,
          target: draggingId,
          className: 'reparent-ghost-edge',
          style: { stroke: toCss(levelAppearance[draggedCard.level].color[theme].border), opacity: 1 },
        })
      }
    }
    return realEdges
  }, [cards, reparentTargetId, draggingId, levelAppearance, theme])
```

- [ ] **Step 4: Run the existing test suite to confirm no regression**

Run: `npx vitest run src/components/MindMapCanvas.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/MindMapCanvas.tsx
git commit -m "feat(canvas): read edge colors from the appearance store"
```

---

## Task 9: Wire `QuizConfigModal.tsx` to the appearance store

**Files:**
- Modify: `src/components/quiz/QuizConfigModal.tsx`

**Interfaces:**
- Consumes: `useResolvedTheme` (Task 5), `useAppearanceSettingsStore` (Task 4).

- [ ] **Step 1: Update imports and remove the local `LEVEL_LABELS`**

Replace lines 1-18:

```ts
import { useState } from 'react'
import { Sprout, Zap, Flame, type LucideIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { useQuizStore } from '../../state/useQuizStore'
import { useAppearanceSettingsStore } from '../../state/useAppearanceSettingsStore'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'
import { toCss, pickReadableTextColor } from '../../colors/contrast'
import type { CardLevel } from '../../types/card'
import type { QuizDifficulty } from '../../types/quiz'

const ALL_LEVELS: CardLevel[] = [1, 2, 3, 4]
```

- [ ] **Step 2: Add the theme/appearance selectors**

After `const startQuiz = useQuizStore(s => s.startQuiz)`, add:

```ts
  const theme = useResolvedTheme()
  const levelAppearance = useAppearanceSettingsStore(s => s.levels)
```

- [ ] **Step 3: Replace the level-square color and label lookups**

Replace the two lines computing `bg`/`text` inside the `ALL_LEVELS.map(level => { ... })` block:

```ts
              const bg = toCss(levelAppearance[level].color[theme].border)
              const text = toCss(pickReadableTextColor(levelAppearance[level].color[theme].border))
```

and replace both `LEVEL_LABELS[level]` occurrences (the checkbox's `aria-label` and the visible text inside the `<label>`) with `levelAppearance[level].label`.

- [ ] **Step 4: Replace the QCM toggle's level-3 color lookups**

Replace the `border`/`background` in the QCM toggle `<button>` style:

```ts
          border: `2px solid ${toCss(levelAppearance[3].color[theme].border)}`,
          background: qcmMode ? toCss(levelAppearance[3].color[theme].bg) : 'var(--background)',
```

and the inner switch track's `background`:

```ts
            background: qcmMode ? toCss(levelAppearance[3].color[theme].border) : '#ccc',
```

- [ ] **Step 5: Run the existing test suite to confirm no regression**

Run: `npx vitest run src/components/quiz/QuizConfigModal.test.tsx`
Expected: PASS — none of its tests select elements by the old label text in a way that would break (the default labels are unchanged), and none assert on color values.

- [ ] **Step 6: Commit**

```bash
git add src/components/quiz/QuizConfigModal.tsx
git commit -m "feat(quiz): read level labels and colors from the appearance store"
```

---

## Task 10: Wire `StaticCardView.tsx` (export) to the appearance store

**Files:**
- Modify: `src/export/StaticCardView.tsx`

**Interfaces:**
- Consumes: `useAppearanceSettingsStore` (Task 4).

- [ ] **Step 1: Update the component**

Replace the full contents of `src/export/StaticCardView.tsx`:

```ts
import type { Card } from '../types/card'
import { detachedColors } from '../colors/levelColors'
import { toCss } from '../colors/contrast'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'

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
 *
 * Always renders the LIGHT palette regardless of the app's live theme: a
 * PDF/image is meant to be printed or shared, where a dark background would
 * waste ink/toner and a shared screenshot should look the same to every
 * recipient, whatever their system theme.
 */
export function StaticCardView({ card, showDefinition }: StaticCardViewProps) {
  const levelAppearance = useAppearanceSettingsStore(s => s.levels)
  const colors = card.detached ? detachedColors.light : levelAppearance[card.level].color.light
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

- [ ] **Step 2: Run the existing test suite to confirm no regression**

Run: `npx vitest run src/export/StaticCardView.test.tsx`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/export/StaticCardView.tsx
git commit -m "feat(export): read level colors from the appearance store"
```

---

## Task 11: App shell dark-mode fixes

**Files:**
- Modify: `src/index.css`
- Modify: `src/App.tsx`
- Modify: `src/components/MindMapCanvas.tsx`
- Delete: `src/App.css`

**Interfaces:** none (pure styling/token wiring).

**Context:** `src/App.css` is dead code — it is never imported anywhere (`grep -rln "App.css" src` returns nothing; only `src/main.tsx` imports `./index.css`). Its `@media (prefers-color-scheme: dark)` block does nothing today; the two banner colors it might look like it explains (`#fef3c7`/`#f59e0b`/`#92400e`) are actually hardcoded inline in `App.tsx`. `index.css` already has working `body { @apply bg-background text-foreground }` / `html { @apply font-sans }` (`@layer base` block) plus a full `.dark { ... }` token override — those two pieces need no change; they already repaint correctly the moment `useThemeDomSync` (Task 5) toggles the `dark` class.

- [ ] **Step 1: Delete the dead stylesheet**

```bash
git rm src/App.css
```

- [ ] **Step 2: Add warning-banner tokens to `index.css`**

In `src/index.css`, in the `:root { ... }` block, add before the closing `}` (after `--sidebar-ring: oklch(0.708 0 0);`):

```css
  --warning-bg: oklch(0.94 0.06 85);
  --warning-border: oklch(0.72 0.14 70);
  --warning-fg: oklch(0.4 0.12 60);
```

In the `.dark { ... }` block, add before its closing `}` (after `--sidebar-ring: oklch(0.556 0 0);`):

```css
  --warning-bg: oklch(0.28 0.05 75);
  --warning-border: oklch(0.55 0.14 70);
  --warning-fg: oklch(0.9 0.08 80);
```

- [ ] **Step 3: Add the `.status-banner` utility class and the view-transition override**

At the end of `src/index.css` (after the `.zone-label` rule), add:

```css
/* Shared style for the loadError/dropError banners in App.tsx — themed via
   the warning tokens above so they repaint correctly in dark mode. */
.status-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 8px 8px;
  padding: 6px 8px;
  border: 1px solid var(--warning-border);
  border-radius: 4px;
  background: var(--warning-bg);
  color: var(--warning-fg);
  font-size: 13px;
}

/* The circular theme-toggle transition (see src/theme/circularReveal.ts)
   animates `clip-path` itself — the View Transitions API's default
   cross-fade between old/new snapshots would show through underneath and
   spoil the effect. */
::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
  mix-blend-mode: normal;
}
```

- [ ] **Step 4: Replace the hardcoded banner styles in `App.tsx`**

Replace the `loadError` block:

```tsx
        {loadError && (
          <div role="alert" className="status-banner">
            <span style={{ flex: 1 }}>⚠ {loadError}</span>
            <button
              type="button"
              aria-label="Masquer le message d’erreur"
              onClick={() => setLoadError(null)}
              style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 15 }}
            >
              ×
            </button>
          </div>
        )}
```

Replace the `dropError` block:

```tsx
        {dropError && (
          <div role="alert" className="status-banner">
            <span style={{ flex: 1 }}>⚠ {dropError}</span>
          </div>
        )}
```

- [ ] **Step 5: Give the canvas background an explicit, theme-aware color**

In `src/components/MindMapCanvas.tsx`, replace the `<Background />` line:

```tsx
        <Background color="var(--border)" />
```

- [ ] **Step 6: Run the affected test suites to confirm no regression**

Run: `npx vitest run src/App.test.tsx src/components/MindMapCanvas.test.tsx`
Expected: PASS (no test asserts on the old hardcoded hex values or on `App.css`)

- [ ] **Step 7: Commit**

```bash
git add -u src/index.css src/App.tsx src/components/MindMapCanvas.tsx
git commit -m "fix(theme): repaint the app shell in dark mode, drop dead App.css"
```

---

## Task 12: `circularReveal.ts`

**Files:**
- Create: `src/theme/circularReveal.ts`
- Test: `src/theme/circularReveal.test.ts`

**Interfaces:**
- Produces: `startCircularThemeTransition({ x, y, apply }: { x: number; y: number; apply: () => void }): void`.

- [ ] **Step 1: Write the failing test**

Create `src/theme/circularReveal.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { startCircularThemeTransition } from './circularReveal'

describe('startCircularThemeTransition', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (document as { startViewTransition?: unknown }).startViewTransition
  })

  it('applies the change directly when the View Transitions API is unavailable', () => {
    const apply = vi.fn()
    startCircularThemeTransition({ x: 10, y: 10, apply })
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('applies the change directly when reduced motion is requested, even if the API is available', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    const startViewTransition = vi.fn()
    ;(document as { startViewTransition?: unknown }).startViewTransition = startViewTransition
    const apply = vi.fn()

    startCircularThemeTransition({ x: 10, y: 10, apply })

    expect(apply).toHaveBeenCalledTimes(1)
    expect(startViewTransition).not.toHaveBeenCalled()
  })

  it('runs apply() inside startViewTransition and animates a circle from the click point to the farthest corner', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('innerHeight', 800)
    const apply = vi.fn()
    const animate = vi.fn()
    document.documentElement.animate = animate
    const startViewTransition = vi.fn((cb: () => void) => {
      cb()
      return { ready: Promise.resolve() }
    })
    ;(document as { startViewTransition?: unknown }).startViewTransition = startViewTransition

    startCircularThemeTransition({ x: 200, y: 100, apply })
    await Promise.resolve()
    await Promise.resolve()

    expect(apply).toHaveBeenCalledTimes(1)
    expect(startViewTransition).toHaveBeenCalledWith(apply)
    const expectedRadius = Math.hypot(Math.max(200, 800), Math.max(100, 700))
    expect(animate).toHaveBeenCalledWith(
      { clipPath: ['circle(0px at 200px 100px)', `circle(${expectedRadius}px at 200px 100px)`] },
      { duration: 500, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' }
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/theme/circularReveal.test.ts`
Expected: FAIL with "Cannot find module './circularReveal'"

- [ ] **Step 3: Implement `circularReveal.ts`**

Create `src/theme/circularReveal.ts`:

```ts
interface CircularThemeTransitionOptions {
  x: number
  y: number
  apply: () => void
}

const TRANSITION_DURATION_MS = 500

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

/**
 * Runs `apply()` (a theme change) inside a circular reveal centered on
 * (x, y) — typically the click that triggered the change. Falls back to
 * calling `apply()` directly, with no animation, when the View Transitions
 * API is unavailable (older WebView, test environment) or the user has
 * requested reduced motion.
 */
export function startCircularThemeTransition({ x, y, apply }: CircularThemeTransitionOptions): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
  if (typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) {
    apply()
    return
  }

  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  const transition = doc.startViewTransition(apply)

  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: TRANSITION_DURATION_MS, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' }
      )
    })
    .catch(() => {
      // The transition was skipped (e.g. the document became hidden) — the
      // theme is already applied via `apply()` above, nothing left to animate.
    })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/theme/circularReveal.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/theme/circularReveal.ts src/theme/circularReveal.test.ts
git commit -m "feat(theme): add the circular reveal transition helper"
```

---

## Task 13: `ThemeToggleButton.tsx`

**Files:**
- Create: `src/components/ThemeToggleButton.tsx`
- Test: `src/components/ThemeToggleButton.test.tsx`

**Interfaces:**
- Consumes: `useResolvedTheme` (Task 5), `useAppearanceSettingsStore` (Task 4), `startCircularThemeTransition` (Task 12).

- [ ] **Step 1: Write the failing test**

Create `src/components/ThemeToggleButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeToggleButton } from './ThemeToggleButton'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'
import { DEFAULT_APPEARANCE_SETTINGS } from '../types/appearanceSettings'
import * as circularReveal from '../theme/circularReveal'

vi.mock('../theme/circularReveal', () => ({
  startCircularThemeTransition: vi.fn(({ apply }: { apply: () => void }) => apply()),
}))

describe('ThemeToggleButton', () => {
  beforeEach(() => {
    useAppearanceSettingsStore.setState(DEFAULT_APPEARANCE_SETTINGS)
    useAppearanceSettingsStore.setState({ themeMode: 'light' })
    vi.mocked(circularReveal.startCircularThemeTransition).mockClear()
  })

  it('shows a "passer au sombre" label in light mode', () => {
    render(<ThemeToggleButton />)
    expect(screen.getByRole('button', { name: 'Passer au thème sombre' })).toBeInTheDocument()
  })

  it('switches to dark on click, via a circular transition centered on the click point', async () => {
    const user = userEvent.setup()
    render(<ThemeToggleButton />)

    await user.click(screen.getByRole('button', { name: 'Passer au thème sombre' }))

    expect(circularReveal.startCircularThemeTransition).toHaveBeenCalledWith(
      expect.objectContaining({ apply: expect.any(Function) })
    )
    expect(useAppearanceSettingsStore.getState().themeMode).toBe('dark')
  })

  it('switches to light when currently dark', async () => {
    useAppearanceSettingsStore.setState({ themeMode: 'dark' })
    const user = userEvent.setup()
    render(<ThemeToggleButton />)

    await user.click(screen.getByRole('button', { name: 'Passer au thème clair' }))

    expect(useAppearanceSettingsStore.getState().themeMode).toBe('light')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/ThemeToggleButton.test.tsx`
Expected: FAIL with "Cannot find module './ThemeToggleButton'"

- [ ] **Step 3: Implement `ThemeToggleButton.tsx`**

Create `src/components/ThemeToggleButton.tsx`:

```tsx
import { Moon, Sun } from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { useResolvedTheme } from '../hooks/useResolvedTheme'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'
import { startCircularThemeTransition } from '../theme/circularReveal'

export function ThemeToggleButton() {
  const resolvedTheme = useResolvedTheme()
  const setThemeMode = useAppearanceSettingsStore(s => s.setThemeMode)
  const label = resolvedTheme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label={label}
            onClick={e => {
              const target = resolvedTheme === 'dark' ? 'light' : 'dark'
              startCircularThemeTransition({
                x: e.clientX,
                y: e.clientY,
                apply: () => {
                  void setThemeMode(target)
                },
              })
            }}
          >
            {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/ThemeToggleButton.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ThemeToggleButton.tsx src/components/ThemeToggleButton.test.tsx
git commit -m "feat(theme): add ThemeToggleButton with a circular reveal transition"
```

---

## Task 14: `OklchSliderGroup.tsx`

**Files:**
- Create: `src/components/appearance/OklchSliderGroup.tsx`
- Test: `src/components/appearance/OklchSliderGroup.test.tsx`

**Interfaces:**
- Consumes: `Oklch` (`src/colors/contrast.ts`), `Slider` (`src/components/ui/slider.tsx`).
- Produces: `OklchSliderGroup({ label, value, onChange }: { label: string; value: Oklch; onChange: (next: Oklch) => void })`.

- [ ] **Step 1: Write the failing test**

Create `src/components/appearance/OklchSliderGroup.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OklchSliderGroup } from './OklchSliderGroup'

describe('OklchSliderGroup', () => {
  const value = { l: 0.5, c: 0.1, h: 200 }

  it('renders a slider for lightness, chroma and hue', () => {
    render(<OklchSliderGroup label="Fond" value={value} onChange={() => {}} />)
    expect(screen.getByRole('slider', { name: 'Fond — luminosité' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Fond — chroma' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Fond — teinte' })).toBeInTheDocument()
  })

  it('reports a lightness change with chroma and hue unchanged', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<OklchSliderGroup label="Fond" value={value} onChange={onChange} />)

    screen.getByRole('slider', { name: 'Fond — luminosité' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(onChange).toHaveBeenCalledWith({ l: 0.51, c: 0.1, h: 200 })
  })

  it('reports a hue change with lightness and chroma unchanged', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<OklchSliderGroup label="Fond" value={value} onChange={onChange} />)

    screen.getByRole('slider', { name: 'Fond — teinte' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(onChange).toHaveBeenCalledWith({ l: 0.5, c: 0.1, h: 201 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/appearance/OklchSliderGroup.test.tsx`
Expected: FAIL with "Cannot find module './OklchSliderGroup'"

- [ ] **Step 3: Implement `OklchSliderGroup.tsx`**

Create `src/components/appearance/OklchSliderGroup.tsx`:

```tsx
import { Slider } from '../ui/slider'
import type { Oklch } from '../../colors/contrast'

interface OklchSliderGroupProps {
  label: string
  value: Oklch
  onChange: (next: Oklch) => void
}

/** Three sliders (lightness, chroma, hue) editing one OKLCH color. */
export function OklchSliderGroup({ label, value, onChange }: OklchSliderGroupProps) {
  return (
    <div style={{ marginBottom: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
          <span style={{ width: 16 }}>L</span>
          <Slider
            aria-label={`${label} — luminosité`}
            min={0}
            max={1}
            step={0.01}
            value={[value.l]}
            onValueChange={([l]) => onChange({ ...value, l })}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
          <span style={{ width: 16 }}>C</span>
          <Slider
            aria-label={`${label} — chroma`}
            min={0}
            max={0.4}
            step={0.01}
            value={[value.c]}
            onValueChange={([c]) => onChange({ ...value, c })}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
          <span style={{ width: 16 }}>H</span>
          <Slider
            aria-label={`${label} — teinte`}
            min={0}
            max={360}
            step={1}
            value={[value.h]}
            onValueChange={([h]) => onChange({ ...value, h })}
          />
        </label>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/appearance/OklchSliderGroup.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/appearance/OklchSliderGroup.tsx src/components/appearance/OklchSliderGroup.test.tsx
git commit -m "feat(appearance): add the OklchSliderGroup primitive"
```

---

## Task 15: `LevelAppearanceEditor.tsx`

**Files:**
- Create: `src/components/appearance/LevelAppearanceEditor.tsx`
- Test: `src/components/appearance/LevelAppearanceEditor.test.tsx`

**Interfaces:**
- Consumes: `useAppearanceSettingsStore` (Task 4), `oklchWcagContrast`/`toCss` (`src/colors/contrast.ts`), `LevelColor` (`src/colors/levelColors.ts`), `OklchSliderGroup` (Task 14).
- Produces: `LevelAppearanceEditor({ level }: { level: CardLevel })`.

- [ ] **Step 1: Write the failing test**

Create `src/components/appearance/LevelAppearanceEditor.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LevelAppearanceEditor } from './LevelAppearanceEditor'
import { useAppearanceSettingsStore } from '../../state/useAppearanceSettingsStore'
import { DEFAULT_APPEARANCE_SETTINGS } from '../../types/appearanceSettings'

describe('LevelAppearanceEditor', () => {
  beforeEach(() => {
    useAppearanceSettingsStore.setState(DEFAULT_APPEARANCE_SETTINGS)
  })

  it('shows the level label in an editable field', () => {
    render(<LevelAppearanceEditor level={1} />)
    expect(screen.getByDisplayValue('Titre')).toBeInTheDocument()
  })

  it('updates the label in the store when edited', async () => {
    const user = userEvent.setup()
    render(<LevelAppearanceEditor level={1} />)

    const input = screen.getByDisplayValue('Titre')
    await user.clear(input)
    await user.type(input, 'Chapitre')

    expect(useAppearanceSettingsStore.getState().levels[1].label).toBe('Chapitre')
  })

  it('shows a contrast warning when a custom color falls below WCAG AA', () => {
    useAppearanceSettingsStore.setState({
      levels: {
        ...DEFAULT_APPEARANCE_SETTINGS.levels,
        1: {
          ...DEFAULT_APPEARANCE_SETTINGS.levels[1],
          color: {
            ...DEFAULT_APPEARANCE_SETTINGS.levels[1].color,
            light: {
              bg: { l: 0.5, c: 0.02, h: 25 },
              border: { l: 0.55, c: 0.18, h: 25 },
              text: { l: 0.52, c: 0.15, h: 25 },
            },
          },
        },
      },
    })
    render(<LevelAppearanceEditor level={1} />)
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Contraste texte/fond insuffisant')
  })

  it('does not show a contrast warning for the default palette', () => {
    render(<LevelAppearanceEditor level={1} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('updates the light background color when its lightness slider moves', async () => {
    const user = userEvent.setup()
    render(<LevelAppearanceEditor level={1} />)

    screen.getByRole('slider', { name: 'Clair — Fond — luminosité' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(useAppearanceSettingsStore.getState().levels[1].color.light.bg.l).toBeCloseTo(0.97)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/appearance/LevelAppearanceEditor.test.tsx`
Expected: FAIL with "Cannot find module './LevelAppearanceEditor'"

- [ ] **Step 3: Implement `LevelAppearanceEditor.tsx`**

Create `src/components/appearance/LevelAppearanceEditor.tsx`:

```tsx
import { oklchWcagContrast, toCss } from '../../colors/contrast'
import type { Oklch } from '../../colors/contrast'
import type { LevelColor } from '../../colors/levelColors'
import type { CardLevel } from '../../types/card'
import { useAppearanceSettingsStore } from '../../state/useAppearanceSettingsStore'
import { OklchSliderGroup } from './OklchSliderGroup'

const THEME_LABELS = { light: 'Clair', dark: 'Sombre' } as const
const PART_LABELS = { bg: 'Fond', border: 'Bordure', text: 'Texte' } as const

interface LevelAppearanceEditorProps {
  level: CardLevel
}

export function LevelAppearanceEditor({ level }: LevelAppearanceEditorProps) {
  const appearance = useAppearanceSettingsStore(s => s.levels[level])
  const setLevelLabel = useAppearanceSettingsStore(s => s.setLevelLabel)
  const setLevelColor = useAppearanceSettingsStore(s => s.setLevelColor)

  return (
    <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
      <legend style={{ fontSize: 12, fontWeight: 700, padding: '0 4px' }}>Niveau {level}</legend>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Libellé</span>
        <input
          type="text"
          value={appearance.label}
          onChange={e => setLevelLabel(level, e.target.value)}
          style={{ width: '100%', padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)' }}
        />
      </label>

      {(['light', 'dark'] as const).map(theme => {
        const color = appearance.color[theme]
        const contrastRatio = oklchWcagContrast(color.bg, color.text)
        return (
          <div key={theme} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div
                aria-hidden
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background: toCss(color.bg),
                  border: `2px solid ${toCss(color.border)}`,
                }}
              />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{THEME_LABELS[theme]}</span>
            </div>

            {(['bg', 'border', 'text'] as const).map(part => (
              <OklchSliderGroup
                key={part}
                label={`${THEME_LABELS[theme]} — ${PART_LABELS[part]}`}
                value={color[part]}
                onChange={(next: Oklch) => {
                  const patch: Partial<LevelColor> = { [part]: next }
                  setLevelColor(level, theme, patch)
                }}
              />
            ))}

            {contrastRatio < 4.5 && (
              <p role="alert" style={{ fontSize: 11, color: 'var(--warning-fg)', margin: '4px 0 0' }}>
                ⚠ Contraste texte/fond insuffisant ({contrastRatio.toFixed(1)}:1, minimum recommandé 4.5:1)
              </p>
            )}
          </div>
        )
      })}
    </fieldset>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/appearance/LevelAppearanceEditor.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/appearance/LevelAppearanceEditor.tsx src/components/appearance/LevelAppearanceEditor.test.tsx
git commit -m "feat(appearance): add LevelAppearanceEditor with a WCAG AA guard"
```

---

## Task 16: `AppearanceSettingsDialog.tsx` + `AppearanceSettingsButton.tsx`

**Files:**
- Create: `src/components/appearance/AppearanceSettingsDialog.tsx`
- Create: `src/components/appearance/AppearanceSettingsButton.tsx`
- Test: `src/components/appearance/AppearanceSettingsDialog.test.tsx`

**Interfaces:**
- Consumes: `useAppearanceSettingsStore` (Task 4), `FONT_OPTIONS`/`ThemeMode` (Task 2), `LevelAppearanceEditor` (Task 15).
- Produces: `AppearanceSettingsDialog({ open, onOpenChange })`, `AppearanceSettingsButton()`.

- [ ] **Step 1: Write the failing test**

Create `src/components/appearance/AppearanceSettingsDialog.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppearanceSettingsDialog } from './AppearanceSettingsDialog'
import { useAppearanceSettingsStore } from '../../state/useAppearanceSettingsStore'
import { DEFAULT_APPEARANCE_SETTINGS } from '../../types/appearanceSettings'

vi.mock('../../persistence/appearanceSettings', () => ({
  loadAppearanceSettings: vi.fn(),
  saveAppearanceSettings: vi.fn().mockResolvedValue(undefined),
}))

describe('AppearanceSettingsDialog', () => {
  beforeEach(() => {
    useAppearanceSettingsStore.setState(DEFAULT_APPEARANCE_SETTINGS)
  })

  it('shows a label editor for all 4 levels', () => {
    render(<AppearanceSettingsDialog open onOpenChange={() => {}} />)
    expect(screen.getByDisplayValue('Titre')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Sous-titre')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Sous-partie')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Info')).toBeInTheDocument()
  })

  it('marks "Système" as the selected theme by default', () => {
    render(<AppearanceSettingsDialog open onOpenChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Système' })).toHaveAttribute('aria-checked', 'true')
  })

  it('switches the theme mode in the store when a theme option is clicked', async () => {
    const user = userEvent.setup()
    render(<AppearanceSettingsDialog open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('radio', { name: 'Sombre' }))

    expect(useAppearanceSettingsStore.getState().themeMode).toBe('dark')
  })

  it('updates the font family in the store when a different font is selected', async () => {
    const user = userEvent.setup()
    render(<AppearanceSettingsDialog open onOpenChange={() => {}} />)

    await user.selectOptions(screen.getByRole('combobox'), 'Georgia, serif')

    expect(useAppearanceSettingsStore.getState().fontFamily).toBe('Georgia, serif')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/appearance/AppearanceSettingsDialog.test.tsx`
Expected: FAIL with "Cannot find module './AppearanceSettingsDialog'"

- [ ] **Step 3: Implement `AppearanceSettingsDialog.tsx`**

Create `src/components/appearance/AppearanceSettingsDialog.tsx`:

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { useAppearanceSettingsStore } from '../../state/useAppearanceSettingsStore'
import { FONT_OPTIONS } from '../../types/appearanceSettings'
import type { ThemeMode } from '../../types/appearanceSettings'
import { LevelAppearanceEditor } from './LevelAppearanceEditor'

const THEME_MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
  { value: 'system', label: 'Système' },
]

interface AppearanceSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AppearanceSettingsDialog({ open, onOpenChange }: AppearanceSettingsDialogProps) {
  const themeMode = useAppearanceSettingsStore(s => s.themeMode)
  const setThemeMode = useAppearanceSettingsStore(s => s.setThemeMode)
  const fontFamily = useAppearanceSettingsStore(s => s.fontFamily)
  const setFontFamily = useAppearanceSettingsStore(s => s.setFontFamily)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apparence</DialogTitle>
        </DialogHeader>

        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
          <legend style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>Thème</legend>
          <div role="radiogroup" aria-label="Thème" style={{ display: 'flex', gap: 8 }}>
            {THEME_MODE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={themeMode === value}
                onClick={() => setThemeMode(value)}
                style={{
                  flex: 1,
                  padding: '8px 4px',
                  borderRadius: 8,
                  border: `2px solid ${themeMode === value ? 'var(--primary)' : 'var(--border)'}`,
                  background: 'var(--background)',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
            Police
          </span>
          <select
            value={fontFamily}
            onChange={e => setFontFamily(e.target.value)}
            style={{ width: '100%', padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)' }}
          >
            {FONT_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
            Niveaux
          </span>
          {([1, 2, 3, 4] as const).map(level => (
            <LevelAppearanceEditor key={level} level={level} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/appearance/AppearanceSettingsDialog.test.tsx`
Expected: PASS

- [ ] **Step 5: Add the button (mirrors `QuizSettingsButton.tsx`, no dedicated test — precedent in this codebase)**

Create `src/components/appearance/AppearanceSettingsButton.tsx`:

```tsx
import { useState } from 'react'
import { Palette } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { AppearanceSettingsDialog } from './AppearanceSettingsDialog'

export function AppearanceSettingsButton() {
  const [open, setOpen] = useState(false)

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Apparence" onClick={() => setOpen(true)}>
            <Palette />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Apparence</TooltipContent>
      </Tooltip>
      <AppearanceSettingsDialog open={open} onOpenChange={setOpen} />
    </TooltipProvider>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/appearance/AppearanceSettingsDialog.tsx src/components/appearance/AppearanceSettingsDialog.test.tsx src/components/appearance/AppearanceSettingsButton.tsx
git commit -m "feat(appearance): add the appearance settings dialog and header button"
```

---

## Task 17: Wire everything into `App.tsx`

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `useAppearanceSettingsStore` (Task 4), `useThemeDomSync`/`useResolvedTheme` (Task 5), `useAppliedFontFamily` (Task 6), `ThemeToggleButton` (Task 13), `AppearanceSettingsButton` (Task 16).

This task is pure wiring — every piece it connects (the store, the two hooks, the two buttons) already has its own passing test suite from Tasks 4-6 and 13-16. There is no new logic here to drive with a red test first; instead, each step below is verified by running `App.test.tsx` once, after all the wiring is in place (Step 5).

- [ ] **Step 1: Mock the new persistence module in `App.test.tsx`**

In `src/App.test.tsx`, add after the existing `vi.mock('./persistence/quizSettings', ...)` block, so the real `@tauri-apps/plugin-fs` module (unmocked in this file) is never reached when `App` mounts and calls `useAppearanceSettingsStore.getState().init()`:

```ts
vi.mock('./persistence/appearanceSettings', async () => {
  const { DEFAULT_APPEARANCE_SETTINGS } = await import('./types/appearanceSettings')
  return {
    loadAppearanceSettings: vi.fn().mockResolvedValue(DEFAULT_APPEARANCE_SETTINGS),
    saveAppearanceSettings: vi.fn().mockResolvedValue(undefined),
  }
})
```

- [ ] **Step 2: Update `App.tsx` imports**

In `src/App.tsx`, add after the existing quiz-related imports:

```ts
import { ThemeToggleButton } from './components/ThemeToggleButton'
import { AppearanceSettingsButton } from './components/appearance/AppearanceSettingsButton'
import { useAppearanceSettingsStore } from './state/useAppearanceSettingsStore'
import { useThemeDomSync } from './hooks/useResolvedTheme'
import { useAppliedFontFamily } from './hooks/useAppliedFontFamily'
```

- [ ] **Step 3: Call the new hooks and extend the init effect**

Replace:

```ts
  useUndoRedoShortcuts()
  useWindowTitle(currentFilePath)
```

with:

```ts
  useUndoRedoShortcuts()
  useWindowTitle(currentFilePath)
  useThemeDomSync()
  useAppliedFontFamily()
```

Replace the init effect:

```ts
  useEffect(() => {
    useQuizSettingsStore.getState().init()
    useAppearanceSettingsStore.getState().init()
  }, [])
```

- [ ] **Step 4: Add the two new buttons to the header**

Replace:

```tsx
          {!quizActive && <LockToggle />}
          {!quizActive && <QuizButton />}
          {!quizActive && <QuizSettingsButton />}
```

with:

```tsx
          {!quizActive && <LockToggle />}
          {!quizActive && <QuizButton />}
          {!quizActive && <QuizSettingsButton />}
          {!quizActive && <AppearanceSettingsButton />}
          {!quizActive && <ThemeToggleButton />}
```

- [ ] **Step 5: Run `App.test.tsx` to verify everything passes**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(app): wire the appearance store, theme sync and new header buttons into App"
```

---

## Task 18: Full regression pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all test files pass (the suite was at 522/522 passing before this plan started — see `docs/superpowers/specs/2026-09-08-lot4-configuration-design.md`'s context; this run should be strictly larger and still green).

- [ ] **Step 2: Run the TypeScript build**

Run: `npm run build`
Expected: `tsc` reports no errors, `vite build` succeeds. This is the first point in the plan where the whole project is type-checked at once — fix any straggler left over from the `levelColor`/`detachedColors` shape change in Task 1 or any of the wiring tasks.

- [ ] **Step 3: Manually verify the dev server (dark mode + circular transition are not exercised by jsdom tests)**

Run: `npm run dev`, open the app in a browser, and check:
- The "Apparence" button opens the settings dialog; editing a level's label/color updates the canvas live.
- The theme toggle button animates a circular reveal between light and dark (Chromium-based WebView2 supports `document.startViewTransition`; if the animation doesn't play, confirm the fallback still switches the theme instantly rather than doing nothing).
- Switching to "Sombre" repaints the sidebar, header, canvas background, and card colors — nothing stays stuck in a light hardcoded color.
- Toggling "Système" while the OS theme preference changes updates the app without a manual refresh.

- [ ] **Step 4: Fix any regression found in Steps 1-3, then commit**

If any fix is needed, make it, re-run the relevant command from Steps 1-2, and commit:

```bash
git add -u
git commit -m "fix: address regressions found in the lot 4 full regression pass"
```

If no fix was needed, no commit is required for this task.
