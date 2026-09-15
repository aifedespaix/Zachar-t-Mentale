import { exists, mkdir, readDir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { loadMindMap, loadMindMapMeta, setMindMapType, stampMindMapSyncMeta } from '../persistence/fileStore'
import { scanFolder } from '../persistence/fileTree'
import { deletePath, renamePath } from '../persistence/fileOps'
import { archiveRemoteAsLinkedCopy, createLinkedCopy, unlinkIfAlone } from '../persistence/copyLinkOps'
import { readAssetBytes, writeAsset, sidecarDirOf } from '../persistence/assets'
import { serializeMindMap, deserializeMindMap } from '../persistence/serialization'
import { fileNameOf, isInsideFolder, isSameFilePath, parentDirOf, separatorOf } from '../persistence/paths'
import type { FileTreeNode } from '../types/workspace'
import type { MindMapMeta, SyncUser, UserRole } from '../types/card'
import { serverStateOf, type SyncState, type SyncStateEntry } from '../persistence/syncState'
import { canClassify, canEditContent, canReorder } from './permissions'
import { mergeCards } from './cardMerge'
import { mapTypeOf } from '../types/mapType'
import { hashContent } from './contentHash'
import { countCards, emptyCardCounts, type CardCounts } from './cardCounts'
import { reconcilePath, seedLastSyncedPath } from './pathReconciliation'
import { reconcileType, seedLastSyncedType } from './typeReconciliation'

export interface RemoteMindMapRecord {
  id: string
  file_id: string
  author: string
  path: string
  content: string
  updated: string
  /**
   * Le type décidé par l'app. Champ REQUIS : une valeur absente ne doit jamais
   * être confondue avec `default` — c'est le rôle de `SyncStateEntry.
   * lastSyncedType` de dire « inconnu ». `mapTypeOf` ramène toute valeur
   * inconnue, vide ou écrite par une version future à `default`.
   */
  type: string
}

export interface RemoteAssetRecord {
  id: string
  hash: string
  extension: string
}

/**
 * The one request option the sync threads through to PocketBase: cancelling a
 * run in flight. Every call is optional-options so a fake can ignore it.
 */
export interface RequestOptions {
  signal?: AbortSignal
}

export interface MindMapsApi {
  getFullList(options?: RequestOptions): Promise<RemoteMindMapRecord[]>
  create(
    data: { file_id: string; author: string; path: string; content: string; type: string },
    options?: RequestOptions
  ): Promise<RemoteMindMapRecord>
  /**
   * Un payload PARTIEL, et c'est le cœur du partage de l'agencement : PocketBase
   * fait un PATCH, donc un champ absent est laissé intact côté serveur. L'auteur
   * envoie `{ content }` et ne peut pas écraser le chemin choisi par un prof ; un
   * prof envoie `{ path }` sans jamais toucher au contenu.
   */
  update(
    id: string,
    data: { path?: string; content?: string; type?: string },
    options?: RequestOptions
  ): Promise<RemoteMindMapRecord>
  /** `undefined` quand l'enregistrement n'existe pas (jamais publié, ou déjà supprimé) — jamais une erreur. */
  getOne(fileId: string, options?: RequestOptions): Promise<RemoteMindMapRecord | undefined>
  /** Un 404 est un succès pour l'appelant : voir chaque point d'appel. */
  delete(id: string, options?: RequestOptions): Promise<void>
}

export interface AssetsApi {
  getFullList(options?: RequestOptions): Promise<RemoteAssetRecord[]>
  upload(hash: string, extension: string, bytes: Uint8Array, options?: RequestOptions): Promise<void>
  download(record: RemoteAssetRecord, options?: RequestOptions): Promise<Uint8Array>
}

/** Un dossier VIDE décidé ailleurs — voir `dossiers` dans `infra/pocketbase-schema.mjs`. */
export interface RemoteFolderRecord {
  id: string
  path: string
}

export interface FoldersApi {
  getFullList(options?: RequestOptions): Promise<RemoteFolderRecord[]>
}

export interface SyncClient {
  mindMaps: MindMapsApi
  assets: AssetsApi
  /**
   * OPTIONNELLE, et elle doit le rester : la collection `dossiers` n'existe que
   * sur un serveur auquel `setup-pocketbase.mjs` a été réappliqué. Un client
   * qui ne la fournit pas — ou un serveur qui répond 404 — synchronise
   * exactement comme avant, sans un dossier vide de moins ni une erreur de plus.
   */
  folders?: FoldersApi
}

/**
 * Ce qu'une résolution de conflit a besoin de MONTRER et d'APPLIQUER, capturé
 * pendant le sync parce que c'est le seul moment où les deux versions sont
 * là en même temps.
 *
 * Optionnel dans `SyncConflict` pour la même raison que `relocated` et ses
 * voisins dans `SyncResult` : plusieurs tests hors du périmètre de ce chantier
 * construisent des conflits littéraux, et `tsconfig` inclut tout `src`. `sync()`
 * le renseigne TOUJOURS ; la boîte de dialogue, elle, sait dire « relancez une
 * synchronisation » plutôt que d'afficher un comparatif vide.
 */
export interface SyncConflictDetail {
  /** Le chemin ABSOLU du fichier local — ce qu'une copie et une relecture visent. */
  localPath: string
  /** Le chemin RELATIF que le serveur détient : différent dès qu'un côté a renommé ou rangé. */
  remotePath: string
  /**
   * Le contenu distant tel que ce run l'a vu. Il sert au comparatif (compter
   * les cartes du serveur sans un aller-retour réseau de plus) et, quand
   * c'est la version locale qui cède, à `archiveRemoteAsLinkedCopy` pour la
   * mettre à l'abri.
   */
  remoteContent: string
  /** L'empreinte de `remoteContent`, déjà calculée par la détection de conflit. */
  remoteContentHash: string
  /** Combien de cartes, par niveau, de chaque côté. */
  localCounts: CardCounts
  remoteCounts: CardCounts
  /**
   * La version LOCALE entière, sérialisée — celle qui n'a PAS été envoyée.
   *
   * `remoteContent` est déjà là, et `localPath` suffit à la boîte de dialogue
   * locale, qui peut relire le fichier. Ce champ sert à l'ailleurs : sans lui,
   * un conflit ne se tranche que devant CETTE machine, seul endroit où cette
   * version existe. Le client la joint à son signalement pour que le prof
   * arbitre à distance depuis l'interface d'administration (`syncReporting.ts`).
   *
   * Absent quand le fichier n'a pas pu être lu ou sérialisé : un conflit se
   * signale TOUJOURS, même sans sa pièce jointe.
   */
  localContent?: string
}

/**
 * `content` : les deux ont changé le contenu — `detail` est alors renseigné.
 * `deleted-remote` : l'enregistrement a disparu et le fichier local a changé
 * depuis (ou est ouvert dans le canevas) — rien à comparer, `detail` absent.
 * `deleted-local` : une tombstone locale existe et le contenu distant a
 * changé depuis — `detail` absent aussi.
 */
export type SyncConflictKind = 'content' | 'deleted-remote' | 'deleted-local'

/**
 * A file both sides changed — or disagreed about deleting — since the last
 * sync. Reported here for the record — this is what `syncReporting.ts` sends
 * to `sync_conflicts` — but always already resolved by the time it lands in
 * this list: the prof wins, and the losing side is archived in a linked copy
 * first when there is content worth archiving. Never left open for a local
 * decision (see `2026-09-15-autorite-prof-conflits-design.md` and
 * `2026-09-15-suppression-publication-auto-sync-ciblee-design.md`).
 */
export interface SyncConflict {
  /** Absent = `content`, pour les littéraux de test écrits avant ce champ. */
  kind?: SyncConflictKind
  fileId: string
  path: string
  /** The local file's own `meta.lastModified`. */
  localModified: string
  /** The server record's `updated` — le dernier connu, pour `deleted-remote`. */
  remoteUpdated: string
  /** Tout ce qu'un comparatif de CONTENU demande — absent pour un conflit de suppression. */
  detail?: SyncConflictDetail
}

export interface SyncResult {
  pushed: number
  pulled: number
  errors: { fileId: string; message: string }[]
  /** The run stopped on the caller's signal instead of finishing its own walk. */
  cancelled: boolean
  /**
   * Every file that actually moved, in order. The counters summarise; this is
   * what a verbose log lists, and what a future "show me what changed" UI needs.
   */
  transferred: { fileId: string; path: string; direction: 'push' | 'pull' }[]
  /**
   * Files the two sides disagreed on. Already resolved by the time they
   * appear here — the prof's version wins, the other is archived in a linked
   * copy — kept for the record (`syncReporting.ts`), not as pending work.
   */
  conflicts: SyncConflict[]
  /**
   * Combien de fichiers locaux ont suivi un chemin décidé ailleurs.
   *
   * Ces trois champs sont OPTIONNELS dans le type — et pas par timidité :
   * plusieurs tests hors du périmètre de ce commit construisent des littéraux
   * `SyncResult` (`useSyncStore.test.ts`, `syncResultLabel.test.ts`,
   * `FileSidebar.test.tsx`, `SyncSettingsPanel.test.tsx`), et `tsconfig` inclut
   * tout `src` : les rendre obligatoires les casserait au `tsc` sans qu'on ait
   * le droit de les committer. `sync()` les renseigne TOUJOURS ; les lecteurs,
   * eux, les prennent avec `?? []`.
   */
  relocated?: number
  /** Le détail, en chemins ABSOLUS : l'interface en a besoin pour suivre le fichier ouvert. */
  moved?: { fileId: string; from: string; to: string }[]
  /** Ce qui n'est ni un échec ni un transfert : « les deux côtés avaient bougé ». */
  notices?: { fileId: string; message: string }[]
  /** Combien de cartes ont adopté le type décidé ailleurs. */
  reclassified?: number
  /** Un pull qui a mis des cartes locales de côté au lieu de les perdre. */
  merged?: { fileId: string; path: string; floatedCount: number }[]
  /** Combien de dossiers vides décidés ailleurs ont été créés localement. */
  foldersCreated?: number
  /** Une suppression distante propagée : le fichier local a disparu avec elle. */
  localDeleted?: number
  /** Une tombstone locale appliquée : l'enregistrement distant a disparu avec elle. */
  remoteDeleted?: number
  /** Un fichier `local-only` (jamais publié) publié tout seul par ce passage. */
  published?: number
}

/** Le résultat tel que `sync()` le construit : ces champs y sont toujours renseignés. */
type SyncRunResult = SyncResult &
  Required<
    Pick<
      SyncResult,
      'relocated' | 'moved' | 'notices' | 'reclassified' | 'merged' | 'localDeleted' | 'remoteDeleted' | 'published'
    >
  >

export interface SyncParams {
  client: SyncClient
  currentUser: string
  currentRole: UserRole
  serverUrl: string
  syncFolderPath: string
  state: SyncState
  /**
   * Le chemin ABSOLU du fichier actuellement chargé dans le canevas, s'il y en
   * a un. Un pull ne l'écrase jamais, quel que soit `lastSyncedUpdated` — le
   * réécrire sous une édition en cours romprait la garantie qu'une correction
   * ne fait jamais perdre le travail en train de se faire.
   */
  openFilePath?: string
  /**
   * Checked between two files, and handed to PocketBase so a slow request can be
   * cut short as well. An aborted run returns normally, with `cancelled: true`.
   */
  signal?: AbortSignal
  /** Called once per file handled — sent, received or failed — with the running count. */
  onProgress?: (done: number, total: number) => void
}

/** The PocketBase SDK flags a cancelled request this way (`ClientResponseError.isAbort`). */
function isAbortError(error: unknown): boolean {
  return error !== null && typeof error === 'object' && (error as { isAbort?: unknown }).isAbort === true
}

/** Un DELETE sur un enregistrement déjà absent : un succès, jamais une erreur à signaler. */
function isNotFoundError(error: unknown): boolean {
  return error !== null && typeof error === 'object' && (error as { status?: unknown }).status === 404
}

export interface PushPlan {
  content: boolean
  path: boolean
  type: boolean
}

/**
 * Ce qu'un sync enverrait pour ce fichier — contenu et chemin séparément.
 *
 * LE point de décision unique, partagé par la boucle d'envoi et par le compteur
 * « à envoyer » de l'interface : les deux appliquent la MÊME règle, donc le
 * nombre affiché ne peut pas contredire durablement ce qu'un sync ferait
 * réellement. Il intègre désormais le CHEMIN, sans quoi un fichier simplement
 * renommé resterait invisible dans le compteur tout en n'étant jamais envoyé —
 * le trou exact que ce chantier répare.
 *
 * Ce qui est vrai, et rien de plus : les deux tombent d'accord une fois la
 * réconciliation passée ET son résultat enregistré. Le compteur lit l'état du
 * disque, la boucle lit l'état réconcilié — deux écarts D'UN SEUL run sont donc
 * connus, et se réparent d'eux-mêmes au suivant :
 *
 * - une **entrée migrée** (compteur 0, le sync en envoie 1) : le chemin est
 *   inconnu, donc rien n'est « déplacé » pour le compteur ; la réconciliation
 *   l'amarre sur le `path` distant, ce qui rend l'envoi du chemin vrai ;
 * - **les deux côtés ont bougé vers le même chemin** (compteur 1, le sync en
 *   envoie 0) : la réconciliation n'a rien à faire, mais elle réamarre la base
 *   sur `remote.path`, et il n'y a alors plus rien à envoyer.
 *
 * Les corriger demanderait une requête réseau de plus au compteur, que la spec
 * refuse — ces deux écarts d'un run ne la justifient pas.
 *
 * Le contenu suit `canEditContent` — son auteur, ou un prof, exactement comme
 * `canReorder` pour le chemin et `canClassify` pour le type : un prof peut
 * corriger le contenu d'un élève sans jamais en devenir l'auteur. Le chemin
 * suit `canReorder`. Le type suit `canClassify` — bornée par ce que
 * `lastSyncedType` permet de comparer.
 *
 * `lastSyncedPath` ABSENT veut dire « inconnu », pas « différent » : une entrée
 * migrée depuis la v1 n'en a pas, et la lire comme un déplacement ferait
 * annoncer « N à envoyer » au premier lancement pour des fichiers qu'un sync
 * n'enverrait pas. La réparation des chemins périmés ne passe pas par ici : la
 * passe de réconciliation les amarre sur le chemin distant avant d'en décider.
 */
export function planPush(params: {
  meta: MindMapMeta
  relPath: string
  currentUser: SyncUser
  entry: SyncStateEntry | undefined
}): PushPlan {
  const { meta, relPath, currentUser, entry } = params
  const content =
    canEditContent(meta, currentUser) && (entry === undefined || entry.lastSyncedModified < meta.lastModified)
  // Entrée absente : l'enregistrement n'existe pas encore, et le `create` qui
  // s'ensuit porte le chemin de toute façon. Demander `path: true` ici n'y
  // changerait rien — ce drapeau ne décide que d'un `update({ path })`, et il
  // n'y a encore aucun enregistrement à mettre à jour.
  const path =
    entry !== undefined &&
    entry.lastSyncedPath !== undefined &&
    entry.lastSyncedPath !== relPath &&
    canReorder(meta, currentUser)
  // Le type est un petit frère du chemin : il ne part que si l'entrée existe,
  // qu'il diffère de l'accord, et qu'on a le droit de classer. mapTypeOf
  // normalise les deux côtés, donc une entrée migrée (lastSyncedType absent)
  // s'accorde implicitement sur default — jamais sur le type local, qui ferait
  // passer un classement de prof pour un changement à moi.
  const type =
    entry !== undefined &&
    mapTypeOf(entry.lastSyncedType) !== mapTypeOf(meta.type) &&
    canClassify(meta, currentUser)
  return { content, path, type }
}

/**
 * Si les deux côtés se contredisent sur le CONTENU.
 *
 * La comparaison porte sur l'empreinte du contenu distant, pas sur la seule
 * révision : une écriture distante qui n'a touché que le `path` (un déplacement
 * de prof) bumpe `updated` sans rien changer au contenu, et une comparaison de
 * révisions bloquerait alors l'auteur en « conflit » à chaque sync, pour
 * toujours. L'égalité des empreintes dit exactement ce qu'on veut savoir :
 * personne n'a écrit de contenu que je n'aie pas vu.
 *
 * Une entrée migrée n'a pas d'empreinte : on retombe sur la comparaison de
 * révisions d'avant, qui reste juste, simplement plus bruyante.
 *
 * Une entrée ABSENTE (`stateEntry === undefined`) n'est pas un conflit : sans
 * mémoire de ce qu'on a déjà vu de ce fichier, il n'y a rien à contredire.
 */
export function isConflict(
  meta: MindMapMeta,
  stateEntry: SyncStateEntry | undefined,
  remote: RemoteMindMapRecord | undefined,
  remoteContentHash: string
): remote is RemoteMindMapRecord {
  if (stateEntry === undefined || remote === undefined) return false
  if (meta.lastModified <= stateEntry.lastSyncedModified) return false
  if (stateEntry.lastSyncedContentHash === undefined) return remote.updated > stateEntry.lastSyncedUpdated
  return stateEntry.lastSyncedContentHash !== remoteContentHash
}

export interface SyncSurvey {
  /** Maps this account authored and changed since the last push: a sync would send them. */
  pending: string[]
  /**
   * Maps with NO sync identity at all (`meta === null`). They are invisible to
   * the push loop, and no amount of clicking « Synchroniser » will ever move
   * them — which is exactly what a user staring at « 0 envoyé » needs to be told.
   */
  localOnly: string[]
}

/**
 * What a sync WOULD do with the folder, without doing anything.
 *
 * Walks every `.zmap` and legacy `.json` of the sync folder, subfolders
 * included, and reads one header each — the same walk the sync itself does,
 * which is why the caller recomputes it on real events (a finished sync, a
 * published file, a re-scan) rather than on every render.
 *
 * A file that is not a mind map (a random `.json` lying in the folder) is not
 * ours and is skipped in silence; one that cannot be READ is skipped too, since
 * the sync itself reports it and a wrong number in the footer is worse than a
 * missing one.
 */
export async function surveySyncFolder(params: {
  syncFolderPath: string
  currentUser: SyncUser
  entries: Record<string, SyncStateEntry>
}): Promise<SyncSurvey> {
  const tree = await scanFolder(params.syncFolderPath)
  const survey: SyncSurvey = { pending: [], localOnly: [] }
  for (const path of flattenMindMapPaths(tree)) {
    // `loadMindMapMeta` throws on anything that is not a mind map, and answers
    // `null` for a map that has simply never been published: the two cases this
    // survey has to tell apart.
    const meta = await loadMindMapMeta(path).catch(() => undefined)
    if (meta === undefined) continue
    if (meta === null) {
      survey.localOnly.push(path)
      continue
    }
    const plan = planPush({
      meta,
      relPath: relativeTo(params.syncFolderPath, path),
      currentUser: params.currentUser,
      entry: params.entries[meta.id],
    })
    if (plan.content || plan.path || plan.type) survey.pending.push(path)
  }
  return survey
}

export type LocalMapScan =
  | { path: string; kind: 'map'; meta: MindMapMeta }
  | { path: string; kind: 'local-only' }
  | { path: string; kind: 'not-a-map' }
  | { path: string; kind: 'unreadable'; error: unknown }

/**
 * L'entrée « carte lisible », extraite de l'union : `Extract` plutôt qu'une
 * intersection `LocalMapScan & { kind: 'map' }`, qui laisserait les autres
 * membres accessibles et ferait échouer l'accès à `.meta`.
 */
export type MapScan = Extract<LocalMapScan, { kind: 'map' }>

/**
 * Une seule lecture de `meta` par fichier, pour tout le passage.
 *
 * La réconciliation des chemins et la boucle d'envoi ont besoin de la même
 * information ; la lire deux fois doublerait les accès disque d'un dossier
 * entier à chaque sync. Les quatre cas sont distingués ici une fois pour
 * toutes — `.json` qui n'est pas une carte (silence, ce n'est pas à nous),
 * carte sans identité de sync (le compteur « à publier »), fichier illisible
 * (une vraie erreur, reportée).
 */
export async function scanLocalMaps(syncFolderPath: string): Promise<LocalMapScan[]> {
  const tree = await scanFolder(syncFolderPath)
  const scans: LocalMapScan[] = []
  for (const path of flattenMindMapPaths(tree)) {
    try {
      const meta = await loadMindMapMeta(path)
      scans.push(meta === null ? { path, kind: 'local-only' } : { path, kind: 'map', meta })
    } catch (error) {
      scans.push((await isNonMindMapFile(path)) ? { path, kind: 'not-a-map' } : { path, kind: 'unreadable', error })
    }
  }
  return scans
}

/**
 * Whether a `.json` file is readable but is NOT a mind map — a data export, a
 * settings file, anything that happens to live in the synced folder.
 *
 * Such a file is not ours: the sync skips it without a word, rather than
 * reporting an error the user can do nothing about. A file that cannot even be
 * read is NOT this case (it is a real problem, and stays reported).
 */
async function isNonMindMapFile(path: string): Promise<boolean> {
  let text: string
  try {
    text = await readTextFile(path)
  } catch {
    return false
  }
  try {
    deserializeMindMap(text)
    return false
  } catch {
    return true
  }
}

/** Every mind map under `nodes`, subfolders included — the sync's own idea of "the folder". */
export function flattenMindMapPaths(nodes: FileTreeNode[]): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.type === 'mindmap') paths.push(node.path)
    else if (node.type === 'folder') paths.push(...flattenMindMapPaths(node.children))
  }
  return paths
}

