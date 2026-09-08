import { mkdir, remove, rename, writeTextFile, exists } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { createRootCard } from '../state/cardsReducer'
import { serializeCards } from './serialization'
import { mindMapExists } from './fileStore'
import { sanitizeFileName } from './paths'
import { sidecarDirOf } from './assets'

/** Only a mind map owns a sidecar; a folder or any other file never does. */
function isMindMapPath(path: string): boolean {
  return path.toLowerCase().endsWith('.json')
}

function withJsonExtension(name: string): string {
  return name.toLowerCase().endsWith('.json') ? name : `${name}.json`
}

export async function createMindMapFile(folderPath: string, fileName: string): Promise<string> {
  const path = await join(folderPath, withJsonExtension(fileName))
  await writeTextFile(path, serializeCards([createRootCard('Nouveau chapitre')]))
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
 * Without this, renaming `chapitre.json` orphans `chapitre.assets` and every
 * image in the map breaks at once — the blocks address assets relative to a
 * sidecar named after the file.
 *
 * The sidecar move is best-effort ON PURPOSE: the `.json` rename has already
 * succeeded by then, and throwing here would report a failure for an operation
 * that half-happened, leaving the caller unable to tell what state the disk is
 * in. A missing sidecar (the common case — most maps have no images) is not an
 * error at all.
 */
export async function renamePath(oldPath: string, newPath: string): Promise<void> {
  await rename(oldPath, newPath)
  if (!isMindMapPath(oldPath)) return

  const oldSidecar = sidecarDirOf(oldPath)
  if (!(await exists(oldSidecar))) return
  await rename(oldSidecar, sidecarDirOf(newPath))
}

/** Deletes a path, taking a mind map's asset sidecar with it rather than leaving it orphaned. */
export async function deletePath(path: string, recursive: boolean): Promise<void> {
  await remove(path, { recursive })
  if (!isMindMapPath(path)) return

  const sidecar = sidecarDirOf(path)
  if (await exists(sidecar)) await remove(sidecar, { recursive: true })
}

/**
 * A free `<folderPath>/<baseName>[ (n)].json` path: the plain sanitized name
 * if free, else the first numbered variant that doesn't collide. Used when
 * writing a file whose name comes from external data (an XMind sheet title)
 * that could coincidentally match something already in the folder.
 */
export async function freeMindMapPath(folderPath: string, baseName: string): Promise<string> {
  const safe = sanitizeFileName(baseName)
  const separator = folderPath.includes('\\') ? '\\' : '/'
  let candidate = `${folderPath}${separator}${withJsonExtension(safe)}`
  let attempt = 1
  while (await mindMapExists(candidate)) {
    attempt += 1
    candidate = `${folderPath}${separator}${withJsonExtension(`${safe} (${attempt})`)}`
  }
  return candidate
}
