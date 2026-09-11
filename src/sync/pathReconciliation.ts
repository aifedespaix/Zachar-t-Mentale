/**
 * Les deux décisions pures du suivi de chemin. Elles vivent ici, hors de
 * `syncService`, pour être testables sans réseau, sans système de fichiers et
 * sans mock — c'est la partie du chantier où une erreur coûte un fichier
 * déplacé au mauvais endroit.
 */

export interface SeedParams {
  /** Le chemin mémorisé, ou `undefined` pour une entrée migrée/inconnue. */
  lastSyncedPath: string | undefined
  /** La racine mémorisée diffère de la racine courante. */
  rootChanged: boolean
  /** Le chemin relatif actuel du fichier local. */
  relPath: string
  /** Le `path` de l'enregistrement distant, `undefined` s'il n'y en a pas. */
  remotePath: string | undefined
}

/**
 * Le chemin de référence d'une entrée dont on ne sait rien.
 *
 * Inconnu (migration) et changé ne sont PAS le même cas : une racine présumée
 * inchangée laisse le chemin distant périmé se faire réparer (« j'ai bougé »),
 * tandis qu'une racine réellement changée ne doit surtout pas réécrire
 * l'agencement du serveur pour suivre le rangement local.
 */
export function seedLastSyncedPath({ lastSyncedPath, rootChanged, relPath, remotePath }: SeedParams): string {
  if (lastSyncedPath !== undefined) return lastSyncedPath
  if (rootChanged) return relPath
  return remotePath ?? relPath
}

export type PathAction =
  | { kind: 'none' }
  | { kind: 'push-path' }
  | { kind: 'relocate'; to: string; bothMoved: boolean }

export interface ReconcileParams {
  relPath: string
  lastSyncedPath: string
  remotePath: string | undefined
}

/**
 * Qui a bougé, et ce qu'il faut en faire. « Premier arrivé gagne, égalité → le
 * serveur » : aucune branche ne dépend du rôle, ce qui rend la règle valable
 * aussi bien pour l'élève dont le prof déplace un fichier que pour le prof qui
 * vient de déplacer.
 */
export function reconcilePath({ relPath, lastSyncedPath, remotePath }: ReconcileParams): PathAction {
  // Aucun enregistrement distant : la création enverra le chemin local, il n'y
  // a rien à réconcilier.
  if (remotePath === undefined) return { kind: 'none' }

  const iMoved = relPath !== lastSyncedPath
  const serverMoved = remotePath !== lastSyncedPath

  if (!iMoved && !serverMoved) return { kind: 'none' }
  if (iMoved && !serverMoved) return { kind: 'push-path' }
  if (!iMoved && serverMoved) return { kind: 'relocate', to: remotePath, bothMoved: false }
  // Les deux ont bougé.
  if (relPath === remotePath) return { kind: 'none' }
  return { kind: 'relocate', to: remotePath, bothMoved: true }
}
