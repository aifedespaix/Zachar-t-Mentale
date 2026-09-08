import type { CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { Oklch } from '../colors/contrast'
import { toCss } from '../colors/contrast'
import { iconBadgeFill } from '../colors/iconBadge'
import { iconComponent } from '../content/icons'

interface CardIconBadgeProps {
  /** Lucide icon name. Unknown or absent falls back to `fallback`, then to an empty badge. */
  name?: string
  /** Drawn when `name` resolves to nothing — the picker's "no icon yet" hint. */
  fallback?: LucideIcon
  /** The card's border colour — the badge is built entirely out of it. */
  border: Oklch
  theme: 'light' | 'dark'
  /** Outer size in px. 24 on a card, larger in the picker's preview. */
  size?: number
}

/**
 * A card's mnemonic icon, in the card's own colours: border in the card's
 * border colour, a lighter wash of it inside, the icon itself back in the
 * border colour.
 *
 * The corners are rounded but squarish on purpose. The structural buttons that
 * grow the tree (`+`, `->`) are perfect circles, and an icon is not one of
 * them — the different silhouette is what keeps "this card is about energy"
 * from being read as one more button to press.
 */
export function CardIconBadge({ name, fallback, border, theme, size = 24 }: CardIconBadgeProps) {
  const Icon = iconComponent(name) ?? fallback ?? null
  const color = toCss(border)
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    // Scaled with the badge so a big preview keeps the same silhouette as the
    // small one on the card, and never rounds into a circle.
    borderRadius: Math.round(size * 0.3),
    border: `1.5px solid ${color}`,
    background: toCss(iconBadgeFill(border, theme)),
    color,
    boxSizing: 'border-box',
    flexShrink: 0,
  }
  return (
    <span data-testid="card-icon-badge" data-icon={iconComponent(name) ? name : undefined} style={style}>
      {Icon && <Icon size={Math.round(size * 0.6)} strokeWidth={2.2} />}
    </span>
  )
}
