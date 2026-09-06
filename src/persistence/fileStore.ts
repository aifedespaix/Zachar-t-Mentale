import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import type { Card } from '../types/card'
import { serializeCards, deserializeCards } from './serialization'

export async function loadMindMap(path: string): Promise<Card[]> {
  const json = await readTextFile(path)
  return deserializeCards(json)
}

export async function saveMindMap(path: string, cards: Card[]): Promise<void> {
  await writeTextFile(path, serializeCards(cards))
}
