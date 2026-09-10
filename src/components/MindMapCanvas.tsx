import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useOnSelectionChange,
  useReactFlow,
  useStoreApi,
  type Node,
  type Edge,
  type NodeProps,
  type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Sparkles,
  Undo2,
  Redo2,
  Download,
  X,
  ClipboardPaste,
  Maximize,
  ZoomIn,
  ZoomOut,
  Scan,
  Home,
} from 'lucide-react'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent } from './ui/context-menu'
import { CommandMenuItem } from './commands/CommandMenuItem'
import { useCanvasCommands } from '../hooks/useCanvasCommands'
import { useCardSelectionStore } from '../state/useCardSelectionStore'
import { useWorkspaceStore } from '../state/useWorkspaceStore'
import { quickExport, type QuickExportFormat } from '../export/quickExport'
import { describeExportError } from '../export/describeExportError'
import { useCardsStore, selectEditsBlocked } from '../state/useCardsStore'
import { useQuizStore } from '../state/useQuizStore'
import { useCardDetailStore } from '../state/useCardDetailStore'
import type { Card } from '../types/card'
import { isRootCard } from '../types/card'
import type { QuizQuestion, QuizResult } from '../types/quiz'
import { computeLayout, type Position } from '../layout/columns'
import { isFullyVisible } from '../layout/visibility'
import { canMoveCardTo, overflowingCardCount, subtreeDepths } from '../state/cardsReducer'
import { CardNode } from './CardNode'
import { clampCardLevel } from '../colors/levelColors'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'
import { useResolvedTheme } from '../hooks/useResolvedTheme'
import { toCss } from '../colors/contrast'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'

// Nominal card size. Used to offset `setCenter` onto the middle of a freshly
// created card, and passed as `initialWidth`/`initialHeight` — a pre-measurement
// FALLBACK only (React Flow replaces it with `measured` as soon as the real DOM
// node is observed, unlike the fixed `width`/`height` this used to declare).
// Without it, `fitView` resolves as soon as the first node is measured and ends
// up framing that node alone, zoomed to maxZoom.
const NOMINAL_NODE_WIDTH = 200
const NOMINAL_NODE_HEIGHT = 92

// Two chrome-only nodes, laid out in flow coordinates so they pan and zoom with
// the cards. They are NOT cards: every card lookup filters them out by id.
const INSERTION_NODE_ID = '__insertion-indicator__'
const ZONE_LABEL_NODE_ID = '__detached-zone-label__'

/** The blue insertion line shown when the drop would REORDER rather than reparent. */
function InsertionLineNode({ data }: NodeProps) {
  const { width } = data as { width: number }
  return <div className="insertion-line" data-testid="insertion-line" style={{ width }} />
}

/** Caption pinned above the floating-cards grid so the zone reads as a zone. */
function ZoneLabelNode({ data }: NodeProps) {
  const { label } = data as { label: string }
  return (
    <div className="zone-label" data-testid="detached-zone-label">
      {label}
    </div>
  )
}

const nodeTypes = { card: CardNode, insertionLine: InsertionLineNode, zoneLabel: ZoneLabelNode }

function buildNodes(
  cards: Card[],
  layout: Record<string, Position>,
  locked: boolean,
  autoEditId: string | null,
  spawningId: string | null,
  quizQuestions: QuizQuestion[],
  quizResults: Record<string, QuizResult>
): Node[] {
  const cardNodes = cards.map(card => {
    // For the one card just created, the FIRST pass of this function places
    // it at its parent's spot instead of its own — `spawningId` is cleared a
    // frame later, and the resulting position change is what the CSS
    // transition on `.react-flow__node` (index.css) animates: the new card
    // visibly grows out of the card that spawned it, briefly behind it
    // (negative z-index) rather than popping directly into its own slot.
    const spawnParent = card.id === spawningId ? cards.find(c => c.id === card.parentId) : undefined
    const question = quizQuestions.find(q => q.cardId === card.id)
    const quiz = question
      ? {
          type: question.type,
          result: quizResults[card.id] ?? 'unanswered',
          distractorDefinitions: question.distractorDefinitions,
          distractorTitles: question.distractorTitles,
          hint: question.hint,
        }
      : undefined
    return {
      id: card.id,
      type: 'card',
      position: spawnParent ? layout[spawnParent.id] : layout[card.id],
      data: { card, autoEdit: card.id === autoEditId, quiz },
      draggable: !locked,
      dragHandle: '.card-drag-handle',
      initialWidth: NOMINAL_NODE_WIDTH,
      initialHeight: NOMINAL_NODE_HEIGHT,
      zIndex: spawnParent ? -1 : undefined,
    }
  })

  const zoneLabel = detachedZoneLabelNode(cards, layout)
  return zoneLabel ? [...cardNodes, zoneLabel] : cardNodes
}

