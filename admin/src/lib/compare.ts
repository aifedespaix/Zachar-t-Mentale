import type { Card } from '@app/types/card'
import { parseMindMapText } from './quality'

/**
 * Ce qui sépare deux versions d'une même carte mentale.
 *
 * Pas un diff textuel : personne ne tranche un conflit en lisant deux colonnes
 * de JSON sur un écran de téléphone. La question réelle est « qu'est-ce que je
 * perds si je choisis l'autre ? », et elle se répond en cartes — celles qui
 * n'existent que d'un côté, et celles dont le texte a changé.
 *
 * La comparaison se fait par `id`, jamais par titre : renommer une carte est
 * une modification, pas une suppression suivie d'un ajout, et les confondre
 * ferait passer une correction de faute de frappe pour une refonte.
 */

export interface CardChange {
  id: string
  /** Le titre du côté qu'on regarde — l'ancien pour un retrait, le nouveau sinon. */
  title: string
  /** Pour un titre modifié, l'autre version : c'est la différence la plus visible. */
  otherTitle?: string
}

export interface MindMapComparison {
  /** Présentes dans la version LOCALE seulement. */
  onlyLocal: CardChange[]
  /** Présentes dans la version SERVEUR seulement. */
  onlyRemote: CardChange[]
  /** Présentes des deux côtés, avec un titre ou une définition différents. */
  changed: CardChange[]
  /** Identiques des deux côtés. */
  identical: number
  /** Aucune des deux versions n'a pu être lue. */
  unreadable: boolean
}

function cardsOf(content: string): Card[] | null {
  const parsed = parseMindMapText(content)
  if (parsed.cards === null) return null
  return parsed.cards.filter(
    (entry): entry is Card =>
      entry !== null && typeof entry === 'object' && typeof (entry as Card).id === 'string'
  )
}

/** Le texte qui « fait » la carte, pour décider si elle a bougé. */
function substanceOf(card: Card): string {
  return JSON.stringify([card.title ?? '', card.definition ?? '', card.content ?? null])
}

export function compareMindMaps(localContent: string, remoteContent: string): MindMapComparison {
  const local = cardsOf(localContent)
  const remote = cardsOf(remoteContent)

  if (local === null || remote === null) {
    return { onlyLocal: [], onlyRemote: [], changed: [], identical: 0, unreadable: true }
  }

  const localById = new Map(local.map(card => [card.id, card]))
  const remoteById = new Map(remote.map(card => [card.id, card]))

  const onlyLocal: CardChange[] = []
  const onlyRemote: CardChange[] = []
  const changed: CardChange[] = []
  let identical = 0

  for (const card of local) {
    const counterpart = remoteById.get(card.id)
    if (counterpart === undefined) {
      onlyLocal.push({ id: card.id, title: card.title })
      continue
    }
    if (substanceOf(card) === substanceOf(counterpart)) {
      identical += 1
      continue
    }
    changed.push({
      id: card.id,
      title: card.title,
      ...(card.title === counterpart.title ? {} : { otherTitle: counterpart.title }),
    })
  }

  for (const card of remote) {
    if (!localById.has(card.id)) onlyRemote.push({ id: card.id, title: card.title })
  }

  return { onlyLocal, onlyRemote, changed, identical, unreadable: false }
}

/**
 * Une phrase qui résume la comparaison.
 *
 * C'est elle qu'on lit en premier, et souvent la seule : « les deux versions
 * sont identiques » clôt la question sans rien ouvrir, et c'est un cas
 * fréquent — deux appareils qui ont enregistré le même travail à une seconde
 * d'intervalle produisent un conflit parfaitement vide.
 */
export function summarizeComparison(comparison: MindMapComparison): string {
  if (comparison.unreadable) return 'Impossible de comparer : une des deux versions est illisible.'
  const parts: string[] = []
  if (comparison.onlyLocal.length > 0) parts.push(`${comparison.onlyLocal.length} seulement en local`)
  if (comparison.onlyRemote.length > 0) parts.push(`${comparison.onlyRemote.length} seulement sur le serveur`)
  if (comparison.changed.length > 0) parts.push(`${comparison.changed.length} modifiée${comparison.changed.length > 1 ? 's' : ''}`)
  if (parts.length === 0) return 'Les deux versions ont exactement le même contenu.'
  return `${parts.join(', ')} · ${comparison.identical} identique${comparison.identical > 1 ? 's' : ''}`
}
