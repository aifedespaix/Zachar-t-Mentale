import { pb } from './pb'
import {
  foldersUnder,
  mapsUnder,
  normalizePath,
  rebasedUnder,
  type LibraryFolder,
  type LibraryMap,
} from './tree'
import { serializeMindMap } from '@app/persistence/serialization'
import type { Card, MindMapMeta, UserRole } from '@app/types/card'
import { mapTypeOf } from '@app/types/mapType'

/**
 * Ce que l'interface d'administration fait au serveur.
 *
 * La partie qui DÉCIDE est séparée de la partie qui ÉCRIT : `planRelocation` et
 * `planRemoval` sont des fonctions pures, testées, et les fonctions `apply*`
 * se contentent d'exécuter leur plan. Cette séparation n'est pas de la
 * cérémonie — renommer un dossier réécrit le chemin de chaque carte qu'il
 * contient, parfois des dizaines, et une erreur de préfixe y déplace en
 * silence des fichiers qui n'ont rien demandé. C'est exactement le genre de
 * calcul qu'on veut pouvoir vérifier sans serveur.
 */

export const MIND_MAPS = 'cartes_mentales'
export const FOLDERS = 'dossiers'
export const SYNC_EVENTS = 'sync_events'
export const SYNC_CONFLICTS = 'sync_conflicts'

export interface RemoteConflict {
  id: string
  file_id: string
  path: string
  username: string
  local_modified: string
  remote_updated: string
  local_content: string
  status: 'open' | 'resolved'
  resolution?: string
  resolved_by?: string
  resolved_at?: string
  created: string
  updated: string
}

export interface RemoteSyncEvent {
  id: string
  username: string
  role: string
  level: 'info' | 'warning' | 'error'
  trigger: string
  summary: string
  pushed: number
  pulled: number
  conflicts: number
  failures: number
  cancelled: boolean
  detail: unknown
  device: string
  created: string
}

/** Une carte avec son contenu — la liste de l'arborescence ne le charge pas. */
export interface RemoteMap extends LibraryMap {
  content: string
}

/** Un chemin à réécrire, dans une collection ou l'autre. */
export interface PathUpdate {
  collection: typeof MIND_MAPS | typeof FOLDERS
  id: string
  path: string
}

export interface Removal {
  collection: typeof MIND_MAPS | typeof FOLDERS
  id: string
}

/**
 * Tout ce qu'il faut réécrire pour que `fromPath` devienne `toPath`.
 *
 * Vaut pour un renommage comme pour un déplacement : les deux sont la même
 * opération vue de ce côté-ci — un préfixe de chemin qui change. Un dossier
 * n'existant nulle part comme entité, il n'y a rien d'autre à faire que ça.
 *
 * L'ordre n'a aucune importance : chaque mise à jour est indépendante des
 * autres, et le chemin cible est calculé depuis l'état d'AVANT, jamais depuis
 * un état intermédiaire. C'est ce qui rend l'opération rejouable telle quelle
 * si elle échoue à mi-parcours.
 */
export function planRelocation(
  maps: readonly LibraryMap[],
  folders: readonly LibraryFolder[],
  fromPath: string,
  toPath: string
): PathUpdate[] {
  if (fromPath === toPath) return []

  const updates: PathUpdate[] = []

  // La carte elle-même, quand c'est une carte qu'on déplace.
  const self = maps.find(entry => normalizePath(entry.path) === fromPath)
  if (self !== undefined) {
    updates.push({ collection: MIND_MAPS, id: self.id, path: toPath })
  }

  for (const map of mapsUnder(maps, fromPath)) {
    updates.push({ collection: MIND_MAPS, id: map.id, path: rebasedUnder(normalizePath(map.path), fromPath, toPath) })
  }

  // `foldersUnder` inclut le dossier lui-même : le renommer, c'est d'abord
  // réécrire son propre enregistrement.
  for (const folder of foldersUnder(folders, fromPath)) {
    updates.push({ collection: FOLDERS, id: folder.id, path: rebasedUnder(normalizePath(folder.path), fromPath, toPath) })
  }

  return updates
}

