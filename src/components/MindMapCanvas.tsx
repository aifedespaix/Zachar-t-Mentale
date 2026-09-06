import { useCallback, useMemo } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls, Position, type Node, type Edge, type OnNodeDrag } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCardsStore } from '../state/useCardsStore'
import { computeLayout } from '../layout/columns'
import { CardNode } from './CardNode'
import { levelColors } from '../colors/levelColors'
import { toCss } from '../colors/contrast'

const nodeTypes = { card: CardNode }

// CardNode (Task 14) renders no <Handle> sub-components yet, so React Flow has
// no way to measure real connection points for it — `getEdgePosition` bails
// out (returns null) whenever a node lacks `internals.handleBounds`, which
// means edges silently fail to render for a Handle-less custom node type
// regardless of test environment. Declaring static `handles` (a supported
// public field on Node, see @xyflow/system's `NodeHandle`) gives React Flow
// fixed, known connection points without needing an actual rendered <Handle>
// element — appropriate here since edges are always derived from parent/child
// data, never drawn by the user. Explicit width/height are required too:
// once `handles` is set, edge/position math needs `measured.width` or
// `width`, and jsdom's ResizeObserver/getBoundingClientRect never report a
// non-zero size, so real measurement would never happen anyway.
const NODE_WIDTH = 220
const NODE_HEIGHT = 56
const nodeHandles = [
  { type: 'target' as const, position: Position.Left, x: 0, y: NODE_HEIGHT / 2 },
  { type: 'source' as const, position: Position.Right, x: NODE_WIDTH, y: NODE_HEIGHT / 2 },
]

function MindMapCanvasInner() {
  const cards = useCardsStore(s => s.history.present)
  const locked = useCardsStore(s => s.locked)
  const moveCardToIndex = useCardsStore(s => s.moveCardToIndex)

  const layout = useMemo(() => computeLayout(cards), [cards])

  const nodes: Node[] = useMemo(
    () =>
      cards.map(card => ({
        id: card.id,
        type: 'card',
        position: layout[card.id],
        data: { card },
        draggable: !locked,
        dragHandle: '.card-drag-handle',
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        handles: nodeHandles,
      })),
    [cards, layout, locked]
  )

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
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeDragStop={handleNodeDragStop} fitView>
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
