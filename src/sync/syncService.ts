import { exists, mkdir, readDir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { loadMindMap, loadMindMapMeta } from '../persistence/fileStore'
import { scanFolder } from '../persistence/fileTree'
import { renamePath } from '../persistence/fileOps'
import { readAssetBytes, writeAsset, sidecarDirOf } from '../persistence/assets'
import { serializeMindMap, deserializeMindMap } from '../persistence/serialization'
import { fileNameOf, parentDirOf, separatorOf } from '../persistence/paths'
import type { FileTreeNode } from '../types/workspace'
import type { MindMapMeta, SyncUser, UserRole } from '../types/card'
import { serverStateOf, type SyncState, type SyncStateEntry } from '../persistence/syncState'
import { canReorder } from './permissions'
import { hashContent } from './contentHash'
import { reconcilePath, seedLastSyncedPath } from './pathReconciliation'

export interface RemoteMindMapRecord {
  id: string
  file_id: string
  author: string
  path: string
  content: string
  updated: string
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
    data: { file_id: string; author: string; path: string; content: string },
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
    data: { path?: string; content?: string },
    options?: RequestOptions
  ): Promise<RemoteMindMapRecord>
}

export interface AssetsApi {
  getFullList(options?: RequestOptions): Promise<RemoteAssetRecord[]>
  upload(hash: string, extension: string, bytes: Uint8Array, options?: RequestOptions): Promise<void>
  download(record: RemoteAssetRecord, options?: RequestOptions): Promise<Uint8Array>
}

export interface SyncClient {
  mindMaps: MindMapsApi
  assets: AssetsApi
}

/** A file both sides changed since the last sync — skipped, never resolved in silence. */
export interface SyncConflict {
  fileId: string
  path: string
  /** The local file's own `meta.lastModified`. */
  localModified: string
  /** The server record's `updated`. */
  remoteUpdated: string
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
   * Files the two sides disagree on. They are NOT pushed and NOT overwritten:
   * both versions contain work someone did, and only the user can choose.
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
}

/** Le résultat tel que `sync()` le construit : les trois champs de déplacement y sont toujours là. */
type SyncRunResult = SyncResult & Required<Pick<SyncResult, 'relocated' | 'moved' | 'notices'>>

