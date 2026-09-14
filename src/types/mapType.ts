/**
 * Le vocabulaire FERMÉ des types de carte, côté application. Le champ serveur
 * est un texte libre : c'est ici, et seulement ici, que la liste est close.
 */
export const MAP_TYPES = ['cours', 'exo', 'prise de notes', 'corrections', 'corrigé'] as const

/** Un type réellement classé — jamais `default`, qui n'est pas un classement. */
export type CategorizedMapType = (typeof MAP_TYPES)[number]

/** `default` n'est pas dans `MAP_TYPES` : c'est l'ABSENCE de classement, pas un type de plus. */
export type MapType = CategorizedMapType | 'default'

export const DEFAULT_MAP_TYPE: MapType = 'default'

/**
 * Ramène toute valeur inconnue à `default` : un type écrit par une version
 * future, une faute de frappe dans un fichier édité à la main, ou un
 * `undefined` de fichier jamais classé. On ne jette jamais.
 *
 * La comparaison passe par NFC parce que `corrigé` est le premier type
 * accentué du vocabulaire : le même mot tapé sur macOS ou recopié depuis un
 * éditeur peut arriver en NFD (`corrige` + accent combinant), que `includes`
 * ne reconnaîtrait pas — et le fichier retomberait en `default` à la
 * première synchro. La valeur RENDUE est toujours un membre de `MAP_TYPES`,
 * jamais la forme reçue.
 */
export function mapTypeOf(value: unknown): MapType {
  if (typeof value !== 'string') return DEFAULT_MAP_TYPE
  const normalized = value.normalize('NFC')
  return (MAP_TYPES as readonly string[]).includes(normalized) ? (normalized as CategorizedMapType) : DEFAULT_MAP_TYPE
}

/**
 * Vrai pour les cinq types classés ET pour `default`. C'est la question
 * que la pilule pose pour distinguer « pas de type » (rien à afficher) d'« une
 * valeur que l'app ne connaît pas » (pilule neutre avec le libellé brut).
 */
export function isKnownMapType(value: unknown): value is MapType {
  return value === DEFAULT_MAP_TYPE || (typeof value === 'string' && (MAP_TYPES as readonly string[]).includes(value))
}

export const MAP_TYPE_LABELS: Record<MapType, string> = {
  cours: 'Cours',
  exo: 'Exercices',
  'prise de notes': 'Prise de notes',
  corrections: 'Corrections',
  'corrigé': 'Corrigé',
  default: 'Sans type',
}

export const MAP_TYPE_DESCRIPTIONS: Record<CategorizedMapType, string> = {
  cours: 'Le support de référence du chapitre.',
  exo: 'Des exercices d’entraînement.',
  'prise de notes': 'Des notes prises en vrac, sans structure de cours.',
  corrections: 'La correction d’un exercice ou d’une évaluation.',
  'corrigé': 'Le travail d’un élève, repris et corrigé par son prof.',
}
