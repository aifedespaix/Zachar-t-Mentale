import { mkdir, remove, rename, writeTextFile, exists, readDir, copyFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { createRootCard } from '../state/cardsReducer'
import { serializeMindMap } from './serialization'
import { loadMindMap, mindMapExists } from './fileStore'
import { isMindMapPath, sanitizeFileName, withMindMapExtension, mindMapBaseName, parentDirOf, fileNameOf } from './paths'
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

async function copyDirRecursive(sourceDir: string, destDir: string): Promise<void> {
  await mkdir(destDir)
  const entries = await readDir(sourceDir)
  for (const entry of entries) {
    const sourcePath = await join(sourceDir, entry.name)
    const destPath = await join(destDir, entry.name)
    if (entry.isDirectory) {
      await copyDirRecursive(sourcePath, destPath)
    } else {
      await copyFile(sourcePath, destPath)
    }
  }
}

/**
 * Duplicates a file or folder onto a new sibling path, carrying a mind
 * map's asset sidecar with it.
 *
 * The sidecar copy is best-effort ON PURPOSE, same rationale as
 * `renamePath`: the primary copy has already succeeded by then, and
 * throwing here would report a failure for an operation that half-happened.
 */
export async function duplicatePath(sourcePath: string, destPath: string, isFolder: boolean): Promise<void> {
  if (isFolder) {
    await copyDirRecursive(sourcePath, destPath)
    return
  }
  await copyFile(sourcePath, destPath)
  if (!isMindMapPath(sourcePath)) return

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
 */
export async function duplicateMap(sourcePath: string, author: string, role: UserRole): Promise<string> {
  const cards = await loadMindMap(sourcePath)
  if (cards === null) throw new Error(`« ${fileNameOf(sourcePath)} » n’existe plus.`)

  const meta: MindMapMeta = { id: crypto.randomUUID(), author, role, lastModified: new Date().toISOString() }
  const destPath = await freeMindMapPath(parentDirOf(sourcePath), `${mindMapBaseName(sourcePath)} (copie)`)
  await writeTextFile(destPath, serializeMindMap(meta, cards))

  const sourceSidecar = sidecarDirOf(sourcePath)
  if (await exists(sourceSidecar)) await copyDirRecursive(sourceSidecar, sidecarDirOf(destPath))

  return destPath
}
