import { exists, mkdir, readDir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { loadMindMap, loadMindMapMeta } from '../persistence/fileStore'
import { scanFolder } from '../persistence/fileTree'
import { readAssetBytes, writeAsset, sidecarDirOf } from '../persistence/assets'
import { serializeMindMap, deserializeMindMap } from '../persistence/serialization'
import { fileNameOf, parentDirOf, separatorOf } from '../persistence/paths'
import type { FileTreeNode } from '../types/workspace'
import type { MindMapMeta, UserRole } from '../types/card'
import { serverStateOf, type SyncState, type SyncStateEntry } from '../persistence/syncState'

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
  update(
    id: string,
    data: { path: string; content: string },
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
}

interface SyncParams {
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

/**
 * Whether a local map still has to be sent: the ONE definition of "pending
 * push", shared by the sync loop and the sidebar's counter so the number the
 * user reads can never disagree with what a sync would actually do.
 *
 * A file is pending when it is the current account's own (ownership is what
 * makes it writable), and its `lastModified` is newer than the last state we
 * pushed — or when we have never pushed it at all.
 */
export function isPushPending(
  meta: MindMapMeta | null,
  author: string,
  stateEntry: SyncStateEntry | undefined
): boolean {
  if (meta === null || meta.author !== author) return false
  return stateEntry === undefined || stateEntry.lastSyncedModified < meta.lastModified
}

/**
 * Whether the two sides disagree about a file: the server record moved since
 * the last time we saw it AND our local file moved too.
 *
 * That is the one case the fork model cannot rule out — the same account on two
 * machines — and the only safe reaction is to touch nothing: pushing would
 * erase what the other machine sent, pulling would erase the local edit.
 *
 * A file we have never pushed (`stateEntry === undefined`) is not a conflict:
 * there is nothing to disagree with.
 */
export function isConflict(
  meta: MindMapMeta,
  stateEntry: SyncStateEntry | undefined,
  remote: RemoteMindMapRecord | undefined
): remote is RemoteMindMapRecord {
  if (stateEntry === undefined || remote === undefined) return false
  return (
    remote.updated > stateEntry.lastSyncedUpdated && meta.lastModified > stateEntry.lastSyncedModified
  )
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
  currentUser: string
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
    if (meta === null) survey.localOnly.push(path)
    else if (isPushPending(meta, params.currentUser, params.entries[meta.id])) survey.pending.push(path)
  }
  return survey
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
  return path.startsWith(root + separator) ? path.slice(root.length + 1) : fileNameOf(path)
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
 * Push then pull, one `.zmap` at a time. The fork model guarantees a given
 * file is writable server-side by exactly one author, so nothing here
 * resolves a conflict — the newer side (by `meta.lastModified` for a push,
 * by the server's `updated` for a pull) simply wins, and a per-file failure
 * is collected without aborting the rest of the batch.
 */
export async function sync({
  client,
  currentUser,
  serverUrl,
  syncFolderPath,
  state,
  signal,
  onProgress,
}: SyncParams): Promise<SyncResult> {
  const result: SyncResult = {
    pushed: 0,
    pulled: 0,
    errors: [],
    cancelled: false,
    conflicts: [],
    transferred: [],
  }

  const remoteRecords = await client.mindMaps.getFullList({ signal })
  const remoteAssets = await client.assets.getFullList({ signal })
  const knownHashes = new Set(remoteAssets.map(asset => asset.hash))
  const remoteByFileId = new Map(remoteRecords.map(record => [record.file_id, record]))

  const server = serverStateOf(state, serverUrl, syncFolderPath)
  const entries = server.entries

  const localTree = await scanFolder(syncFolderPath)
  const localPaths = flattenMindMapPaths(localTree)

  // Both halves are known up front, so the caller can show « 4/12 » from the
  // first file rather than a spinner with no end in sight.
  const total = localPaths.length + remoteRecords.length
  let done = 0
  const report = () => {
    done += 1
    onProgress?.(done, total)
  }
  const aborted = () => signal?.aborted === true

  // Guards a single sync run against two local files claiming the same
  // `meta.id`: without it, alternating pushes of two different files would
  // corrupt one shared remote record. This does not (and isn't meant to)
  // prevent such a duplicate from arising in the first place.
  const seenFileIds = new Set<string>()

  /** Everything the push pass does for ONE local file. */
  async function pushOne(path: string): Promise<void> {
    let meta: MindMapMeta | null
    try {
      meta = await loadMindMapMeta(path)
    } catch (error) {
      // A .json that is not a mind map is simply not ours; one that cannot be
      // read is a real problem and is still reported.
      if (!(await isNonMindMapFile(path))) {
        result.errors.push({ fileId: path, message: describeSyncError(error) })
      }
      return
    }
    if (meta === null || meta.author !== currentUser) return

    if (seenFileIds.has(meta.id)) {
      result.errors.push({ fileId: meta.id, message: 'plusieurs fichiers locaux partagent le même identifiant de synchronisation' })
      return
    }
    seenFileIds.add(meta.id)

    const known = entries[meta.id]
    if (!isPushPending(meta, currentUser, known)) return

    const remote = remoteByFileId.get(meta.id)
    if (isConflict(meta, known, remote)) {
      // Reported, never resolved here: both versions hold work someone did.
      result.conflicts.push({
        fileId: meta.id,
        path: relativeTo(syncFolderPath, path),
        localModified: meta.lastModified,
        remoteUpdated: remote.updated,
      })
      return
    }

    try {
      const cards = await loadMindMap(path)
      if (cards === null) return
      const content = serializeMindMap(meta, cards)
      const relPath = relativeTo(syncFolderPath, path)
      // Assets are pushed BEFORE the record that references them: an
      // observer's getFullList() must never see a record whose content
      // names an asset hash with no matching asset row yet — that image
      // would then never be retried (the pull-side `>=` skip check treats
      // the record's `updated` as fully synced regardless of its assets).
      await pushAssetsFor(client, path, knownHashes, { signal })
      const existing = remoteByFileId.get(meta.id)
      const savedRecord = existing
        ? await client.mindMaps.update(existing.id, { content, path: relPath }, { signal })
        : await client.mindMaps.create({ file_id: meta.id, author: meta.author, path: relPath, content }, { signal })
      entries[meta.id] = { lastSyncedModified: meta.lastModified, lastSyncedUpdated: savedRecord.updated }
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

  for (const path of localPaths) {
    if (aborted()) {
      result.cancelled = true
      break
    }
    await pushOne(path)
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
      entries[record.file_id] = { lastSyncedModified: meta?.lastModified ?? record.updated, lastSyncedUpdated: record.updated }
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