/**
 * Tout ce qu'il faut supprimer pour que `path` disparaisse.
 *
 * Une suppression de dossier emporte sa branche entière — c'est la seule
 * sémantique cohérente avec un système de fichiers, et c'est aussi la plus
 * dangereuse : l'appelant DOIT montrer ce compte à l'utilisateur avant de
 * l'exécuter. `countMaps` existe pour ça.
 */
export function planRemoval(
  maps: readonly LibraryMap[],
  folders: readonly LibraryFolder[],
  path: string
): Removal[] {
  const removals: Removal[] = []
  const self = maps.find(entry => normalizePath(entry.path) === path)
  if (self !== undefined) removals.push({ collection: MIND_MAPS, id: self.id })
  for (const map of mapsUnder(maps, path)) removals.push({ collection: MIND_MAPS, id: map.id })
  for (const folder of foldersUnder(folders, path)) removals.push({ collection: FOLDERS, id: folder.id })
  return removals
}

/**
 * L'enveloppe d'une carte créée ICI.
 *
 * `meta` est indispensable : une carte publiée sans lui arriverait chez l'élève
 * comme un fichier « sans identité de synchronisation », invisible pour la
 * boucle d'envoi et impossible à modifier ensuite. C'est précisément le piège
 * que l'application de bureau signale dans ses réglages, et il n'y a aucune
 * raison de le tendre depuis l'admin.
 *
 * `lastModified` doit être postérieur à tout ce que le serveur connaît de ce
 * fichier ; pour une création, `now` convient par construction.
 */
export function buildNewMapContent(
  cards: readonly Card[],
  author: string,
  role: UserRole,
  type: string,
  now = new Date()
): { fileId: string; content: string; meta: MindMapMeta } {
  const fileId = crypto.randomUUID()
  const meta: MindMapMeta = {
    id: fileId,
    author,
    role,
    lastModified: now.toISOString(),
    type: mapTypeOf(type),
  }
  return { fileId, content: serializeMindMap(meta, [...cards]), meta }
}

/**
 * Le contenu d'une carte EXISTANTE, réécrit — en conservant son identité.
 *
 * `meta.author` ne bouge pas : un prof qui corrige la carte d'un élève ne la
 * lui prend pas. C'est la même discipline que celle de l'application de bureau
 * (`canEditContent` dans `src/sync/permissions.ts`), et elle compte : l'élève
 * doit continuer de pouvoir modifier son propre fichier après la correction.
 */
