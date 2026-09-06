import { mkdir, remove, rename, writeTextFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { createRootCard } from '../state/cardsReducer'
import { serializeCards } from './serialization'

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
