import JSZip from 'jszip'
import type { Card, CardLevel } from '../types/card'

export interface XmindSheetImport {
  sheetTitle: string
  cards: Card[]
}

interface XmindTopic {
  title?: unknown
  notes?: { plain?: { content?: unknown } }
  children?: { attached?: XmindTopic[] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function topicTitle(topic: XmindTopic): string {
  return typeof topic.title === 'string' && topic.title.trim() !== '' ? topic.title : 'Sans titre'
}

function topicNote(topic: XmindTopic): string | undefined {
  const content = topic.notes?.plain?.content
  return typeof content === 'string' && content.trim() !== '' ? content : undefined
}

function topicChildren(topic: XmindTopic): XmindTopic[] {
  return Array.isArray(topic.children?.attached) ? topic.children!.attached! : []
}

/** Renders a subtree deeper than level 4 as indented text lines, folded into the level-4 ancestor's definition. */
function foldDeepSubtree(topic: XmindTopic, indent: number): string[] {
  const prefix = '  '.repeat(indent)
  const lines = [`${prefix}- ${topicTitle(topic)}`]
  const note = topicNote(topic)
  if (note) lines.push(`${prefix}  ${note}`)
  for (const child of topicChildren(topic)) lines.push(...foldDeepSubtree(child, indent + 1))
  return lines
}

function buildCards(topic: XmindTopic, level: CardLevel, parentId: string | null, order: number, out: Card[]): void {
  const id = crypto.randomUUID()
  const children = topicChildren(topic)
  let definition = topicNote(topic)
  if (level === 4 && children.length > 0) {
    const folded = children.flatMap(child => foldDeepSubtree(child, 0))
    definition = [definition, ...folded].filter((line): line is string => Boolean(line)).join('\n')
  }
  const card: Card = { id, level, title: topicTitle(topic), parentId, order }
  if (definition) card.definition = definition
  out.push(card)
  if (level < 4) {
    children.forEach((child, index) => buildCards(child, (level + 1) as CardLevel, id, index, out))
  }
}

/**
 * Pure mapping from a parsed XMind Zen/2021 `content.json` (an array of
 * sheets, each with a `rootTopic`) to one `XmindSheetImport` per sheet. A
 * topic deeper than the app's strict 4 levels is folded into text inside its
 * level-4 ancestor's `definition` — never detached, which would strip it of
 * the hierarchy that gave it meaning.
 */
export function xmindContentToCards(contentJson: unknown): XmindSheetImport[] {
  if (!Array.isArray(contentJson)) {
    throw new Error('Format XMind non reconnu : contenu racine attendu sous forme de liste de feuilles.')
  }
  return contentJson.map((sheet, index) => {
    if (!isRecord(sheet) || !isRecord(sheet.rootTopic)) {
      throw new Error(`Feuille XMind n°${index + 1} illisible : sujet central manquant.`)
    }
    const sheetTitle = typeof sheet.title === 'string' && sheet.title.trim() !== '' ? sheet.title : `Feuille ${index + 1}`
    const cards: Card[] = []
    buildCards(sheet.rootTopic as XmindTopic, 1, null, 0, cards)
    return { sheetTitle, cards }
  })
}

/** Unzips a `.xmind` file (XMind Zen/2021 format only) and maps its sheets. */
export async function readXmindFile(bytes: Uint8Array): Promise<XmindSheetImport[]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new Error('Fichier .xmind illisible : archive corrompue.')
  }
  const entry = zip.file('content.json')
  if (!entry) {
    throw new Error(
      'Fichier .xmind non pris en charge : content.json introuvable (format XMind 8 ou antérieur ?).'
    )
  }
  const text = await entry.async('string')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Fichier .xmind illisible : content.json n’est pas un JSON valide.')
  }
  return xmindContentToCards(parsed)
}
