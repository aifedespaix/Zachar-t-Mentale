import { useEffect, useState } from 'react'
import { loadMindMapMeta } from '../persistence/fileStore'
import { useWorkspaceStore } from '../state/useWorkspaceStore'
import type { MindMapMeta } from '../types/card'

/**
 * The map's sync metadata, `null` while pending or for a file with none —
 * same "never blocks the row's first render" shape as `useMindMapFormatValid`,
 * without its persistent cache: a `meta` header is a cheap JSON parse, unlike
 * the full `validateCards` pass that cache exists to avoid repeating.
 */
export function useMindMapAuthor(path: string | null): MindMapMeta | null {
  const [meta, setMeta] = useState<MindMapMeta | null>(null)
  // Read, not merely subscribed: a publish or a pull rewrites the file at this
  // very path, and the path alone would not re-run the effect below.
  const revision = useWorkspaceStore(state => state.fileMetaRevision)

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
  }, [path, revision])

  return meta
}
