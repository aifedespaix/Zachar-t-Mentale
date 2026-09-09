import { Sun, Moon, Monitor, type LucideIcon } from 'lucide-react'
import type { AppearanceSettings, ThemeMode } from '../../types/appearanceSettings'
import { FONT_OPTIONS } from '../../types/appearanceSettings'
import type { UpdateCheckStatus } from '../../hooks/useAppUpdater'
import { SettingsSection } from './SettingsSection'
import { Button } from '../ui/button'

const UPDATE_STATUS_LABEL: Partial<Record<UpdateCheckStatus, string>> = {
  checking: 'Vérification en cours…',
  'up-to-date': 'À jour',
  error: 'Échec de la vérification',
}

const THEME_MODE_OPTIONS: { value: ThemeMode; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Clair', icon: Sun },
  { value: 'dark', label: 'Sombre', icon: Moon },
  { value: 'system', label: 'Système', icon: Monitor },
]

interface GeneralSettingsPanelProps {
  settings: AppearanceSettings
  onChange: (next: AppearanceSettings) => void
  updateCheck: { status: UpdateCheckStatus; checkNow: () => Promise<void> }
}

/** App-wide choices: the ones that change how everything looks, not just cards. */
export function GeneralSettingsPanel({ settings, onChange, updateCheck }: GeneralSettingsPanelProps) {
  return (
    <div>
      <SettingsSection title="Thème" description="« Système » suit le réglage clair/sombre de ton ordinateur.">
        <div role="radiogroup" aria-label="Thème" style={{ display: 'flex', gap: 10 }}>
          {THEME_MODE_OPTIONS.map(({ value, label, icon: Icon }) => {
            const selected = settings.themeMode === value
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ ...settings, themeMode: value })}
                style={{
                  flex: 1,
                  padding: '14px 8px',
                  borderRadius: 12,
                  border: `2px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
                  background: selected ? 'color-mix(in oklch, var(--primary), transparent 92%)' : 'var(--background)',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: 12.5,
                  fontWeight: 600,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  transition: 'border-color 0.15s ease, background 0.15s ease',
                }}
              >
                <Icon size={20} aria-hidden />
                {label}
              </button>
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Police" description="Change la police de toute l'application, cartes comprises.">
        <label>
          <span className="sr-only">Police</span>
          <select
            aria-label="Police"
            value={settings.fontFamily}
            onChange={e => onChange({ ...settings, fontFamily: e.target.value })}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--background)',
              color: 'inherit',
              fontSize: 13,
            }}
          >
            {FONT_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {/* Rendered in the font being chosen: the point of a font picker is
            seeing the font, and the preview updates live because the draft is
            applied to the app as you edit. */}
        <p
          style={{
            fontFamily: settings.fontFamily,
            fontSize: 15,
            margin: '12px 0 0',
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px dashed var(--border)',
            color: 'var(--muted-foreground)',
          }}
        >
          Portez ce vieux whisky au juge blond qui fume — 0123456789
        </p>
      </SettingsSection>

      <SettingsSection title="Mises à jour" description="Vérifie manuellement si une nouvelle version est disponible.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button
            variant="outline"
            onClick={() => {
              void updateCheck.checkNow()
            }}
            disabled={updateCheck.status === 'checking'}
          >
            Rechercher les mises à jour
          </Button>
          {UPDATE_STATUS_LABEL[updateCheck.status] && (
            <span style={{ fontSize: 12.5, color: 'var(--muted-foreground)' }}>
              {UPDATE_STATUS_LABEL[updateCheck.status]}
            </span>
          )}
        </div>
      </SettingsSection>
    </div>
  )
}
