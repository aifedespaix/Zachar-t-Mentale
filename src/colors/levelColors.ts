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
    // Orange — Sous-titre
    bg: { l: 0.96, c: 0.03, h: 55 },
    border: { l: 0.6, c: 0.16, h: 55 },
    text: { l: 0.34, c: 0.14, h: 55 },
  },
  3: {
    // Bleu — Sous-partie
    bg: { l: 0.96, c: 0.03, h: 235 },
    border: { l: 0.55, c: 0.14, h: 235 },
    text: { l: 0.32, c: 0.13, h: 235 },
  },
  4: {
    // Jaune — Info
    bg: { l: 0.96, c: 0.03, h: 95 },
    border: { l: 0.62, c: 0.14, h: 95 },
    text: { l: 0.3, c: 0.12, h: 95 },
  },
}
