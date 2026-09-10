import { useEffect, useState } from 'react'
import { loadMindMapMeta } from '../persistence/fileStore'
import type { MindMapMeta } from '../types/card'

/**
 * The map's sync metadata, `null` while pending or for a file with none —
 * same "never blocks the row's first render" shape as `useMindMapFormatValid`,
 * without its persistent cache: a `meta` header is a cheap JSON parse, unlike
 * the full `validateCards` pass that cache exists to avoid repeating.
 */
export function useMindMapAuthor(path: string | null): MindMapMeta | null {
  const [meta, setMeta] = useState<MindMapMeta | null>(null)

  useEffect(() => {
    if (path === null) {
      setMeta(null)
      return
    }
    let cancelled = false
    loadMindMapMeta(path)
      .catch(() => null)
      .then(result => {
        if (!cancelled) setMeta(result)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  return meta
}
