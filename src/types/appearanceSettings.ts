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
  color?: {
    light?: Partial<LevelColor>
    dark?: Partial<LevelColor>
  }
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