export interface SyncParams {
  client: SyncClient
  currentUser: string
  currentRole: UserRole
  serverUrl: string
  syncFolderPath: string
  state: SyncState
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

export interface PushPlan {
  content: boolean
  path: boolean
}

/**
 * Ce qu'un sync enverrait pour ce fichier — contenu et chemin séparément.
 *
 * LE point de vérité unique, partagé par la boucle d'envoi et par le compteur
 * « à envoyer » de l'interface : le nombre affiché ne peut donc pas contredire
 * ce qu'un sync ferait réellement. Il intègre désormais le CHEMIN, sans quoi un
 * fichier simplement renommé resterait invisible dans le compteur tout en
 * n'étant jamais envoyé — le trou exact que ce chantier répare.
 *
 * Le contenu n'appartient qu'à son auteur. Le chemin suit `canReorder` : son
 * auteur, ou un prof.
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
    meta.author === currentUser.username && (entry === undefined || entry.lastSyncedModified < meta.lastModified)
  // Entrée absente : l'enregistrement n'existe pas encore, donc le `create`
  // enverra le chemin de toute façon — inutile de le compter deux fois.
  const path =
    entry !== undefined &&
    entry.lastSyncedPath !== undefined &&
    entry.lastSyncedPath !== relPath &&
    canReorder(meta, currentUser)
  return { content, path }
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
    if (plan.content || plan.path) survey.pending.push(path)
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
 * The fork model guarantees a given
 * file is writable server-side by exactly one author, so nothing here
 * resolves a conflict — the newer side (by `meta.lastModified` for a push,
 * by the server's `updated` for a pull) simply wins, and a per-file failure
 * is collected without aborting the rest of the batch.
 */
export async function sync({
  client,
  currentUser,
  currentRole,
  serverUrl,
  syncFolderPath,
  state,
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

    const action = reconcilePath({
      relPath,
      lastSyncedPath,
      remotePath: remote?.path,
    })
    // Les deux côtés ont bougé vers le MÊME chemin : `reconcilePath` n'a rien à
    // faire, mais la base doit suivre le chemin distant. Sans ça, un fichier
    // dont le push de chemin est refusé (élève sur la carte d'un prof) garde
    // une base périmée, et un renommage local ULTÉRIEUR serait lu comme « les
    // deux ont bougé différemment » puis annulé par une relocalisation — une
    // action de l'utilisateur silencieusement défaite.
    if (remote !== undefined && remote.path === relPath) entry.lastSyncedPath = remote.path
    if (action.kind !== 'relocate') return

    const destination = await join(syncFolderPath, action.to)
    try {
      if (await exists(destination)) {
        // Sous Windows `exists()` ignore la casse : relire l'identité de ce qui
        // occupe la destination évite de refuser à CHAQUE sync un renommage qui
        // ne change que la casse du même `file_id`, tout en protégeant le
        // fichier d'un autre.
        const occupant = await loadMindMapMeta(destination)
        if (occupant === null || occupant.id !== scan.meta.id) {
          result.errors.push({
            fileId: scan.meta.id,
            message: `impossible de replacer « ${relPath} » : « ${action.to} » existe déjà`,
          })
          return
        }
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

  // Both halves are known up front, so the caller can show « 4/12 » from the
  // first file rather than a spinner with no end in sight.
  const total = scans.length + remoteRecords.length
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
    if (!plan.content && !plan.path) return

    // Un conflit porte sur du CONTENU, jamais sur un rangement : le contrôle ne
    // s'applique donc que si c'est du contenu qu'on s'apprête à envoyer.
    if (plan.content && isConflict(meta, known, remote, remote === undefined ? '' : await hashContent(remote.content))) {
      // Reported, never resolved here: both versions hold work someone did.
      result.conflicts.push({
        fileId: meta.id,
        path: relativeTo(syncFolderPath, scan.path),
        localModified: meta.lastModified,
        remoteUpdated: remote.updated,
      })
      return
    }

    try {
      // Un `create` n'a AUCUN contenu distant à protéger, mais son payload
      // exige le champ `content` : c'est le seul cas où un envoi de chemin lit
      // encore le fichier — et il n'écrase alors rien.
      const sendsContent = plan.content || remote === undefined
      let content: string | undefined
      let contentHash: string | undefined
      if (sendsContent) {
        const cards = await loadMindMap(scan.path)
        if (cards === null) return
        // La sérialisation est calculée UNE fois : cette chaîne est celle
        // envoyée au serveur ET celle dont on prend l'empreinte. Hacher un
        // jumeau sérialisé différemment rendrait la comparaison de conflit
        // « toujours différente » pour tout fichier modifié, sans qu'aucun
        // test ne tombe.
        content = serializeMindMap(meta, cards)
        contentHash = await hashContent(content)
        // Assets are pushed BEFORE the record that references them: an
        // observer's getFullList() must never see a record whose content
        // names an asset hash with no matching asset row yet — that image
        // would then never be retried (the pull-side `>=` skip check treats
        // the record's `updated` as fully synced regardless of its assets).
        await pushAssetsFor(client, scan.path, knownHashes, { signal })
      }
      const relPath = relativeTo(syncFolderPath, scan.path)
      let savedRecord: RemoteMindMapRecord
      if (remote === undefined) {
        if (content === undefined) return
        savedRecord = await client.mindMaps.create({ file_id: meta.id, author: meta.author, path: relPath, content }, { signal })
      } else {
        // Le champ qu'on a le droit d'écrire, et lui seul : le contenu à son
        // auteur, le chemin à qui peut réarranger. Envoyer les deux à chaque
        // fois laisserait l'élève annuler sans le savoir le rangement du prof.
        const payload: { path?: string; content?: string } = {}
        if (plan.content) payload.content = content
        if (plan.path) payload.path = relPath
        savedRecord = await client.mindMaps.update(remote.id, payload, { signal })
      }

      entries[meta.id] = {
        // Un push de chemin SEUL ne réécrit pas la révision de contenu vue par
        // ce client : un prof n'écrit pas le contenu d'un élève.
        lastSyncedModified: sendsContent ? meta.lastModified : (known?.lastSyncedModified ?? meta.lastModified),
        lastSyncedUpdated: savedRecord.updated,
        lastSyncedPath: relPath,
        lastSyncedContentHash: sendsContent ? contentHash : known?.lastSyncedContentHash,
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

  for (const scan of scans) {
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

  /** Everything the pull pass does for ONE remote record. */
  async function pullOne(record: RemoteMindMapRecord): Promise<void> {
    if (record.author === currentUser) return
    const known = entries[record.file_id]
    if (known && known.lastSyncedUpdated >= record.updated) return

    if (!isSafeRelativePath(record.path)) {
      result.errors.push({ fileId: record.file_id, message: 'chemin distant invalide, fichier ignoré' })
      return
    }

    try {
      const { meta, cards } = deserializeMindMap(record.content)
      const localPath = await join(syncFolderPath, record.path)

      // A locally-created file can already sit at the path a remote record
      // resolves to — most dangerously, one that has never been synced
      // (`meta === null`) and so is invisible to the push loop above and
      // backed up nowhere. Only overwrite when the file already there is a
      // previous pull/update of THIS SAME record; anything else is left
      // alone and reported instead of silently destroyed.
      if (await exists(localPath)) {
        const localMeta = await loadMindMapMeta(localPath)
        if (localMeta === null || localMeta.id !== record.file_id) {
          result.errors.push({
            fileId: record.file_id,
            message: 'un fichier local existe déjà à cet emplacement et n’est pas ce fichier synchronisé',
          })
          return
        }
      }

      await ensureLocalFolder(localPath)
      await writeTextFile(localPath, record.content)
      await pullAssetsFor(client, localPath, referencedAssets(record.content, remoteAssets), { signal })
      // L'empreinte est prise sur `record.content`, la chaîne REÇUE, jamais sur
      // une re-sérialisation locale : c'est la seule qui corresponde à ce que
      // le serveur détient, donc la seule qui rende la comparaison de conflit
      // exacte au prochain passage.
      entries[record.file_id] = {
        lastSyncedModified: meta?.lastModified ?? record.updated,
        lastSyncedUpdated: record.updated,
        lastSyncedPath: record.path,
        lastSyncedContentHash: await hashContent(record.content),
      }
      result.pulled += 1
      result.transferred.push({ fileId: record.file_id, path: record.path, direction: 'pull' })
      void cards // validated by deserializeMindMap succeeding; the written file is the record's own content verbatim
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
    await pullOne(record)
    report()
  }

  return result
}
