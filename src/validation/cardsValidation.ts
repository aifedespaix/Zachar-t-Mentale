import type { Card, CardLevel } from '../types/card'
import { MAX_LEVEL, createRootCard } from '../state/cardsReducer'
import { normalizeContent, sanitizeBlocks } from '../content/blocks'

/**
 * Structural validation of a raw mind map, run BEFORE anything tries to render
 * it.
 *
 * The canvas assumes a very specific shape — one root, every attached card
 * reachable from it through at most `MAX_LEVEL` levels, floating cards with no
 * children — and a file that breaks those assumptions does not degrade
 * gracefully: `computeLayout` cannot place a card caught in a parent cycle, and
 * `levelColors[card.level]` is `undefined` for a level outside 1..4. Either one
 * throws mid-render, React tears the whole tree down, and the map the user just
 * clicked vanishes a frame after appearing — with nothing on screen to say why.
 *
 * So the rule is: validate first, render second. A file that fails validation
 * is never handed to the canvas; the user is offered a repaired copy instead
 * (`repairCards`).
 */

/** The single definition of "well placed", used by both the report and the repair. */
export type CardIssueKind =
  /** Not a usable card record at all (missing id, non-numeric level, ...). */
  | 'malformed'
  /** A second card claiming an id already taken by an earlier one. */
  | 'duplicate-id'
  /** `parentId` points at a card that does not exist — a "carte fantôme". */
  | 'ghost-parent'
  /** The card is its own ancestor (directly or through a loop of parents). */
  | 'cycle'
  /** The card sits deeper than the strict 4-level limit. */
  | 'depth-overflow'
  /** A second card claiming to be the hierarchy root (single-root invariant). */
  | 'extra-root'
  /** Attached to a floating card, which may never have children. */
  | 'detached-parent'
  /** Sits under another broken card, so its whole branch is cut off from the root. */
  | 'orphan-branch'
  /** Declared `level` disagrees with the card's real depth in the tree. */
  | 'invalid-level'

export interface CardIssue {
  kind: CardIssueKind
  /** The offending card, or `null` when the record is too broken to name one. */
  cardId: string | null
  /** Position in the raw array — the only handle on a record with no usable id. */
  index: number
  /** Plain French, shown to the user in the repair dialog. */
  message: string
}

export interface ValidationReport {
  valid: boolean
  issues: CardIssue[]
}

/** Depth is 0-based, so the deepest allowed card sits at `MAX_DEPTH`. */
export const MAX_DEPTH = MAX_LEVEL - 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a raw entry can be used as a card at all. This is deliberately about
 * *usability*, not correctness: the fields checked here are the ones something
 * would crash or silently misbehave on (a missing id breaks React keys and
 * every lookup; a non-numeric `order` makes every sort produce `NaN`; a
 * non-string title makes the title input flip to uncontrolled). Placement is
 * judged separately, below.
 */
function isUsableCardRecord(value: unknown): value is Card {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || value.id === '') return false
  if (typeof value.title !== 'string') return false
  if (typeof value.level !== 'number' || !Number.isFinite(value.level)) return false
  if (typeof value.order !== 'number' || !Number.isFinite(value.order)) return false
  if (value.parentId !== null && typeof value.parentId !== 'string') return false
  if (value.detached !== undefined && typeof value.detached !== 'boolean') return false
  if (value.definition !== undefined && typeof value.definition !== 'string') return false
  if (value.icon !== undefined && typeof value.icon !== 'string') return false
  // Only the shape of the container is checked here. Per-block problems are
  // NOT fatal: `contentOf` degrades an unknown kind to text and drops a
  // malformed payload at render time, so a card carrying one block written by
  // a later version of the app still opens — and, because nothing rewrites it
  // on load, that block survives the next autosave untouched.
  if (value.content !== undefined && !Array.isArray(value.content)) return false
  return true
}

interface Placement {
  /** Cards reachable from the root within the level limit, mapped to their depth. */
  depthById: Map<string, number>
  /** The card the hierarchy hangs from, or `null` when the file has none. */
  root: Card | null
  /** Well-formed cards, first occurrence of each id. */
  byId: Map<string, Card>
  /** Well-formed cards in file order (duplicates excluded). */
  usable: Card[]
  /** Where each well-formed card sits in the raw array. */
  indexById: Map<string, number>
  /** Entries that could not be read as cards, by index. */
  malformedIndexes: number[]
  /** Ids seen more than once, by the index of each later occurrence. */
  duplicates: { index: number; id: string }[]
}

