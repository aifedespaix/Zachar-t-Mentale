import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { Card } from '../types/card'
import { useCardsStore } from '../state/useCardsStore'
import { levelColors } from '../colors/levelColors'
import { toCss } from '../colors/contrast'

type CardNodeProps = NodeProps & { data: { card: Card } }

export function CardNode({ data }: CardNodeProps) {
  const { card } = data
  const updateTitle = useCardsStore(s => s.updateTitle)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(card.title)
  const colors = levelColors[card.level]

  function commitTitle() {
    updateTitle(card.id, draftTitle.trim() || card.title)
    setEditing(false)
  }

  function cancelTitle() {
    setDraftTitle(card.title)
    setEditing(false)
  }

  return (
    <div
      data-testid={`card-${card.id}`}
      className="card-node"
      style={{
        background: toCss(colors.bg),
        borderColor: toCss(colors.border),
        color: toCss(colors.text),
        border: '2px solid',
        borderRadius: 8,
        padding: 12,
        minWidth: 180,
      }}
    >
      {editing ? (
        <input
          autoFocus
          value={draftTitle}
          onChange={e => setDraftTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={e => {
            if (e.key === 'Enter') commitTitle()
            if (e.key === 'Escape') cancelTitle()
          }}
        />
      ) : (
        <span onClick={() => setEditing(true)}>{card.title}</span>
      )}
    </div>
  )
}
