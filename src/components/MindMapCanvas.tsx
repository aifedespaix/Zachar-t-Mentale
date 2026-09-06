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

function MindMapCanvasInner() {
  const cards = useCardsStore(s => s.history.present)
  const locked = useCardsStore(s => s.locked)
  const moveCardToIndex = useCardsStore(s => s.moveCardToIndex)
  const { setCenter } = useReactFlow()

  const layout = useMemo(() => computeLayout(cards), [cards])

  // Track card ids seen so far so a newly created card (child or sibling)
  // can be detected: the viewport pans to it AND its title editor opens.
  const previousIds = useRef(new Set(cards.map(c => c.id)))
  const [autoEditId, setAutoEditId] = useState<string | null>(null)
  const [spawningId, setSpawningId] = useState<string | null>(null)

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

  const edges: Edge[] = useMemo(
    () =>
      cards
        .filter((card): card is typeof card & { parentId: string } => card.parentId !== null)
        .map(card => ({
          id: `e-${card.parentId}-${card.id}`,
          source: card.parentId,
          target: card.id,
          style: { stroke: toCss(levelColors[card.level].border) },
        })),
    [cards]
  )

  // While dragging, the OTHER cards in the same sibling group (and, through
  // the full re-layout, any of their descendants) glide into the slots
  // they'd occupy if the card were dropped right now — the gap that opens up
  // at the target row is the "preview" itself, no separate ghost element
  // needed. The dragged node's own position stays whatever `onNodesChange`
  // already gave it (live under the cursor); only its neighbours are
  // re-slotted here. Nothing is committed to the store until drop.
  const handleNodeDrag: OnNodeDrag = useCallback(
    (_event, draggedNode) => {
      const previewIndex = resolveDragIndex(cards, layout, draggedNode.id, draggedNode.position.y)
      const previewLayout = computeLayout(moveCardToIndexOp(cards, draggedNode.id, previewIndex))
      setNodes(current =>
        current.map(node =>
          node.id === draggedNode.id ? node : { ...node, position: previewLayout[node.id] ?? node.position }
        )
      )
    },
    [cards, layout, setNodes]
  )

  const handleNodeDragStop: OnNodeDrag = useCallback(
    (_event, draggedNode) => {
      const newIndex = resolveDragIndex(cards, layout, draggedNode.id, draggedNode.position.y)
      moveCardToIndex(draggedNode.id, newIndex)
    },
    [cards, layout, moveCardToIndex]
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
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
