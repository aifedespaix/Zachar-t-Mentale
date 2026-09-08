import { mkdir, readFile, writeFile, exists } from '@tauri-apps/plugin-fs'
import { convertFileSrc } from '@tauri-apps/api/core'
import { parentDirOf, separatorOf, fileNameOf } from './paths'

/**
 * Images live in a folder beside the map, not inside its JSON.
 *
 * Base64 in the `.json` was the obvious alternative and is the wrong one: the
 * autosave rewrites the WHOLE file on a debounce, so a 2 MB screenshot would
 * mean 2.7 MB of base64 rewritten every few keystrokes. A sidecar keeps the
 * JSON small, and keeps the map transportable as a pair (file + folder) rather
 * than tying it to a workspace-wide asset store.
 */

/** Past this, a picture does not belong in a mind map — a card is 260 px wide. */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024

const EXTENSION_PATTERN = /^[a-z0-9]{1,8}$/

/** `chapitre.json` → `chapitre.assets`, on whichever separator the path uses. */
export function sidecarDirOf(mindMapPath: string): string {
  const name = fileNameOf(mindMapPath)
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const dir = parentDirOf(mindMapPath)
  return dir === '' ? `${base}.assets` : `${dir}${separatorOf(mindMapPath)}${base}.assets`
}

/**
 * The full path of one asset, refusing anything that is not a plain file name
 * directly inside the sidecar.
 *
 * Asset names are read from a `.json` that may have been shared, so they are
 * untrusted input: without this check, `"../../.ssh/id_rsa"` in a card would
 * make the app read — and the export inline — a file anywhere on disk.
 */
export function assetPathOf(mindMapPath: string, asset: string): string {
  if (asset === '' || asset.includes('/') || asset.includes('\\') || asset.includes('..')) {
    throw new Error(`Nom de média invalide : « ${asset} »`)
  }
  return `${sidecarDirOf(mindMapPath)}${separatorOf(mindMapPath)}${asset}`
}

/** Lowercased, dot-stripped, and validated — the caller's extension is untrusted too. */
function safeExtension(extension: string): string {
  const cleaned = extension.replace(/^\./, '').toLowerCase()
  return EXTENSION_PATTERN.test(cleaned) ? cleaned : 'png'
}

/**
 * Content-addressed, so pasting the same picture into two cards writes one
 * file. 64 bits of SHA-256 is plenty here: the namespace is one folder beside
 * one mind map, and a collision would need two different images the same user
 * put in the same map.
 */
async function contentHash(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes)
  const digest = await crypto.subtle.digest('SHA-256', view)
  return [...new Uint8Array(digest).slice(0, 8)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Writes `bytes` into the map's sidecar and returns the asset NAME to store in
 * the block — never a path. An absolute path would break the first time the
 * workspace moved or the map was opened on another machine.
 */
export async function writeAsset(mindMapPath: string, bytes: Uint8Array, extension: string): Promise<string> {
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error(
      `Image trop volumineuse (${Math.round(bytes.byteLength / 1024 / 1024)} Mo) : la limite est de ${MAX_ASSET_BYTES / 1024 / 1024} Mo.`
    )
  }
  const asset = `${await contentHash(bytes)}.${safeExtension(extension)}`
  const path = assetPathOf(mindMapPath, asset)

  await mkdir(sidecarDirOf(mindMapPath), { recursive: true })
  // Content addressing means an existing file with this name IS this file.
  if (!(await exists(path))) await writeFile(path, bytes)
  return asset
}

export async function readAssetBytes(mindMapPath: string, asset: string): Promise<Uint8Array> {
  return readFile(assetPathOf(mindMapPath, asset))
}

/**
 * A `src` the live webview can display.
 *
 * NOT usable for the export: `convertFileSrc` yields a different origin, and
 * `html-to-image` rejects the entire page capture when it meets an image it
 * cannot re-encode. The export path inlines assets as data URIs instead.
 */
export function assetSrc(mindMapPath: string, asset: string): string {
  return convertFileSrc(assetPathOf(mindMapPath, asset))
}
