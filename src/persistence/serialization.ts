import type { Card, MindMapMeta } from '../types/card'

interface MindMapEnvelope {
  meta: MindMapMeta
  cards: Card[]
}

/**
 * A bare array (today's format) when there is no meta — so a file that has
 * never been synced never changes shape. Only a file that has been synced at
 * least once gets the `{ meta, cards }` envelope.
 */
export function serializeMindMap(meta: MindMapMeta | null, cards: Card[]): string {
  return JSON.stringify(meta === null ? cards : { meta, cards }, null, 2)
}

export function deserializeMindMap(json: string): { meta: MindMapMeta | null; cards: Card[] } {
  const parsed: unknown = JSON.parse(json)
  if (Array.isArray(parsed)) return { meta: null, cards: parsed as Card[] }
  if (parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as MindMapEnvelope).cards)) {
    const envelope = parsed as Partial<MindMapEnvelope>
    return { meta: envelope.meta ?? null, cards: envelope.cards as Card[] }
  }
  throw new Error('deserializeMindMap: expected a JSON array of cards or { meta, cards }')
}
