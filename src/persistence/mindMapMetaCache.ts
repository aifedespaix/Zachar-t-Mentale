import { loadMindMapMeta } from './fileStore'
import type { MindMapMeta } from '../types/card'

/**
 * A session-wide cache of every map's `meta` header, keyed by path.
 *
 * The tree needs to know each map's TYPE to filter on it, and reading a header
 * is a filesystem round-trip: without this, selecting « Cours » in the sidebar
 * would re-read every visible `.zmap` on each render, and switching back and
 * forth between two types would re-read them all over again.
 *
 * The entry does NOT check the file's mtime the way the format cache does. The
 * header only changes through the operations that already bump
 * `fileMetaRevision` (publish, classify, pull), so invalidating on that
 * revision is both cheaper and more precise than a `stat` per file — and a
 * save that rewrites the body leaves `type`, `author` and `id` untouched.
 */
const cache = new Map<string, MindMapMeta | null>()
const pending = new Map<string, Promise<MindMapMeta | null>>()

/**
 * The map's header, from the cache when it is there. A file that cannot be read
 * (deleted since the tree was scanned, unreadable) caches `null` rather than
 * staying pending, so a later render does not retry it on every keystroke.
 */
export function loadMindMapMetaCached(path: string): Promise<MindMapMeta | null> {
  if (cache.has(path)) return Promise.resolve(cache.get(path) ?? null)
  const inFlight = pending.get(path)
  if (inFlight !== undefined) return inFlight

  const request = loadMindMapMeta(path)
    .then(meta => {
      cache.set(path, meta)
      return meta
    })
    .catch(() => {
      cache.set(path, null)
      return null
    })
    .finally(() => {
      pending.delete(path)
    })
  pending.set(path, request)
  return request
}

/** Forgets every header — called when a publish, a classification or a pull rewrote one. */
export function invalidateMindMapMetaCache(): void {
  cache.clear()
}

/** Test-only: clears the cache and any request still in flight. */
export function resetMindMapMetaCacheForTests(): void {
  cache.clear()
  pending.clear()
}
