import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'

const CACHE_FILE_NAME = 'mindmap-format-cache.json'

export interface MindMapFormatCacheEntry {
  mtimeMs: number
  size: number
  valid: boolean
}

export type MindMapFormatCache = Record<string, MindMapFormatCacheEntry>

async function cacheFilePath(): Promise<string> {
  return join(await appConfigDir(), CACHE_FILE_NAME)
}

/**
 * A corrupted cache file is discarded rather than surfaced: unlike the
 * app's settings files, this cache holds nothing the user authored — it is
 * cheap to rebuild from scratch, so there is no reason to let a broken
 * cache file break startup.
 */
export async function loadMindMapFormatCache(): Promise<MindMapFormatCache> {
  const path = await cacheFilePath()
  if (!(await exists(path))) return {}
  try {
    const json = await readTextFile(path)
    return JSON.parse(json) as MindMapFormatCache
  } catch {
    return {}
  }
}

export async function saveMindMapFormatCache(cache: MindMapFormatCache): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const path = await cacheFilePath()
  await writeTextFile(path, JSON.stringify(cache, null, 2))
}

/**
 * Whether a cached entry still matches the file's current mtime/size. A
 * `null` current mtime (the type Tauri's `stat` allows, rarely seen in
 * practice) is never trusted enough to reuse a cached result.
 */
export function isCacheEntryFresh(
  entry: MindMapFormatCacheEntry | undefined,
  current: { mtimeMs: number | null; size: number }
): boolean {
  if (entry === undefined || current.mtimeMs === null) return false
  return entry.mtimeMs === current.mtimeMs && entry.size === current.size
}
