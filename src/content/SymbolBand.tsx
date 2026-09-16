import type { CSSProperties } from 'react'
import type { CardBlockKind } from '../types/cardBlock'
import type { BandTabId, PaletteSymbol } from '../types/symbolBand'
import { Hint } from '../components/ui/hint'
import { GROUP_TONES, LanguageFlag, tint } from './LanguageHelpPalette'
import { SYMBOL_TABS } from './symbolTabs'

export interface SymbolBandProps {
  /** Le bloc qui recevra l'insertion, nommé dans le bandeau — sans quoi on ne saurait pas où le clic écrit. */
  targetLabel: string
  /** Le type du bloc visé, pour dire ce que chaque touche écrira. */
  kind: CardBlockKind
  /** Faux sur une image : aucun champ texte ne peut y recevoir un signe. */
  symbolsApply: boolean
  /** Vrai quand la cible accepte du LaTeX (formule, ou cellule de formule). */
  structuresApply: boolean
  /** Vrai quand la cible accepte du texte simple (texte, ou cellule de texte). */
  textApply: boolean
  /** Les familles que l'utilisateur a masquées, par leur nom (voir `persistence/bandFamilies`). */
  hiddenFamilies: string[]
  /** L'onglet ouvert, ou `null` quand l'utilisateur l'a fermé pour ne rien afficher. */
  activeTab: BandTabId | null
  onChooseTab: (tab: BandTabId | null) => void
  onInsert: (symbol: PaletteSymbol) => void
}

/**
 * Le bandeau de symboles, au-dessus de la description qui défile.
 *
 * **Ligne 1 : le bloc visé, puis les onglets.** Un onglet est un jeu de familles ;
 * le bandeau n'en montre qu'un. Cliquer l'onglet déjà ouvert le referme — c'est le
 * même bouton qui ouvre et qui ferme, donc rien à chercher pour « ne rien
 * afficher ».
 *
 * **Ligne 2 et suivantes : les familles de l'onglet ouvert.**
 *
 * Trois propriétés portent tout le reste :
 *
 *  - **Il est hors des blocs, à hauteur réservée.** Un pied qui n'existe que sur
 *    le bloc actif fait sauter le contenu de 120 à 190 px dès qu'on change de
 *    bloc — et un élément `position: sticky` ne corrige rien, puisqu'il garde sa
 *    place dans le flux. Une bande toujours présente ne déplace jamais rien.
 *  - **Les touches ne bougent pas** dans un onglet donné : mêmes familles, même
 *    ordre, mêmes positions, quel que soit le bloc actif. Ce qui ne s'applique pas
 *    est **grisé, jamais retiré ni déplacé**. Changer d'ONGLET change le contenu,
 *    mais c'est un geste volontaire, pas une conséquence du bloc qu'on regarde.
 *  - **Une seule touche par signe.** C'est le champ qui décide de ce qu'elle
 *    écrit — `glyph` dans un texte, `latex` dans une formule — donc il n'y a pas
 *    deux `≤` à deux endroits.
 *
 * Chaque famille est un **conteneur teinté** de sa propre couleur : la bande se
 * replie, et un groupe doit rester un groupe de chaque côté du repli — c'est la
 * couleur du fond qui le dit, pas la distance entre deux touches.
 */