function relativeTo(root: string, path: string): string {
  const separator = separatorOf(path)
  const relative = path.startsWith(root + separator) ? path.slice(root.length + 1) : fileNameOf(path)
  // Le `path` distant est la forme CANONIQUE, à slashes : un dossier poussé
  // depuis une machine POSIX et relu sous Windows se comparerait sinon
  // `Chimie/atomes.zmap` à `Chimie\atomes.zmap`, et chaque fichier serait lu
  // comme « déplacé », en attente perpétuelle.
  return relative.replace(/\\/g, '/')
}

function describeSyncError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'erreur inconnue'
}

/** Rejects anything but a plain, relative, single-directory-tree path — a record's `path` field is untrusted remote input. */
function isSafeRelativePath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.startsWith('\\')) return false
  if (/^[a-zA-Z]:/.test(path)) return false
  return path.split(/[/\\]/).every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

/** Every local `.assets` file the app wrote for this map — no need to parse card content, only content ever written is ever present. */
async function pushAssetsFor(
  client: SyncClient,
  mindMapPath: string,
  knownHashes: Set<string>,
  options?: RequestOptions
): Promise<void> {
  const sidecar = sidecarDirOf(mindMapPath)
  if (!(await exists(sidecar))) return
  const entries = await readDir(sidecar)
  for (const entry of entries) {
    const dot = entry.name.lastIndexOf('.')
    if (dot <= 0) continue
    const hash = entry.name.slice(0, dot)
    const extension = entry.name.slice(dot + 1)
    if (knownHashes.has(hash)) continue
    const bytes = await readAssetBytes(mindMapPath, entry.name)
    await client.assets.upload(hash, extension, bytes, options)
    knownHashes.add(hash)
  }
}

