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
    // Orange — Sous-titre. Hue 57° is a true orange (`darkorange`), where the
    // old 70° sat on the amber edge; chroma is raised so it reads as orange
    // beside both the rouge of level 1 and the jaune of level 4.
    light: {
      bg: { l: 0.95, c: 0.05, h: 57 },
      border: { l: 0.63, c: 0.2, h: 57 },
      text: { l: 0.35, c: 0.17, h: 57 },
    },
    dark: {
      bg: { l: 0.23, c: 0.05, h: 57 },
      border: { l: 0.7, c: 0.19, h: 57 },
      text: { l: 0.88, c: 0.07, h: 57 },
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
    // Jaune — Info. Hue 98° and a saturated background carry the yellow.
    //
    // The LIGHT border stays gold (~l 0.63) rather than bright: the mnemonic
    // icon is drawn in the border colour on a near-white badge wash, and a
    // brighter yellow there drops below the 3:1 non-text contrast (guarded by
    // iconBadge.test.ts). The DARK border is free to be bright (l 0.78), since
    // its badge fill is dark.
    light: {
      bg: { l: 0.95, c: 0.08, h: 98 },
      border: { l: 0.63, c: 0.2, h: 98 },
      text: { l: 0.34, c: 0.14, h: 98 },
    },
    dark: {
      bg: { l: 0.25, c: 0.06, h: 98 },
      border: { l: 0.78, c: 0.18, h: 98 },
      text: { l: 0.9, c: 0.09, h: 98 },
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
 * Clamps a possibly-corrupt level to a real 1..4 `CardLevel` — the same rule
 * `levelColor` applies internally, exported for callers that index
 * `levels`/`useAppearanceSettingsStore` directly rather than going through
 * `levelColor`.
 */
export function clampCardLevel(level: number): CardLevel {
  return Math.min(Math.max(Math.round(level) || 1, 1), 4) as CardLevel
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
