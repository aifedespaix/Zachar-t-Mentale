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
import { computeLayout } from '../layout/columns'
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
  cards: ReturnType<typeof useCardsStore.getState>['history']['present'],
  layout: Record<string, { x: number; y: number }>,
  locked: boolean,
  autoEditId: string | null
): Node[] {
  return cards.map(card => ({
    id: card.id,
    type: 'card',
    position: layout[card.id],
    data: { card, autoEdit: card.id === autoEditId },
    draggable: !locked,
    dragHandle: '.card-drag-handle',
    initialWidth: NOMINAL_NODE_WIDTH,
    initialHeight: NOMINAL_NODE_HEIGHT,
  }))
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
  if (!initialNodes.current) initialNodes.current = buildNodes(cards, layout, locked, null)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes.current)

  useEffect(() => {
    setNodes(buildNodes(cards, layout, locked, autoEditId))
  }, [cards, layout, locked, autoEditId, setNodes])

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

  const handleNodeDragStop: OnNodeDrag = useCallback(
    (_event, draggedNode) => {
      const draggedCard = cards.find(c => c.id === draggedNode.id)
      if (!draggedCard) return
      const siblingYs = cards
        .filter(c => c.parentId === draggedCard.parentId)
        .map(c => ({ id: c.id, y: c.id === draggedCard.id ? draggedNode.position.y : layout[c.id].y }))
        .sort((a, b) => a.y - b.y)
      const newIndex = siblingYs.findIndex(c => c.id === draggedCard.id)
      moveCardToIndex(draggedCard.id, newIndex)
    },
    [cards, layout, moveCardToIndex]
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
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
