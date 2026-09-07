import { save, open } from '@tauri-apps/plugin-dialog'
import { readFile, writeFile } from '@tauri-apps/plugin-fs'

export interface SaveFilter {
  name: string
  extensions: string[]
}

/**
 * Opens the native "save as" dialog and writes `bytes` to the chosen path.
 * Returns the path written to, or `null` if the user cancelled — cancelling
 * is not an error, callers should just do nothing.
 */
export async function saveBytesAs(bytes: Uint8Array, defaultName: string, filters: SaveFilter[]): Promise<string | null> {
  const path = await save({ defaultPath: defaultName, filters })
  if (!path) return null
  await writeFile(path, bytes)
  return path
}

/** Native "open" dialog filtered to `.xmind` files. `null` if cancelled. */
export async function pickXmindFile(): Promise<string | null> {
  const path = await open({ multiple: false, filters: [{ name: 'XMind', extensions: ['xmind'] }] })
  return typeof path === 'string' ? path : null
}

export async function readBinaryFile(path: string): Promise<Uint8Array> {
  return readFile(path)
}