/**
 * Only assets whose `<hash>.<ext>` name literally appears in the pulled
 * `content` string are downloaded — content-addressed names are unique
 * enough that a substring check is exact here, and it avoids depending on
 * the card-block schema to find image references.
 */
function referencedAssets(content: string, knownAssets: RemoteAssetRecord[]): RemoteAssetRecord[] {
  return knownAssets.filter(asset => content.includes(`${asset.hash}.${asset.extension}`))
}

async function pullAssetsFor(
  client: SyncClient,
  mindMapPath: string,
  assets: RemoteAssetRecord[],
  options?: RequestOptions
): Promise<void> {
  for (const asset of assets) {
    const bytes = await client.assets.download(asset, options)
    await writeAsset(mindMapPath, bytes, asset.extension)
  }
}

/**
 * Le même `meta`, sans son LIEN DE COPIE.
 *
 * Le lien décrit un arrangement de FICHIERS sur une machine : « cette carte a
 * une copie à côté d'elle, même dossier, même nom ». Rien de tout cela n'est
 * vrai ailleurs — une autre machine n'a pas la copie —, donc il ne monte pas au
 * serveur, et un tirage ne l'écrase pas (voir `pullOne`). Ce n'est pas une
 * censure : c'est la différence entre le contenu d'une carte, qui se partage,
 * et le rangement d'un dossier, qui est à chacun.
 */
function withoutCopyLink(meta: MindMapMeta): MindMapMeta {
  if (meta.copyLink === undefined) return meta
  const { copyLink: _copyLink, ...rest } = meta
  return rest
}

/**
 * Le comparatif d'un conflit : où sont les deux versions, et de quoi elles sont
 * faites.
 *
 * Compter des cartes ne doit JAMAIS faire échouer une synchronisation. Un
 * fichier illisible d'un côté ou de l'autre donne un comptage vide plutôt
 * qu'une erreur : le conflit reste signalé, avec ses dates et ses chemins, et
 * c'est le seul message qui compte vraiment ici.
 */
async function conflictDetailOf(params: {
  localPath: string
  meta: MindMapMeta
  remote: RemoteMindMapRecord
  remoteContentHash: string
}): Promise<SyncConflictDetail> {
  const { localPath, meta, remote, remoteContentHash } = params
  // UNE lecture du fichier local, qui sert aux deux : les comptes du comparatif
  // et la copie sérialisée que le signalement emporte. Les séparer relirait le
  // même fichier deux fois pour la même information.
  const localCards = await loadMindMap(localPath).catch(() => null)
  const localCounts = localCards === null ? emptyCardCounts() : countCards(localCards)
  let localContent: string | undefined
  try {
    // `withoutCopyLink`, comme partout où du contenu part vers le serveur : ce
    // champ-ci n'est pas une exception, il atterrit dans `sync_conflicts` et se
    // relit depuis l'interface d'administration. Le lien de copie décrit un
    // arrangement de fichiers propre à CETTE machine ; l'emporter ferait
    // promettre à l'ailleurs une copie qui n'y existe pas.
    if (localCards !== null) localContent = serializeMindMap(withoutCopyLink(meta), localCards)
  } catch {
    localContent = undefined
  }
  let remoteCounts: CardCounts
  try {
    remoteCounts = countCards(deserializeMindMap(remote.content).cards)
  } catch {
    remoteCounts = emptyCardCounts()
  }
  return {
    localPath,
    remotePath: remote.path,
    remoteContent: remote.content,
    remoteContentHash,
    localCounts,
    remoteCounts,
    ...(localContent === undefined ? {} : { localContent }),
  }
}

async function ensureLocalFolder(path: string): Promise<void> {
  const dir = parentDirOf(path)
  if (dir && !(await exists(dir))) await mkdir(dir, { recursive: true })
}

