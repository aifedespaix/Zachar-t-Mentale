import { Slider } from '../ui/slider'
import type { Oklch } from '../../colors/contrast'

interface OklchSliderGroupProps {
  label: string
  value: Oklch
  onChange: (next: Oklch) => void
}

/** Three sliders (lightness, chroma, hue) editing one OKLCH color. */
export function OklchSliderGroup({ label, value, onChange }: OklchSliderGroupProps) {
  return (
    <div style={{ marginBottom: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
          <span style={{ width: 16 }}>L</span>
          <Slider
            aria-label={`${label} — luminosité`}
            min={0}
            max={1}
            step={0.01}
            value={[value.l]}
            onValueChange={([l]) => onChange({ ...value, l })}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
          <span style={{ width: 16 }}>C</span>
          <Slider
            aria-label={`${label} — chroma`}
            min={0}
            max={0.4}
            step={0.01}
            value={[value.c]}
            onValueChange={([c]) => onChange({ ...value, c })}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
          <span style={{ width: 16 }}>H</span>
          <Slider
            aria-label={`${label} — teinte`}
            min={0}
            max={360}
            step={1}
            value={[value.h]}
            onValueChange={([h]) => onChange({ ...value, h })}
          />
        </label>
      </div>
    </div>
  )
}
