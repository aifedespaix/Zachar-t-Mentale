import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import type { Card } from '../types/card'
import { serializeCards, deserializeCards } from './serialization'

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
  return deserializeCards(json)
}

export async function saveMindMap(path: string, cards: Card[]): Promise<void> {
  await writeTextFile(path, serializeCards(cards))
}