/**
 * Réconcilie les chemins, puis push, puis pull, un `.zmap` à la fois. La
 * réconciliation passe en PREMIER et pour tout le monde : le tirage ignore les
 * enregistrements dont on est l'auteur, donc sans elle un fichier que le
 * serveur a déplacé ne reviendrait jamais à sa place.
 *
 * The fork model guarantees a given file is writable server-side by exactly
 * one author, so most disagreements resolve themselves: the newer side (by
 * `meta.lastModified` for a push, by the server's `updated` for a pull)
 * simply wins. The one case it cannot rule out — both sides changed a shared
 * file since the last sync — is settled by role, not by timing: the prof
 * always wins, and whichever side cedes is archived in a linked copy first
 * (see `2026-09-15-autorite-prof-conflits-design.md`). A per-file failure is
 * collected without aborting the rest of the batch.
 */
export async function sync({
  client,
  currentUser,
  currentRole,
  serverUrl,
  syncFolderPath,
  state,
  openFilePath,
  signal,
  onProgress,
}: SyncParams): Promise<SyncResult> {
  const result: SyncRunResult = {
    pushed: 0,
    pulled: 0,
    errors: [],
    cancelled: false,
    conflicts: [],
    transferred: [],
    relocated: 0,
    moved: [],
    notices: [],
    reclassified: 0,
    merged: [],
    localDeleted: 0,
    remoteDeleted: 0,
    published: 0,
  }

  const remoteRecords = await client.mindMaps.getFullList({ signal })
  const remoteAssets = await client.assets.getFullList({ signal })
  const knownHashes = new Set(remoteAssets.map(asset => asset.hash))
  const remoteByFileId = new Map(remoteRecords.map(record => [record.file_id, record]))

  const server = serverStateOf(state, serverUrl, syncFolderPath)
  const entries = server.entries
  // L'identité complète, pour ce qui dépend du rôle : `planPush` autorise un
  // prof à répercuter le chemin d'une carte d'élève.
  const viewer: SyncUser = { username: currentUser, role: currentRole }
  const aborted = () => signal?.aborted === true

  // ── Passe 1 : réconciliation des chemins ────────────────────────────────
  //
  // Avant tout le reste, et pour TOUT LE MONDE : le tirage ignore les
  // enregistrements dont on est l'auteur, donc sans cette passe un fichier que
  // le serveur a déplacé ne serait jamais ramené à sa place.
  const rootChanged = server.syncFolderPath !== null && server.syncFolderPath !== syncFolderPath
  server.syncFolderPath = syncFolderPath

  const scans = await scanLocalMaps(syncFolderPath)

  // ── Publication automatique ──────────────────────────────────────────
  //
  // Un fichier « local-only » (lisible comme carte mentale, sans `meta`) —
  // qu'il vienne d'être créé, dupliqué, importé ou déposé directement dans le
  // dossier — obtient son identité de sync ICI, avant tout le reste, et
  // traverse ensuite exactement le même chemin qu'un fichier déjà publié.
  // « Tous les fichiers sont synchronisés, pas de fichier pas synchronisé » —
  // voir `2026-09-15-suppression-publication-auto-sync-ciblee-design.md`.
  for (let i = 0; i < scans.length; i += 1) {
    const scan = scans[i]
    if (scan === undefined || scan.kind !== 'local-only') continue
    try {
      await stampMindMapSyncMeta(scan.path, viewer.username, viewer.role)
      const meta = await loadMindMapMeta(scan.path)
      if (meta === null) continue // ne devrait pas arriver ; laissé tel quel, retenté au prochain sync
      scans[i] = { path: scan.path, kind: 'map', meta }
      result.published += 1
    } catch (error) {
      // Laissé `local-only` : retenté au prochain sync, comme un push qui échoue.
      result.errors.push({ fileId: scan.path, message: describeSyncError(error) })
    }
  }

  async function reconcileOne(scan: MapScan): Promise<void> {
    const entry = entries[scan.meta.id]
    if (entry === undefined) return // jamais synchronisé : la création enverra le chemin
    const remote = remoteByFileId.get(scan.meta.id)
    const relPath = relativeTo(syncFolderPath, scan.path)
    const lastSyncedPath = seedLastSyncedPath({
      lastSyncedPath: entry.lastSyncedPath,
      rootChanged,
      relPath,
      remotePath: remote?.path,
    })
    entry.lastSyncedPath = lastSyncedPath

    // ── Type ────────────────────────────────────────────────────────────
    // L'accord est amarré AVANT de décider : une entrée migrée (lastSyncedType
    // absent) s'accorde implicitement sur default, jamais sur le type local, qui
    // ferait passer un classement de prof pour un changement à moi. Un
    // enregistrement ABSENT est le seul cas « pas de type » : un champ vide ou
    // manquant vaut default, pas « aucun enregistrement ».
    const seededLastSyncedType = seedLastSyncedType(entry.lastSyncedType)
    entry.lastSyncedType = seededLastSyncedType
    const typeAction = reconcileType({
      localType: mapTypeOf(scan.meta.type),
      lastSyncedType: seededLastSyncedType,
      remoteType: remote === undefined ? undefined : (remote.type ?? ''),
      iAmProf: currentRole === 'prof',
    })
    if (typeAction.kind === 'adopt') {
      try {
        await setMindMapType(scan.path, typeAction.to)
        // Le fichier porte désormais ce type : la copie en mémoire doit suivre,
        // sinon la boucle d'envoi le relirait comme un écart local et
        // reclasserait la carte dans l'autre sens.
        scan.meta.type = typeAction.to
        entry.lastSyncedType = typeAction.to
        result.reclassified += 1
        if (typeAction.bothMoved) {
          result.notices.push({
            fileId: scan.meta.id,
            message: '« ' + relPath + ' » a été classé des deux côtés : le type du serveur a été appliqué',
          })
        }
      } catch (error) {
        result.errors.push({ fileId: scan.meta.id, message: describeSyncError(error) })
      }
    }
    // Les deux côtés portent déjà le même type : réamarrer l'accord dessus,
    // sinon le push suivant renverrait une valeur identique.
    if (remote !== undefined && mapTypeOf(remote.type) === mapTypeOf(scan.meta.type)) {
      entry.lastSyncedType = mapTypeOf(remote.type)
    }

    const action = reconcilePath({
      relPath,
      lastSyncedPath,
      remotePath: remote?.path,
      iAmProf: currentRole === 'prof',
    })
    // Les deux côtés ont bougé vers le MÊME chemin : `reconcilePath` n'a rien à
    // faire, mais la base doit suivre le chemin distant. Sans ça, un fichier
    // dont le push de chemin est refusé (élève sur la carte d'un prof) garde
    // une base périmée, et un renommage local ULTÉRIEUR serait lu comme « les
    // deux ont bougé différemment » puis annulé par une relocalisation — une
    // action de l'utilisateur silencieusement défaite.
    if (remote !== undefined && remote.path === relPath) entry.lastSyncedPath = remote.path
    if (action.kind !== 'relocate') return

    // Le `path` d'un enregistrement est une entrée distante NON fiable — le
    // tirage le valide déjà, pour la même raison : `join(root, 'C:/x')` ou
    // `join(root, '../..')` remplacerait la racine du dossier de
    // synchronisation, et `ensureLocalFolder` créerait même les dossiers
    // parents. Rien n'est tenté tant que le chemin n'est pas prouvé relatif.
    if (!isSafeRelativePath(action.to)) {
      result.errors.push({ fileId: scan.meta.id, message: 'chemin distant invalide, fichier ignoré' })
      return
    }

    try {
      // Dans le `try` : un chemin que `join` ne sait pas résoudre est l'échec de
      // CE fichier, jamais l'abandon de tout le lot.
      const destination = await join(syncFolderPath, action.to)
      // « Le même fichier » se prouve par le CHEMIN, jamais par le `meta.id` :
      // deux fichiers locaux qui partagent un `file_id` sont exactement la
      // duplication que la boucle d'envoi signale, et `fs.rename` remplacerait
      // l'un par l'autre sans un mot. La comparaison normalise les séparateurs
      // et ignore la casse, donc un renommage qui ne change que la casse reste
      // le même fichier et n'est pas refusé à chaque sync.
      //
      // Lire le `meta` de l'occupant pour en décider était pire : un occupant
      // qui n'est pas une carte, ou qui est illisible, faisait remonter son
      // erreur d'analyse brute au lieu de la seule chose utile à dire ici.
      if ((await exists(destination)) && !isSameFilePath(destination, scan.path)) {
        result.errors.push({
          fileId: scan.meta.id,
          message: `impossible de replacer « ${relPath} » : « ${action.to} » existe déjà`,
        })
        return
      }
      await ensureLocalFolder(destination)
      await renamePath(scan.path, destination)
      const from = scan.path
      scan.path = destination
      entry.lastSyncedPath = action.to
      result.relocated += 1
      result.moved.push({ fileId: scan.meta.id, from, to: destination })
      if (action.bothMoved) {
        result.notices.push({ fileId: scan.meta.id, message: `« ${action.to} » a été déplacé des deux côtés : le chemin du serveur a été appliqué` })
      }
    } catch (error) {
      result.errors.push({ fileId: scan.meta.id, message: describeSyncError(error) })
    }
  }

  for (const scan of scans) {
    if (aborted()) {
      result.cancelled = true
      break
    }
    if (scan.kind === 'map') await reconcileOne(scan)
  }

  // ── Passe 2 : propagation des suppressions distantes ────────────────────
  //
  // Un `file_id` connu (une entrée existe) qui n'est plus dans la liste
  // distante a été supprimé — par son auteur, par un prof, ou depuis
  // l'administration. Propager est le cas normal. Un désaccord réel (le
  // fichier a changé ici depuis, ou est ouvert) devient un conflit tranché
  // par rôle, jamais par un dialogue — voir
  // `2026-09-15-autorite-prof-conflits-design.md`.
  const locallyDeletedFileIds = new Set<string>()

  async function propagateRemoteDeletion(fileId: string, entry: SyncStateEntry): Promise<void> {
    // Retrouvé parmi les scans DÉJÀ faits — jamais par `entry.lastSyncedPath`,
    // qui peut être périmé (un fichier déplacé localement avant qu'un
    // enregistrement distant n'existe pour le réconcilier). Chercher par
    // `meta.id` distingue « vraiment introuvable » de « juste ailleurs ».
    const localScan = scans.find((scan): scan is MapScan => scan.kind === 'map' && scan.meta.id === fileId)
    if (localScan === undefined) {
      delete entries[fileId]
      return
    }
    const relPath = relativeTo(syncFolderPath, localScan.path)

    // Le fichier ouvert dans le canevas n'est jamais supprimé sous les pieds
    // de qui édite, quel que soit `lastModified` : c'est un désaccord, pas
    // un cas simple.
    const isOpen = isSameFilePath(localScan.path, openFilePath ?? '')
    if (!isOpen && localScan.meta.lastModified <= entry.lastSyncedModified) {
      try {
        const link = localScan.meta.copyLink
        await deletePath(localScan.path, false)
        if (link !== undefined) await unlinkIfAlone(parentDirOf(localScan.path), link.groupId).catch(() => {})
        delete entries[fileId]
        locallyDeletedFileIds.add(fileId)
        result.localDeleted += 1
      } catch (error) {
        result.errors.push({ fileId, message: describeSyncError(error) })
      }
      return
    }

    result.conflicts.push({
      kind: 'deleted-remote',
      fileId,
      path: relPath,
      localModified: localScan.meta.lastModified,
      remoteUpdated: entry.lastSyncedUpdated,
    })
    if (currentRole === 'prof') {
      // Le prof a le dernier mot : rien n'est touché ici, sa version repart
      // au serveur par le push normal qui suit (`remote` absent → `create`).
      result.notices.push({
        fileId,
        message: `« ${relPath} » avait été supprimé côté serveur, mais votre version a changé depuis — elle repart au serveur`,
      })
      return
    }
    try {
      const archived = await createLinkedCopy({ sourcePath: localScan.path, author: viewer.username, role: viewer.role })
      await deletePath(localScan.path, false)
      delete entries[fileId]
      locallyDeletedFileIds.add(fileId)
      result.localDeleted += 1
      result.notices.push({
        fileId,
        message: `« ${relPath} » a été supprimé côté serveur — votre version, qui avait changé, a été gardée dans « ${fileNameOf(archived.path)} »`,
      })
    } catch (error) {
      result.errors.push({ fileId, message: describeSyncError(error) })
    }
  }

  for (const [fileId, entry] of Object.entries(entries)) {
    if (aborted()) {
      result.cancelled = true
      break
    }
    if (remoteByFileId.has(fileId)) continue
    await propagateRemoteDeletion(fileId, entry)
  }

  // ── Passe 3 : application des tombstones ─────────────────────────────────
  //
  // `remoteRecords`/`remoteByFileId` sont un INSTANTANÉ pris au tout début de
  // `sync()` : un `mindMaps.delete` réussi ici ne les met pas à jour. Sans
  // cet ensemble, le tirage qui suit reverrait le même enregistrement dans
  // cet instantané et le retélécharger ait — ressuscitant ce qu'on vient de
  // supprimer, dans le MÊME passage.
  const remoteDeletedThisRun = new Set<string>()

  async function applyTombstone(fileId: string): Promise<void> {
    const recreatedLocally = scans.some(
      scan => scan.kind === 'map' && scan.meta.id === fileId && !locallyDeletedFileIds.has(fileId)
    )
    if (recreatedLocally) {
      server.tombstones = server.tombstones.filter(id => id !== fileId)
      return
    }

    const remote = remoteByFileId.get(fileId)
    if (remote === undefined) {
      server.tombstones = server.tombstones.filter(id => id !== fileId)
      delete entries[fileId]
      return
    }

    const entry = entries[fileId]
    let changed: boolean
    if (entry === undefined) {
      changed = false
    } else if (entry.lastSyncedContentHash !== undefined) {
      changed = entry.lastSyncedContentHash !== (await hashContent(remote.content))
    } else {
      changed = remote.updated > entry.lastSyncedUpdated
    }

    async function deleteRemoteRecord(): Promise<boolean> {
      try {
        await client.mindMaps.delete(remote!.id, { signal })
        return true
      } catch (error) {
        if (isNotFoundError(error)) return true
        result.errors.push({ fileId, message: describeSyncError(error) })
        return false
      }
    }

    if (!changed) {
      if (!(await deleteRemoteRecord())) return
      server.tombstones = server.tombstones.filter(id => id !== fileId)
      delete entries[fileId]
      remoteDeletedThisRun.add(fileId)
      result.remoteDeleted += 1
      return
    }

    result.conflicts.push({
      kind: 'deleted-local',
      fileId,
      path: remote.path,
      localModified: entry?.lastSyncedModified ?? remote.updated,
      remoteUpdated: remote.updated,
    })
    if (currentRole === 'prof') {
      if (!(await deleteRemoteRecord())) return
      server.tombstones = server.tombstones.filter(id => id !== fileId)
      delete entries[fileId]
      remoteDeletedThisRun.add(fileId)
      result.remoteDeleted += 1
      result.notices.push({
        fileId,
        message: `« ${remote.path} » supprimé malgré une modification depuis votre demande — vous avez le dernier mot`,
      })
      return
    }
    // L'élève cède : la suppression est annulée, l'entrée reste en retard sur
    // la révision distante — le tirage qui suit, dans ce même passage,
    // retélécharge normalement la version plus récente.
    server.tombstones = server.tombstones.filter(id => id !== fileId)
    result.notices.push({
      fileId,
      message: `« ${remote.path} » : vous l'aviez supprimé, mais il a changé depuis — la version du serveur est restaurée`,
    })
  }

  for (const fileId of [...server.tombstones]) {
    if (aborted()) {
      result.cancelled = true
      break
    }
    await applyTombstone(fileId)
  }

  // Rien de plus n'a pu être décidé une fois annulé — un scan mal formé
  // (jamais réel, seulement un double de test incomplet) ne doit pas non
  // plus faire échouer ce filtre pour autant.
  const scansAfterDeletion = aborted()
    ? scans
    : scans.filter(scan => scan.kind !== 'map' || !locallyDeletedFileIds.has(scan.meta.id))

  // Both halves are known up front, so the caller can show « 4/12 » from the
  // first file rather than a spinner with no end in sight.
  const total = scansAfterDeletion.length + remoteRecords.length
  let done = 0
  const report = () => {
    done += 1
    onProgress?.(done, total)
  }

  // Guards a single sync run against two local files claiming the same
  // `meta.id`: without it, alternating pushes of two different files would
  // corrupt one shared remote record. This does not (and isn't meant to)
  // prevent such a duplicate from arising in the first place.
  const seenFileIds = new Set<string>()

  /** Everything the push pass does for ONE local file. */
  async function pushOne(scan: MapScan): Promise<void> {
    const meta = scan.meta

    if (seenFileIds.has(meta.id)) {
      result.errors.push({ fileId: meta.id, message: 'plusieurs fichiers locaux partagent le même identifiant de synchronisation' })
      return
    }
    seenFileIds.add(meta.id)

    const known = entries[meta.id]
    const remote = remoteByFileId.get(meta.id)
    // Le compteur de l'interface et cette boucle lisent la MÊME décision :
    // `planPush` encode « le contenu à son auteur, le chemin à qui peut
    // réarranger ». Le garde d'auteur a disparu — il sortait AVANT de consulter
    // ce plan, donc un prof ne pouvait jamais répercuter le rangement d'un
    // élève, et le badge « à envoyer » mentait pour toujours.
    const plan = planPush({ meta, relPath: relativeTo(syncFolderPath, scan.path), currentUser: viewer, entry: known })
    if (!plan.content && !plan.path && !plan.type) return

    // Un conflit porte sur du CONTENU, jamais sur un rangement : le contrôle ne
    // s'applique donc que si c'est du contenu qu'on s'apprête à envoyer.
    // Calculée à la même condition qu'avant d'être sortie de la ligne ci-dessous
    // (`plan.content &&`) : une empreinte est un hachage du contenu complet, et
    // la prendre pour tous les fichiers d'un dossier alors que la plupart n'ont
    // rien à envoyer serait un coût pur.
    const remoteContentHash = plan.content && remote !== undefined ? await hashContent(remote.content) : ''
    if (plan.content && isConflict(meta, known, remote, remoteContentHash)) {
      // Signalé pour le journal et le rapport à l'administration (voir
      // `syncReporting.ts`), mais TRANCHÉ ici même — le prof a le dernier mot,
      // voir `2026-09-15-autorite-prof-conflits-design.md`. Rien n'est perdu :
      // la version qui cède est mise à l'abri dans une copie liée avant d'être
      // remplacée.
      const relPath = relativeTo(syncFolderPath, scan.path)
      result.conflicts.push({
        fileId: meta.id,
        path: relPath,
        localModified: meta.lastModified,
        remoteUpdated: remote.updated,
        // Le comparatif est monté ICI parce que c'est le seul instant où les
        // deux versions sont sous la main : plus tard, il faudrait retélécharger
        // l'enregistrement pour pouvoir seulement compter ses cartes.
        detail: await conflictDetailOf({ localPath: scan.path, meta, remote, remoteContentHash }),
      })

      if (currentRole !== 'prof') {
        // L'élève cède : sa version locale part dans une copie liée, et cette
        // fonction s'arrête là — le tirage qui suit dans ce même passage écrira
        // la version du prof à sa place, exactement comme il le ferait pour
        // n'importe quel enregistrement plus récent que ce qu'on a vu.
        try {
          const archived = await createLinkedCopy({ sourcePath: scan.path, author: viewer.username, role: viewer.role })
          result.notices.push({
            fileId: meta.id,
            message: `« ${relPath} » : modifié des deux côtés — le prof a le dernier mot, votre version a été gardée dans « ${fileNameOf(archived.path)} »`,
          })
        } catch (error) {
          result.errors.push({ fileId: meta.id, message: describeSyncError(error) })
        }
        return
      }

      // Le prof gagne : sa version locale part au serveur comme n'importe quel
      // push de contenu (la suite de la fonction s'en charge) — mais d'abord,
      // la version distante qu'elle remplace est mise à l'abri.
      try {
        const archived = await archiveRemoteAsLinkedCopy({
          anchorPath: scan.path,
          remoteContent: remote.content,
          author: viewer.username,
          role: viewer.role,
        })
        if (archived !== null) {
          // Les images que ce contenu référence ne sont pas encore sur cette
          // machine : sans ce tirage, la copie archivée aurait des images
          // cassées alors qu'elles existent bel et bien sur le serveur.
          await pullAssetsFor(client, archived.path, referencedAssets(remote.content, remoteAssets), { signal })
          result.notices.push({
            fileId: meta.id,
            message: `« ${relPath} » : modifié des deux côtés — vous avez le dernier mot, l'autre version a été gardée dans « ${fileNameOf(archived.path)} »`,
          })
        }
      } catch (error) {
        result.errors.push({ fileId: meta.id, message: describeSyncError(error) })
      }
    }

    try {
      // Un `create` exige le champ `content`, et le contenu n'appartient qu'à
      // son auteur : quand l'enregistrement distant a disparu et que ce n'est
      // PAS notre contenu, on ne recrée rien. Publier la carte d'un élève sous
      // son nom ferait de son prochain push un conflit, et de son prochain
      // tirage l'écrasement de son fichier par la copie du prof. Un
      // enregistrement disparu côté serveur est l'affaire du plan de
      // suppression, pas d'un ré-envoi silencieux.
      if (remote === undefined && !plan.content) return

      let content: string | undefined
      let contentHash: string | undefined
      if (plan.content) {
        const cards = await loadMindMap(scan.path)
        if (cards === null) return
        // La sérialisation est calculée UNE fois : cette chaîne est celle
        // envoyée au serveur ET celle dont on prend l'empreinte. Hacher un
        // jumeau sérialisé différemment rendrait la comparaison de conflit
        // « toujours différente » pour tout fichier modifié, sans qu'aucun
        // test ne tombe.
        content = serializeMindMap(withoutCopyLink(meta), cards)
        contentHash = await hashContent(content)
        // Assets are pushed BEFORE the record that references them: an
        // observer's getFullList() must never see a record whose content
        // names an asset hash with no matching asset row yet — that image
        // would then never be retried (the pull-side `>=` skip check treats
        // the record's `updated` as fully synced regardless of its assets).
        await pushAssetsFor(client, scan.path, knownHashes, { signal })
      }
      const relPath = relativeTo(syncFolderPath, scan.path)
      // Le chemin n'est enregistré que s'il a RÉELLEMENT été envoyé : `create`
      // le porte toujours, `update` seulement quand le plan le demande.
      const sentPath = plan.path || remote === undefined
      let savedRecord: RemoteMindMapRecord
      if (remote === undefined) {
        // Inatteignable : `plan.content` est vrai ici, donc `content` est un
        // string — l'affirmation n'existe que pour le type.
        if (content === undefined) return
        savedRecord = await client.mindMaps.create(
          { file_id: meta.id, author: meta.author, path: relPath, content, type: mapTypeOf(meta.type) },
          { signal }
        )
      } else {
        // Le champ qu'on a le droit d'écrire, et lui seul : le contenu à son
        // auteur, le chemin à qui peut réarranger. Envoyer les deux à chaque
        // fois laisserait l'élève annuler sans le savoir le rangement du prof.
        const payload: { path?: string; content?: string; type?: string } = {}
        if (plan.content) payload.content = content
        if (plan.path) payload.path = relPath
        if (plan.type) payload.type = mapTypeOf(meta.type)
        savedRecord = await client.mindMaps.update(remote.id, payload, { signal })
      }

      entries[meta.id] = {
        // Un push de chemin SEUL ne réécrit pas la révision de contenu vue par
        // ce client : un prof n'écrit pas le contenu d'un élève.
        lastSyncedModified: plan.content ? meta.lastModified : (known?.lastSyncedModified ?? meta.lastModified),
        lastSyncedUpdated: savedRecord.updated,
        // Enregistrer un chemin qui n'a PAS été envoyé ferait dire à l'entrée
        // que le serveur est au chemin local alors qu'il garde l'ancien : la
        // passe suivante lirait ça comme « le serveur a bougé » et ramènerait
        // le fichier de l'utilisateur à l'ancien emplacement — le renommage de
        // l'utilisateur silencieusement défait.
        lastSyncedPath: sentPath ? relPath : known?.lastSyncedPath,
        // Même règle que le chemin : le `create` porte TOUJOURS le type, l'`update`
        // seulement quand le plan le demande. Tant qu'il n'est pas envoyé, l'accord
        // reste celui qu'on connaissait — l'enregistrer ferait croire au serveur
        // qu'il détient déjà ce type.
        lastSyncedType: plan.type || remote === undefined ? mapTypeOf(meta.type) : known?.lastSyncedType,
        lastSyncedContentHash: plan.content ? contentHash : known?.lastSyncedContentHash,
      }
      result.pushed += 1
      result.transferred.push({ fileId: meta.id, path: relPath, direction: 'push' })
    } catch (error) {
      // A cancelled request is not a file that failed: the run stops, without
      // blaming a file the user themselves interrupted.
      if (aborted() || isAbortError(error)) {
        result.cancelled = true
        return
      }
      result.errors.push({ fileId: meta.id, message: describeSyncError(error) })
    }
  }

  for (const scan of scansAfterDeletion) {
    if (aborted()) {
      result.cancelled = true
      break
    }
    if (scan.kind === 'unreadable') {
      result.errors.push({ fileId: scan.path, message: describeSyncError(scan.error) })
    } else if (scan.kind === 'map') {
      await pushOne(scan)
    }
    report()
    if (result.cancelled) break
  }

  /**
   * Everything the pull pass does for ONE remote record.
   *
   * No author guard here on purpose: `canEditContent` (see `planPush`) lets a
   * prof push a correction under the ELÈVE's own `author`, so authorship can
   * no longer stand in for "nobody else could have changed this". The check
   * right below already answers the right question — has the SERVER moved
   * since I last saw it — using the pre-push snapshot `remoteRecords` was
   * built from at the top of `sync()`, which is why a file I just pushed
   * myself, in this very run, is already caught by it.
   */
  async function pullOne(record: RemoteMindMapRecord): Promise<void> {
    const known = entries[record.file_id]
    if (known && known.lastSyncedUpdated >= record.updated) return

    if (!isSafeRelativePath(record.path)) {
      result.errors.push({ fileId: record.file_id, message: 'chemin distant invalide, fichier ignoré' })
      return
    }

    try {
      const { meta, cards } = deserializeMindMap(record.content)
      const localPath = await join(syncFolderPath, record.path)
      // Le fichier ouvert dans le canevas n'est JAMAIS réécrit par un pull, même
      // si le serveur a bougé : une correction ne doit pas écraser une édition
      // en cours. Il sera relu au prochain sync, une fois refermé.
      if (isSameFilePath(localPath, openFilePath ?? '')) return

      // A locally-created file can already sit at the path a remote record
      // resolves to — most dangerously, one that has never been synced
      // (`meta === null`) and so is invisible to the push loop above and
      // backed up nowhere. Only overwrite when the file already there is a
      // previous pull/update of THIS SAME record; anything else is left
      // alone and reported instead of silently destroyed.
      // Relu ICI plutôt que dans la seule branche du garde ci-dessous : son lien
      // de copie doit survivre à la réécriture, quelques lignes plus bas.
      const alreadyThere = await exists(localPath)
      const localMeta = alreadyThere ? await loadMindMapMeta(localPath) : null
      if (alreadyThere && (localMeta === null || localMeta.id !== record.file_id)) {
        result.errors.push({
          fileId: record.file_id,
          message: 'un fichier local existe déjà à cet emplacement et n’est pas ce fichier synchronisé',
        })
        return
      }

      await ensureLocalFolder(localPath)
      // Toute carte locale absente de la version reçue devient volante au lieu
      // d'être perdue — voir `mergeCards`. Rien à fusionner pour un premier
      // pull (`localCards === null`, rien n'existait avant).
      const localCards = await loadMindMap(localPath)
      const { cards: mergedCards, floatedCount } =
        localCards === null ? { cards, floatedCount: 0 } : mergeCards(localCards, cards)
      if (floatedCount > 0) {
        result.merged.push({ fileId: record.file_id, path: record.path, floatedCount })
      }
      // Le champ `type` de l'enregistrement fait foi : la copie locale est
      // réécrite avec lui, sans toucher au reste du `meta`. Le LIEN DE COPIE,
      // lui, est remis tel qu'il était en local : il ne vient pas du serveur
      // (voir `withoutCopyLink`), donc sans cette ligne le premier tirage venu
      // délierait une copie que l'utilisateur a expressément demandée.
      const applied =
        meta === null
          ? null
          : {
              ...meta,
              type: mapTypeOf(record.type),
              ...(localMeta?.copyLink === undefined ? {} : { copyLink: localMeta.copyLink }),
            }
      const serialized = serializeMindMap(applied, mergedCards)
      await writeTextFile(localPath, serialized)
      // `referencedAssets` lit la chaîne ÉCRITE (`serialized`), jamais la chaîne
      // reçue : ce sont les mêmes références, mais une seule est le fichier réel.
      await pullAssetsFor(client, localPath, referencedAssets(serialized, remoteAssets), { signal })
      // L'empreinte est prise sur la chaîne FINALEMENT ÉCRITE, jamais sur la
      // chaîne reçue : c'est le fichier réel, donc la seule base juste pour la
      // comparaison de conflit du prochain passage. Sans son lien de copie,
      // toutefois : ce qu'elle sert à comparer, c'est le contenu DISTANT, qui
      // n'en porte jamais. La prendre sur le fichier tel quel ferait déclarer un
      // conflit à chaque édition d'une carte liée, le lien suffisant à faire
      // diverger les deux empreintes pour toujours.
      const comparable = applied === null ? serialized : serializeMindMap(withoutCopyLink(applied), mergedCards)
      entries[record.file_id] = {
        lastSyncedModified: meta?.lastModified ?? record.updated,
        lastSyncedUpdated: record.updated,
        lastSyncedPath: record.path,
        lastSyncedType: mapTypeOf(record.type),
        lastSyncedContentHash: await hashContent(comparable),
      }
      result.pulled += 1
      result.transferred.push({ fileId: record.file_id, path: record.path, direction: 'pull' })
    } catch (error) {
      if (aborted() || isAbortError(error)) {
        result.cancelled = true
        return
      }
      result.errors.push({ fileId: record.file_id, message: describeSyncError(error) })
    }
  }

  for (const record of remoteRecords) {
    // An interrupted push stops the whole run: the user asked to stop, not to
    // continue with the other half.
    if (result.cancelled || aborted()) {
      result.cancelled = true
      break
    }
    // Un enregistrement que la passe 3 vient de supprimer est encore dans cet
    // instantané — le retirer avant le tirage évite de ressusciter, dans ce
    // même passage, ce qu'on vient de supprimer. `report()` compte quand même :
    // `total` a été fixé sur la taille de cet instantané.
    if (!remoteDeletedThisRun.has(record.file_id)) await pullOne(record)
    report()
  }

  // Les dossiers VIDES, en dernier — après que les fichiers ont créé les leurs.
  //
  // Un dossier peuplé n'a pas besoin de cette passe : `pullOne` crée déjà
  // l'arborescence de chaque fichier qu'il écrit. Ne restent donc ici que les
  // dossiers qu'AUCUN chemin n'implique — ceux qu'un prof a créés d'avance
  // depuis l'interface d'administration, avant d'avoir quoi que ce soit à
  // mettre dedans. Sans cette passe, ils n'atteindraient jamais l'élève.
  if (!result.cancelled && !aborted()) {
    result.foldersCreated = await pullEmptyFolders()
  }

  return result

  /**
   * Crée localement les dossiers vides du serveur. Ne lève JAMAIS : la
   * collection est facultative (404 sur un serveur pas encore réappliqué), et
   * un rangement manquant ne doit pas faire échouer une synchronisation de
   * contenu qui, elle, a réussi.
   */
  async function pullEmptyFolders(): Promise<number> {
    if (client.folders === undefined) return 0
    let created = 0
    try {
      const records = await client.folders.getFullList({ signal })
      for (const record of records) {
        if (aborted()) break
        // `path` est une entrée distante non vérifiée, comme celui d'une carte :
        // le même garde s'applique, sans quoi un `../..` créerait un dossier
        // hors du dossier synchronisé.
        if (!isSafeRelativePath(record.path)) continue
        const absolute = await join(syncFolderPath, record.path)
        if (await exists(absolute)) continue
        await mkdir(absolute, { recursive: true })
        created += 1
      }
    } catch {
      // Silencieux par contrat — voir le commentaire ci-dessus.
    }
    return created
  }
}

