import { oklchWcagContrast, toCss } from '../../colors/contrast'
import type { Oklch } from '../../colors/contrast'
import type { CardLevel } from '../../types/card'
import type { LevelAppearance } from '../../types/appearanceSettings'
import { OklchSliderGroup } from './OklchSliderGroup'

const THEME_LABELS = { light: 'Clair', dark: 'Sombre' } as const
const PART_LABELS = { bg: 'Fond', border: 'Bordure', text: 'Texte' } as const

interface LevelAppearanceEditorProps {
  level: CardLevel
  appearance: LevelAppearance
  onChange: (next: LevelAppearance) => void
}

/**
 * Controlled: the level's appearance and the callback come from the settings
 * dialog, which holds the whole draft, rather than being read and written
 * straight through to the store.
 *
 * That is what makes "Annuler" possible. An editor that wrote to the store on
 * every slider tick would have persisted each intermediate colour to disk, and
 * there would be nothing left to revert TO — the dialog snapshots the settings
 * once, on open, and every edit here is a preview until "Enregistrer".
 */
export function LevelAppearanceEditor({ level, appearance, onChange }: LevelAppearanceEditorProps) {
  return (
    <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
      <legend style={{ fontSize: 12, fontWeight: 700, padding: '0 4px' }}>Niveau {level}</legend>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Libellé</span>
        <input
          type="text"
          value={appearance.label}
          onChange={e => onChange({ ...appearance, label: e.target.value })}
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
                onChange={(next: Oklch) =>
                  onChange({
                    ...appearance,
                    color: { ...appearance.color, [theme]: { ...color, [part]: next } },
                  })
                }
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
