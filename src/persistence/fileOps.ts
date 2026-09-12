import { mkdir, remove, rename, writeTextFile, exists, readDir, copyFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { createRootCard } from '../state/cardsReducer'
import { serializeMindMap } from './serialization'
import { loadMindMap, mindMapExists, stripMindMapSyncMeta } from './fileStore'
import {
  isMindMapPath,
  sanitizeFileName,
  withMindMapExtension,
  mindMapBaseName,
  parentDirOf,
  fileNameOf,
  separatorOf,
  isSameFilePath,
  isInsideFolder,
} from './paths'
import { titleCase } from '../utils/titleCase'
import { sidecarDirOf } from './assets'
import type { MindMapMeta, UserRole } from '../types/card'

/**
 * Writes a brand-new mind map with a single root card, and returns its path.
 *
 * The root card is NAMED AFTER THE FILE. It used to be the placeholder
 * « Nouveau chapitre », which meant a freshly created map showed the same
 * anonymous card whether it was « Chapitre 1 – Les nombres relatifs » or
 * « Chapitre 2 – Pythagore »: the first thing the user had to do was rename the
 * very card the name they had just typed was already about. The name is
 * title-cased for the card (« les nombres relatifs » → « Les Nombres
 * Relatifs ») and left as typed for the FILE, which stays the thing the user
 * named.
 */
export async function createMindMapFile(folderPath: string, fileName: string): Promise<string> {
  const path = await join(folderPath, withMindMapExtension(fileName))
  const title = titleCase(mindMapBaseName(path))
  await writeTextFile(path, serializeMindMap(null, [createRootCard(title === '' ? 'Nouveau chapitre' : title)]))
  return path
}

export async function createSubfolder(folderPath: string, folderName: string): Promise<string> {
  const path = await join(folderPath, folderName)
  await mkdir(path)
  return path
}

/**
 * Renames a path, carrying a mind map's asset sidecar with it.
 *
 * Without this, renaming `chapitre.zmap` orphans `chapitre.assets` and every
 * image in the map breaks at once — the blocks address assets relative to a
 * sidecar named after the file.
 *
 * The sidecar move is best-effort ON PURPOSE: the map's own rename has already
 * succeeded by then, and throwing here would report a failure for an operation
 * that half-happened, leaving the caller unable to tell what state the disk is
 * in. A missing sidecar (the common case — most maps have no images) is not an
 * error at all.
 */
export async function renamePath(oldPath: string, newPath: string): Promise<void> {
  await rename(oldPath, newPath)
  if (!isMindMapPath(oldPath)) return

  try {
    const oldSidecar = sidecarDirOf(oldPath)
    if (!(await exists(oldSidecar))) return
    await rename(oldSidecar, sidecarDirOf(newPath))
  } catch {
    // Genuinely best-effort, as the comment above promises: the map's own
    // rename has already succeeded, so rejecting here would report a failure for an
    // operation that half-happened. A cross-device rename (EXDEV) is the
    // realistic case.
  }
}

/** Deletes a path, taking a mind map's asset sidecar with it rather than leaving it orphaned. */
export async function deletePath(path: string, recursive: boolean): Promise<void> {
  await remove(path, { recursive })
  if (!isMindMapPath(path)) return

  try {
    const sidecar = sidecarDirOf(path)
    if (await exists(sidecar)) await remove(sidecar, { recursive: true })
  } catch {
    // The map is already gone; failing the whole delete over its leftovers
    // would be worse than leaving an orphaned folder behind.
  }
}

/**
 * A free `<folderPath>/<baseName>[ (n)]` path, with a forced mind-map
 * extension when `isFolder` is false: the plain sanitized name if free,
 * else the first numbered variant that doesn't collide. Generalizes what
 * `freeMindMapPath` used to do inline, to also cover folders and
 * duplicate-name defaults.
 */
export async function freeSiblingPath(folderPath: string, baseName: string, isFolder: boolean): Promise<string> {
  const safe = sanitizeFileName(baseName)
  const separator = folderPath.includes('\\') ? '\\' : '/'
  const nameOf = (candidateBase: string) => (isFolder ? candidateBase : withMindMapExtension(candidateBase))
  const isTaken = (candidatePath: string) => (isFolder ? exists(candidatePath) : mindMapExists(candidatePath))
  let candidate = `${folderPath}${separator}${nameOf(safe)}`
  let attempt = 1
  while (await isTaken(candidate)) {
    attempt += 1
    candidate = `${folderPath}${separator}${nameOf(`${safe} (${attempt})`)}`
  }
  return candidate
}

/**
 * A free `<folderPath>/<baseName>[ (n)]` mind-map path. Used when writing a
 * file whose name comes from external data (an XMind sheet title) that
 * could coincidentally match something already in the folder.
 */
export async function freeMindMapPath(folderPath: string, baseName: string): Promise<string> {
  return freeSiblingPath(folderPath, baseName, false)
}

/**
 * A byte-for-byte copy of one directory tree.
 *
 * `stripSyncMeta` is for the one caller that is duplicating USER CONTENT
 * (`duplicatePath`): a mind map copied verbatim would keep the original's sync
 * identity and publish to the same remote record. It defaults to `false`
 * because the other caller is `duplicateMap`, which copies an asset sidecar —
 * files minted by the app, with no `meta` header to strip.
 */
async function copyDirRecursive(sourceDir: string, destDir: string, stripSyncMeta = false): Promise<void> {
  await mkdir(destDir)
  const entries = await readDir(sourceDir)
  for (const entry of entries) {
    const sourcePath = await join(sourceDir, entry.name)
    const destPath = await join(destDir, entry.name)
    if (entry.isDirectory) {
      await copyDirRecursive(sourcePath, destPath, stripSyncMeta)
    } else {
      await copyFile(sourcePath, destPath)
      if (stripSyncMeta && isMindMapPath(entry.name)) await stripMindMapSyncMeta(destPath)
    }
  }
}

/**
 * Duplicates a file or folder onto a new sibling path, carrying a mind
 * map's asset sidecar with it — and WITHOUT its sync metadata.
 *
 * This is the generic « Dupliquer », not « Personnaliser / Faire ma copie »
 * (that one is `duplicateMap`, which deliberately stamps a fresh identity): a
 * copy that kept the original's `meta` would carry the same `file_id` as the
 * remote record, and two local files publishing to one server row is precisely
 * the corruption the fork model rules out. Every map copied — including inside
 * a duplicated folder — comes out as a plain local file, invisible to sync and
 * editable by whoever opens it next.
 *
 * The sidecar copy, like the metadata strip, is best-effort ON PURPOSE, same
 * rationale as `renamePath`: the primary copy has already succeeded by then,
 * and throwing here would report a failure for an operation that half-happened.
 */
export async function duplicatePath(sourcePath: string, destPath: string, isFolder: boolean): Promise<void> {
  if (isFolder) {
    // A nested map is exactly as sync-identified as a top-level one, so the
    // whole copy is walked rather than only the file the user right-clicked.
    await copyDirRecursive(sourcePath, destPath, true)
    return
  }
  await copyFile(sourcePath, destPath)
  if (!isMindMapPath(sourcePath)) return

  // The copy must NOT carry the original's `meta`: its `id` is the `file_id` of
  // the remote record, and two local files claiming one remote row is the exact
  // corruption the fork model rules out. The duplicate becomes a purely local
  // draft — invisible to the push loop, editable by anyone, with no history.
  // Deliberately not awaited-fail-hard: `stripMindMapSyncMeta` is best-effort,
  // and the copy this leaves behind is a complete, usable file either way.
  await stripMindMapSyncMeta(destPath)

  try {
    const sourceSidecar = sidecarDirOf(sourcePath)
    if (!(await exists(sourceSidecar))) return
    await copyDirRecursive(sourceSidecar, sidecarDirOf(destPath))
  } catch {
    // Best-effort, as in `renamePath`: the primary copy already succeeded.
  }
}

/**
 * Forks a map: a full local copy, stamped as authored by `author` under a
 * fresh id, so the copy is immediately and exclusively editable by them —
 * this is the entire "Personnaliser / Faire ma copie" action.
 *
 * The copy KEEPS the original's name: it is the same course under a new
 * owner, and renaming it « (copie) » lost the only thing that told two
 * students' copies of one shared map apart. The author's username goes in
 * the suffix instead — « Chapitre 1 (eleve1) » — so the file says whose copy
 * it is without the user having to rename it back by hand.
 */
export async function duplicateMap(sourcePath: string, author: string, role: UserRole): Promise<string> {
  const cards = await loadMindMap(sourcePath)
  if (cards === null) throw new Error(`« ${fileNameOf(sourcePath)} » n’existe plus.`)

  const meta: MindMapMeta = { id: crypto.randomUUID(), author, role, lastModified: new Date().toISOString() }
  const destPath = await freeMindMapPath(parentDirOf(sourcePath), `${mindMapBaseName(sourcePath)} (${author})`)
  await writeTextFile(destPath, serializeMindMap(meta, cards))

  const sourceSidecar = sidecarDirOf(sourcePath)
  if (await exists(sourceSidecar)) await copyDirRecursive(sourceSidecar, sidecarDirOf(destPath))

  return destPath
}

/**
 * The same tree, copied verbatim — sync identity and all.
 *
 * `duplicatePath` cannot serve here: it deliberately STRIPS a mind map's `meta`
 * so a copy comes out as a fresh, purely local draft. A MOVE must keep that
 * identity, because the file it produces IS the file the user dragged; dropping
 * its `file_id` would orphan its remote record and publish the same course
 * again under a new id.
 */
async function copyPathVerbatim(sourcePath: string, destPath: string, isFolder: boolean): Promise<void> {
  if (isFolder) {
    await copyDirRecursive(sourcePath, destPath)
    return
  }
  await copyFile(sourcePath, destPath)
  if (!isMindMapPath(sourcePath)) return

  const sourceSidecar = sidecarDirOf(sourcePath)
  if (await exists(sourceSidecar)) await copyDirRecursive(sourceSidecar, sidecarDirOf(destPath))
}

/**
 * Moves a file or folder into `destFolderPath`, keeping its own name — the
 * gesture behind a drag & drop in the sidebar.
 *
 * A move between two folders IS a rename across directories, so it goes through
 * `renamePath` and inherits its sidecar handling: moving `chapitre.zmap`
 * takes `chapitre.assets` along, and every image in the map keeps working.
 *
 * Three refusals, each raised before anything is written so the caller can turn
 * it into a banner: the destination is already the file's own parent (a no-op),
 * the name is already taken there (a move must never silently overwrite — the
 * user renames first), and a folder dropped into itself or one of its own
 * descendants (an infinite tree).
 *
 * A rename across devices (`EXDEV` — two configured roots on two drives, or a
 * network share) is the one case `rename` cannot serve, and the move is then
 * emulated: copy verbatim, then delete the original. Deliberately NOT the
 * default path, since it duplicates before it deletes and a failure in between
 * leaves two files behind — hence the explicit message for that outcome.
 */
export async function movePath(sourcePath: string, destFolderPath: string, isFolder: boolean): Promise<void> {
  const name = fileNameOf(sourcePath)
  const destination = `${destFolderPath}${separatorOf(destFolderPath)}${name}`

  if (isSameFilePath(parentDirOf(sourcePath), destFolderPath)) {
    throw new Error(`« ${name} » est déjà dans ce dossier`)
  }
  if (isFolder && isInsideFolder(destFolderPath, sourcePath)) {
    throw new Error(`« ${name} » ne peut pas être déplacé dans lui-même`)
  }
  if (await exists(destination)) {
    throw new Error(`« ${name} » existe déjà dans ce dossier`)
  }

  let renameError: unknown = null
  try {
    await renamePath(sourcePath, destination)
    return
  } catch (error) {
    // Reported as-is unless the copy fallback below succeeds: a permission
    // error is far more informative than the copy failure it causes.
    renameError = error
  }
  // If the source is gone, the rename half-happened and copying would be wrong.
  if (!(await exists(sourcePath))) throw renameError

  try {
    await copyPathVerbatim(sourcePath, destination, isFolder)
  } catch {
    throw renameError
  }

  try {
    await deletePath(sourcePath, isFolder)
  } catch {
    throw new Error(
      `« ${name} » a bien été copiée dans ce dossier, mais l’original n’a pas pu être supprimé : il y en a maintenant deux`
    )
  }
}
