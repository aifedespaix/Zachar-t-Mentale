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
