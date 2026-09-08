import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { fileNameOf } from '../persistence/paths'
import type { ImageSource } from './imageBlock'

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg']

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
}

/** The MIME a path implies. The picker gives no type, only a path. */
export function mimeForPath(path: string): string {
  const dot = path.lastIndexOf('.')
  const extension = dot > 0 ? path.slice(dot + 1).toLowerCase() : ''
  return MIME_BY_EXTENSION[extension] ?? 'image/png'
}

/**
 * Native file picker, filtered to images. `null` when the user cancelled —
 * cancelling is a deliberate no-op, never an error, matching `pickXmindFile`.
 */
export async function pickImageFile(): Promise<ImageSource | null> {
  const path = await open({ multiple: false, filters: [{ name: 'Image', extensions: IMAGE_EXTENSIONS }] })
  if (typeof path !== 'string') return null

  return { bytes: await readFile(path), mime: mimeForPath(path), name: fileNameOf(path) }
}
