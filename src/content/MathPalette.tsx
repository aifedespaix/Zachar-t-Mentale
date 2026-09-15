import { useState } from 'react'
import type { MathFieldHandle } from './MathFieldEditor'

/**
 * One insertable fragment.
 *
 * `rich` is what MathLive receives, and may carry its placeholder tokens
 * (`#0` = where the selection lands, `#?` = the next tab stop) — that is what
 * makes « fraction » leave the caret in the numerator instead of after the
 * whole thing. `plain` is the same fragment as literal LaTeX for the raw-field
 * path, where those tokens would be typed out verbatim.
 */
interface Entry {
  /** What the button shows. Unicode where one exists, so the button reads as the result. */
  face: string
  /** Read aloud, and shown on hover. In French, like every other label in the app. */
  label: string
  rich: string
  plain?: string
}

interface Group {
  name: string
  entries: Entry[]
}

/**
 * What a collège course actually writes, and nothing else.
 *
 * The selection is the whole point of this component. The target user is a
 * collégien for whom `\frac{a}{b}` is not "simple, pratique, intuitif" — the
 * adoption risk the rich-content design named explicitly. A palette that tried
 * to cover LaTeX would miss it just as badly as no palette at all: what is
 * needed is the dozen constructs that appear in a maths, physics or chemistry
 * exercise, reachable without knowing they are called `\frac` or `\ce`.
 */
const GROUPS: Group[] = [
  {
    name: 'Structures',
    entries: [
      { face: '⅟', label: 'Fraction', rich: '\\frac{#0}{#?}', plain: '\\frac{}{}' },
      { face: 'x²', label: 'Puissance', rich: '#0^{#?}', plain: '^{}' },
      { face: 'xₙ', label: 'Indice', rich: '#0_{#?}', plain: '_{}' },
      { face: '√', label: 'Racine carrée', rich: '\\sqrt{#0}', plain: '\\sqrt{}' },
      { face: 'ⁿ√', label: 'Racine n-ième', rich: '\\sqrt[#?]{#0}', plain: '\\sqrt[]{}' },
      { face: '( )', label: 'Parenthèses', rich: '\\left(#0\\right)', plain: '\\left(\\right)' },
    ],
  },
  {
    name: 'Opérateurs',
    entries: [
      { face: '×', label: 'Multiplié par', rich: '\\times ' },
      { face: '÷', label: 'Divisé par', rich: '\\div ' },
      { face: '±', label: 'Plus ou moins', rich: '\\pm ' },
      { face: '≠', label: 'Différent de', rich: '\\neq ' },
      { face: '≤', label: 'Inférieur ou égal', rich: '\\leq ' },
      { face: '≥', label: 'Supérieur ou égal', rich: '\\geq ' },
      { face: '≈', label: 'Environ égal', rich: '\\approx ' },
      { face: '→', label: 'Flèche', rich: '\\rightarrow ' },
      { face: 'π', label: 'Pi', rich: '\\pi ' },
      { face: '∞', label: 'Infini', rich: '\\infty ' },
    ],
  },
  {
    // Free, in the sense that costs nothing extra: mhchem is already imported
    // alongside KaTeX in `renderMath.ts`, so chemistry and physics units ship
    // with the maths rather than as a second dependency.
    name: 'Chimie et unités',
    entries: [
      { face: '⚗', label: 'Équation chimique', rich: '\\ce{#0}', plain: '\\ce{}' },
      { face: 'm/s', label: 'Grandeur avec unité', rich: '\\pu{#0}', plain: '\\pu{}' },
    ],
  },
]

/**
 * Ce qui fait reconnaître un groupe d'un coup d'œil : sa teinte, et le fait
 * qu'il écrive ou non ses libellés sous les glyphes.
 *
 * Tenue à côté de `GROUPS` plutôt que dedans, pour que `GROUPS` reste la seule
 * description de ce que la palette insère — une couleur de famille n'a rien à
 * faire dans le même objet que son LaTeX.
 *
 * Les teintes sont des oklch à mi-clarté, jamais posées telles quelles : elles
 * sont diluées dans `var(--background)` pour les fonds et dans `transparent`
 * pour les bordures (voir `overBackground` et `veiled`). Comme le fond de
 * référence suit le thème, la même recette donne un pastel sur le thème clair
 * et une surface légèrement remontée sur le thème sombre : une couleur choisie
 * pour un fond blanc trouerait un fond noir, et réciproquement.
 */
