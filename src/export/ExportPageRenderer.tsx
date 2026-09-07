import { computeLayout, COLUMN_WIDTH, ROW_HEIGHT } from '../layout/columns'
import { StaticCardView, EXPORT_CARD_WIDTH } from './StaticCardView'
import type { ExportPage } from './pagination'

export interface PageBounds {
  width: number
  height: number
}

export function computePageBounds(page: ExportPage): PageBounds {
  const positions = computeLayout(page.cards)
  const xs = page.cards.map(c => positions[c.id].x)
  const ys = page.cards.map(c => positions[c.id].y)
  return {
    width: (xs.length > 0 ? Math.max(...xs) : 0) + COLUMN_WIDTH,
    height: (ys.length > 0 ? Math.max(...ys) : 0) + ROW_HEIGHT,
  }
}

export interface ExportPageRendererProps {
  page: ExportPage
  showDefinitions: boolean
}

/**
 * A page's mini mind map, absolutely positioned by the same `computeLayout`
 * the live canvas uses (`position` is a top-left coordinate, exactly as
 * `MindMapCanvas` feeds it straight into a React Flow node) — so an export
 * page reads exactly like a slice of the real canvas, never a bespoke print
 * layout that could drift from it.
 */
export function ExportPageRenderer({ page, showDefinitions }: ExportPageRendererProps) {
  const positions = computeLayout(page.cards)
  const bounds = computePageBounds(page)
  return (
    <div style={{ position: 'relative', width: bounds.width, height: bounds.height }}>
      {page.cards.map(card => {
        const pos = positions[card.id]
        return (
          <div key={card.id} style={{ position: 'absolute', left: pos.x, top: pos.y, width: EXPORT_CARD_WIDTH }}>
            <StaticCardView card={card} showDefinition={showDefinitions} />
          </div>
        )
      })}
    </div>
  )
}
