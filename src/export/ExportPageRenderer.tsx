import { computeLayout, COLUMN_WIDTH, ROW_HEIGHT } from '../layout/columns'
import { StaticCardView, EXPORT_CARD_WIDTH, EXPORT_CARD_HEIGHT } from './StaticCardView'
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
      <svg
        style={{ position: 'absolute', left: 0, top: 0, width: bounds.width, height: bounds.height, pointerEvents: 'none' }}
      >
        {page.cards.map(card => {
          if (card.parentId === null) return null
          const parentPos = positions[card.parentId]
          const childPos = positions[card.id]
          if (!parentPos || !childPos) return null
          const x1 = parentPos.x + EXPORT_CARD_WIDTH
          const y1 = parentPos.y + EXPORT_CARD_HEIGHT / 2
          const x2 = childPos.x
          const y2 = childPos.y + EXPORT_CARD_HEIGHT / 2
          return <line key={card.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#94a3b8" strokeWidth={1.5} />
        })}
      </svg>
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