export function SymbolBand({
  targetLabel,
  kind,
  symbolsApply,
  structuresApply,
  textApply,
  hiddenFamilies,
  activeTab,
  onChooseTab,
  onInsert,
}: SymbolBandProps) {
  const openTab = SYMBOL_TABS.find(tab => tab.id === activeTab) ?? null
  const families = (openTab?.families ?? []).filter(family => !hiddenFamilies.includes(family.name))

  return (
    <div
      role="group"
      aria-label="Symboles à insérer"
      style={{ display: 'flex', flexDirection: 'column', gap: 7, color: 'var(--foreground)', minWidth: 0 }}
    >
      {/* Ligne 1 : le bloc visé, puis les onglets. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={TARGET_CHIP}>{targetLabel}</span>

        <div role="group" aria-label="Onglets du bandeau" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {SYMBOL_TABS.map(tab => {
            const Icon = tab.icon
            const open = tab.id === activeTab
            // Un onglet de langue porte un DRAPEAU et non une icône (`icon:
            // null`) : le drapeau est un SVG, jamais un emoji, qui s'afficherait
            // « GB » sur Windows.
            const flag = tab.id === 'en' || tab.id === 'es' || tab.id === 'fr' ? tab.id : null
            return (
              <Hint key={tab.id} label={open ? `${tab.label} — cliquer pour fermer` : tab.label}>
                <button
                  type="button"
                  // `aria-pressed` et non `role="tab"` : le contenu n'est pas un
                  // vrai panneau d'onglets, et le prétendre serait un mensonge
                  // pour un lecteur d'écran. Ce sont des boutons bascules, ce que
                  // l'utilisateur voit exactement.
                  aria-pressed={open}
                  aria-label={tab.label}
                  onMouseDown={event => event.preventDefault()}
                  // Cliquer l'onglet DÉJÀ ouvert le referme : un seul geste pour
                  // « ouvre » et pour « ne rien afficher ».
                  onClick={() => onChooseTab(open ? null : tab.id)}
                  style={{
                    ...TAB_BUTTON,
                    borderColor: open ? 'var(--ring)' : 'var(--border)',
                    background: open ? 'color-mix(in oklch, var(--ring), transparent 84%)' : 'transparent',
                    fontWeight: open ? 650 : 500,
                  }}
                >
                  {flag !== null ? <LanguageFlag id={flag} /> : Icon !== null && <Icon size={14} />}
                  {tab.label}
                </button>
              </Hint>
            )
          })}
        </div>
      </div>

      {/* Ligne 2 et suivantes : les familles de l'onglet ouvert. Rien du tout
          quand aucun onglet ne l'est — c'est un état voulu, pas un vide. */}
      {families.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', minWidth: 0 }}>
          {families.map(family => {
            const hue = GROUP_TONES[family.hue] ?? GROUP_TONES[0]
            // Une famille « formule seulement » dans un texte, ou « texte
            // seulement » dans une formule : grisée. La raison est dans
            // l'infobulle du NOM de la famille — elle ne peut pas être sur les
            // touches, qui sont désactivées, et une infobulle ne s'ouvre pas sur
            // un bouton désactivé.
            const muted =
              (family.formulaOnly === true && !structuresApply) || (family.textOnly === true && !textApply)
            const why = family.formulaOnly === true ? 'une formule' : 'un texte'
            return (
              <div
                key={family.name}
                role="group"
                aria-label={family.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 9px 4px 8px',
                  borderRadius: 12,
                  background: tint(hue, 8),
                  border: `1px solid ${tint(hue, 24)}`,
                  opacity: muted ? 0.55 : 1,
                }}
              >
                {muted ? (
                  <Hint label={`Ces signes ne s'écrivent que dans ${why}`}>
                    <span style={familyLabel(hue)}>{family.name}</span>
                  </Hint>
                ) : (
                  <span style={familyLabel(hue)}>{family.name}</span>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {family.symbols.map(symbol => {
                    const unavailable =
                      family.formulaOnly === true
                        ? !structuresApply
                        : family.textOnly === true
                          ? !textApply
                          : !symbolsApply
                    return (
                      <Hint
                        key={symbol.glyph}
                        label={
                          // Dire ce que la touche écrira ICI : c'est ce qui rend
                          // l'adaptation au type de champ lisible plutôt que
                          // magique.
                          symbol.latex !== undefined && kind === 'math'
                            ? `${symbol.label} — écrit ${symbol.latex}`
                            : `${symbol.label} — écrit ${keyFace(symbol)}`
                        }
                      >
                        <button
                          type="button"
                          aria-label={unavailable ? `${symbol.label} — indisponible ici` : symbol.label}
                          disabled={unavailable}
                          // `onMouseDown` annulé, comme les palettes d'origine :
                          // laisser le clic donner le focus au bouton retirerait le
                          // caret du champ, et le caret est toute la raison d'être
                          // d'une palette. Ça évite aussi que le champ perde le
                          // focus — donc que la bande se regrise — au moment même
                          // où on la clique.
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => onInsert(symbol)}
                          style={{
                            ...BAND_KEY,
                            border: `1px solid ${tint(hue, 34)}`,
                            background: tint(hue, 20),
                          }}
                        >
                          {keyFace(symbol)}
                        </button>
                      </Hint>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Ce qu'une touche MONTRE : les deux signes d'une paire (`¿ ?`, `« »`) quand le
 * clic les écrit ensemble, sinon le glyphe seul. C'est le contrat de la palette
 * de langue d'origine, repris tel quel : une touche se lit comme le texte
 * qu'elle écrit, donc la paire n'a pas à être reconstituée de tête.
 */
function keyFace(symbol: PaletteSymbol): string {
  return symbol.closesWith === undefined ? symbol.glyph : `${symbol.glyph} ${symbol.closesWith}`
}

/**
 * Le nom d'une famille, écrit DANS la couleur de la famille plutôt que sur une
 * seconde pastille teintée : le conteneur porte déjà la teinte, et une pastille
 * dans une pastille se lit mal. La couleur est ramenée vers le premier plan du
 * thème, donc elle reste lisible en clair comme en sombre — l'accent nu serait
 * trop pâle d'un côté et trop sombre de l'autre.
 */
function familyLabel(hue: string): CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
    color: `color-mix(in oklab, var(--foreground), ${hue} 55%)`,
  }
}

const TARGET_CHIP: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 650,
  padding: '3px 10px',
  borderRadius: 999,
  border: '1px solid var(--ring)',
  whiteSpace: 'nowrap',
}

const TAB_BUTTON: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 26,
  padding: '0 10px',
  fontFamily: 'inherit',
  fontSize: 12,
  borderRadius: 999,
  border: '1px solid var(--border)',
  color: 'inherit',
  cursor: 'pointer',
}

const BAND_KEY: CSSProperties = {
  minWidth: 34,
  height: 34,
  padding: '0 6px',
  fontFamily: 'inherit',
  fontSize: 16,
  lineHeight: 1,
  borderRadius: 9,
  cursor: 'pointer',
  color: 'inherit',
}
