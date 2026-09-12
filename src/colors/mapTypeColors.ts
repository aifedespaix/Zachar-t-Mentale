import type { Oklch } from './contrast'
import type { MapType } from '../types/mapType'

export interface MapTypeColor {
  bg: Oklch
  border: Oklch
  text: Oklch
}

export interface MapTypeColorPair {
  light: MapTypeColor
  dark: MapTypeColor
}

/**
 * Une couleur par type, sur le modèle exact de `levelColors` : fond très
 * désaturé, bordure et texte dans le hue du type. `prise de notes` est
 * volontairement achromatique — c'est le brouillon, il ne doit pas concurrencer
 * les trois autres au premier coup d'œil.
 */
export const mapTypeColors: Record<Exclude<MapType, 'default'>, MapTypeColorPair> = {
  cours: {
    // Bleu — la référence
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
  exo: {
    // Vert — l'entraînement
    light: {
      bg: { l: 0.96, c: 0.03, h: 150 },
      border: { l: 0.55, c: 0.14, h: 150 },
      text: { l: 0.32, c: 0.13, h: 150 },
    },
    dark: {
      bg: { l: 0.22, c: 0.035, h: 150 },
      border: { l: 0.62, c: 0.13, h: 150 },
      text: { l: 0.88, c: 0.05, h: 150 },
    },
  },
  'prise de notes': {
    // Achromatique — le brouillon
    light: {
      bg: { l: 0.96, c: 0, h: 0 },
      border: { l: 0.62, c: 0, h: 0 },
      text: { l: 0.38, c: 0, h: 0 },
    },
    dark: {
      bg: { l: 0.22, c: 0, h: 0 },
      border: { l: 0.6, c: 0, h: 0 },
      text: { l: 0.88, c: 0, h: 0 },
    },
  },
  corrections: {
    // Rouge-orangé — ce qui demande l'attention
    light: {
      bg: { l: 0.96, c: 0.03, h: 30 },
      border: { l: 0.55, c: 0.18, h: 30 },
      text: { l: 0.32, c: 0.15, h: 30 },
    },
    dark: {
      bg: { l: 0.22, c: 0.035, h: 30 },
      border: { l: 0.62, c: 0.16, h: 30 },
      text: { l: 0.88, c: 0.05, h: 30 },
    },
  },
}

/**
 * La pilule d'une valeur que l'app ne connaît pas : neutre, achromatique, mais
 * lisible. Elle dit « ce fichier est classé, je ne sais juste pas en quoi ».
 */
export const neutralMapTypeColors: MapTypeColorPair = {
  light: {
    bg: { l: 0.95, c: 0, h: 0 },
    border: { l: 0.7, c: 0, h: 0 },
    text: { l: 0.4, c: 0, h: 0 },
  },
  dark: {
    bg: { l: 0.24, c: 0, h: 0 },
    border: { l: 0.55, c: 0, h: 0 },
    text: { l: 0.85, c: 0, h: 0 },
  },
}

/**
 * `null` quand il n'y a rien à rendre : `default`, une chaîne vide, `undefined`.
 * Toute autre valeur est traitée comme « classé, mais inconnu de l'app » et
 * reçoit la pilule neutre. La fonction est TOTALE : l'appartenance se teste sur
 * les propriétés PROPRES, car `mapTypeColors['constructor']` ou
 * `mapTypeColors['toString']` renvoie un membre hérité de `Object.prototype` —
 * non `undefined` — et rendrait `undefined` au lieu de la pilule neutre. Ce
 * chemin est emprunté pendant le rendu et un `undefined` y jette, ce qui
 * démonte toute l'application — la même garde que `levelColors.ts`.
 */
export function mapTypeColor(type: string | undefined, theme: 'light' | 'dark'): MapTypeColor | null {
  if (type === undefined || type === '' || type === 'default') return null
  if (!Object.prototype.hasOwnProperty.call(mapTypeColors, type)) return neutralMapTypeColors[theme]
  return mapTypeColors[type as Exclude<MapType, 'default'>][theme]
}
