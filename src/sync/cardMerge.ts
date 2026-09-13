import type { Card } from '../types/card'

/**
 * Ce que `pullOne` écrit à la place d'un simple écrasement : toute carte
 * locale absente de la version reçue devient une carte volante au lieu
 * d'être perdue. Une différence d'ensembles à DEUX voies, pas une fusion à
 * trois — aucune version de référence commune n'est nécessaire : qu'une carte
 * ait été ajoutée par l'élève depuis la dernière synchro, ou supprimée par le
 * prof, le traitement est le même dans les deux cas — elle est mise de côté,
 * jamais perdue.
 *
 * Une carte présente des deux côtés (même `id`) n'est JAMAIS comparée champ à
 * champ : la version distante gagne intégralement — c'est la règle demandée
 * (« on écrit ce que le prof a voulu »), et ça évite un vrai moteur de fusion.
 */
export function mergeCards(local: Card[], remote: Card[]): { cards: Card[]; floatedCount: number } {
  const remoteIds = new Set(remote.map(card => card.id))
  const extra = local.filter(card => !remoteIds.has(card.id)).map(card => ({ ...card, parentId: null, detached: true }))
  return { cards: [...remote, ...extra], floatedCount: extra.length }
}
