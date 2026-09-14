import type { SyncStateEntry } from '../persistence/syncState'
import { fileNameOf, parentDirOf } from '../persistence/paths'

/**
 * Ce que l'utilisateur décide pour UN conflit.
 *
 * - `accept-remote` : la version du serveur reprend la main (bouton bleu) ;
 * - `keep-local` : la version locale repart au serveur (bouton rouge) ;
 * - `copy` : les deux sont gardées — le serveur reprend le fichier d'origine,
 *   le travail local part dans une copie LIÉE (bouton orange).
 */
export type ConflictChoice = 'accept-remote' | 'keep-local' | 'copy'

/**
 * L'entrée d'état à écrire pour appliquer un choix — et RIEN D'AUTRE.
 *
 * Une résolution ne transfère aucun fichier elle-même. Elle réécrit la mémoire
 * du dernier sync, puis laisse la synchronisation suivante faire le transfert
 * par ses chemins habituels, déjà éprouvés : le tirage télécharge les images du
 * serveur et met les cartes locales absentes de côté (`mergeCards`) au lieu de
 * les perdre ; l'envoi pousse les images avant l'enregistrement. Réimplémenter
 * tout cela dans une boîte de dialogue, c'était s'offrir une deuxième version,
 * moins testée, de la seule partie de l'app qui peut détruire du travail.
 *
 * Concrètement, chaque choix désamorce UNE des deux moitiés du désaccord :
 *
 * - `accept-remote` (et `copy`, qui l'applique après avoir mis la version
 *   locale à l'abri) fait dire à l'entrée que le fichier local est à jour
 *   (`lastSyncedModified = meta.lastModified`) : plus rien à envoyer, donc plus
 *   de conflit, et `lastSyncedUpdated` restant en retard sur le serveur, le
 *   tirage écrit la version distante ;
 * - `keep-local` fait dire à l'entrée qu'on a VU la version du serveur
 *   (`lastSyncedUpdated` et `lastSyncedContentHash` de l'enregistrement
 *   distant) : `isConflict` se tait, l'envoi part, et le tirage passe son tour
 *   puisque la révision distante n'est plus en avance.
 *
 * L'empreinte enregistrée est celle du contenu distant TEL QU'IL ÉTAIT au
 * moment du conflit, et c'est volontaire : si le serveur a encore bougé entre
 * temps, le prochain `isConflict` compare une empreinte qui ne correspond plus
 * et redéclare un conflit — la nouvelle version distante est annoncée au lieu
 * d'être écrasée en silence.
 */
export function resolvedStateEntry(params: {
  choice: ConflictChoice
  entry: SyncStateEntry
  /** Le `meta.lastModified` du fichier local, relu au moment de résoudre. */
  localModified: string
  /** Le `updated` de l'enregistrement distant tel que le sync l'a vu. */
  remoteUpdated: string
  /** L'empreinte du contenu distant tel que le sync l'a vu. */
  remoteContentHash: string
}): SyncStateEntry {
  const { choice, entry, localModified, remoteUpdated, remoteContentHash } = params
  if (choice === 'keep-local') {
    return { ...entry, lastSyncedUpdated: remoteUpdated, lastSyncedContentHash: remoteContentHash }
  }
  return { ...entry, lastSyncedModified: localModified }
}

/** En quoi les deux côtés ne nomment pas le fichier au même endroit. */
export interface PathChange {
  /** Le nom du fichier, des deux côtés. */
  localName: string
  remoteName: string
  /** Le dossier (relatif à la racine de synchronisation), `''` à la racine. */
  localFolder: string
  remoteFolder: string
  /** Le fichier a été renommé d'un côté. */
  nameChanged: boolean
  /** Le fichier a changé de dossier d'un côté. */
  folderChanged: boolean
}

/**
 * Compare les deux chemins RELATIFS d'un conflit.
 *
 * Nom et dossier sont séparés parce qu'ils ne disent pas la même chose à
 * l'utilisateur : « ce n'est plus le même nom » est une décision de contenu,
 * « ce n'est plus le même dossier » est une décision de rangement, et le
 * comparatif doit pouvoir annoncer l'une sans l'autre.
 *
 * Les séparateurs sont normalisés — un chemin distant est toujours écrit en
 * `/`, un chemin local peut arriver en `\` sous Windows, et les comparer bruts
 * annoncerait un déplacement à chaque conflit sur cette plateforme.
 */
export function describePathChange(localPath: string, remotePath: string): PathChange {
  const normalize = (value: string) => value.replace(/[\\/]+/g, '/')
  const local = normalize(localPath)
  const remote = normalize(remotePath)
  const localName = fileNameOf(local)
  const remoteName = fileNameOf(remote)
  return {
    localName,
    remoteName,
    localFolder: parentDirOf(local),
    remoteFolder: parentDirOf(remote),
    nameChanged: localName !== remoteName,
    folderChanged: parentDirOf(local) !== parentDirOf(remote),
  }
}