export interface SyncOneFileParams {
  client: SyncClient
  currentUser: string
  currentRole: UserRole
  serverUrl: string
  syncFolderPath: string
  state: SyncState
  /** Le chemin ABSOLU du fichier qu'on referme — c'est lui, et lui seul, qui est synchronisé. */
  filePath: string
  /** Le fichier actuellement chargé dans le canevas, s'il y en a un : jamais réécrit par un tirage. */
  openFilePath?: string
  signal?: AbortSignal
}

/**
 * Le même raisonnement que `sync()` — réconciliation, publication
 * automatique, conflit tranché par rôle — pour UN SEUL fichier : celui qu'on
 * vient de refermer. Voir la décision de cadrage n°4 de
 * `2026-09-15-suppression-publication-auto-sync-ciblee-design.md`.
 *
 * Ce qu'elle NE paie PAS : `scanFolder` (le dossier entier) et
 * `mindMaps.getFullList()` (tous les enregistrements, contenu compris) — un
 * seul enregistrement est demandé, filtré par `file_id`. `assets.getFullList()`
 * reste appelé : ce ne sont que des triplets `{id, hash, extension}`, pas les
 * images elles-mêmes, et c'est ce qui permet de savoir lesquelles tirer.
 *
 * Ce qu'elle ne fait PAS DU TOUT, délibérément : réconcilier les AUTRES
 * fichiers, propager une suppression, appliquer une tombstone, publier un
 * AUTRE fichier local-only, descendre les dossiers vides. Ces passes ont
 * besoin de la vue d'ensemble — le lancement et l'intervalle (`sync()`,
 * inchangée) continuent de s'en charger.
 */
