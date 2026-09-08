import type { CardLevel } from '../../types/card'
import type { AppearanceSettings, LevelAppearance } from '../../types/appearanceSettings'
import { LevelAppearanceEditor } from '../appearance/LevelAppearanceEditor'
import { SettingsSection } from './SettingsSection'

interface AppearanceSettingsPanelProps {
  settings: AppearanceSettings
  onChange: (next: AppearanceSettings) => void
}

/** Per-level names and colours — what a card of each depth looks like. */
export function AppearanceSettingsPanel({ settings, onChange }: AppearanceSettingsPanelProps) {
  function updateLevel(level: CardLevel, next: LevelAppearance) {
    onChange({ ...settings, levels: { ...settings.levels, [level]: next } })
  }

  return (
    <SettingsSection
      title="Niveaux de carte"
      description="Chaque niveau a son nom et ses couleurs, en thème clair et en thème sombre. Les changements s'affichent tout de suite sur la carte, derrière la fenêtre."
    >
      {([1, 2, 3, 4] as const).map(level => (
        <LevelAppearanceEditor
          key={level}
          level={level}
          appearance={settings.levels[level]}
          onChange={next => updateLevel(level, next)}
        />
      ))}
    </SettingsSection>
  )
}
