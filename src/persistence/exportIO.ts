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

/** Decodes a base64 data URL (as produced by canvas/image capture) into raw bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? ''
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
