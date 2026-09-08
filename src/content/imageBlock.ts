import type { CardBlock } from '../types/cardBlock'
import { writeAsset } from '../persistence/assets'

/**
 * Fallback box for an image whose real dimensions could not be read.
 *
 * There must ALWAYS be a usable pair. A failed decode yields `NaN`, which
 * serializes to `null` and makes the block unreadable on the next load — the
 * image reference is lost while the definition still claims a picture. A
 * plausible 4:3 box is wrong by a little; `NaN` is wrong by everything.
 */
const FALLBACK_SIZE = { width: 320, height: 240 }

/** Beyond this, the image is downscaled: a card is 260 px wide, nothing needs 4000. */
const MAX_STORED_WIDTH = 1600

/**
 * How long to wait for a decode before falling back.
 *
 * A decode that never settles is not hypothetical — a truncated or malformed
 * file can leave `onload`/`onerror` unfired — and it would leave the insertion
 * pending forever with no way for the user to recover. Falling back to a
 * plausible box is always better than hanging.
 */
const PROBE_TIMEOUT_MS = 3000

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
}

export function extensionForMime(mime: string, fallbackName = ''): string {
  const known = EXTENSION_BY_MIME[mime.toLowerCase()]
  if (known !== undefined) return known
  const dot = fallbackName.lastIndexOf('.')
  return dot > 0 ? fallbackName.slice(dot + 1) : 'png'
}

/**
 * The intrinsic size of an image, or the fallback.
 *
 * Never rejects and never returns a non-finite number: every caller is on a
 * path where the alternative is losing the user's picture.
 */
export async function probeImageSize(
  bytes: Uint8Array,
  mime: string,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<{ width: number; height: number }> {
  if (typeof URL?.createObjectURL !== 'function' || typeof Image === 'undefined') return FALLBACK_SIZE

  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }))
  try {
    const size = await new Promise<{ width: number; height: number }>(resolve => {
      const timer = setTimeout(() => resolve(FALLBACK_SIZE), timeoutMs)
      const settle = (value: { width: number; height: number }) => {
        clearTimeout(timer)
        resolve(value)
      }
      const image = new Image()
      image.onload = () =>
        settle({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height })
      image.onerror = () => settle(FALLBACK_SIZE)
      image.src = url
    })
    const usable = Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
    if (!usable) return FALLBACK_SIZE
    if (size.width <= MAX_STORED_WIDTH) return size
    // Only the DISPLAYED box is scaled down here; the file is stored as-is.
    // Re-encoding would need a canvas round-trip that silently degrades a
    // scanned diagram, and the size guard in `writeAsset` already covers the
    // case that actually hurts — a file too big to belong in a map at all.
    const scale = MAX_STORED_WIDTH / size.width
    return { width: MAX_STORED_WIDTH, height: Math.max(1, Math.round(size.height * scale)) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface ImageSource {
  bytes: Uint8Array
  mime: string
  /** Used for the extension when the MIME type is unknown, and to seed the alt text. */
  name?: string
}

export interface ImageBlockOptions {
  /** Decode timeout; exposed so tests need not wait out the real one. */
  probeTimeoutMs?: number
}

/**
 * Stores an image in the map's sidecar and returns the block that references
 * it. Throws when the file cannot be stored (too large, disk failure) so the
 * caller can tell the user rather than inserting a broken block.
 */
export async function imageBlockFrom(
  mindMapPath: string,
  source: ImageSource,
  options: ImageBlockOptions = {}
): Promise<CardBlock> {
  const extension = extensionForMime(source.mime, source.name ?? '')
  // Sequential, not Promise.all: when the write fails there is nothing to
  // insert, so probing first would spend a decode — and leave its timer
  // running — for a block that will never exist.
  const asset = await writeAsset(mindMapPath, source.bytes, extension)
  const size = await probeImageSize(source.bytes, source.mime, options.probeTimeoutMs)
  return {
    kind: 'image',
    asset,
    // Seeded from the file name so the plain-text mirror says something useful
    // straight away; the user can rewrite it in the editor.
    alt: altFromName(source.name ?? ''),
    width: size.width,
    height: size.height,
  }
}

/** `schema-cellule.png` → `schema cellule`, and '' for a name that carries nothing. */
export function altFromName(name: string): string {
  const withoutExtension = name.replace(/\.[a-z0-9]{1,8}$/i, '')
  const words = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  // A clipboard paste has no name, and a hash-like name says nothing a reader
  // would want — better an empty alt the editor prompts for.
  return /^[0-9a-f]{8,}$/i.test(words) ? '' : words
}