/**
 * Copies each node's `measured` box (and the `width`/`height` React Flow may
 * have written alongside it) from the nodes currently on screen onto the ones
 * `buildNodes` just produced.
 *
 * Without this, EVERY rebuild — flipping the lock, a theme change, an answered
 * quiz card — hands React Flow node objects with no `measured` field.
 * `adoptUserNodes` then resets both the node's size (to the `initialWidth` /
 * `initialHeight` fallback: 200×92) and its handle bounds, so every edge is
 * re-routed against a card-sized guess for the frame or two it takes the
 * ResizeObserver to report the real boxes again. The cards themselves never
 * move — they are placed by `position`, not by their size — so what the user
 * sees is the links alone jumping and snapping back. Carrying the measurement
 * over keeps the boxes (and, through them, the handle bounds React Flow only
 * preserves for an already-measured node) stable across the rebuild.
 */
export function carryMeasured(next: Node[], previous: Node[]): Node[] {
  const previousById = new Map(previous.map(node => [node.id, node]))
  return next.map(node => {
    const before = previousById.get(node.id)
    if (before === undefined) return node
    // `selected` rides along for a different reason than the measurements:
    // `buildNodes` derives nodes from the card list, which knows nothing about
    // selection, so every rebuild (a title edit, a lock toggle) would clear it.
    // Losing it mid-edit breaks the chained keyboard flow the shortcuts exist
    // for — Tab, type, Entrée, type — since each new card would deselect the
    // one the next keystroke is meant to act on.
    const withSelection = before.selected === true ? { ...node, selected: true } : node
    if (!before.measured) return withSelection
    return { ...withSelection, measured: before.measured, width: before.width, height: before.height }
  })
}

/** The floating zone's caption, anchored just above its top-left card. */
function detachedZoneLabelNode(cards: Card[], layout: Record<string, Position>): Node | null {
  const detachedPositions = cards.filter(c => c.detached).map(c => layout[c.id]).filter(Boolean)
  if (detachedPositions.length === 0) return null
  return {
    id: ZONE_LABEL_NODE_ID,
    type: 'zoneLabel',
    position: { x: Math.min(...detachedPositions.map(p => p.x)), y: Math.min(...detachedPositions.map(p => p.y)) - 34 },
    data: { label: 'Cartes volantes' },
    draggable: false,
    selectable: false,
    focusable: false,
    deletable: false,
  }
}

// Distinguishes a genuine incremental create (addChild/addSibling — every
// previously-known id is still present, plus one new one) from a wholesale
// replacement of the card array (a file load via `loadCards`, which swaps
// in a completely different set of ids — notably including the very first
// load-on-mount, which replaces the store's transient default root card).
// Only the former should trigger auto-focus; exported for direct unit
// testing since spying on `setCenter` through `useReactFlow`'s context is
// more brittle than testing this pure decision in isolation.
export function findNewlyCreatedCardId(previousIds: Set<string>, currentIds: Set<string>): string | undefined {
  const isIncrementalChange = [...previousIds].some(id => currentIds.has(id))
  if (!isIncrementalChange) return undefined
  return [...currentIds].find(id => !previousIds.has(id))
}

export interface NodeBox {
  id: string
  x: number
  y: number
  width: number
  height: number
}