/**
 * Walks the hierarchy from the root and records how deep each card it can
 * legitimately reach sits. Everything a card needs to be "in the tree" is
 * expressed here — being reachable from the root, through attached parents
 * only, within the level limit — so a card is well placed exactly when this
 * walk reached it. Anything else is diagnosed afterwards.
 */
function placeCards(raw: unknown[]): Placement {
  const malformedIndexes: number[] = []
  const duplicates: { index: number; id: string }[] = []
  const byId = new Map<string, Card>()
  const usable: Card[] = []
  const indexById = new Map<string, number>()

  raw.forEach((entry, index) => {
    if (!isUsableCardRecord(entry)) {
      malformedIndexes.push(index)
      return
    }
    if (byId.has(entry.id)) {
      duplicates.push({ index, id: entry.id })
      return
    }
    byId.set(entry.id, entry)
    indexById.set(entry.id, index)
    usable.push(entry)
  })

  const root = usable.find(card => card.parentId === null && !card.detached) ?? null

  const childrenByParent = new Map<string, Card[]>()
  for (const card of usable) {
    if (card.detached || card.parentId === null) continue
    const group = childrenByParent.get(card.parentId)
    if (group) group.push(card)
    else childrenByParent.set(card.parentId, [card])
  }
  for (const group of childrenByParent.values()) group.sort((a, b) => a.order - b.order)

  // Breadth-first from the root. `depthById` doubles as the visited set, which
  // is what makes the walk terminate on a file containing a parent cycle.
  const depthById = new Map<string, number>()
  if (root) {
    depthById.set(root.id, 0)
    const queue: Card[] = [root]
    while (queue.length > 0) {
      const current = queue.shift()!
      const depth = depthById.get(current.id)!
      if (depth >= MAX_DEPTH) continue
      for (const child of childrenByParent.get(current.id) ?? []) {
        if (depthById.has(child.id)) continue
        depthById.set(child.id, depth + 1)
        queue.push(child)
      }
    }
  }

  return { depthById, root, byId, usable, indexById, malformedIndexes, duplicates }
}

/** Why an attached card the root walk never reached is out of place. */
function diagnoseUnplaced(card: Card, placement: Placement): CardIssueKind {
  const { byId, depthById } = placement
  if (card.parentId === null) return 'extra-root'
  const parent = byId.get(card.parentId)
  if (!parent) return 'ghost-parent'
  if (parent.detached) return 'detached-parent'

  // Climb the parent chain: it either loops (cycle), dies on a card that is
  // itself out of place, or reaches a placed ancestor — in which case the only
  // thing that stopped the walk was the level limit.
  const seen = new Set<string>([card.id])
  let current: Card | undefined = parent
  while (current) {
    if (seen.has(current.id)) return 'cycle'
    if (depthById.has(current.id)) return 'depth-overflow'
    seen.add(current.id)
    if (current.parentId === null || current.detached) break
    current = byId.get(current.parentId)
  }
  // Its whole branch hangs off another broken card; the branch root carries the
  // real diagnosis and this card simply travels with it.
  return 'orphan-branch'
}

const ISSUE_LABELS: Record<CardIssueKind, string> = {
  malformed: 'donnée de carte illisible',
  'duplicate-id': 'identifiant en double',
  'ghost-parent': 'carte fantôme (parent introuvable)',
  cycle: 'référence circulaire',
  'depth-overflow': 'carte au-delà de la limite de 4 niveaux',
  'extra-root': 'seconde carte racine',
  'detached-parent': 'carte rattachée à une carte volante',
  'orphan-branch': 'branche coupée de la racine',
  'invalid-level': 'niveau incohérent avec la position dans l’arbre',
}

/** One human-readable line per issue kind, e.g. « 2 cartes fantômes ». */
export function summarizeIssues(issues: CardIssue[]): string[] {
  const counts = new Map<CardIssueKind, number>()
  for (const issue of issues) counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1)
  return [...counts.entries()].map(([kind, count]) => `${count} × ${ISSUE_LABELS[kind]}`)
}

function describe(card: Card): string {
  return card.title ? `« ${card.title} »` : `« ${card.id} »`
}