export function buildUpdatedMapContent(
  previousContent: string,
  cards: readonly Card[],
  fallbackAuthor: string,
  fallbackRole: UserRole,
  now = new Date()
): { content: string; meta: MindMapMeta } {
  let meta: MindMapMeta
  try {
    const parsed: unknown = JSON.parse(previousContent)
    const previousMeta =
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? ((parsed as { meta?: MindMapMeta }).meta ?? null)
        : null
    meta = previousMeta ?? { id: crypto.randomUUID(), author: fallbackAuthor, role: fallbackRole, lastModified: '' }
  } catch {
    meta = { id: crypto.randomUUID(), author: fallbackAuthor, role: fallbackRole, lastModified: '' }
  }
  const next: MindMapMeta = { ...meta, lastModified: now.toISOString() }
  return { content: serializeMindMap(next, [...cards]), meta: next }
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

/**
 * L'arborescence, SANS les contenus.
 *
 * `fields` n'est pas une micro-optimisation : `content` porte la carte mentale
 * entière, et une bibliothèque de cinquante chapitres se compte en mégaoctets.
 * Les charger tous pour afficher une liste de noms rendrait l'écran d'accueil
 * inutilisable sur un téléphone en 4G, c'est-à-dire dans la situation exacte
 * pour laquelle cette interface existe.
 */
export async function fetchMaps(): Promise<LibraryMap[]> {
  return pb.collection(MIND_MAPS).getFullList<LibraryMap>({
    fields: 'id,file_id,author,path,type,updated',
    sort: 'path',
  })
}

export async function fetchFolders(): Promise<LibraryFolder[]> {
  return pb.collection(FOLDERS).getFullList<LibraryFolder>({ fields: 'id,path', sort: 'path' })
}

/** Le contenu d'une carte, chargé seulement quand on l'ouvre. */
export async function fetchMap(id: string): Promise<RemoteMap> {
  return pb.collection(MIND_MAPS).getOne<RemoteMap>(id)
}

export async function fetchConflicts(): Promise<RemoteConflict[]> {
  return pb.collection(SYNC_CONFLICTS).getFullList<RemoteConflict>({
    // Les conflits ouverts d'abord, puis les plus récents : c'est l'ordre dans
    // lequel on veut les traiter, pas l'ordre chronologique pur.
    sort: '+status,-created',
  })
}

export async function fetchEvents(limit = 100): Promise<RemoteSyncEvent[]> {
  const page = await pb.collection(SYNC_EVENTS).getList<RemoteSyncEvent>(1, limit, { sort: '-created' })
  return page.items
}

// ---------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------

/**
 * Applique un plan de réécriture de chemins.
 *
 * Séquentiel, et c'est voulu : une salve de cinquante PATCH en parallèle
 * depuis un téléphone sature la connexion bien avant d'aller plus vite, et
 * brouille le diagnostic quand l'une d'elles échoue. `onProgress` permet à
 * l'interface de rester honnête pendant ce temps.
 */
export async function applyRelocation(updates: readonly PathUpdate[], onProgress?: (done: number, total: number) => void): Promise<void> {
  let done = 0
  for (const update of updates) {
    await pb.collection(update.collection).update(update.id, { path: update.path })
    done += 1
    onProgress?.(done, updates.length)
  }
}

export async function applyRemoval(removals: readonly Removal[], onProgress?: (done: number, total: number) => void): Promise<void> {
  let done = 0
  for (const removal of removals) {
    await pb.collection(removal.collection).delete(removal.id)
    done += 1
    onProgress?.(done, removals.length)
  }
}

export async function createFolder(path: string, createdBy: string): Promise<LibraryFolder> {
  return pb.collection(FOLDERS).create<LibraryFolder>({ path, created_by: createdBy })
}

export async function createMap(params: {
  path: string
  cards: readonly Card[]
  author: string
  role: UserRole
  type: string
}): Promise<void> {
  const { fileId, content } = buildNewMapContent(params.cards, params.author, params.role, params.type)
  await pb.collection(MIND_MAPS).create({
    file_id: fileId,
    author: params.author,
    path: params.path,
    content,
    type: mapTypeOf(params.type),
  })
}

export async function updateMapContent(
  id: string,
  previousContent: string,
  cards: readonly Card[],
  fallbackAuthor: string,
  fallbackRole: UserRole
): Promise<void> {
  const { content } = buildUpdatedMapContent(previousContent, cards, fallbackAuthor, fallbackRole)
  await pb.collection(MIND_MAPS).update(id, { content })
}

export async function updateMapType(id: string, type: string): Promise<void> {
  await pb.collection(MIND_MAPS).update(id, { type: mapTypeOf(type) })
}

/**
 * Classe un conflit.
 *
 * « Adopter la version locale » écrit ce contenu dans la carte ET marque le
 * conflit résolu. L'ordre compte : si l'écriture du contenu échoue, le conflit
 * doit rester OUVERT — le classer d'abord donnerait un conflit réputé tranché
 * dont la décision n'a jamais atteint le fichier.
 */
export async function resolveConflict(
  conflict: RemoteConflict,
  resolution: 'kept-remote' | 'took-local' | 'dismissed',
  resolvedBy: string
): Promise<void> {
  if (resolution === 'took-local') {
    if (conflict.local_content.trim() === '') {
      throw new Error('La version locale n’a pas été enregistrée : impossible de l’adopter.')
    }
    const record = await pb
      .collection(MIND_MAPS)
      .getFirstListItem<RemoteMap>(pb.filter('file_id = {:fileId}', { fileId: conflict.file_id }))
    await pb.collection(MIND_MAPS).update(record.id, { content: conflict.local_content })
  }
  await pb.collection(SYNC_CONFLICTS).update(conflict.id, {
    status: 'resolved',
    resolution,
    resolved_by: resolvedBy,
    resolved_at: new Date().toISOString(),
  })
}

export async function deleteConflict(id: string): Promise<void> {
  await pb.collection(SYNC_CONFLICTS).delete(id)
}
