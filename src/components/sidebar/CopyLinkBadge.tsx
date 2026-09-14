import { Link2 } from 'lucide-react'
import { copyLinkBadgeText, copyLinkLabel, type CopyLink } from '../../sync/copyLink'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/**
 * L'indice visuel du LIEN DE COPIE, dans l'arborescence.
 *
 * Les deux fichiers d'un couple portent la même pastille : c'est ce qui fait
 * qu'on voit qu'ils vont ensemble SANS ouvrir quoi que ce soit, et sans se
 * rappeler pourquoi il y a deux « Chapitre 1 » dans ce dossier. Le mot change
 * de part et d'autre (« liée » sur l'original, « copie » sur la copie), parce
 * que la question qu'on se pose devant deux fichiers jumeaux est « lequel est
 * lequel ».
 *
 * Rendue en pointillés et plus discrète que le tag de type : elle qualifie une
 * RELATION entre deux lignes, pas le contenu de l'une d'elles.
 */
export function CopyLinkBadge({ link }: { link: CopyLink | undefined }) {
  if (link === undefined) return null
  const label = copyLinkLabel(link)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span data-testid="copy-link-badge" className="copy-link-badge" aria-label={label}>
          <Link2 size={9} aria-hidden />
          {copyLinkBadgeText(link)}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span>{label}</span>
      </TooltipContent>
    </Tooltip>
  )
}