/**
 * Full structural report on a raw mind map. Accepts `unknown` on purpose: the
 * data comes straight from a JSON file that nothing has type-checked, and
 * `deserializeCards` only proves it is an array.
 */
export function validateCards(cards: unknown): ValidationReport {
  if (!Array.isArray(cards)) {
    return {
      valid: false,
      issues: [
        {
          kind: 'malformed',
          cardId: null,
          index: -1,
          message: 'Le fichier ne contient pas une liste de cartes.',
        },
      ],
    }
  }

  const placement = placeCards(cards)
  const issues: CardIssue[] = []

  for (const index of placement.malformedIndexes) {
    issues.push({
      kind: 'malformed',
      cardId: null,
      index,
      message: `L’élément n°${index + 1} n’est pas une carte exploitable.`,
    })
  }
  for (const { index, id } of placement.duplicates) {
    issues.push({
      kind: 'duplicate-id',
      cardId: id,
      index,
      message: `L’identifiant « ${id} » est utilisé par plusieurs cartes.`,
    })
  }

  placement.usable.forEach(card => {
    const index = placement.indexById.get(card.id)!
    if (card.detached) {
      // Floating cards are outside the hierarchy by definition; the only thing
      // that can be wrong with one is having children, which is reported on the
      // child (it is the card that has to move).
      return
    }
    const depth = placement.depthById.get(card.id)
    if (depth === undefined) {
      const kind = diagnoseUnplaced(card, placement)
      issues.push({ kind, cardId: card.id, index, message: unplacedMessage(kind, card) })
      return
    }
    if (card.level !== depth + 1) {
      issues.push({
        kind: 'invalid-level',
        cardId: card.id,
        index,
        message: `La carte ${describe(card)} est annoncée au niveau ${card.level} mais se trouve au niveau ${depth + 1}.`,
      })
    }
  })

  return { valid: issues.length === 0, issues }
}

function unplacedMessage(kind: CardIssueKind, card: Card): string {
  switch (kind) {
    case 'ghost-parent':
      return `La carte ${describe(card)} référence un parent qui n’existe plus.`
    case 'cycle':
      return `La carte ${describe(card)} fait partie d’une boucle de parents.`
    case 'depth-overflow':
      return `La carte ${describe(card)} dépasse la limite stricte de ${MAX_LEVEL} niveaux.`
    case 'extra-root':
      return `La carte ${describe(card)} est une seconde racine (une seule est autorisée).`
    case 'detached-parent':
      return `La carte ${describe(card)} est rattachée à une carte volante, qui ne peut pas avoir d’enfants.`
    case 'orphan-branch':
      return `La carte ${describe(card)} appartient à une branche coupée de la racine.`
    default:
      return `La carte ${describe(card)} est hors de la hiérarchie.`
  }
}

function clampLevel(level: number): CardLevel {
  const rounded = Math.round(level)
  if (!Number.isFinite(rounded) || rounded < 1) return 1
  if (rounded > MAX_LEVEL) return MAX_LEVEL as CardLevel
  return rounded as CardLevel
}

/**
 * Best-effort rescue of an entry `isUsableCardRecord` rejected. Whatever is
 * readable is kept and parked in the floating zone; an entry with neither a
 * title nor a definition holds nothing a user could recognise, so it is dropped
 * instead of littering that zone with a blank card.
 */
function salvage(entry: unknown): Card | null {
  if (!isRecord(entry)) return null
  const title = typeof entry.title === 'string' ? entry.title : ''
  // `content` counts as recoverable material: a SVT card whose whole point is
  // a diagram may legitimately have no title and no definition text, and
  // dropping it would delete the only copy of that image reference.
  //
  // It goes through the SAME sanitize + normalize pair the editor writes
  // through, for two reasons. Junk (`[null]`, `[1,2,3]`, a half-image) would
  // otherwise resurrect as a card that renders nothing at all — exactly the
  // blank card this function refuses to create — and, more importantly,
  // `definition` MUST be derived from the blocks. Writing `content` without
  // its mirror leaves the card invisible to everything that reads the mirror:
  // the quiz's question typing, the XMind note, the export.
  const salvaged = normalizeContent(sanitizeBlocks(entry.content))
  const content = salvaged.content
  // When there are blocks, the mirror MUST be derived from them or the two
  // disagree. With no blocks, the entry's own text is what is left to save —
  // and it goes through the same normalization, so a whitespace-only
  // definition is dropped rather than resurrected as a blank card.
  const definition =
    content !== undefined
      ? salvaged.definition
      : normalizeContent(
          typeof entry.definition === 'string' ? [{ kind: 'text', text: entry.definition }] : []
        ).definition
  if (title === '' && definition === undefined && content === undefined) return null
  const card: Card = {
    id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : crypto.randomUUID(),
    level: clampLevel(typeof entry.level === 'number' ? entry.level : 1),
    title,
    parentId: null,
    order: 0,
    detached: true,
  }
  if (definition !== undefined) card.definition = definition
  if (content !== undefined) card.content = content as Card['content']
  return card
}

