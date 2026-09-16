import { useEffect } from 'react'
import { X } from 'lucide-react'
import { Button } from '../components/ui/button'
import { SYMBOL_FAMILIES } from './symbolSets'

export interface BandOptionsOverlayProps {
  /** Les familles masquées, par leur nom. */
  hidden: string[]
  onToggle: (family: string) => void
  onShowAll: () => void
  onClose: () => void
}

/**
 * Le choix des familles de signes du bandeau.
 *
 * Une surcouche LOCALE plutôt qu'un `Dialog` Radix, pour deux raisons : elle
 * s'ouvre depuis la modale de description, qui est déjà un dialogue Radix — en
 * imbriquer un second dans son portail complique le piège de focus et la touche
 * Échap pour rien ; et sur `position: absolute; inset: 0` elle se pose sur la
 * modale entière, ce qui est exactement la surface à couvrir. C'est le même
 * montage que l'overlay de confirmation de suppression.
 *
 * Ce qu'on règle ici ne touche PAS au contenu : une famille masquée disparaît du
 * bandeau, rien n'est retiré du fichier, et le choix est retrouvé à la prochaine
 * ouverture (voir `persistence/bandFamilies`).
 */
export function BandOptionsOverlay({ hidden, onToggle, onShowAll, onClose }: BandOptionsOverlayProps) {
  // Échap ferme CETTE surcouche, et surtout pas la description : l'écoute est en
  // phase de CAPTURE sur `window`, donc elle passe avant celle de Radix et
  // l'arrête. Sans ça, Échap refermait la modale entière et l'utilisateur
  // perdait le réglage qu'il était en train de faire.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const visibleCount = SYMBOL_FAMILIES.filter(family => !hidden.includes(family.name)).length

  return (
    <div
      role="dialog"
      // Pas de `aria-modal` : le focus n'est pas piégé ici, et la tête et le pied
      // de la description restent atteignables. Le prétendre serait un mensonge
      // pour un lecteur d'écran ; le dire, non. La surcouche couvre la zone
      // d'édition, recadrée par l'`overflow: hidden` de la modale.
      aria-label="Familles de symboles"
      style={{
        position: 'absolute',
        inset: 0,
        // Au-dessus de la croix de fermeture (3) et des flèches (2) : cette
        // surcouche couvre la modale entière, elle doit donc passer devant tout.
        zIndex: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'color-mix(in oklch, var(--popover), transparent 12%)',
        borderRadius: 12,
      }}
    >
      <div
        style={{
          width: 'min(460px, 100%)',
          maxHeight: '100%',
          overflowY: 'auto',
          padding: 20,
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: 'var(--popover)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>
              Familles de symboles
            </p>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, opacity: 0.7 }}>
              Décoche une famille pour la retirer du bandeau. Rien n’est supprimé de ta fiche — seul
              l’affichage change, et ton choix est retrouvé à la prochaine ouverture.
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Fermer les options" onClick={onClose}>
            <X />
          </Button>
        </div>

        <ul
          style={{
            listStyle: 'none',
            margin: '16px 0 0',
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {SYMBOL_FAMILIES.map(family => {
            const shown = !hidden.includes(family.name)
            return (
              <li key={family.name}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '7px 8px',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  <input type="checkbox" checked={shown} onChange={() => onToggle(family.name)} />
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{family.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.6 }}>
                    {family.symbols.length} signes
                    {family.formulaOnly === true ? ' · formules' : ''}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 18,
          }}
        >
          <span style={{ marginRight: 'auto', fontSize: 12, opacity: 0.6 }}>
            {visibleCount} famille{visibleCount > 1 ? 's' : ''} affichée{visibleCount > 1 ? 's' : ''}
          </span>
          <Button variant="outline" onClick={onShowAll} disabled={hidden.length === 0}>
            Tout afficher
          </Button>
          <Button onClick={onClose}>Terminé</Button>
        </div>
      </div>
    </div>
  )
}
