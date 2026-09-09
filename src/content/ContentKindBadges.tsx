import { Sigma, Image as ImageIcon, Table2 } from 'lucide-react'
import type { CardBlock } from '../types/cardBlock'
import { nonTextKinds } from './blocks'

/** Exported so the fiche corner badge (`CardNode.tsx`) can reuse the exact same icon per content kind, rather than maintaining a second mapping that could drift from this one. */
export const CONTENT_KIND_ICONS = {
  math: { icon: Sigma, label: 'Contient une formule' },
  image: { icon: ImageIcon, label: 'Contient une image' },
  table: { icon: Table2, label: 'Contient un tableau' },
} as const

const BADGES = CONTENT_KIND_ICONS

export interface ContentKindBadgesProps {
  blocks: CardBlock[]
  size?: number
}

/**
 * What a definition holds, without showing it.
 *
 * This is the compromise that lets the card's description button be
 * informative while its footprint stays fixed (règle anti-décalage 1: the
 * card's size never depends on what its definition contains). A two-line
 * excerpt would tell you more and would make two neighbouring cards different
 * heights, which moves the whole tree on every edit. A row of badges of fixed
 * height tells you there is a formula and a picture in there — which is what
 * makes the button worth clicking — and costs nothing.
 */
export function ContentKindBadges({ blocks, size = 11 }: ContentKindBadgesProps) {
  const kinds = nonTextKinds(blocks)
  if (kinds.length === 0) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, opacity: 0.65 }}>
      {kinds.map(kind => {
        const { icon: Icon, label } = BADGES[kind]
        return <Icon key={kind} size={size} aria-label={label} />
      })}
    </span>
  )
}
