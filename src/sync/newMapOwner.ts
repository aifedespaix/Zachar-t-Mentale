import { isInsideFolder } from '../persistence/paths'
import type { SyncUser } from '../types/card'

export interface NewMapOwnerParams {
  /** Le dossier où la carte va naître. */
  folderPath: string
  /** Le compte connecté, `null` quand personne ne l'est. */
  currentUser: SyncUser | null
  /** La racine du dossier synchronisé, `null` quand la synchronisation n'est pas configurée. */
  syncFolderPath: string | null
}

/**
 * À qui appartient une carte qu'on vient de créer — donc, du même coup, si elle
 * se synchronise par défaut.
 *
 * La règle est celle du dossier : **dans le dossier synchronisé, une carte naît
 * publiée**. Elle porte une identité de synchronisation dès sa première
 * écriture, part au serveur à la synchronisation suivante, et son type
 * (« exo », « cours », « corrigé »…) est classable immédiatement — élève comme
 * prof, puisque `canClassify` autorise l'auteur.
 *
 * Avant, chaque carte naissait brouillon et il fallait penser à « Publier » :
 * un élève qui ne le faisait pas travaillait pour lui seul, sans jamais le
 * savoir, et le menu « Type » lui restait grisé.
 *
 * Deux refus, et un seul sens à chaque fois :
 *
 * - **personne n'est connecté** : il n'y a pas d'auteur à inscrire, et en
 *   inventer un ferait une carte qui prétend appartenir à quelqu'un ;
 * - **hors du dossier synchronisé** : rien ne l'y poussera jamais (la boucle
 *   d'envoi ne parcourt que ce dossier), et une identité de synchronisation y
 *   ne produirait qu'un badge « hors du dossier » sur chaque carte d'un
 *   utilisateur qui prend ses notes ailleurs.
 *
 * Les brouillons qui en résultent ne sont pas perdus pour autant : déplacés
 * dans le dossier synchronisé, la synchronisation suivante les adopte.
 */
export function newMapOwner({ folderPath, currentUser, syncFolderPath }: NewMapOwnerParams): SyncUser | null {
  if (currentUser === null || syncFolderPath === null) return null
  return isInsideFolder(folderPath, syncFolderPath) ? currentUser : null
}
