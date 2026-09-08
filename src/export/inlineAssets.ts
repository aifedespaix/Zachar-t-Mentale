import type { Card } from '../types/card'
import { contentOf } from '../content/blocks'
import { readAssetBytes } from '../persistence/assets'

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
}

function mimeFor(asset: string): string {
  const dot = asset.lastIndexOf('.')
  const extension = dot > 0 ? asset.slice(dot + 1).toLowerCase() : ''
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  // Chunked: `String.fromCharCode(...bytes)` blows the call stack on anything
  // bigger than a small icon.
  const CHUNK = 0x8000
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return btoa(binary)
}

/**
 * Every image a card set references, as data URIs.
 *
 * This is not an optimization. `html-to-image` re-encodes each image it meets
 * and **rejects the whole page capture** when it cannot — and Tauri serves
 * assets from a different origin than the page, so a single picture would
 * otherwise abort the entire export rather than merely go missing (verified in
 * `docs/superpowers/spikes/2026-09-08-contenus-riches/`).
 *
 * An asset that fails to read is simply absent from the map: `BlockView` then
 * renders its named "image introuvable" placeholder, which is a far better
 * outcome than an export that throws.
 */
export async function inlineAssets(cards: Card[], mindMapPath: string | null): Promise<Map<string, string>> {
  const inlined = new Map<string, string>()
  if (mindMapPath === null) return inlined

  const assets = new Set<string>()
  for (const card of cards) {
    for (const block of contentOf(card)) {
      if (block.kind === 'image') assets.add(block.asset)
    }
  }

  for (const asset of assets) {
    try {
      const bytes = await readAssetBytes(mindMapPath, asset)
      inlined.set(asset, `data:${mimeFor(asset)};base64,${toBase64(bytes)}`)
    } catch {
      // Left out on purpose — see the placeholder note above.
    }
  }
  return inlined
}
