/**
 * Les deux décisions pures du suivi de type. Elles vivent ici, hors de
 * `syncService`, pour être testables sans réseau, sans système de fichiers
 * et sans mock — c'est la partie où une erreur coûte une classification de prof
 * silencieusement annulée.
 */

import { DEFAULT_MAP_TYPE, mapTypeOf, type MapType } from '../types/mapType'

/**
 * Le type de référence d'une entrée dont on ne sait rien.
 *
 * Une entrée migrée décrit un serveur qui n'avait AUCUN champ de type : le point
 * d'accord implicite est donc `default`. Surtout pas le type local, qui
 * ferait passer une classification de prof pour « je n'ai pas bougé » et la
 * laisserait écraser.
 */
export function seedLastSyncedType(lastSyncedType: string | undefined): MapType {
  if (lastSyncedType === undefined) return DEFAULT_MAP_TYPE
  return mapTypeOf(lastSyncedType)
}

export type TypeAction =
  | { kind: 'none' }
  | { kind: 'push-type' }
  | { kind: 'adopt'; to: MapType; bothMoved: boolean }

export interface ReconcileTypeParams {
  /** Le `meta.type` local, déjà ramené au vocabulaire par `mapTypeOf`. */
  localType: MapType
  /** Le type de référence, déjà amarré par `seedLastSyncedType`. */
  lastSyncedType: MapType
  /** Le `type` brut de l'enregistrement distant, `undefined` s'il n'y en a pas. */
  remoteType: string | undefined
}

/**
 * Qui a bougé, et ce qu'il faut en faire. « Premier arrivé gagne, égalité → le
 * serveur » : aucune branche ne dépend du rôle, ce qui rend la règle valable
 * aussi bien pour l'élève dont le prof classe une carte que pour le prof qui
 * vient de classer.
 *
 * Le cas « les deux ont bougé vers le MÊME type » rend `none` : l'appelant
 * réamarre l'accord sur la valeur distante, comme la réconciliation de chemins
 * le fait pour un chemin identique des deux côtés.
 */
export function reconcileType({ localType, lastSyncedType, remoteType }: ReconcileTypeParams): TypeAction {
  // Aucun enregistrement distant : la création enverra le type local, il n'y a
  // rien à réconcilier.
  if (remoteType === undefined) return { kind: 'none' }
  const remote = mapTypeOf(remoteType)

  const iMoved = localType !== lastSyncedType
  const serverMoved = remote !== lastSyncedType

  if (!iMoved && !serverMoved) return { kind: 'none' }
  if (iMoved && !serverMoved) return { kind: 'push-type' }
  if (!iMoved && serverMoved) return { kind: 'adopt', to: remote, bothMoved: false }
  // Les deux ont bougé.
  if (localType === remote) return { kind: 'none' }
  return { kind: 'adopt', to: remote, bothMoved: true }
}