interface GroupLook {
  /** Teinte de reconnaissance du groupe, à mi-clarté. */
  accent: string
  /**
   * Écrire le libellé français sous le glyphe. « ⅟ », « ⁿ√ » ou « x² » ne se
   * lisent pas tout seuls, et rien ne distingue « √ » de « ⁿ√ » sinon le mot :
   * ceux-là l'affichent. Les opérateurs s'en passent — « × », « ≤ » ou « π »
   * sont déjà le mot que l'élève cherche, et une légende de plus n'y ajouterait
   * que de la largeur.
   */
  spelled: boolean
}

const GROUP_LOOKS: Record<string, GroupLook> = {
  // Bleu pour les structures, vert pour les opérateurs, violet pour la chimie.
  // Le nom du groupe et l'ordre de lecture départagent les trois même pour un
  // daltonisme qui en confondrait deux : la couleur aide, elle ne porte rien.
  Structures: { accent: 'oklch(0.62 0.16 258)', spelled: true },
  Opérateurs: { accent: 'oklch(0.64 0.13 172)', spelled: false },
  'Chimie et unités': { accent: 'oklch(0.6 0.17 305)', spelled: true },
}

/** Un groupe renommé garde une allure neutre au lieu de tomber en `undefined`. */
const NEUTRAL_LOOK: GroupLook = { accent: 'oklch(0.62 0.04 258)', spelled: true }

/*
 * Deux espaces de mélange, et ce n'est pas un détail : `oklab` pour tout ce qui
 * se mêle à un jeton du thème, `oklch` pour ce qui se mêle à `transparent`.
 *
 * `--background` et `--foreground` sont achromatiques, donc de teinte 0. Or
 * `color-mix(in oklch, ...)` interpole l'ANGLE de teinte, et le plus court
 * chemin de 0 vers un bleu à 258° passe par le magenta. Mesuré dans le moteur :
 * le fond de touche « bleu » ressortait en `oklch(0.886 0.048 329.4)` — rose —
 * et les trois groupes se ressemblaient. `oklab` interpole en rectangulaire
 * (a et b, sans angle) : la teinte de l'accent est conservée telle quelle. Un
 * mélange avec `transparent` (alpha 0) n'a pas ce défaut, l'alpha étant
 * prémultiplié : `oklch` y garde la teinte exacte, et c'est l'espace demandé.
 */

/** L'accent versé dans le fond du thème — jamais la couleur seule, voir `GROUP_LOOKS`. */
function overBackground(accent: string, percent: number): string {
  return `color-mix(in oklab, var(--background), ${accent} ${percent}%)`
}

/** La couleur à demi transparente : une teinte qui se pose sur les deux thèmes sans en casser un. */
function veiled(color: string, percent: number): string {
  return `color-mix(in oklch, ${color}, transparent ${percent}%)`
}

/**
 * L'accent assez soutenu pour porter du texte.
 *
 * Mélangé au premier plan du thème et non posé sur un fond : il s'assombrit sur
 * le thème clair et s'éclaircit sur le sombre, donc il reste lisible sur les
 * deux là où l'accent nu, à sa clarté d'origine, serait trop pâle d'un côté et
 * trop sombre de l'autre. Mélangé en `oklab` pour la raison dite plus haut.
 */
function inked(accent: string): string {
  return `color-mix(in oklab, var(--foreground), ${accent} 50%)`
}

export interface MathPaletteProps {
  /** The field to insert into. Null while the block has not mounted its editor yet. */
  field: MathFieldHandle | null
}

/**
 * Clickable symbols for the formula block.
 *
 * Deliberately NOT a replacement for typing: MathLive's own shortcuts still
 * work, `$$` still converts a text block on the spot, and someone who knows
 * LaTeX never has to come here. It exists so that not knowing LaTeX is not a
 * wall — the button is the discoverable path, not the mandatory one.
 */
