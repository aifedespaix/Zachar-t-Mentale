import { useEffect, useMemo, useState } from 'react'
import { collectMindMapPaths } from '../persistence/fileTree'
import { invalidateMindMapMetaCache, loadMindMapMetaCached } from '../persistence/mindMapMetaCache'
import { mapTypeOf, type MapType } from '../types/mapType'
import type { FileTreeNode } from '../types/workspace'

export interface MindMapTypeIndex {
  /** Every indexed path's classification — `default` for a map with no type header. */
  types: ReadonlyMap<string, MapType>
  /**
   * Whether every path of the current tree has been indexed. The sidebar holds
   * the filter back until this is true, so choosing a type never blanks the tree
   * for the frame the reads are still in flight — and never shows a stale one.
   */
  ready: boolean
}

/**
 * The classification of every mind map in the tree, read on demand.
 *
 * Lazy on purpose: a user who never touches the type filter pays for no header
 * read. Once active, only the paths that are not already known are read, so
 * switching « Cours » → « Exercices » reuses the same index and answers at once.
 *
 * `revision` is the workspace's `fileMetaRevision`, bumped whenever a publish
 * or a pull rewrote a header under an existing path.
 */
export function useMindMapTypeIndex(
  nodes: FileTreeNode[],
  active: boolean,
  revision: number
): MindMapTypeIndex {
  const [types, setTypes] = useState<ReadonlyMap<string, MapType>>(() => new Map())
  const paths = useMemo(() => [...collectMindMapPaths(nodes)].sort(), [nodes])

  // A publish or a pull rewrote a header: whatever the cache holds for it is stale.
  useEffect(() => {
    invalidateMindMapMetaCache()
  }, [revision])

  useEffect(() => {
    if (!active || paths.length === 0) return
    let cancelled = false
    void Promise.all(
      paths.map(async path => [path, mapTypeOf((await loadMindMapMetaCached(path))?.type)] as const)
    ).then(entries => {
      if (cancelled) return
      setTypes(previous => {
        const next = new Map(previous)
        for (const [path, type] of entries) next.set(path, type)
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [active, paths, revision])

  const ready = useMemo(() => paths.every(path => types.has(path)), [paths, types])

  return { types, ready }
}
