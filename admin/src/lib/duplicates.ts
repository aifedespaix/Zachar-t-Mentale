import type { Card } from '@app/types/card'
import { parseMindMapText } from './quality'

/**
 * Les doublons de contenu : deux fichiers qui portent exactement les mêmes
 * cartes.
 *
 * Ce qu'on compare, ce sont les CARTES, jamais les métadonnées. Le nom du
 * fichier, son auteur, son type, ses dates, son identité de synchronisation et
 * l'id interne de chaque carte ne disent rien de ce que l'élève révise : deux
 * copies du même chapitre publiées par deux personnes différentes, à deux ans
 * d'écart, sont le même contenu. La HIÉRARCHIE, elle, compte — la même liste de
 * cartes reliées autrement n'est pas la même carte mentale.
 *
 * L'empreinte est une chaîne canonique, jamais un hachage : proposer de
 * supprimer un fichier sur la foi d'une collision, même improbable, serait une
 * funeste idée. Un contenu illisible ne reçoit pas d'empreinte et ne sera donc
 * jamais proposé à la suppression.
 */

/** Une carte telle que le serveur la renvoie — de quoi la comparer et l'afficher. */
export interface DuplicateFile {
  id: string
  file_id: string
  author: string
  path: string
  type: string
  created: string
  updated: string
  content: string
}

export interface DuplicateGroup {
  /** L'empreinte commune — stable, elle sert aussi de clé de liste à l'interface. */
  fingerprint: string
  cardCount: number
  /** Les copies, la plus récemment modifiée d'abord : c'est celle qu'on garde par défaut. */
  files: DuplicateFile[]
}

/**
 * Un JSON déterministe.
 *
 * `JSON.stringify` suit l'ordre d'insertion des clés : deux cartes écrites par
 * deux versions de l'application, ou relues puis réécrites, peuvent porter les
 * mêmes valeurs dans un ordre différent et paraître distinctes. On trie les
 * clés, et on écarte les `undefined` pour que « champ absent » et « champ mis à
 * undefined » soient la même chose.
 */
function stable(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`
}

function cardsOf(content: string): Card[] | null {
  const parsed = parseMindMapText(content)
  if (parsed.cards === null) return null
  return parsed.cards.filter(
    (entry): entry is Card =>
      entry !== null && typeof entry === 'object' && typeof (entry as Card).id === 'string'
  )
}

/**
 * Ce qui « fait » la carte, une fois retiré tout ce qui n'est pas son contenu.
 *
 * `id`, `order`, `icon` et l'enveloppe `meta` sont ignorés ; le titre et la
 * définition sont rognés, parce qu'une espace ajoutée par un copier-coller n'est
 * pas une modification. Les enfants arrivent déjà triés : l'ordre de déclaration
 * des frères ne change pas la carte.
 */
function canonicalCard(card: Card, children: readonly string[]): string {
  return stable([
    card.level ?? null,
    card.kind ?? 'definition',
    card.detached === true,
    (card.title ?? '').trim(),
    (card.definition ?? '').trim(),
    card.content ?? null,
    children,
  ])
}

/**
 * L'arbre de cartes, mis à plat en une chaîne.
 *
 * Une carte dont le parent manque, ou qu'un cycle rend inatteignable, est
 * rattachée à la racine plutôt que silencieusement perdue : un fichier
 * légèrement cassé doit rester comparable, sinon deux fichiers cassés de façons
 * différentes finiraient par se ressembler.
 */
function canonicalise(cards: readonly Card[]): string {
  const byId = new Map<string, Card>()
  for (const card of cards) byId.set(card.id, card)

  const roots: Card[] = []
  const detached: Card[] = []
  const childrenByParent = new Map<string, Card[]>()

  for (const card of cards) {
    if (card.detached === true) {
      detached.push(card)
      continue
    }
    if (card.parentId === null || card.parentId === card.id || !byId.has(card.parentId)) {
      roots.push(card)
      continue
    }
    const siblings = childrenByParent.get(card.parentId)
    if (siblings === undefined) childrenByParent.set(card.parentId, [card])
    else siblings.push(card)
  }

  const seen = new Set<string>()
  function render(card: Card): string {
    if (seen.has(card.id)) return '(cycle)'
    seen.add(card.id)
    const children = (childrenByParent.get(card.id) ?? []).map(render).sort()
    return canonicalCard(card, children)
  }

  const attached = roots.map(render).sort()
  const floating = detached.map(render).sort()
  const leftovers = cards
    .filter(card => !seen.has(card.id))
    .map(card => canonicalCard(card, []))
    .sort()

  return stable({ attached, floating, leftovers })
}

/** L'empreinte du contenu en cartes, ou `null` quand il est illisible. */
export function fingerprintCards(content: string): string | null {
  const cards = cardsOf(content)
  if (cards === null) return null
  return canonicalise(cards)
}

/**
 * Les groupes de fichiers identiques, du plus fourni au plus petit.
 *
 * Un fichier sans jumeau ne produit rien : la question posée est « qu'est-ce
 * qui existe en plusieurs exemplaires ? », pas « qu'est-ce qui existe ? ».
 */
export function findDuplicateGroups(files: readonly DuplicateFile[]): DuplicateGroup[] {
  const byFingerprint = new Map<string, DuplicateFile[]>()

  for (const file of files) {
    const fingerprint = fingerprintCards(file.content)
    if (fingerprint === null) continue
    const group = byFingerprint.get(fingerprint)
    if (group === undefined) byFingerprint.set(fingerprint, [file])
    else group.push(file)
  }

  const groups: DuplicateGroup[] = []
  for (const [fingerprint, groupFiles] of byFingerprint) {
    if (groupFiles.length < 2) continue
    const sorted = [...groupFiles].sort((a, b) => b.updated.localeCompare(a.updated))
    groups.push({ fingerprint, cardCount: cardsOf(sorted[0].content)?.length ?? 0, files: sorted })
  }

  groups.sort(
    (a, b) => b.files.length - a.files.length || a.files[0].path.localeCompare(b.files[0].path)
  )
  return groups
}
