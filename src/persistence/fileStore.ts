import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { DEFAULT_MAP_TYPE, type MapType } from '../types/mapType'
import type { Card, MindMapMeta, UserRole } from '../types/card'
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
 * Drops a `.zmap`'s sync metadata, rewriting it as a bare array of cards.
 *
 * The generic « Dupliquer » copies a file byte for byte, so the copy would
 * carry the original's `meta.id` — which is the `file_id`, unique server-side,
 * of the remote record. Two local files publishing to one remote row is
 * exactly the corruption the fork model forbids, and the copy is meant to be a
 * purely local draft: a file with no `meta` is invisible to the push loop and
 * editable by anyone, so it is ready to be made someone's own.
 *
 * BEST-EFFORT AND SILENT BY CONTRACT: every caller is a duplicate whose byte
 * copy has already succeeded, so throwing here would report a failure for an
 * operation that half-happened. A file with no `meta` is left untouched (no
 * write at all — no needless mtime churn), and an unreadable or corrupt one
 * cannot be parsed to begin with: leaving it alone keeps duplicating a broken
 * file working exactly as it did before. The residual risk is contained by the
 * sync service's own duplicate-`file_id` guard, which reports the shared id
 * instead of pushing it.
 *
 * @returns whether the file was rewritten (i.e. it did have a `meta`).
 */
export async function stripMindMapSyncMeta(path: string): Promise<boolean> {
  try {
    const { meta, cards } = deserializeMindMap(await readTextFile(path))
    if (meta === null) return false
    await writeTextFile(path, serializeMindMap(null, cards))
    return true
  } catch {
    return false
  }
}

/**
 * The inverse of {@link stripMindMapSyncMeta}: gives a purely local map the
 * identity the sync engine looks for — a fresh id, and `author` as its owner.
 *
 * This is the missing half of the « Dupliquer » flow: a duplicate is local on
 * purpose (its `meta` is stripped), so without this a chapter written in the
 * app could never be pushed — the push loop only ever sends files whose
 * `meta.author` is the signed-in user.
 *
 * Refuses to touch a file that already HAS a `meta`: it is either already
 * syncable, or someone else's (a fork is the way in, not a stamp), and
 * replacing the id would orphan the remote record it points at.
 *
 * Unlike the strip, this one is NOT silent: it runs from a click, and a
 * failure (unreadable file, read-only disk) must reach the user's banner.
 *
 * @returns whether the file was stamped.
 */
export async function stampMindMapSyncMeta(path: string, author: string, role: UserRole): Promise<boolean> {
  const { meta, cards } = deserializeMindMap(await readTextFile(path))
  if (meta !== null) return false
  const stamped: MindMapMeta = {
    id: crypto.randomUUID(),
    author,
    role,
    lastModified: new Date().toISOString(),
    type: DEFAULT_MAP_TYPE,
  }
  await writeTextFile(path, serializeMindMap(stamped, cards))
  return true
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

/**
 * Classe un fichier DÉJÀ publié. Le type vit dans meta : un brouillon local n'en
 * a pas, et le refus est explicite plutôt que silencieux, pour que l'appelant
 * puisse le dire.
 *
 * lastModified est PRÉSERVÉ : une classification n'est pas une édition de
 * contenu. Le bumper déclencherait un push de contenu chez l'auteur, alors que
 * seul le champ type a bougé.
 *
 * default est écrit explicitement plutôt que retiré : tous les producteurs
 * produisent la même forme, et le fichier reste lisible tel quel.
 */
export async function setMindMapType(path: string, type: MapType): Promise<void> {
  const { meta, cards } = deserializeMindMap(await readTextFile(path))
  if (meta === null) {
    throw new Error('setMindMapType : ce fichier n’a pas d’identité de synchronisation, impossible de le classer.')
  }
  await writeTextFile(path, serializeMindMap({ ...meta, type }, cards))
}