function boxesOverlap(a: NodeBox, b: NodeBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function centerOf(box: NodeBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * What a drop would do, decided purely by geometry. The two gestures are told
 * apart by WHERE on the hovered card the dragged one sits:
 *
 * - over its top/bottom band (`INSERT_BAND` of the height, i.e. visually
 *   *between* two cards) -> `insert`: the dragged card joins the hovered
 *   card's sibling group at that slot. That covers plain reordering AND
 *   "become a sibling of this card", including across parents.
 * - over its middle -> `reparent`: the dragged card (with its whole branch)
 *   becomes a child of the hovered card.
 *
 * A drop onto the parent the card already has is `null` (nothing to do) rather
 * than a no-op move, and the dragged card's own branch is never a candidate —
 * it travels with it, and dropping into it would make a cycle.
 */
export const INSERT_BAND = 0.3

export type DropTarget =
  | { kind: 'reparent'; parentId: string }
  | { kind: 'insert'; parentId: string; index: number; anchorId: string; side: 'before' | 'after' }

function insertTarget(cards: Card[], draggedId: string, anchor: Card, side: 'before' | 'after'): DropTarget | null {
  // The root has no sibling group (single-root invariant) and floating cards
  // are not a hierarchy — neither can host an insertion.
  if (anchor.detached || anchor.parentId === null) return null
  if (!canMoveCardTo(cards, draggedId, anchor.parentId)) return null
  const siblings = cards
    .filter(c => c.parentId === anchor.parentId && !c.detached && c.id !== draggedId)
    .sort((a, b) => a.order - b.order)
  const anchorIndex = siblings.findIndex(c => c.id === anchor.id)
  if (anchorIndex === -1) return null
  return {
    kind: 'insert',
    parentId: anchor.parentId,
    index: side === 'after' ? anchorIndex + 1 : anchorIndex,
    anchorId: anchor.id,
    side,
  }
}

export function resolveDropTarget(cards: Card[], boxes: NodeBox[], draggedId: string): DropTarget | null {
  const dragged = cards.find(c => c.id === draggedId)
  if (!dragged || isRootCard(dragged)) return null
  const draggedBox = boxes.find(b => b.id === draggedId)
  if (!draggedBox) return null

  const ownBranch = subtreeDepths(cards, draggedId)
  const cardById = new Map(cards.map(c => [c.id, c]))
  const overlapping = boxes.filter(
    box => cardById.has(box.id) && !ownBranch.has(box.id) && boxesOverlap(draggedBox, box)
  )
  if (overlapping.length === 0) return null

  // Several cards can be under the dragged one at once; the closest center wins.
  const draggedCenter = centerOf(draggedBox)
  const anchorBox = [...overlapping].sort(
    (a, b) => distance(centerOf(a), draggedCenter) - distance(centerOf(b), draggedCenter)
  )[0]
  const anchor = cardById.get(anchorBox.id)!

  const relativeY = (draggedCenter.y - anchorBox.y) / (anchorBox.height || NOMINAL_NODE_HEIGHT)
  const overEdgeBand = relativeY < INSERT_BAND || relativeY > 1 - INSERT_BAND
  if (!overEdgeBand) {
    if (anchor.id === dragged.parentId) return null // already this card's child
    if (canMoveCardTo(cards, draggedId, anchor.id)) return { kind: 'reparent', parentId: anchor.id }
    // Level-4 (and other non-receiving) cards fall through: a drop onto one is
    // read as "put me next to it" rather than rejected outright.
  }
  return insertTarget(cards, draggedId, anchor, relativeY < 0.5 ? 'before' : 'after')
}

/** The insertion line's own flow-coordinates node, straddling the gap it marks. */
function insertionLineNode(target: DropTarget | null, boxes: NodeBox[]): Node | null {
  if (target?.kind !== 'insert') return null
  const anchorBox = boxes.find(b => b.id === target.anchorId)
  if (!anchorBox) return null
  return {
    id: INSERTION_NODE_ID,
    type: 'insertionLine',
    position: {
      x: anchorBox.x,
      y: target.side === 'before' ? anchorBox.y - 14 : anchorBox.y + anchorBox.height + 10,
    },
    data: { width: anchorBox.width },
    draggable: false,
    selectable: false,
    focusable: false,
    deletable: false,
    zIndex: 1000,
  }
}

/**
 * The warning shown when a drop would push part of the moved branch past level
 * 4. Pure (and exported) so the exact wording — the one thing the user reads
 * before agreeing to lose the hierarchy under those cards — is unit-tested.
 */
export function overflowWarningMessage(count: number): string {
  const cards = count === 1 ? '1 carte enfant située' : `${count} cartes enfants situées`
  const outcome = count === 1 ? 'sera transformée en carte volante' : 'seront transformées en cartes volantes'
  return `Attention, ce déplacement dépasse la limite des 4 niveaux. ${cards} hors limite ${outcome}.`
}

interface PendingMove {
  cardId: string
  parentId: string
  index?: number
  overflowCount: number
}

function MindMapCanvasInner() {
  const cards = useCardsStore(s => s.history.present)
  const locked = useCardsStore(selectEditsBlocked)
  const moveCard = useCardsStore(s => s.moveCard)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const [exportError, setExportError] = useState<string | null>(null)
  const quizQuestions = useQuizStore(s => s.questions)
  const quizResults = useQuizStore(s => s.results)
  const theme = useResolvedTheme()
  const levelAppearance = useAppearanceSettingsStore(s => s.levels)
  const { setCenter, getZoom, flowToScreenPosition } = useReactFlow()
  const storeApi = useStoreApi()
  const openFicheIds = useCardDetailStore(s => s.open)

  const layout = useMemo(() => computeLayout(cards), [cards])

  // Track card ids seen so far so a newly created card (child or sibling)
  // can be detected: the viewport pans to it AND its title editor opens.
  const previousIds = useRef(new Set(cards.map(c => c.id)))
  const [autoEditId, setAutoEditId] = useState<string | null>(null)
  const [spawningId, setSpawningId] = useState<string | null>(null)
  /**
   * Set just before an action that adds cards which already HAVE their text —
   * a paste, a duplicate. Opening the title editor there (and selecting the
   * title, as a fresh card's editor does) would leave the pasted branch one
   * keystroke from being overwritten. A blank new card still wants it.
   */
  const suppressAutoEdit = useRef(false)
  const requestSuppressAutoEdit = useCallback(() => {
    suppressAutoEdit.current = true
  }, [])

  /** Brings a card into the middle of the viewport, at the current zoom. */
  const focusCard = useCallback(
    (cardId: string) => {
      const position = layout[cardId]
      if (position === undefined) return
      setCenter(position.x + NOMINAL_NODE_WIDTH / 2, position.y + NOMINAL_NODE_HEIGHT / 2, {
        zoom: getZoom(),
        duration: 250,
      })
    },
    [layout, setCenter, getZoom]
  )

  /**
   * React Flow owns selection (it is what a click sets and what the outline
   * draws); this mirrors it into the store the command handlers read, so
   * « supprimer la carte » and the arrow keys act on the card the user can see
   * is selected. Only card nodes count — the insertion line and the zone label
   * are chrome, never a target.
   */
  // Memoised: React Flow re-subscribes whenever this identity changes, and an
  // inline arrow would hand it a new one on every render of the canvas.
  const handleSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: Node[] }) => {
    const card = selectedNodes.find(node => node.type === 'card')
    useCardSelectionStore.getState().select(card?.id ?? null)
  }, [])
  useOnSelectionChange({ onChange: handleSelectionChange })

  /**
   * Applies a selection made in code — an arrow-key move, a card just created
   * or pasted, a cut that left nothing selected.
   *
   * Through React Flow's own selection action rather than by rewriting the node
   * array: React Flow owns selection, and a second writer patching `selected`
   * onto the nodes it is handed sets the two of them re-triggering each other
   * (its adoption emits changes, `onNodesChange` writes a new array, adoption
   * runs again) until React gives up on the render loop.
   *
   * A card created a moment ago is not in React Flow's lookup yet — the node
   * array is rebuilt by the effect that runs after this one — so the request is
   * held and re-applied by the effect below, once the node exists.
   */
  const pendingSelection = useRef<string | null>(null)
  const selectCard = useCallback(
    (cardId: string | null) => {
      // Mirrored first and unconditionally: the command handlers read this, and
      // they must see the new selection even when the node is still on its way.
      useCardSelectionStore.getState().select(cardId)
      const { addSelectedNodes, unselectNodesAndEdges, nodeLookup } = storeApi.getState()
      if (cardId === null) {
        unselectNodesAndEdges()
        return
      }
      if (nodeLookup.has(cardId)) addSelectedNodes([cardId])
      else pendingSelection.current = cardId
    },
    [storeApi]
  )

  // Read through a ref by the creation effect below, which must not re-run
  // (and re-centre the viewport) just because this callback was re-created.
  const selectCardRef = useRef(selectCard)
  selectCardRef.current = selectCard

  useCanvasCommands({ cards, locked, focusCard, selectCard, suppressAutoEdit: requestSuppressAutoEdit })

  // Which card is currently being dragged and what its drop would do — see
  // `resolveDropTarget`. Both are only ever set between onNodeDragStart and
  // onNodeDragStop.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  // A drop that would push part of the moved branch past level 4: held here
  // until the user confirms turning those cards into floating ones.
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const reparentTargetId = dropTarget?.kind === 'reparent' ? dropTarget.parentId : null

  useEffect(() => {
    const currentIds = new Set(cards.map(c => c.id))
    const createdId = findNewlyCreatedCardId(previousIds.current, currentIds)
    if (createdId) {
      const position = layout[createdId]
      setCenter(position.x + NOMINAL_NODE_WIDTH / 2, position.y + NOMINAL_NODE_HEIGHT / 2, {
        zoom: 1,
        duration: 400,
      })
    }
    // A card you just created is the card you are about to act on: selecting it
    // is what makes "Tab, Tab, Tab" build a branch, and what lets Suppr undo a
    // mis-click without reaching for the mouse.
    if (createdId) selectCardRef.current(createdId)
    setAutoEditId(suppressAutoEdit.current ? null : (createdId ?? null))
    setSpawningId(createdId ?? null)
    suppressAutoEdit.current = false
    previousIds.current = currentIds
  }, [cards, layout, setCenter])

  /**
   * Keeps the card whose fiche just opened in view.
   *
   * The fiche panel takes its width out of the flow pane, so a card near the
   * right edge can end up BEHIND the panel that was opened to read it — the
   * one failure that would make the whole panel feel hostile.
   *
   * Only when it is actually needed: `isFullyVisible` is checked against the
   * pane as it is now (the panel has already been laid out by the time this
   * effect runs), and the zoom is preserved, so this never re-frames a map the
   * user had positioned deliberately. Same "compare against the previous set"
   * shape as the newly-created-card effect above.
   */
  const paneRef = useRef<HTMLDivElement>(null)
  const previousFicheIds = useRef(new Set<string>())
  useEffect(() => {
    const currentIds = new Set(openFicheIds.map(entry => entry.cardId))
    const appeared = [...currentIds].find(id => !previousFicheIds.current.has(id))
    previousFicheIds.current = currentIds
    if (appeared === undefined) return

    const position = layout[appeared]
    const pane = paneRef.current
    if (position === undefined || pane === null) return

    const topLeft = flowToScreenPosition({ x: position.x, y: position.y })
    const bottomRight = flowToScreenPosition({
      x: position.x + NOMINAL_NODE_WIDTH,
      y: position.y + NOMINAL_NODE_HEIGHT,
    })
    const card = { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y }
    const bounds = pane.getBoundingClientRect()
    // The margin covers the sibling "+" buttons, which straddle the card's own
    // border by ~14px and are just as unusable when clipped.
    if (isFullyVisible(card, bounds, 24)) return

    setCenter(position.x + NOMINAL_NODE_WIDTH / 2, position.y + NOMINAL_NODE_HEIGHT / 2, {
      zoom: getZoom(),
      duration: 300,
    })
  }, [openFicheIds, layout, flowToScreenPosition, getZoom, setCenter])

  // React Flow owns the node array so a drag moves the card live under the
  // cursor (`onNodesChange` applies position changes during the gesture).
  // `cards` + `layout` stay the source of truth: this effect resyncs the
  // canonical positions whenever the store changes — including right after a
  // drop commits, which is what snaps the card onto its new grid row.
  // Seeded with the real nodes rather than `[]` so the very first paint (and
  // the `fitView` that runs with it) already sees the whole tree.
  const initialNodes = useRef<Node[]>(undefined)
  if (!initialNodes.current)
    initialNodes.current = buildNodes(cards, layout, locked, null, null, quizQuestions, quizResults)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes.current)

  useEffect(() => {
    setNodes(current =>
      carryMeasured(buildNodes(cards, layout, locked, autoEditId, spawningId, quizQuestions, quizResults), current)
    )
    // `spawningId` intentionally excluded below: it is only read here to seed
    // the spawn override at CREATION time (when `cards` changes anyway). The
    // effect right after this one clears it via a targeted position patch
    // instead of re-running `buildNodes` — that would hand every node a
    // brand new `data` object, re-rendering every CardNode including the one
    // whose title field a user may have just selected, which collapses that
    // selection (Chrome resets it when a controlled input's value is
    // re-committed, even to the same string).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, layout, locked, autoEditId, quizQuestions, quizResults, setNodes])

  // Puts every node back on its canonical spot and drops all drag chrome (the
  // insertion line, the reparent highlight). Used when a drag ends without a
  // move — an empty drop zone, or a cancelled overflow confirmation: "la carte
  // retourne à sa place initiale".
  useEffect(() => {
    const pending = pendingSelection.current
    if (pending === null) return
    const { addSelectedNodes, nodeLookup } = storeApi.getState()
    if (!nodeLookup.has(pending)) return
    // Cleared before the call, so the node changes it triggers re-enter this
    // effect with nothing left to do.
    pendingSelection.current = null
    addSelectedNodes([pending])
  }, [nodes, storeApi])

  const resyncNodes = useCallback(() => {
    setNodes(current => carryMeasured(buildNodes(cards, layout, locked, autoEditId, null, quizQuestions, quizResults), current))
  }, [cards, layout, locked, autoEditId, quizQuestions, quizResults, setNodes])

  // One frame after a card spawns at its parent's position (see `buildNodes`),
  // patch just that node's position/zIndex back to its real layout slot — a
  // targeted update, not a full rebuild (see note above). The position
  // change between those two committed frames is exactly what the CSS
  // transition on `.react-flow__node` animates.
  useEffect(() => {
    if (!spawningId) return
    const raf = requestAnimationFrame(() => {
      setNodes(current =>
        current.map(node => (node.id === spawningId ? { ...node, position: layout[node.id], zIndex: undefined } : node))
      )
      setSpawningId(null)
    })
    return () => cancelAnimationFrame(raf)
  }, [spawningId, layout, setNodes])

  const edges: Edge[] = useMemo(() => {
    const realEdges = cards
      // `!card.detached` is belt and braces: detaching always nulls `parentId`,
      // but a hand-edited file could carry both and would draw an edge from the
      // floating zone back into the tree.
      .filter((card): card is typeof card & { parentId: string } => card.parentId !== null && !card.detached)
      .map(
        (card): Edge => ({
          id: `e-${card.parentId}-${card.id}`,
          source: card.parentId,
          target: card.id,
          // The real edge from the current parent fades out while a valid
          // reparent target is active, so it doesn't compete with the dashed
          // ghost edge previewing the future link (added below).
          style: {
            stroke: toCss(levelAppearance[clampCardLevel(card.level)].color[theme].border),
            opacity: reparentTargetId && card.id === draggingId ? 0.15 : 1,
          },
        })
      )
    if (reparentTargetId && draggingId) {
      const draggedCard = cards.find(c => c.id === draggingId)
      if (draggedCard) {
        realEdges.push({
          id: 'reparent-ghost-edge',
          source: reparentTargetId,
          target: draggingId,
          className: 'reparent-ghost-edge',
          style: { stroke: toCss(levelAppearance[clampCardLevel(draggedCard.level)].color[theme].border), opacity: 1 },
        })
      }
    }
    return realEdges
  }, [cards, reparentTargetId, draggingId, levelAppearance, theme])

  const handleNodeDragStart: OnNodeDrag = useCallback((_event, draggedNode) => {
    setDraggingId(draggedNode.id)
  }, [])

  // Two mutually exclusive previews, decided fresh every frame by
  // `resolveDropTarget`:
  //
  // - `reparent`: the target card lights up (`isReparentTarget`) and a dashed
  //   ghost edge previews the future parent link (see `edges` above).
  // - `insert`: a blue line is drawn in the gap the card would drop into.
  //
  // The other cards always sit on their canonical layout spots: the indicator
  // IS the preview, so nothing reflows under the cursor. The dragged node's own
  // position stays whatever `onNodesChange` gave it (live under the pointer),
  // and nothing is committed to the store until drop.
  const handleNodeDrag: OnNodeDrag = useCallback(
    (_event, draggedNode) => {
      const cardIds = new Set(cards.map(c => c.id))
      const boxes: NodeBox[] = nodes
        .filter(node => cardIds.has(node.id))
        .map(node => ({
          id: node.id,
          x: node.id === draggedNode.id ? draggedNode.position.x : node.position.x,
          y: node.id === draggedNode.id ? draggedNode.position.y : node.position.y,
          width: node.measured?.width ?? NOMINAL_NODE_WIDTH,
          height: node.measured?.height ?? NOMINAL_NODE_HEIGHT,
        }))
      const target = resolveDropTarget(cards, boxes, draggedNode.id)
      setDropTarget(previous => (sameDropTarget(previous, target) ? previous : target))

      const highlightedId = target?.kind === 'reparent' ? target.parentId : null
      const indicator = insertionLineNode(target, boxes)
      setNodes(current => {
        const patched = current
          .filter(node => node.id !== INSERTION_NODE_ID)
          .map(node => {
            if (node.id === draggedNode.id || !cardIds.has(node.id)) return node
            const isTarget = node.id === highlightedId
            const highlightChanged = Boolean(node.data.isReparentTarget) !== isTarget
            const positionChanged = node.position !== layout[node.id]
            if (!highlightChanged && !positionChanged) return node
            return {
              ...node,
              position: layout[node.id] ?? node.position,
              data: highlightChanged ? { ...node.data, isReparentTarget: isTarget } : node.data,
            }
          })
        return indicator ? [...patched, indicator] : patched
      })
    },
    [cards, layout, nodes, setNodes]
  )

  const handleNodeDragStop: OnNodeDrag = useCallback(
    (_event, draggedNode) => {
      const target = dropTarget
      setDraggingId(null)
      setDropTarget(null)
      if (!target) {
        resyncNodes()
        return
      }
      const index = target.kind === 'insert' ? target.index : undefined
      const overflowCount = overflowingCardCount(cards, draggedNode.id, target.parentId)
      // The card snaps home either way: on a plain move the store update
      // immediately re-places it, and on an overflow it must not hover in
      // limbo behind the confirmation dialog.
      resyncNodes()
      if (overflowCount > 0) {
        setPendingMove({ cardId: draggedNode.id, parentId: target.parentId, index, overflowCount })
        return
      }
      moveCard(draggedNode.id, target.parentId, index)
    },
    [cards, dropTarget, moveCard, resyncNodes]
  )

  async function exportFromCanvas(format: QuickExportFormat) {
    try {
      await quickExport(format, cards, currentFilePath)
    } catch (error) {
      setExportError(`Échec de l’export : ${describeExportError(error)}`)
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div style={{ width: '100%', height: '100%' }}>
            <ReactFlow
              // Measured rather than assumed: the flow pane's width changes when
              // the fiche panel opens, and the recentring above compares against
              // what it actually is at that moment.
              ref={paneRef}
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              nodeTypes={nodeTypes}
              onNodeDragStart={handleNodeDragStart}
              onNodeDrag={handleNodeDrag}
              onNodeDragStop={handleNodeDragStop}
              // Opening a quiz question selects its card like any other click
              // would. React Flow's default Backspace/Delete shortcut would
              // then remove that still-selected card from the canvas the
              // instant focus leaves an input — e.g. when a wrong answer
              // disables the field. No card may ever disappear during a quiz.
              // Card deletion goes through the `edit.delete` command instead,
              // so the keyboard, the card's own × and the context menu all end
              // up in the same confirmation dialog — React Flow's built-in
              // shortcut would remove a branch outright, with no warning and no
              // "détacher les enfants" option.
              deleteKeyCode={null}
              fitView
              colorMode={theme}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </ContextMenuTrigger>
        {/*
          The canvas menu is the one you get on empty space: everything here
          acts on the map as a whole. Actions on a single card live on the
          card's own right-click menu (see `CardNode`), which stops this one
          from opening over it.

          Entries are `CommandMenuItem`s rather than inline handlers, so each
          one shows its current shortcut and greys itself out exactly when the
          keyboard would refuse it — a locked map, an empty clipboard.
        */}
        <ContextMenuContent>
          <CommandMenuItem command="card.addFloating" icon={Sparkles} />
          <CommandMenuItem command="edit.paste" icon={ClipboardPaste} />
          <ContextMenuSeparator />
          <CommandMenuItem command="edit.undo" icon={Undo2} />
          <CommandMenuItem command="edit.redo" icon={Redo2} />
          <ContextMenuSeparator />
          <CommandMenuItem command="view.fitView" icon={Maximize} />
          <CommandMenuItem command="nav.root" icon={Home} />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Scan size={14} /> Zoom
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <CommandMenuItem command="view.zoomIn" icon={ZoomIn} />
              <CommandMenuItem command="view.zoomOut" icon={ZoomOut} />
              <CommandMenuItem command="view.zoomReset" icon={Scan} />
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          {/*
            Export stays on its own handlers rather than the command registry:
            these three write a file from the cards on screen through this
            component's own error banner, and the catalogue's `file.export`
            opens the full dialog (formats, page setup) from the header.
          */}
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Download size={14} /> Exporter
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onSelect={() => exportFromCanvas('pdf')}>PDF</ContextMenuItem>
              <ContextMenuItem onSelect={() => exportFromCanvas('image')}>Image</ContextMenuItem>
              <ContextMenuItem onSelect={() => exportFromCanvas('xmind')}>XMind</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>

      {exportError && (
        <div
          role="alert"
          className="status-banner"
          style={{ position: 'absolute', top: 8, left: 8, right: 8, bottom: 'auto', zIndex: 5 }}
        >
          <span style={{ flex: 1 }}>{exportError}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Masquer le message d’erreur"
            onClick={() => setExportError(null)}
          >
            <X size={14} />
          </Button>
        </div>
      )}

      {pendingMove && (
        <Dialog open onOpenChange={open => !open && setPendingMove(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{overflowWarningMessage(pendingMove.overflowCount)}</DialogTitle>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPendingMove(null)}>
                Annuler
              </Button>
              <Button
                onClick={() => {
                  moveCard(pendingMove.cardId, pendingMove.parentId, pendingMove.index)
                  setPendingMove(null)
                }}
              >
                Confirmer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

/** Cheap structural equality, so a drag frame that changes nothing re-renders nothing. */
function sameDropTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === b) return true
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'reparent' && b.kind === 'reparent') return a.parentId === b.parentId
  if (a.kind === 'insert' && b.kind === 'insert') {
    return a.parentId === b.parentId && a.index === b.index && a.anchorId === b.anchorId && a.side === b.side
  }
  return false
}

export function MindMapCanvas() {
  return (
    <ReactFlowProvider>
      <div style={{ width: '100%', height: '100%' }}>
        <MindMapCanvasInner />
      </div>
    </ReactFlowProvider>
  )
}
