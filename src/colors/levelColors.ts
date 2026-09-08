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
