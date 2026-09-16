import type { ComponentType } from 'react'

/**
 * Ce qu'un signe du bandeau est, et comment il s'écrit.
 *
 * Les types vivent ici, avec ceux du reste du contenu (`cardBlock`, `card`,
 * `commands`) : les données qui les remplissent sont dans `content/symbolSets`,
 * et le composant qui les affiche dans `content/SymbolBand`. Trois fichiers,
 * trois responsabilités — la forme, le contenu, le rendu.
 */
export interface PaletteSymbol {
  /** Ce que la touche montre, et ce qu'elle écrit dans un TEXTE. */
  glyph: string
  /** Nom accessible et infobulle. */
  label: string
  /**
   * Ce qu'elle écrit dans une FORMULE. **Absent pour un caractère de langue** :
   * `é` ou `«` n'ont pas de forme LaTeX, donc ces touches-là ne servent que le
   * texte — et un onglet qui n'a que de tels signes est désactivé dans une
   * formule, exactement comme « Structures » l'est dans un texte.
   */
  latex?: string
  /**
   * Le même fragment sans les taquets MathLive (`#0` = la sélection, `#?` = le
   * taquet suivant), pour le chemin dégradé où il n'y a pas d'éditeur vivant
   * pour les interpréter.
   */
  plain?: string
  /**
   * Le signe qui ferme celui-ci, écrit dans le même clic : la paire arrive
   * comme des parenthèses, curseur au milieu, et une sélection est entourée
   * plutôt qu'écrasée. C'est le comportement des caractères de langue
   * (`¿…?`, `« … »`) repris tel quel — l'aplatir serait une régression.
   */
  closesWith?: string
  /** Vrai quand la paire est espacée à l'intérieur (`« texte »`), faux quand elle colle (`¿texto?`). */
  spaced?: boolean
}

/**
 * Une famille de signes — un groupe qu'on lit d'un coup d'œil.
 *
 * `hue` est un INDEX dans `GROUP_TONES`, pas une couleur : une famille, une
 * teinte, et c'est la même table de teintes que les caractères de langue, donc
 * les deux palettes de l'app parlent la même langue visuelle.
 */
export interface SymbolFamily {
  name: string
  hue: number
  /**
   * Une famille qui n'a de sens que dans une FORMULE : une fraction ou une
   * puissance n'a pas d'équivalent Unicode, donc dans un texte ces touches sont
   * grisées plutôt que d'écrire du LaTeX brut au milieu d'une phrase.
   */
  formulaOnly?: boolean
  /**
   * Une famille qui n'a de sens que dans un TEXTE — les caractères d'une langue.
   * L'inverse exact de `formulaOnly`, et la même règle : grisée là où elle ne
   * vaut rien, jamais retirée ni déplacée.
   */
  textOnly?: boolean
  symbols: PaletteSymbol[]
}

/** L'identifiant d'un onglet du bandeau. */
export type BandTabId = 'maths' | 'sciences' | 'en' | 'es' | 'fr'

/**
 * Un onglet du bandeau : un jeu de familles, sous un nom et une icône.
 *
 * Les onglets remplacent la langue qui vivait dans l'état de l'éditeur : c'est
 * le même besoin — « quels caractères m'aide-t-on à écrire en ce moment ? » — mais
 * posé sur le bandeau, donc sans que le bloc ait à retenir quoi que ce soit.
 */
export interface SymbolTab {
  id: BandTabId
  label: string
  /** Une icône, ou `null` quand l'onglet porte un drapeau — les langues. */
  icon: ComponentType<{ size?: number }> | null
  families: SymbolFamily[]
}
