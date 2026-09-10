import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import type { Card, MindMapMeta } from '../types/card'
import { serializeMindMap, deserializeMindMap } from './serialization'

/**
 * Returns `null` when there is no file at `path` yet — an expected first-run
 * state, safe to answer with an empty default map and to start autosaving.
 *
 * A REJECTION means the file exists but could not be read or parsed. That is a
 * real problem: the caller must NOT start autosaving, or the debounce would
 * overwrite the user's (recoverable) chapter with an empty default. The two
 * cases are distinguished with the filesystem's own `exists()` rather than by
 * pattern-matching an error message.
 */
export async function loadMindMap(path: string): Promise<Card[] | null> {
  if (!(await exists(path))) return null
  const json = await readTextFile(path)
  return deserializeMindMap(json).cards
}

/** The sync metadata of a `.zmap`, or `null` for a file that has never been synced (or does not exist). */
export async function loadMindMapMeta(path: string): Promise<MindMapMeta | null> {
  if (!(await exists(path))) return null
  const json = await readTextFile(path)
  return deserializeMindMap(json).meta
}

/**
 * Whether a mind map file is already there. Used before writing a repaired
 * copy: the repair flow's whole promise is that nothing existing is
 * overwritten, the broken original least of all.
 */
export async function mindMapExists(path: string): Promise<boolean> {
  return exists(path)
}

/**
 * Whatever `meta` the file already had is carried over, with `lastModified`
 * bumped to now — every autosave of a synced file updates the one field the
 * sync algorithm compares, with zero changes needed at any of this
 * function's call sites (autosave, XMind import, the repair flow, …). A file
 * that has never been synced (`meta === null`) keeps writing a bare array.
 */
export async function saveMindMap(path: string, cards: Card[]): Promise<void> {
  const previousMeta = await loadMindMapMeta(path)
  const meta: MindMapMeta | null =
    previousMeta === null ? null : { ...previousMeta, lastModified: new Date().toISOString() }
  await writeTextFile(path, serializeMindMap(meta, cards))
}
