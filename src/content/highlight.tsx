import type { ReactNode } from 'react'

/**
 * The app's own lightweight markup for a definition's key terms:
 * `**mot-clé**`. Never shown as literal asterisks — either stripped
 * (`stripHighlightMarkers`, used everywhere the quiz shows this text, so no
 * option is visually richer than another because of markup rather than
 * content) or rendered as a coloured `<mark>` (`renderHighlighted`, used only
 * by the reading panel). Non-greedy and non-nesting: the first `**` opens,
 * the next one closes.
 */
const HIGHLIGHT_PATTERN = /\*\*(.+?)\*\*/g

export function stripHighlightMarkers(text: string): string {
  return text.replace(HIGHLIGHT_PATTERN, '$1')
}

export function renderHighlighted(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  const pattern = new RegExp(HIGHLIGHT_PATTERN)
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    nodes.push(
      <mark
        key={key++}
        style={{ background: 'transparent', color: 'oklch(0.55 0.18 40)', fontWeight: 600 }}
      >
        {match[1]}
      </mark>
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}