export function MathPalette({ field }: MathPaletteProps) {
  return (
    <div
      role="group"
      aria-label="Symboles mathématiques"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        alignItems: 'flex-start',
        // Le contraste des glyphes est fixé ici, une fois pour toutes : les
        // fonds de la palette sont tous des dérivés du thème, donc le premier
        // plan du thème reste lisible sur chacun d'eux, en clair comme en
        // sombre. Aucun `color` en dur nulle part.
        color: 'var(--foreground)',
        minWidth: 0,
      }}
    >
      {GROUPS.map(group => {
        const look = GROUP_LOOKS[group.name] ?? NEUTRAL_LOOK

        return (
          <div
            key={group.name}
            // Un vrai groupe, pas seulement une rangée : ses touches se suivent
            // et son nom les annonce, ce que l'`aria-label` seul sur un `div`
            // ne faisait pas.
            role="group"
            aria-label={group.name}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '8px 10px 10px',
              borderRadius: 14,
              background: overBackground(look.accent, 14),
              border: `1px solid ${veiled(look.accent, 55)}`,
              // Les groupes se replient au lieu de déborder quand le bandeau
              // qui les porte est étroit : c'est le `wrap` des touches qui
              // finit le travail en dessous de la largeur d'un groupe.
              minWidth: 0,
              maxWidth: '100%',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: look.accent,
                  flex: '0 0 auto',
                }}
              />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 650,
                  letterSpacing: '0.01em',
                  // Un titre lisible, et non un gris à 10px : c'est lui qui
                  // annonce le groupe à qui ne distingue pas les teintes.
                  color: inked(look.accent),
                }}
              >
                {group.name}
              </span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {group.entries.map(entry => (
                <PaletteKey
                  key={entry.label}
                  entry={entry}
                  field={field}
                  accent={look.accent}
                  spelled={look.spelled}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface PaletteKeyProps {
  entry: Entry
  field: MathFieldHandle | null
  /** Teinte du groupe, pour que la touche se lise comme y appartenant. */
  accent: string
  /** Voir `GroupLook.spelled`. */
  spelled: boolean
}

/**
 * Une touche de la palette.
 *
 * Le survol et le focus sont tenus en état React plutôt qu'en CSS : ce fichier
 * n'a pas de feuille de style, et deux `useState` coûtent moins qu'un fichier
 * de plus pour deux pseudo-classes.
 *
 * Le focus reste visible parce que c'est la seule chose qui dise où l'on se
 * trouve quand on avance au clavier ; le `preventDefault` du `mousedown`
 * empêchant la souris de donner le focus, il ne s'allume de toute façon que
 * pour un clavier.
 */
function PaletteKey({ entry, field, accent, spelled }: PaletteKeyProps) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const disabled = field === null
  // Un survol ne doit rien promettre à une touche inerte.
  const lit = hovered && !disabled

  return (
    <button
      type="button"
      aria-label={entry.label}
      title={entry.label}
      // `onMouseDown` + preventDefault plutôt que `onClick` : un clic donne
      // d'abord le focus au bouton, ce qui retire le curseur de la formule —
      // et ce curseur est toute la raison d'être de l'insertion.
      onMouseDown={event => {
        event.preventDefault()
        field?.insert(entry.rich, entry.plain)
      }}
      // …mais un `mousedown` n'existe pas au clavier : Entrée et Espace
      // déclenchent un `click`, que personne n'écoute ici. Sans ceci, les
      // touches sont atteignables au Tab, s'annoncent avec leur libellé, et ne
      // font rien — le pire des trois états. `preventDefault` sur le keydown
      // empêche en prime le `click` de synthèse, donc l'insertion ne part
      // jamais deux fois.
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        field?.insert(entry.rich, entry.plain)
      }}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: 'inline-flex',
        flexDirection: spelled ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spelled ? 3 : 0,
        // 46×44 pour un opérateur nu, une carte plus large dès qu'un nom
        // l'accompagne : dans les deux cas nettement au-dessus des 38px
        // demandés, parce qu'une cible se rate d'abord par sa hauteur.
        minWidth: spelled ? 70 : 46,
        minHeight: spelled ? 52 : 44,
        padding: spelled ? '7px 12px' : '0 12px',
        fontFamily: 'inherit',
        fontSize: 19,
        lineHeight: 1.1,
        borderRadius: 10,
        // L'état désactivé est porté par la forme autant que par la couleur : un
        // contour en pointillés se lit même pour qui ne distingue pas les gris,
        // et il ne dépend d'aucune teinte de thème.
        border: disabled ? `1px dashed ${veiled('var(--foreground)', 70)}` : `1px solid ${veiled(accent, lit ? 25 : 40)}`,
        background: disabled ? 'transparent' : overBackground(accent, lit ? 44 : 30),
        color: disabled ? veiled('var(--foreground)', 38) : 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        outline: focused ? '2px solid var(--ring)' : 'none',
        outlineOffset: 2,
        transition: 'background-color 120ms ease-in-out, border-color 120ms ease-in-out',
      }}
    >
      <span>{entry.face}</span>
      {spelled && (
        <span style={{ fontSize: 11, lineHeight: 1.15, opacity: 0.85, whiteSpace: 'nowrap' }}>{entry.label}</span>
      )}
    </button>
  )
}
