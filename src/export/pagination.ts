import type { Card } from '../types/card'

/**
 * How many leaf rows comfortably fit one A4 landscape page at a legible
 * print scale. A4 landscape usable height (297mm minus 2×15mm margins) is
 * ~267mm; at a print size that keeps cards readable on paper (roughly
 * matching the on-screen 168px `ROW_HEIGHT` scaled down for print), that is
 * about 6 rows.
 */
export const PAGE_ROW_BUDGET = 6

export interface ExportPage {
  cards: Card[]
}

function childrenOf(cards: Card[], parentId: string): Card[] {
  return cards.filter(c => c.parentId === parentId && !c.detached).sort((a, b) => a.order - b.order)
}

function leafCount(cards: Card[], cardId: string): number {
  const kids = childrenOf(cards, cardId)
  if (kids.length === 0) return 1
  return kids.reduce((sum, kid) => sum + leafCount(cards, kid.id), 0)
}

function subtreeIds(cards: Card[], cardId: string): string[] {
  const ids = [cardId]
  for (const kid of childrenOf(cards, cardId)) ids.push(...subtreeIds(cards, kid.id))
  return ids
}

/**
 * Ids of `nodeId` and everything under it that belongs on the same page,
 * grouped into as many pages as needed to keep every page within `budget`
 * leaf rows. `nodeId` heads every group this returns, so a caller one level
 * up can prepend ITS own id to each and build a full root-to-leaf chain by
 * induction.
 */
function splitSubtree(cards: Card[], nodeId: string, budget: number): string[][] {
  const kids = childrenOf(cards, nodeId)
  if (kids.length === 0) return [[nodeId]]
  if (leafCount(cards, nodeId) <= budget) {
    return [[nodeId, ...subtreeIds(cards, nodeId).slice(1)]]
  }

  // Greedily pack whole child subtrees into shared pages; a child that alone
  // exceeds the budget is recursively split into its own page group instead
  // of pulling every other child down into single-item pages with it.
  const pages: string[][] = []
  let batchIds: string[] = []
  let batchLeaves = 0
  const flushBatch = () => {
    if (batchIds.length > 0) {
      pages.push([nodeId, ...batchIds])
      batchIds = []
      batchLeaves = 0
    }
  }
  for (const kid of kids) {
    const kidLeaves = leafCount(cards, kid.id)
    if (kidLeaves > budget) {
      flushBatch()
      for (const group of splitSubtree(cards, kid.id, budget)) pages.push([nodeId, ...group])
      continue
    }
    if (batchLeaves + kidLeaves > budget) flushBatch()
    batchIds.push(...subtreeIds(cards, kid.id))
    batchLeaves += kidLeaves
  }
  flushBatch()
  return pages
}

/**
 * Splits a mind map into print-ready pages: each page's `cards` form a
 * valid root-rooted (sub)tree, safe to hand straight to `computeLayout` —
 * small enough to read on one A4 landscape page. A branch too big for one
 * page is recursively split (by sub-branch, then by leaf batch), always
 * repeating the path from the true root down to that page's content.
 */
export function paginateForExport(
  cards: Card[],
  options: { includeDetached: boolean },
  rowBudget: number = PAGE_ROW_BUDGET
): ExportPage[] {
  const root = cards.find(c => c.parentId === null && !c.detached)
  const byId = new Map(cards.map(c => [c.id, c]))
  const pages: ExportPage[] = root
    ? splitSubtree(cards, root.id, rowBudget).map(ids => ({ cards: ids.map(id => byId.get(id)!) }))
    : []

  if (options.includeDetached) {
    const detached = cards.filter(c => c.detached).sort((a, b) => a.order - b.order)
    if (detached.length > 0) pages.push({ cards: detached })
  }
  return pages
}
