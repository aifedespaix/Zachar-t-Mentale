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
    // Orange — Sous-titre. Hue pushed from 55° to 70° and chroma raised so it
    // reads apart from both rouge and jaune at a glance (they used to sit
    // within 40° of each other).
    bg: { l: 0.96, c: 0.03, h: 70 },
    border: { l: 0.6, c: 0.19, h: 70 },
    text: { l: 0.34, c: 0.16, h: 70 },
  },
  3: {
    // Bleu — Sous-partie
    bg: { l: 0.96, c: 0.03, h: 235 },
    border: { l: 0.55, c: 0.14, h: 235 },
    text: { l: 0.32, c: 0.13, h: 235 },
  },
  4: {
    // Jaune — Info. Hue pushed from 95° to 105° and chroma raised, same
    // reason as orange above.
    bg: { l: 0.96, c: 0.03, h: 105 },
    border: { l: 0.62, c: 0.17, h: 105 },
    text: { l: 0.3, c: 0.15, h: 105 },
  },
}

/**
 * Floating ("volante") cards: deliberately achromatic, so a detached card reads
 * as OUT of the four-level hierarchy at a glance rather than as a fifth level.
 * Kept above the WCAG AA text/background ratio like every level palette.
 */
export const detachedColors: LevelColor = {
  bg: { l: 0.95, c: 0, h: 0 },
  border: { l: 0.72, c: 0, h: 0 },
  text: { l: 0.42, c: 0, h: 0 },
}