/** Turns a card into a floating one: out of the hierarchy, parentless, childless. */
function toFloating(card: Card, order: number): Card {
  return { ...card, parentId: null, detached: true, order }
}

/**
 * Builds a REPAIRED COPY of a corrupt mind map. Never mutates its input, and is
 * never written back over the original file — the broken version stays on disk
 * untouched, by design.
 *
 * The contract is "keep everything, move as little as possible":
 *
 * - every card the root walk can legitimately reach keeps its parent, its
 *   order and its content, and only has its `level` recomputed from its real
 *   depth (levels are derived data, so fixing one costs the user nothing);
 * - every other card — ghost parent, cycle, past level 4, second root, hanging
 *   off a floating card — is detached, flattened, and parked in the floating
 *   zone as a "carte volante" (grey, draft), which is exactly what the app
 *   already does with cards it cannot place;
 * - no readable content is deleted. A card that loses its parent keeps its
 *   title and its definition, and its children follow it into the floating
 *   zone rather than disappearing with it. Only an entry too broken to hold
 *   either a title or a definition is dropped.
 *
 * The result is guaranteed to satisfy `validateCards`.
 */
export function repairCards(cards: unknown): Card[] {
  const raw = Array.isArray(cards) ? cards : []
  const placement = placeCards(raw)

  const repaired: Card[] = []
  const floating: Card[] = []

  // The root first, so the repaired array reads top-down like a fresh file.
  if (placement.root) repaired.push({ ...placement.root, level: 1, parentId: null, order: 0 })

  // Attached cards, re-levelled from their real depth. Sibling groups are
  // renumbered 0..n-1 while preserving their relative order.
  const orderInGroup = new Map<string, number>()
  const nextOrder = new Map<string, number>()
  const placedChildren = placement.usable
    .filter(card => card.id !== placement.root?.id && placement.depthById.has(card.id))
    .sort((a, b) => a.order - b.order)
  for (const card of placedChildren) {
    const key = card.parentId!
    const order = nextOrder.get(key) ?? 0
    nextOrder.set(key, order + 1)
    orderInGroup.set(card.id, order)
  }
  for (const card of placement.usable) {
    if (card.id === placement.root?.id) continue
    const depth = placement.depthById.get(card.id)
    if (depth === undefined) continue
    const next: Card = {
      ...card,
      level: (depth + 1) as CardLevel,
      order: orderInGroup.get(card.id)!,
    }
    delete next.detached
    repaired.push(next)
  }

  // Then the floating zone: cards that were already floating keep their place
  // in it, and the newly detached ones are appended in file order behind them.
  const alreadyFloating = placement.usable.filter(card => card.detached).sort((a, b) => a.order - b.order)
  const newlyFloating = placement.usable.filter(
    card => !card.detached && card.id !== placement.root?.id && !placement.depthById.has(card.id)
  )
  const salvaged = [
    ...placement.malformedIndexes.map(index => salvage(raw[index])),
    ...placement.duplicates.map(({ index }) => {
      const rescued = salvage(raw[index])
      // A duplicate id is still a real card: it only needs an id of its own.
      return rescued ? { ...rescued, id: crypto.randomUUID() } : null
    }),
  ].filter((card): card is Card => card !== null)

  for (const card of [...alreadyFloating, ...newlyFloating, ...salvaged]) {
    floating.push(toFloating({ ...card, level: clampLevel(card.level) }, floating.length))
  }

  const result = [...repaired, ...floating]

  // A file whose root was unusable would otherwise repair into a pile of
  // floating cards with nothing to attach them back to. Give it a home rather
  // than a dead end — the user can rename it and drag their cards back in.
  if (!placement.root && result.length > 0) {
    return [createRootCard('Carte réparée'), ...result]
  }
  return result
}
