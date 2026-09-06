import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useReactFlow,
  type Node,
  type Edge,
  type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCardsStore } from '../state/useCardsStore'
import type { Card } from '../types/card'
import { computeLayout, type Position } from '../layout/columns'
import { moveCardToIndex as moveCardToIndexOp } from '../state/cardsReducer'
import { CardNode } from './CardNode'
import { levelColors } from '../colors/levelColors'
import { toCss } from '../colors/contrast'

const nodeTypes = { card: CardNode }

// Nominal card size. Used to offset `setCenter` onto the middle of a freshly
// created card, and passed as `initialWidth`/`initialHeight` — a pre-measurement
// FALLBACK only (React Flow replaces it with `measured` as soon as the real DOM
// node is observed, unlike the fixed `width`/`height` this used to declare).
// Without it, `fitView` resolves as soon as the first node is measured and ends
// up framing that node alone, zoomed to maxZoom.
const NOMINAL_NODE_WIDTH = 200
const NOMINAL_NODE_HEIGHT = 92

function buildNodes(
  cards: Card[],
  layout: Record<string, Position>,
  locked: boolean,
  autoEditId: string | null,
  spawningId: string | null
): Node[] {
  return cards.map(card => {
    // For the one card just created, the FIRST pass of this function places
    // it at its parent's spot instead of its own — `spawningId` is cleared a
    // frame later, and the resulting position change is what the CSS
    // transition on `.react-flow__node` (index.css) animates: the new card
    // visibly grows out of the card that spawned it, briefly behind it
    // (negative z-index) rather than popping directly into its own slot.
    const spawnParent = card.id === spawningId ? cards.find(c => c.id === card.parentId) : undefined
    return {
      id: card.id,
      type: 'card',
      position: spawnParent ? layout[spawnParent.id] : layout[card.id],
      data: { card, autoEdit: card.id === autoEditId },
      draggable: !locked,
      dragHandle: '.card-drag-handle',
      initialWidth: NOMINAL_NODE_WIDTH,
      initialHeight: NOMINAL_NODE_HEIGHT,
      zIndex: spawnParent ? -1 : undefined,
    }
  })
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

/**
 * Where a dragged card's sibling group would sort it if dropped right now,
 * given its live in-progress Y. Shared by the continuous drag preview and
 * the drop commit so they can never disagree about the target slot.
 */
function resolveDragIndex(cards: Card[], layout: Record<string, Position>, draggedId: string, liveY: number): number {
  const draggedCard = cards.find(c => c.id === draggedId)
  const siblingYs = cards
    .filter(c => c.parentId === draggedCard?.parentId)
    .map(c => ({ id: c.id, y: c.id === draggedId ? liveY : layout[c.id].y }))
    .sort((a, b) => a.y - b.y)
  return siblingYs.findIndex(c => c.id === draggedId)
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
 * Which card the dragged card should reparent onto if dropped right now, given
 * its live bounding box among all the others'. A candidate must be at the level
 * directly above the dragged card (same constraint `moveCardToParent` enforces,
 * which is also why it can never be one of the dragged card's own descendants)
 * and must overlap it — its current parent doesn't count, since dropping there
 * changes nothing. Ties among several overlapping candidates go to whichever
 * center is closest to the dragged card's.
 */
export function resolveReparentTarget(cards: Card[], boxes: NodeBox[], draggedId: string): string | undefined {
  const draggedCard = cards.find(c => c.id === draggedId)
  if (!draggedCard || draggedCard.parentId === null) return undefined
  const draggedBox = boxes.find(b => b.id === draggedId)
  if (!draggedBox) return undefined

  const validLevel = draggedCard.level - 1
  const overlapping = boxes.filter(b => {
    if (b.id === draggedId || b.id === draggedCard.parentId) return false
    const card = cards.find(c => c.id === b.id)
    return card?.level === validLevel && boxesOverlap(draggedBox, b)
  })
  if (overlapping.length === 0) return undefined

  const draggedCenter = centerOf(draggedBox)
  overlapping.sort((a, b) => distance(centerOf(a), draggedCenter) - distance(centerOf(b), draggedCenter))
  return overlapping[0].id
}

function MindMapCanvasInner() {
  const cards = useCardsStore(s => s.history.present)
  const locked = useCardsStore(s => s.locked)
  const moveCardToIndex = useCardsStore(s => s.moveCardToIndex)
  const moveCardToParent = useCardsStore(s => s.moveCardToParent)
  const { setCenter } = useReactFlow()

  const layout = useMemo(() => computeLayout(cards), [cards])

  // Track card ids seen so far so a newly created card (child or sibling)
  // can be detected: the viewport pans to it AND its title editor opens.
  const previousIds = useRef(new Set(cards.map(c => c.id)))
  const [autoEditId, setAutoEditId] = useState<string | null>(null)
  const [spawningId, setSpawningId] = useState<string | null>(null)
  // Which card is currently being dragged, and which OTHER card (if any) it is
  // hovering as a valid reparent target — see `resolveReparentTarget`. Both are
  // only ever set between onNodeDragStart and onNodeDragStop.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [reparentTargetId, setReparentTargetId] = useState<string | null>(null)

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
    setAutoEditId(createdId ?? null)
    setSpawningId(createdId ?? null)
    previousIds.current = currentIds
  }, [cards, layout, setCenter])

  // React Flow owns the node array so a drag moves the card live under the
  // cursor (`onNodesChange` applies position changes during the gesture).
  // `cards` + `layout` stay the source of truth: this effect resyncs the
  // canonical positions whenever the store changes — including right after
  // `moveCardToIndex` fires on drag stop, which is what snaps the card back
  // onto its grid row.
  // Seeded with the real nodes rather than `[]` so the very first paint (and
  // the `fitView` that runs with it) already sees the whole tree.
  const initialNodes = useRef<Node[]>(undefined)
  if (!initialNodes.current) initialNodes.current = buildNodes(cards, layout, locked, null, null)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes.current)

  useEffect(() => {
    setNodes(buildNodes(cards, layout, locked, autoEditId, spawningId))
    // `spawningId` intentionally excluded below: it is only read here to seed
    // the spawn override at CREATION time (when `cards` changes anyway). The
    // effect right after this one clears it via a targeted position patch
    // instead of re-running `buildNodes` — that would hand every node a
    // brand new `data` object, re-rendering every CardNode including the one
    // whose title field a user may have just selected, which collapses that
    // selection (Chrome resets it when a controlled input's value is
    // re-committed, even to the same string).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, layout, locked, autoEditId, setNodes])

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
      .filter((card): card is typeof card & { parentId: string } => card.parentId !== null)
      .map(
        (card): Edge => ({
          id: `e-${card.parentId}-${card.id}`,
          source: card.parentId,
          target: card.id,
          // The real edge from the current parent fades out while a valid
          // reparent target is active, so it doesn't compete with the dashed
          // ghost edge previewing the future link (added below).
          style: {
            stroke: toCss(levelColors[card.level].border),
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
          style: { stroke: toCss(levelColors[draggedCard.level].border), opacity: 1 },
        })
      }
    }
    return realEdges
  }, [cards, reparentTargetId, draggingId])

  const handleNodeDragStart: OnNodeDrag = useCallback((_event, draggedNode) => {
    setDraggingId(draggedNode.id)
  }, [])

  // Two mutually exclusive previews, decided fresh every frame by whether the
  // dragged card currently overlaps a valid reparent target (see
  // `resolveReparentTarget`):
  //
  // - A target IS hovered: every other card snaps back to its real layout
  //   slot (undoing any leftover reorder preview from a moment ago) and the
  //   target lights up (`isReparentTarget`) — the highlight plus the dashed
  //   ghost edge (`edges` above) IS the preview, nothing reflows.
  // - No target: the classic reorder preview — the OTHER cards in the same
  //   sibling group (and, through the full re-layout, any of their
  //   descendants) glide into the slots they'd occupy if the card were
  //   dropped right now, the gap that opens up at the target row is the
  //   preview itself.
  //
  // Either way the dragged node's own position stays whatever `onNodesChange`
  // already gave it (live under the cursor); only its neighbours are
  // re-slotted here. Nothing is committed to the store until drop.
  const handleNodeDrag: OnNodeDrag = useCallback(
    (_event, draggedNode) => {
      const boxes: NodeBox[] = nodes.map(node => ({
        id: node.id,
        x: node.id === draggedNode.id ? draggedNode.position.x : node.position.x,
        y: node.id === draggedNode.id ? draggedNode.position.y : node.position.y,
        width: node.measured?.width ?? NOMINAL_NODE_WIDTH,
        height: node.measured?.height ?? NOMINAL_NODE_HEIGHT,
      }))
      const target = resolveReparentTarget(cards, boxes, draggedNode.id)
      setReparentTargetId(prev => (prev === target ? prev : (target ?? null)))

      if (target) {
        setNodes(current =>
          current.map(node => {
            if (node.id === draggedNode.id) return node
            const isTarget = node.id === target
            const highlightChanged = Boolean(node.data.isReparentTarget) !== isTarget
            const positionChanged = node.position !== layout[node.id]
            if (!highlightChanged && !positionChanged) return node
            return {
              ...node,
              position: layout[node.id] ?? node.position,
              data: highlightChanged ? { ...node.data, isReparentTarget: isTarget } : node.data,
            }
          })
        )
      } else {
        const previewIndex = resolveDragIndex(cards, layout, draggedNode.id, draggedNode.position.y)
        const previewLayout = computeLayout(moveCardToIndexOp(cards, draggedNode.id, previewIndex))
        setNodes(current =>
          current.map(node => {
            if (node.id === draggedNode.id) return node
            const highlightChanged = Boolean(node.data.isReparentTarget)
            return {
              ...node,
              position: previewLayout[node.id] ?? node.position,
              data: highlightChanged ? { ...node.data, isReparentTarget: false } : node.data,
            }
          })
        )
      }
    },
    [cards, layout, nodes, setNodes]
  )

  const handleNodeDragStop: OnNodeDrag = useCallback(
    (_event, draggedNode) => {
      if (reparentTargetId) {
        moveCardToParent(draggedNode.id, reparentTargetId)
      } else {
        const newIndex = resolveDragIndex(cards, layout, draggedNode.id, draggedNode.position.y)
        moveCardToIndex(draggedNode.id, newIndex)
      }
      setDraggingId(null)
      setReparentTargetId(null)
    },
    [cards, layout, moveCardToIndex, moveCardToParent, reparentTargetId]
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      onNodeDragStart={handleNodeDragStart}
      onNodeDrag={handleNodeDrag}
      onNodeDragStop={handleNodeDragStop}
      fitView
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
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
