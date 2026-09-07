import JSZip from 'jszip'
import type { Card } from '../types/card'

interface XmindTopicOut {
  id: string
  class: 'topic'
  title: string
  notes?: { plain: { content: string } }
  children?: { attached: XmindTopicOut[] }
}

function toTopic(cards: Card[], card: Card): XmindTopicOut {
  const children = cards.filter(c => c.parentId === card.id && !c.detached).sort((a, b) => a.order - b.order)
  const topic: XmindTopicOut = { id: card.id, class: 'topic', title: card.title }
  if (card.definition) topic.notes = { plain: { content: card.definition } }
  if (children.length > 0) topic.children = { attached: children.map(child => toTopic(cards, child)) }
  return topic
}

/**
 * Maps `Card[]` to an XMind Zen/2021 `content.json` (one sheet, since one
 * file is always one chapter/root). Detached cards, if present, are nested
 * under a synthetic "Cartes volantes" topic hanging off the root — mirroring
 * the dedicated final page the PDF/image export gives them — so nothing is
 * silently dropped from the export.
 */
export function cardsToXmindContent(cards: Card[]): unknown {
  const root = cards.find(c => c.parentId === null && !c.detached)
  if (!root) throw new Error('Aucune carte racine à exporter.')

  const rootTopic = toTopic(cards, root)
  const detached = cards.filter(c => c.detached).sort((a, b) => a.order - b.order)
  if (detached.length > 0) {
    const detachedTopic: XmindTopicOut = {
      id: crypto.randomUUID(),
      class: 'topic',
      title: 'Cartes volantes',
      children: { attached: detached.map(card => toTopic(cards, card)) },
    }
    rootTopic.children = { attached: [...(rootTopic.children?.attached ?? []), detachedTopic] }
  }

  return [{ id: crypto.randomUUID(), class: 'sheet', title: root.title, rootTopic }]
}

export async function writeXmindFile(cards: Card[]): Promise<Uint8Array> {
  const content = cardsToXmindContent(cards)
  const zip = new JSZip()
  zip.file('content.json', JSON.stringify(content))
  return zip.generateAsync({ type: 'uint8array' })
}
