import type { Card } from '../types/card'
import { clampCardLevel, detachedColors } from '../colors/levelColors'
import { toCss } from '../colors/contrast'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'

export const EXPORT_CARD_WIDTH = 260
export const EXPORT_CARD_HEIGHT = 120

export interface StaticCardViewProps {
  card: Card
  showDefinition: boolean
}

/**
 * Read-only visual of a card for export capture: same palette as `CardNode`,
 * none of its interactivity (no inputs, no structural buttons, no drag
 * handle) — a screenshot never needs to be editable.
 *
 * Always renders the LIGHT palette regardless of the app's live theme: a
 * PDF/image is meant to be printed or shared, where a dark background would
 * waste ink/toner and a shared screenshot should look the same to every
 * recipient, whatever their system theme.
 */
export function StaticCardView({ card, showDefinition }: StaticCardViewProps) {
  const levelAppearance = useAppearanceSettingsStore(s => s.levels)
  const colors = card.detached ? detachedColors.light : levelAppearance[clampCardLevel(card.level)].color.light
  return (
    <div
      data-testid={`export-card-${card.id}`}
      style={{
        width: EXPORT_CARD_WIDTH,
        minHeight: EXPORT_CARD_HEIGHT,
        boxSizing: 'border-box',
        background: toCss(colors.bg),
        color: toCss(colors.text),
        border: card.detached ? '2px dashed' : '2px solid',
        borderColor: toCss(colors.border),
        borderRadius: 8,
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
      }}
    >
      <strong style={{ fontSize: 14 }}>{card.title}</strong>
      {showDefinition && card.definition && <p style={{ margin: 0, fontSize: 12 }}>{card.definition}</p>}
    </div>
  )
}
