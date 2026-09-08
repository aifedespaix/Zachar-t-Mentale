import type { ReactNode } from 'react'

interface SettingsSectionProps {
  title: string
  /** One line saying what this group of controls is for, in plain language. */
  description?: string
  children: ReactNode
}

/**
 * One labelled group inside a settings panel. Every section looks the same —
 * heading, optional explanation, controls — so a panel reads as a list of
 * decisions rather than a wall of inputs.
 */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h3
        style={{
          fontSize: 12,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--muted-foreground)',
          margin: '0 0 4px',
        }}
      >
        {title}
      </h3>
      {description && (
        <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: '0 0 12px', lineHeight: 1.5 }}>
          {description}
        </p>
      )}
      {children}
    </section>
  )
}
