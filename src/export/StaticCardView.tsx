import type { Card } from '../types/card'
import { clampCardLevel, detachedColors } from '../colors/levelColors'
import { toCss } from '../colors/contrast'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'
import { contentOf } from '../content/blocks'
import { BlockView } from '../content/BlockView'
import { ROW_HEIGHT } from '../layout/columns'

export const EXPORT_CARD_WIDTH = 260
export const EXPORT_CARD_HEIGHT = 120

/**
 * The hard ceiling on an export card, and the reason the export needs no
 * height-aware pagination.
 *
 * `computeLayout` places rows on a fixed `ROW_HEIGHT` grid and measures
 * nothing, so a card that grows past that pitch silently covers the one below
 * it. Rich content — a tall picture, a long table — makes that easy. Capping
 * here means overlap is impossible AND the existing leaf-count page budget
 * stays correct, so `computeLayout` and `paginateForExport` are untouched.
 *
 * The cost is that very tall content is clipped on the overview export. That
 * is the right trade for a map meant to be read at a glance; full-size content
 * belongs to the separate « fiche de révision » format, which deliberately
 * lets cards grow.
 */
export const EXPORT_CARD_MAX_HEIGHT = ROW_HEIGHT - 16

export interface StaticCardViewProps {
  card: Card
  showDefinition: boolean
  /**
   * How an image block's asset name becomes a `src`.
   *
   * The default reports "not available", which renders a named placeholder.
   * The capture pipeline must pass a resolver backed by data URIs: an image on
   * another origin makes `html-to-image` reject the WHOLE page capture, so an
   * unresolved asset has to degrade visibly rather than be attempted.
   */
  resolveAsset?: (asset: string) => string
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
export function StaticCardView({ card, showDefinition, resolveAsset = () => '' }: StaticCardViewProps) {
  const levelAppearance = useAppearanceSettingsStore(s => s.levels)
  const colors = card.detached ? detachedColors.light : levelAppearance[clampCardLevel(card.level)].color.light
  return (
    <div
      data-testid={`export-card-${card.id}`}
      style={{
        width: EXPORT_CARD_WIDTH,
        minHeight: EXPORT_CARD_HEIGHT,
        maxHeight: EXPORT_CARD_MAX_HEIGHT,
        overflow: 'hidden',
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
      {/* The same renderer the popover uses, so the PDF cannot drift from the
          screen — only the asset resolution differs between the two. */}
      {showDefinition && (
        <div style={{ fontSize: 12, minWidth: 0 }}>
          <BlockView blocks={contentOf(card)} resolveAsset={resolveAsset} />
        </div>
      )}
    </div>
  )
}
