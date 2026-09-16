import type { SymbolFamily } from '../types/symbolBand'

/**
 * Les signes du bandeau, groupés par famille.
 *
 * Deux décisions portent tout le reste, et c'est la place qu'elles font gagner :
 *
 *  1. **Un seul glyphe par signe.** `≤` existait deux fois dans l'éditeur — une
 *     fois dans la palette de texte, une fois dans celle de formule. Dans un
 *     bandeau unique, c'est un doublon visuel et une touche perdue. Ici il n'y a
 *     qu'une entrée, et c'est le CHAMP qui décide de ce qu'elle écrit : `glyph`
 *     pour un texte, `latex` pour une formule. Le résultat à l'écran est le
 *     même, donc ce n'est pas déroutant — et la touche garde sa place quel que
 *     soit le bloc, ce qui est toute la raison d'être du bandeau.
 *
 *  2. **Une teinte par famille**, prise dans `GROUP_TONES` — celles des groupes
 *     de caractères de langue, déjà éprouvées pour rester lisibles en clair
 *     comme en sombre (elles sont mélangées au fond, jamais posées dessus).
 *
 * Les familles sont volontairement courtes : chaque signe ici est un signe qu'un
 * cours écrit réellement au milieu d'une phrase. La longue traîne (sommes,
 * intégrales, vecteurs) reste l'affaire de la saisie LaTeX, où la notation peut
 * être composée correctement.
 *
 * Ce module ne contient que les DONNÉES : la forme est dans
 * `types/symbolBand`, le rendu dans `SymbolBand`. Une famille se retire en
 * supprimant son entrée ci-dessous, et rien d'autre ne bouge.
 */
export const SYMBOL_FAMILIES: SymbolFamily[] = [
  {
    // Reprises de l'ancienne palette de formules, et c'est le point : les
    // retirer aurait été une PERTE DE CAPACITÉ, pas un rangement. Une fraction,
    // une puissance, un indice et des parenthèses sont ce qu'on écrit le plus
    // souvent en maths.
    name: 'Structures',
    hue: 3,
    formulaOnly: true,
    symbols: [
      { glyph: '⅟', label: 'Fraction', latex: '\\frac{#0}{#?}', plain: '\\frac{}{}' },
      { glyph: 'x²', label: 'Puissance', latex: '#0^{#?}', plain: '^{}' },
      { glyph: 'xₙ', label: 'Indice', latex: '#0_{#?}', plain: '_{}' },
      { glyph: '√', label: 'Racine carrée', latex: '\\sqrt{#0}', plain: '\\sqrt{}' },
      { glyph: 'ⁿ√', label: 'Racine n-ième', latex: '\\sqrt[#?]{#0}', plain: '\\sqrt[]{}' },
      { glyph: '( )', label: 'Parenthèses', latex: '\\left(#0\\right)', plain: '\\left(\\right)' },
    ],
  },
  {
    name: 'Comparaisons',
    hue: 0,
    symbols: [
      { glyph: '≤', label: 'Inférieur ou égal', latex: '\\leq ' },
      { glyph: '≥', label: 'Supérieur ou égal', latex: '\\geq ' },
      { glyph: '≠', label: 'Différent de', latex: '\\neq ' },
      { glyph: '≈', label: 'Environ égal à', latex: '\\approx ' },
    ],
  },
  {
    name: 'Opérations',
    hue: 1,
    symbols: [
      { glyph: '×', label: 'Multiplié par', latex: '\\times ' },
      { glyph: '÷', label: 'Divisé par', latex: '\\div ' },
      { glyph: '±', label: 'Plus ou moins', latex: '\\pm ' },
      { glyph: '·', label: 'Point multiplicatif', latex: '\\cdot ' },
    ],
  },
  {
    name: 'Divers',
    hue: 2,
    symbols: [
      { glyph: '→', label: 'Tend vers', latex: '\\to ' },
      { glyph: 'π', label: 'Pi', latex: '\\pi' },
      { glyph: '∞', label: 'Infini', latex: '\\infty' },
      { glyph: '°', label: 'Degré', latex: '^{\\circ}' },
    ],
  },
  {
    name: 'Ensembles',
    hue: 3,
    symbols: [
      { glyph: '∈', label: 'Appartient à', latex: '\\in ' },
      { glyph: '∉', label: 'N’appartient pas à', latex: '\\notin ' },
      { glyph: '∪', label: 'Union', latex: '\\cup ' },
      { glyph: '∩', label: 'Intersection', latex: '\\cap ' },
      { glyph: '∅', label: 'Ensemble vide', latex: '\\varnothing' },
    ],
  },
  {
    name: 'Logique',
    hue: 0,
    symbols: [
      { glyph: '⇒', label: 'Donc, implique', latex: '\\Rightarrow ' },
      { glyph: '⇔', label: 'Équivalent à', latex: '\\Leftrightarrow ' },
    ],
  },
  {
    name: 'Grec',
    hue: 1,
    symbols: [
      { glyph: 'α', label: 'Alpha', latex: '\\alpha' },
      { glyph: 'β', label: 'Bêta', latex: '\\beta' },
      { glyph: 'θ', label: 'Thêta', latex: '\\theta' },
      { glyph: 'Δ', label: 'Delta', latex: '\\Delta' },
      { glyph: 'Σ', label: 'Sigma', latex: '\\Sigma' },
    ],
  },
  {
    // Conservées parce que `katex/contrib/mhchem` est bien chargé : `\ce` et
    // `\pu` rendent vraiment. Les retirer aurait supprimé une capacité réelle
    // pour gagner deux touches.
    name: 'Unités',
    hue: 2,
    formulaOnly: true,
    symbols: [
      { glyph: '⚗', label: 'Équation chimique', latex: '\\ce{#0}', plain: '\\ce{}' },
      { glyph: 'm/s', label: 'Grandeur avec unité', latex: '\\pu{#0}', plain: '\\pu{}' },
    ],
  },
]

