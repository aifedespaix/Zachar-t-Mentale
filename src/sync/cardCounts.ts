import { ALL_CARD_LEVELS, type Card, type CardLevel } from '../types/card'

/**
 * De quoi est faite une carte mentale, en un coup d'œil — ce qu'une résolution
 * de conflit met des deux côtés d'une comparaison.
 *
 * Les cartes VOLANTES sont comptées à part et jamais dans `byLevel` : leur
 * `level` est vestigial (voir `Card.detached`), donc les ranger par niveau
 * ferait dire à la comparaison « 3 cartes de niveau 2 » là où il n'y en a
 * qu'une attachée et deux mises de côté. `total` les compte, lui : elles sont
 * bien dans le fichier, et une version qui en a douze de plus n'est pas la même.
 */
export interface CardCounts {
  total: number
  byLevel: Record<CardLevel, number>
  detached: number
}

export function emptyCardCounts(): CardCounts {
  return { total: 0, byLevel: { 1: 0, 2: 0, 3: 0, 4: 0 }, detached: 0 }
}

/**
 * Compte les cartes par niveau.
 *
 * Un niveau HORS de 1-4 (fichier écrit à la main, ou par une version future)
 * n'est rangé nulle part mais compte dans `total` : la comparaison doit rester
 * juste sur le nombre de cartes même quand l'une d'elles n'est pas classable.
 */
export function countCards(cards: Card[]): CardCounts {
  const counts = emptyCardCounts()
  for (const card of cards) {
    counts.total += 1
    if (card.detached === true) {
      counts.detached += 1
      continue
    }
    if ((ALL_CARD_LEVELS as readonly number[]).includes(card.level)) {
      counts.byLevel[card.level] += 1
    }
  }
  return counts
}

/**
 * L'écart d'un côté à l'autre, pour l'afficher à côté du nombre : `+2`, `-1`,
 * ou `null` quand les deux côtés sont d'accord — rien à signaler ne doit rien
 * écrire, sinon la colonne se remplit de « 0 » qui noient les vrais écarts.
 */
export function countDelta(left: number, right: number): string | null {
  const delta = left - right
  if (delta === 0) return null
  return delta > 0 ? `+${delta}` : `${delta}`
}
