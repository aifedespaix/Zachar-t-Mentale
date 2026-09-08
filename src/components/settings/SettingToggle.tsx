import { Switch } from '../ui/switch'

interface SettingToggleProps {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/**
 * A labelled on/off row. The whole row is the hit target (it is a `<label>`),
 * which is the behaviour people expect from a settings list — clicking the
 * explanation toggles the switch instead of doing nothing.
 */
export function SettingToggle({ label, description, checked, onCheckedChange }: SettingToggleProps) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '12px 14px',
        borderRadius: 10,
        border: '1px solid var(--border)',
        marginBottom: 8,
        cursor: 'pointer',
      }}
    >
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{label}</span>
        {description && (
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted-foreground)', marginTop: 2, lineHeight: 1.45 }}>
            {description}
          </span>
        )}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}
