import type { Card } from '@app/types/card'
import { stripCopySuffix } from '@app/sync/copyLink'
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

// ---------------------------------------------------------------------------
// Les copies de synchronisation, et le grand nettoyage
// ---------------------------------------------------------------------------

/**
 * Les anciennes versions de l'application résolvaient un conflit en rangeant
 * la version perdante dans « <original> (copie).zmap », à côté de l'original.
 * Ces fichiers n'ont PAS le même contenu que l'original — c'est justement
 * pourquoi ils existent — et `findDuplicateGroups` ne les voit donc pas. Ils
 * se reconnaissent à leur nom : même dossier, même racine, suffixe « (copie) ».
 */
export interface CopyGroup {
  /** Le chemin que le groupe doit finir par occuper : celui de l'original. */
  path: string
  /** L'original, s'il est encore sur le serveur. */
  original: DuplicateFile | null
  /** Tous les membres, le plus récemment modifié d'abord : c'est celui qu'on garde. */
  files: DuplicateFile[]
}

function splitExtension(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? { stem: name, extension: '' } : { stem: name.slice(0, dot), extension: name.slice(dot) }
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut)
}

function nameOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? path : path.slice(cut + 1)
}

/**
 * Le chemin de l'original dont `path` est une copie, ou `null` si ce n'est pas
 * une copie. La règle de nommage est celle de l'application (`copyLink.ts`).
 */
export function originalPathOf(path: string): string | null {
  const { stem, extension } = splitExtension(nameOf(path))
  const base = stripCopySuffix(stem)
  if (base === stem || base.trim() === '') return null
  const parent = parentOf(path)
  const name = `${base}${extension}`
  return parent === '' ? name : `${parent}/${name}`
}

/**
 * L'instant de la dernière ÉDITION d'un fichier : la `meta.lastModified` de son
 * contenu, et `updated` seulement en repli — le serveur bumpe `updated` sur un
 * simple déplacement, qui n'est pas une modification.
 */
export function modifiedAt(file: DuplicateFile): number {
  const meta = parseMindMapText(file.content).meta
  const edited = meta === null ? Number.NaN : Date.parse(meta.lastModified)
  if (!Number.isNaN(edited)) return edited
  const updated = Date.parse(file.updated.replace(' ', 'T'))
  return Number.isNaN(updated) ? 0 : updated
}

function byMostRecent(a: DuplicateFile, b: DuplicateFile): number {
  return modifiedAt(b) - modifiedAt(a) || b.updated.localeCompare(a.updated)
}

/** Les groupes « original + ses copies », ou « plusieurs copies » quand l'original a disparu. */
export function findCopyGroups(files: readonly DuplicateFile[]): CopyGroup[] {
  const byPath = new Map<string, DuplicateFile>()
  for (const file of files) byPath.set(file.path, file)

  const copiesByOriginal = new Map<string, DuplicateFile[]>()
  for (const file of files) {
    const original = originalPathOf(file.path)
    if (original === null) continue
    const group = copiesByOriginal.get(original)
    if (group === undefined) copiesByOriginal.set(original, [file])
    else group.push(file)
  }

  const groups: CopyGroup[] = []
  for (const [path, copies] of copiesByOriginal) {
    const original = byPath.get(path) ?? null
    const members = original === null ? copies : [original, ...copies]
    // Une copie seule, sans original, n'est le doublon de rien.
    if (members.length < 2) continue
    groups.push({ path, original, files: [...members].sort(byMostRecent) })
  }
  return groups.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Ce que le grand nettoyage fera, décidé sans toucher au serveur.
 *
 * - `remove` : les fichiers supprimés.
 * - `rewrite` : l'original garde sa place et son identité (celle que les
 *   appareils connaissent), mais reçoit les cartes de la copie plus récente.
 * - `rename` : une copie restée seule reprend le nom de l'original disparu.
 */
export interface CleanupPlan {
  remove: DuplicateFile[]
  rewrite: { target: DuplicateFile; source: DuplicateFile }[]
  rename: { file: DuplicateFile; path: string }[]
}

/**
 * Une seule version par fichier, la plus récemment modifiée.
 *
 * D'abord les doublons de contenu (on garde le plus récent de chaque groupe),
 * puis, parmi ce qui reste, les copies de synchronisation. L'ordre compte : un
 * fichier déjà promis à la suppression ne doit pas être choisi ensuite comme
 * la version à garder d'un groupe de copies.
 */
export function planCleanup(files: readonly DuplicateFile[]): CleanupPlan {
  const removed = new Set<string>()
  const plan: CleanupPlan = { remove: [], rewrite: [], rename: [] }

  for (const group of findDuplicateGroups(files)) {
    const [kept, ...others] = [...group.files].sort(byMostRecent)
    for (const file of others) {
      if (file.id === kept.id || removed.has(file.id)) continue
      removed.add(file.id)
      plan.remove.push(file)
    }
  }

  const remaining = files.filter(file => !removed.has(file.id))
  for (const group of findCopyGroups(remaining)) {
    const [newest, ...others] = group.files
    if (group.original === null) {
      // Plus d'original : la copie la plus récente reprend son nom — libre par
      // construction, puisqu'aucun fichier restant ne l'occupe.
      plan.rename.push({ file: newest, path: group.path })
      for (const file of others) plan.remove.push(file)
      continue
    }
    if (newest.id !== group.original.id) {
      plan.rewrite.push({ target: group.original, source: newest })
    }
    for (const file of group.files) {
      if (file.id !== group.original.id) plan.remove.push(file)
    }
  }

  return plan
}

/** Les cartes d'un contenu, telles quelles — ce qu'une réécriture recopie. */
export function cardsOfContent(content: string): Card[] | null {
  return cardsOf(content)
}
