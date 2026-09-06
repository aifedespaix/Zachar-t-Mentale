import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { Card } from '../types/card'
import { useCardsStore } from '../state/useCardsStore'
import { levelColors } from '../colors/levelColors'
import { toCss } from '../colors/contrast'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'

type CardNodeProps = NodeProps & { data: { card: Card } }

export function CardNode({ data }: CardNodeProps) {
  const { card } = data
  const updateTitle = useCardsStore(s => s.updateTitle)
  const addChild = useCardsStore(s => s.addChild)
  const addSibling = useCardsStore(s => s.addSibling)
  const deleteCard = useCardsStore(s => s.deleteCard)
  const descendantCount = useCardsStore(s => s.descendantCount)
  const locked = useCardsStore(s => s.locked)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(card.title)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const colors = levelColors[card.level]
  const childColors = card.level < 4 ? levelColors[(card.level + 1) as 1 | 2 | 3 | 4] : null

  function commitTitle() {
    updateTitle(card.id, draftTitle.trim() || card.title)
    setEditing(false)
  }

  function cancelTitle() {
    setDraftTitle(card.title)
    setEditing(false)
  }

  function handleDeleteClick() {
    if (descendantCount(card.id) === 0) {
      deleteCard(card.id)
    } else {
      setConfirmOpen(true)
    }
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
        position: 'relative',
      }}
    >
      <span
        className="card-drag-handle"
        data-testid="drag-handle"
        aria-disabled={locked}
        style={{
          position: 'absolute',
          top: 4,
          left: 4,
          cursor: locked ? 'default' : 'grab',
          color: locked ? '#c0c0c0' : toCss(colors.border),
          pointerEvents: locked ? 'none' : 'auto',
        }}
      >
        ⠿
      </span>

      {card.parentId !== null && (
        <button
          aria-label="Ajouter au-dessus"
          style={{ color: toCss(colors.border) }}
          onClick={() => addSibling(card.id, 'above')}
        >
          +
        </button>
      )}

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

      {card.parentId !== null && (
        <button
          aria-label="Ajouter en dessous"
          style={{ color: toCss(colors.border) }}
          onClick={() => addSibling(card.id, 'below')}
        >
          +
        </button>
      )}

      {childColors && (
        <button
          aria-label="Ajouter un enfant"
          style={{ color: toCss(childColors.border) }}
          onClick={() => addChild(card.id)}
        >
          {'->'}
        </button>
      )}

      {card.parentId !== null && (
        <button aria-label="Supprimer" style={{ color: toCss(colors.border) }} onClick={handleDeleteClick}>
          ×
        </button>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Supprimer cette card et ses {descendantCount(card.id)} enfants ?
            </DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deleteCard(card.id)
                setConfirmOpen(false)
              }}
            >
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
