import { ALL_CARD_LEVELS, type Card, type CardLevel } from '../types/card'
import type { FileTreeNode } from '../types/workspace'

/**
 * « 1,2 Mo » — a file size a human reads at a glance.
 *
 * Binary units (1 Ko = 1024 o), because that is what every file manager on the
 * platforms this app ships to shows beside the same file. Returns « — » for a
 * size the filesystem did not give, rather than inventing « 0 o ».
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} o`
  const units = ['Ko', 'Mo', 'Go', 'To']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${(value < 10 ? value.toFixed(1) : Math.round(value)).toString().replace('.', ',')} ${units[unit]}`
}

/**
 * An absolute timestamp in the reader's locale, or `null` for « no date » —
 * the same contract as `formatRelativeTime`, so a caller chooses its own
 * fallback sentence.
 */
export function formatDateTime(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(date)
}

/** How many cards a map holds, in total and per level. */
export interface CardTally {
  total: number
  byLevel: Record<CardLevel, number>
}

export function tallyCards(cards: readonly Card[]): CardTally {
  const byLevel = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<CardLevel, number>
  for (const card of cards) {
    if (ALL_CARD_LEVELS.includes(card.level)) byLevel[card.level] += 1
  }
  return { total: cards.length, byLevel }
}

/** What a folder holds, counted by kind. */
export interface TreeTally {
  folders: number
  mindmaps: number
  others: number
  total: number
}

export function tallyTree(node: FileTreeNode): TreeTally {
  const tally: TreeTally = { folders: 0, mindmaps: 0, others: 0, total: 0 }
  const visit = (current: FileTreeNode) => {
    for (const child of current.type === 'folder' ? current.children : []) {
      tally.total += 1
      if (child.type === 'folder') tally.folders += 1
      else if (child.type === 'mindmap') tally.mindmaps += 1
      else tally.others += 1
      visit(child)
    }
  }
  visit(node)
  return tally
}
