import { mkdir, remove, rename, writeTextFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { createRootCard } from '../state/cardsReducer'
import { serializeCards } from './serialization'
import { mindMapExists } from './fileStore'
import { sanitizeFileName } from './paths'

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

export async function renamePath(oldPath: string, newPath: string): Promise<void> {
  await rename(oldPath, newPath)
}

export async function deletePath(path: string, recursive: boolean): Promise<void> {
  await remove(path, { recursive })
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
