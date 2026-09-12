import { toCss } from '../../colors/contrast'
import { mapTypeColor } from '../../colors/mapTypeColors'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'
import {
  MAP_TYPE_DESCRIPTIONS,
  MAP_TYPE_LABELS,
  MAP_TYPES,
  type CategorizedMapType,
  type MapType,
} from '../../types/mapType'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/**
 * Le tag coloré d’une carte, dans l’arborescence. `default` (ou absent) ne rend
 * rien du tout : l’absence de tag EST l’information « pas encore classée ».
 *
 * Une valeur INCONNUE (fichier écrit par une version future, main éditée) garde
 * sa pilule neutre et son libellé BRUT plutôt que de disparaître : `mapTypeColor`
 * rend le neutre pour ce cas, et le spec veut qu’elle reste lisible.
 *
 * Le détail au survol passe par le Tooltip de l’app, pas une popover Radix : un
 * libellé et une phrase tiennent dans un tooltip, et celui-ci est déjà monté par
 * FileSidebar.
 */
export function MapTypeBadge({ type }: { type: string | undefined }) {
  const theme = useResolvedTheme()
  const color = mapTypeColor(type, theme)
  if (color === null) return null

  const categorized = type !== undefined && (MAP_TYPES as readonly string[]).includes(type)
  const label = categorized ? MAP_TYPE_LABELS[type as MapType] : (type ?? '')
  const description = categorized ? MAP_TYPE_DESCRIPTIONS[type as CategorizedMapType] : 'Type inconnu'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="map-type-badge"
          aria-label={label}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
            padding: '0 5px',
            borderRadius: 999,
            border: '1px solid ' + toCss(color.border),
            background: toCss(color.bg),
            color: toCss(color.text),
            fontSize: 9,
            fontWeight: 600,
            lineHeight: '14px',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ opacity: 0.8 }}>{description}</span>
      </TooltipContent>
    </Tooltip>
  )
}
