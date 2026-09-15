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
  /** Le compte courant a le rôle prof — voir le cas « les deux ont bougé » ci-dessous. */
  iAmProf: boolean
}

/**
 * Qui a bougé, et ce qu'il faut en faire.
 *
 * Quand un seul côté a bougé, la règle ne dépend pas du rôle : « premier
 * arrivé gagne » suffit, et c'est valable aussi bien pour l'élève dont le prof
 * déplace un fichier (le serveur a bougé, je me relocalise) que pour le prof
 * qui vient de déplacer (j'ai bougé, je pousse).
 *
 * Quand les DEUX ont bougé, différemment, il faut trancher — et « égalité →
 * le serveur » était une course : gagnait celui dont le push avait atteint le
 * serveur en premier, prof ou élève indifféremment, y compris quand c'est le
 * rangement du PROF qui se faisait défaire par un élève plus rapide à
 * synchroniser. Le prof a le dernier mot : je pousse mon propre chemin si je
 * suis prof, sinon je me relocalise sur celui du serveur.
 */
export function reconcilePath({ relPath, lastSyncedPath, remotePath, iAmProf }: ReconcileParams): PathAction {
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
  if (iAmProf) return { kind: 'push-path' }
  return { kind: 'relocate', to: remotePath, bothMoved: true }
}
