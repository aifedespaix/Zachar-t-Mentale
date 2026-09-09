import { useEffect, useState } from 'react'
import { stat } from '@tauri-apps/plugin-fs'
import { loadMindMap } from '../persistence/fileStore'
import { validateCards } from '../validation/cardsValidation'
import {
  loadMindMapFormatCache,
  saveMindMapFormatCache,
  isCacheEntryFresh,
  type MindMapFormatCache,
} from '../persistence/mindMapFormatCache'

const SAVE_DEBOUNCE_MS = 500

// Module-level singleton: every row's hook shares one in-memory cache and
// one debounced save, so a burst of rows validating at once (e.g. opening a
// folder with many mind maps) writes the cache file once, not once per row.
let cache: MindMapFormatCache | null = null
let cacheLoadPromise: Promise<MindMapFormatCache> | null = null
let saveTimeout: ReturnType<typeof setTimeout> | undefined

async function getCache(): Promise<MindMapFormatCache> {
  if (cache !== null) return cache
  cacheLoadPromise ??= loadMindMapFormatCache().then(loaded => {
    cache = loaded
    return loaded
  })
  return cacheLoadPromise
}

function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(() => {
    saveTimeout = undefined
    if (cache !== null) void saveMindMapFormatCache(cache).catch(() => {})
  }, SAVE_DEBOUNCE_MS)
}

async function checkMindMapFormat(path: string): Promise<boolean> {
  const loaded = await getCache()

  let info: { mtime: Date | null; size: number }
  try {
    info = await stat(path)
  } catch {
    return false
  }
  const mtimeMs = info.mtime?.getTime() ?? null

  if (isCacheEntryFresh(loaded[path], { mtimeMs, size: info.size })) {
    return loaded[path]!.valid
  }

  let valid: boolean
  try {
    const cards = await loadMindMap(path)
    valid = cards !== null && validateCards(cards).valid
  } catch {
    valid = false
  }

  if (mtimeMs !== null) {
    loaded[path] = { mtimeMs, size: info.size, valid }
    scheduleSave()
  }
  return valid
}

/**
 * Whether `path` is a well-formed mind map — `undefined` while the check is
 * still pending, so a caller can show a neutral default and upgrade the
 * icon once this resolves, never blocking the row's first render. Pass
 * `null` for a row that isn't a mind map (e.g. a folder) — this keeps the
 * hook called unconditionally on every render while performing no IPC and
 * always returning `undefined`.
 */
export function useMindMapFormatValid(path: string | null): boolean | undefined {
  const [valid, setValid] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    if (path === null) {
      setValid(undefined)
      return
    }
    let cancelled = false
    setValid(undefined)
    checkMindMapFormat(path)
      .catch(() => false)
      .then(result => {
        if (!cancelled) setValid(result)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  return valid
}

/** Test-only: clears the shared in-memory cache and any pending debounced save. */
export function resetMindMapFormatCacheForTests(): void {
  cache = null
  cacheLoadPromise = null
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = undefined
}
