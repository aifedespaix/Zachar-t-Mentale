import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { useAppearanceSettingsStore } from '../../state/useAppearanceSettingsStore'
import { FONT_OPTIONS } from '../../types/appearanceSettings'
import type { ThemeMode } from '../../types/appearanceSettings'
import { LevelAppearanceEditor } from './LevelAppearanceEditor'

const THEME_MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
  { value: 'system', label: 'Système' },
]

interface AppearanceSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AppearanceSettingsDialog({ open, onOpenChange }: AppearanceSettingsDialogProps) {
  const themeMode = useAppearanceSettingsStore(s => s.themeMode)
  const setThemeMode = useAppearanceSettingsStore(s => s.setThemeMode)
  const fontFamily = useAppearanceSettingsStore(s => s.fontFamily)
  const setFontFamily = useAppearanceSettingsStore(s => s.setFontFamily)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apparence</DialogTitle>
        </DialogHeader>

        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
          <legend style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>Thème</legend>
          <div role="radiogroup" aria-label="Thème" style={{ display: 'flex', gap: 8 }}>
            {THEME_MODE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={themeMode === value}
                onClick={() => setThemeMode(value)}
                style={{
                  flex: 1,
                  padding: '8px 4px',
                  borderRadius: 8,
                  border: `2px solid ${themeMode === value ? 'var(--primary)' : 'var(--border)'}`,
                  background: 'var(--background)',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
            Police
          </span>
          <select
            value={fontFamily}
            onChange={e => setFontFamily(e.target.value)}
            style={{ width: '100%', padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)' }}
          >
            {FONT_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
            Niveaux
          </span>
          {([1, 2, 3, 4] as const).map(level => (
            <LevelAppearanceEditor key={level} level={level} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