/**
 * Les signes propres aux SCIENCES — physique-chimie et SVT.
 *
 * Un onglet à part et non des familles de plus dans Maths, comme demandé : ce
 * qu'on cherche quand on rédige une réaction chimique n'est pas ce qu'on cherche
 * quand on écrit une inéquation, et les mélanger dans une seule bande obligerait
 * à chercher au milieu des signes dont on n'a pas besoin ici.
 *
 * `⚗` et `m/s` viennent de l'ancienne palette de formules et sont conservés :
 * `katex/contrib/mhchem` est bien chargé, donc `\ce` et `\pu` rendent vraiment.
 */
export const SCIENCES_FAMILIES: SymbolFamily[] = [
  {
    name: 'Réactions',
    hue: 1,
    formulaOnly: true,
    symbols: [
      { glyph: '⇌', label: 'Équilibre chimique', latex: '\\rightleftharpoons ' },
      { glyph: '⚗', label: 'Équation chimique', latex: '\\ce{#0}', plain: '\\ce{}' },
      { glyph: 'm/s', label: 'Grandeur avec unité', latex: '\\pu{#0}', plain: '\\pu{}' },
    ],
  },
  {
    name: 'Grandeurs',
    hue: 3,
    symbols: [
      { glyph: '°C', label: 'Degré Celsius', latex: '^{\\circ}\\mathrm{C}' },
      { glyph: 'µ', label: 'Micro', latex: '\\mu ' },
      { glyph: 'Ω', label: 'Ohm', latex: '\\Omega ' },
      { glyph: 'λ', label: 'Lambda, longueur d’onde', latex: '\\lambda ' },
      { glyph: 'ν', label: 'Nu, fréquence', latex: '\\nu ' },
      { glyph: 'ρ', label: 'Rho, masse volumique', latex: '\\rho ' },
    ],
  },
  {
    name: 'Mesures',
    hue: 2,
    symbols: [
      { glyph: '≈', label: 'Environ égal à', latex: '\\approx ' },
      { glyph: 'Δ', label: 'Variation', latex: '\\Delta ' },
      { glyph: '→', label: 'Évolue vers', latex: '\\to ' },
      { glyph: '°', label: 'Degré', latex: '^{\\circ}' },
    ],
  },
]