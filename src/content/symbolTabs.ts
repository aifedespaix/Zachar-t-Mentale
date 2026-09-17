import { FlaskConical, Sigma } from 'lucide-react'
import type { BandTabId, SymbolFamily, SymbolTab } from '../types/symbolBand'
import { LANGUAGES, type LanguageHelp } from './languageHelp'
import { SCIENCES_FAMILIES, SYMBOL_FAMILIES } from './symbolSets'

/**
 * Les onglets du bandeau.
 *
 * Un onglet est un jeu de familles sous un nom et une icône, et le bandeau n'en
 * montre qu'un à la fois. C'est le remplacement de ce qui existait avant, où
 * l'éditeur retenait une LANGUE et où chaque bloc portait sa propre palette : le
 * besoin est le même — « quels caractères m'aide-t-on à écrire en ce moment ? » —
 * mais il est posé sur le bandeau, donc **aucun bloc n'a plus rien à retenir**.
 *
 * Deux conséquences, et elles comptent :
 *
 *  - Le pied du bloc disparaît, et avec lui le décalage de 120–190 px qu'il
 *    provoquait à chaque changement de bloc actif. C'était le dernier.
 *  - L'onglet ouvert est un réglage d'AFFICHAGE : il se retient entre deux
 *    ouvertures de la modale et entre deux lancements (voir
 *    `persistence/bandTab`), et il ne part jamais dans un fichier.
 *
 * Les onglets de langue ont `icon: null` : leur visuel est un DRAPEAU, dessiné
 * en SVG par `LanguageFlag`. Pas d'emoji drapeau — il s'affiche « GB » sur
 * Windows, où vit cette app.
 */
/**
 * Une couleur par onglet, pour le liséré et le voile de l'onglet-dossier.
 *
 * Cinq teintes prises à la même famille que les `GROUP_TONES` (mélangées au fond,
 * jamais posées dessus), donc lisibles en clair comme en sombre. Le mélange se
 * fait avec `--popover` — le fond de la modale — ce qui leur évite d'exister en
 * deux versions : elles valent dans les deux thèmes telles quelles.
 */
const TAB_ACCENTS: Record<BandTabId, string> = {
  maths: 'oklch(0.6 0.17 250)',
  sciences: 'oklch(0.62 0.15 155)',
  en: 'oklch(0.55 0.18 275)',
  es: 'oklch(0.66 0.16 75)',
  fr: 'oklch(0.62 0.17 20)',
}

export const SYMBOL_TABS: SymbolTab[] = [
  {
    id: 'maths',
    label: 'Mathématiques',
    icon: Sigma,
    accent: TAB_ACCENTS.maths,
    families: SYMBOL_FAMILIES,
  },
  {
    id: 'sciences',
    label: 'Sciences',
    icon: FlaskConical,
    accent: TAB_ACCENTS.sciences,
    families: SCIENCES_FAMILIES,
  },
  // Les langues étaient les dernières à garder un pied de bloc, parce qu'elles
  // dépendaient d'une langue à choisir. Elles passent au bandeau comme les
  // autres : le choix devient un onglet, donc un geste en plus au lieu d'un
  // état de plus, et le pied n'a plus rien à porter.
  ...LANGUAGES.map(language => ({
    id: language.id,
    label: language.label,
    icon: null,
    accent: TAB_ACCENTS[language.id],
    families: familiesOf(language),
  })),
]

/**
 * Un groupe de caractères de langue, vu comme une famille du bandeau.
 *
 * `textOnly` est ce qui grise la famille hors d'un texte (voir `SymbolBand`),
 * et `hue` est l'INDEX du groupe : c'est la même table `GROUP_TONES` que la
 * palette d'origine, donc les couleurs suivent le groupe et non l'onglet.
 *
 * `closesWith`/`spaced` sont repris TELS QUELS : `¿…?` et `« … »` s'écrivent
 * d'un seul clic, curseur au milieu, et aplatir la paire serait une régression.
 */
function familiesOf(language: LanguageHelp): SymbolFamily[] {
  return language.groups.map((group, hue) => ({
    name: group.name,
    hue,
    textOnly: true,
    symbols: group.characters.map(character => ({
      glyph: character.char,
      label: character.label,
      closesWith: character.closesWith,
      spaced: character.spaced,
    })),
  }))
}

/** L'onglet ouvert par défaut, et celui qu'on retrouve quand le réglage est illisible. */
export const DEFAULT_TAB: SymbolTab['id'] = 'maths'
