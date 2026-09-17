import { RotateCcw } from 'lucide-react'
import type { CardLevel } from '../../types/card'
import type { AppearanceSettings, LevelAppearance } from '../../types/appearanceSettings'
import { defaultLevelAppearances } from '../../types/appearanceSettings'
import { LevelAppearanceEditor } from '../appearance/LevelAppearanceEditor'
import { SettingsSection } from './SettingsSection'
import { Button } from '../ui/button'

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
      {/*
        Resets the four levels only — the theme and the font live on the «
        Général » tab, and silently changing choices made there from a button
        that sits under the level editors would be a surprise. Like every other
        edit in this dialog, it changes the draft, so « Annuler » still undoes
        it and nothing reaches disk before « Enregistrer ».
      */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <Button
          variant="outline"
          onClick={() => onChange({ ...settings, levels: defaultLevelAppearances() })}
          title="Remettre les quatre niveaux à leurs noms et couleurs d'origine"
        >
          <RotateCcw size={14} /> Réinitialiser les niveaux
        </Button>
      </div>
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