export async function syncOneFile(params: SyncOneFileParams): Promise<SyncResult> {
  const { client, currentUser, currentRole, serverUrl, syncFolderPath, state, filePath, openFilePath, signal } = params
  const result: SyncRunResult = {
    pushed: 0,
    pulled: 0,
    errors: [],
    cancelled: false,
    conflicts: [],
    transferred: [],
    relocated: 0,
    moved: [],
    notices: [],
    reclassified: 0,
    merged: [],
    localDeleted: 0,
    remoteDeleted: 0,
    published: 0,
  }

  // Hors du dossier de synchronisation : ce chemin n'existe pas pour `sync()`
  // non plus, il n'y a rien à faire.
  if (!isInsideFolder(filePath, syncFolderPath)) return result

  const viewer: SyncUser = { username: currentUser, role: currentRole }
  const server = serverStateOf(state, serverUrl, syncFolderPath)
  const entries = server.entries

  let meta = await loadMindMapMeta(filePath).catch(() => null)
  if (meta === null) {
    // Publication automatique — même geste que dans `sync()`, pour ce seul
    // fichier : le cas le plus courant d'un fichier qu'on vient de créer puis
    // de refermer.
    try {
      await stampMindMapSyncMeta(filePath, viewer.username, viewer.role)
      meta = await loadMindMapMeta(filePath)
      if (meta !== null) result.published += 1
    } catch (error) {
      result.errors.push({ fileId: filePath, message: describeSyncError(error) })
      return result
    }
  }
  if (meta === null) return result // pas une carte mentale : rien à synchroniser

  let remote: RemoteMindMapRecord | undefined
  try {
    remote = await client.mindMaps.getOne(meta.id, { signal })
  } catch (error) {
    result.errors.push({ fileId: meta.id, message: describeSyncError(error) })
    return result
  }

  const relPath = relativeTo(syncFolderPath, filePath)
  const entry = entries[meta.id]
  let currentPath = filePath
  const iAmProf = currentRole === 'prof'

  // ── Réconciliation de chemin et de type, pour ce fichier seul ───────────
  if (entry !== undefined) {
    const lastSyncedPath = seedLastSyncedPath({
      lastSyncedPath: entry.lastSyncedPath,
      rootChanged: false,
      relPath,
      remotePath: remote?.path,
    })
    entry.lastSyncedPath = lastSyncedPath

    const seededType = seedLastSyncedType(entry.lastSyncedType)
    entry.lastSyncedType = seededType
    const typeAction = reconcileType({
      localType: mapTypeOf(meta.type),
      lastSyncedType: seededType,
      remoteType: remote === undefined ? undefined : (remote.type ?? ''),
      iAmProf,
    })
    if (typeAction.kind === 'adopt') {
      try {
        await setMindMapType(currentPath, typeAction.to)
        meta = { ...meta, type: typeAction.to }
        entry.lastSyncedType = typeAction.to
        result.reclassified += 1
      } catch (error) {
        result.errors.push({ fileId: meta.id, message: describeSyncError(error) })
      }
    }
    if (remote !== undefined && mapTypeOf(remote.type) === mapTypeOf(meta.type)) {
      entry.lastSyncedType = mapTypeOf(remote.type)
    }

    const pathAction = reconcilePath({ relPath, lastSyncedPath, remotePath: remote?.path, iAmProf })
    if (remote !== undefined && remote.path === relPath) entry.lastSyncedPath = remote.path
    if (pathAction.kind === 'relocate' && isSafeRelativePath(pathAction.to)) {
      try {
        const destination = await join(syncFolderPath, pathAction.to)
        if (!(await exists(destination)) || isSameFilePath(destination, currentPath)) {
          await ensureLocalFolder(destination)
          await renamePath(currentPath, destination)
          result.moved.push({ fileId: meta.id, from: currentPath, to: destination })
          currentPath = destination
          entry.lastSyncedPath = pathAction.to
          result.relocated += 1
        }
      } catch (error) {
        result.errors.push({ fileId: meta.id, message: describeSyncError(error) })
      }
    }
  }

  // ── Contenu : le même plan, le même conflit, la même autorité que `sync()` ──
  const plan = planPush({ meta, relPath: relativeTo(syncFolderPath, currentPath), currentUser: viewer, entry })
  const remoteContentHash = plan.content && remote !== undefined ? await hashContent(remote.content) : ''
  let skipPush = false

  if (plan.content && isConflict(meta, entry, remote, remoteContentHash)) {
    result.conflicts.push({
      kind: 'content',
      fileId: meta.id,
      path: relativeTo(syncFolderPath, currentPath),
      localModified: meta.lastModified,
      remoteUpdated: remote.updated,
      detail: await conflictDetailOf({ localPath: currentPath, meta, remote, remoteContentHash }),
    })
    if (iAmProf) {
      try {
        const archived = await archiveRemoteAsLinkedCopy({
          anchorPath: currentPath,
          remoteContent: remote.content,
          author: viewer.username,
          role: viewer.role,
        })
        if (archived !== null) {
          const remoteAssets = await client.assets.getFullList({ signal })
          await pullAssetsFor(client, archived.path, referencedAssets(remote.content, remoteAssets), { signal })
          result.notices.push({
            fileId: meta.id,
            message: `« ${relPath} » : modifié des deux côtés — vous avez le dernier mot, l'autre version a été gardée dans « ${fileNameOf(archived.path)} »`,
          })
        }
      } catch (error) {
        result.errors.push({ fileId: meta.id, message: describeSyncError(error) })
      }
    } else {
      try {
        const archived = await createLinkedCopy({ sourcePath: currentPath, author: viewer.username, role: viewer.role })
        result.notices.push({
          fileId: meta.id,
          message: `« ${relPath} » : modifié des deux côtés — le prof a le dernier mot, votre version a été gardée dans « ${fileNameOf(archived.path)} »`,
        })
      } catch (error) {
        result.errors.push({ fileId: meta.id, message: describeSyncError(error) })
      }
      skipPush = true
    }
  }

  if (!skipPush && (plan.content || plan.path || plan.type) && !(remote === undefined && !plan.content)) {
    try {
      let content: string | undefined
      let contentHash: string | undefined
      if (plan.content) {
        const cards = await loadMindMap(currentPath)
        if (cards === null) throw new Error('carte introuvable')
        content = serializeMindMap(withoutCopyLink(meta), cards)
        contentHash = await hashContent(content)
        const remoteAssets = await client.assets.getFullList({ signal })
        const knownHashes = new Set(remoteAssets.map(asset => asset.hash))
        await pushAssetsFor(client, currentPath, knownHashes, { signal })
      }
      const sentPath = plan.path || remote === undefined
      let savedRecord: RemoteMindMapRecord
      if (remote === undefined) {
        if (content === undefined) throw new Error('rien à publier')
        savedRecord = await client.mindMaps.create(
          { file_id: meta.id, author: meta.author, path: relPath, content, type: mapTypeOf(meta.type) },
          { signal }
        )
      } else {
        const payload: { path?: string; content?: string; type?: string } = {}
        if (plan.content) payload.content = content
        if (plan.path) payload.path = relPath
        if (plan.type) payload.type = mapTypeOf(meta.type)
        savedRecord = await client.mindMaps.update(remote.id, payload, { signal })
      }
      entries[meta.id] = {
        lastSyncedModified: plan.content ? meta.lastModified : (entry?.lastSyncedModified ?? meta.lastModified),
        lastSyncedUpdated: savedRecord.updated,
        lastSyncedPath: sentPath ? relPath : entry?.lastSyncedPath,
        lastSyncedType: plan.type || remote === undefined ? mapTypeOf(meta.type) : entry?.lastSyncedType,
        lastSyncedContentHash: plan.content ? contentHash : entry?.lastSyncedContentHash,
      }
      result.pushed += 1
      result.transferred.push({ fileId: meta.id, path: relPath, direction: 'push' })
      return result
    } catch (error) {
      if (isAbortError(error) || signal?.aborted === true) {
        result.cancelled = true
      } else {
        result.errors.push({ fileId: meta.id, message: describeSyncError(error) })
      }
      return result
    }
  }

  // ── Tirage : seulement si le serveur est plus récent que ce qu'on a vu ──
  const known = entries[meta.id]
  if (remote === undefined || (known && known.lastSyncedUpdated >= remote.updated)) return result
  if (isSameFilePath(currentPath, openFilePath ?? '')) return result // jamais le fichier ouvert
  if (!isSafeRelativePath(remote.path)) {
    result.errors.push({ fileId: meta.id, message: 'chemin distant invalide, fichier ignoré' })
    return result
  }

  try {
    const { meta: remoteMeta, cards } = deserializeMindMap(remote.content)
    const localPath = await join(syncFolderPath, remote.path)
    const alreadyThere = await exists(localPath)
    const localMeta = alreadyThere ? await loadMindMapMeta(localPath) : null
    if (alreadyThere && (localMeta === null || localMeta.id !== meta.id)) {
      result.errors.push({
        fileId: meta.id,
        message: 'un fichier local existe déjà à cet emplacement et n’est pas ce fichier synchronisé',
      })
      return result
    }
    await ensureLocalFolder(localPath)
    const localCards = await loadMindMap(localPath)
    const { cards: mergedCards, floatedCount } = localCards === null ? { cards, floatedCount: 0 } : mergeCards(localCards, cards)
    if (floatedCount > 0) result.merged.push({ fileId: meta.id, path: remote.path, floatedCount })
    const applied =
      remoteMeta === null
        ? null
        : {
            ...remoteMeta,
            type: mapTypeOf(remote.type),
            ...(localMeta?.copyLink === undefined ? {} : { copyLink: localMeta.copyLink }),
          }
    const serialized = serializeMindMap(applied, mergedCards)
    await writeTextFile(localPath, serialized)
    const remoteAssets = await client.assets.getFullList({ signal })
    await pullAssetsFor(client, localPath, referencedAssets(serialized, remoteAssets), { signal })
    const comparable = applied === null ? serialized : serializeMindMap(withoutCopyLink(applied), mergedCards)
    entries[meta.id] = {
      lastSyncedModified: remoteMeta?.lastModified ?? remote.updated,
      lastSyncedUpdated: remote.updated,
      lastSyncedPath: remote.path,
      lastSyncedType: mapTypeOf(remote.type),
      lastSyncedContentHash: await hashContent(comparable),
    }
    result.pulled += 1
    result.transferred.push({ fileId: meta.id, path: remote.path, direction: 'pull' })
  } catch (error) {
    if (isAbortError(error)) result.cancelled = true
    else result.errors.push({ fileId: meta.id, message: describeSyncError(error) })
  }

  return result
}
