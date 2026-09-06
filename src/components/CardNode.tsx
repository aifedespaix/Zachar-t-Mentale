import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Card } from '../types/card'
import { useCardsStore } from '../state/useCardsStore'
import { levelColors } from '../colors/levelColors'
import { toCss } from '../colors/contrast'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

type CardNodeProps = NodeProps & { data: { card: Card; autoEdit?: boolean } }

/**
 * Shared "structurally unavailable" grey. Per the spec, nothing on a card is
 * ever removed because it does not apply — the drag handle when locked, the
 * `+` on the root, the `->` on a level 4, the `x` on the root all stay in
 * place and go grey, so a card always shows the same gabarit.
 */
const DISABLED_GREY = '#c0c0c0'

interface EdgeButtonProps {
  label: string
  glyph: string
  color: string
  disabled: boolean
  onActivate: () => void
  position: CSSProperties
}

/** A structural button pinned to one edge/corner of the card. */
function EdgeButton({ label, glyph, color, disabled, onActivate, position }: EdgeButtonProps) {
  return (
    <button
      aria-label={label}
      aria-disabled={disabled}
      onClick={() => {
        // Defence in depth: `pointerEvents: none` already blocks real clicks,
        // but the store action must never run for an inapplicable button.
        if (disabled) return
        onActivate()
      }}
      style={{
        position: 'absolute',
        ...position,
        color: disabled ? DISABLED_GREY : color,
        pointerEvents: disabled ? 'none' : 'auto',
        cursor: disabled ? 'default' : 'pointer',
        background: 'transparent',
        border: 'none',
        padding: '0 3px',
        margin: 0,
        lineHeight: 1,
        fontSize: 14,
        fontWeight: 700,
      }}
    >
      {glyph}
    </button>
  )
}

export function CardNode({ data }: CardNodeProps) {
  const { card, autoEdit = false } = data
  const updateTitle = useCardsStore(s => s.updateTitle)
  const updateDefinition = useCardsStore(s => s.updateDefinition)
  const addChild = useCardsStore(s => s.addChild)
  const addSibling = useCardsStore(s => s.addSibling)
  const deleteCard = useCardsStore(s => s.deleteCard)
  const descendantCount = useCardsStore(s => s.descendantCount)
  const locked = useCardsStore(s => s.locked)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(card.title)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [definitionShown, setDefinitionShown] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [editingDefinition, setEditingDefinition] = useState(false)
  const [draftDefinition, setDraftDefinition] = useState(card.definition ?? '')
  const colors = levelColors[card.level]
  const childColors = card.level < 4 ? levelColors[(card.level + 1) as 1 | 2 | 3 | 4] : null

  const isRoot = card.parentId === null
  const siblingDisabled = isRoot // a single-root map: the root has no siblings
  const childDisabled = childColors === null // no level 5
  const deleteDisabled = isRoot // the root cannot be deleted

  // A freshly created card opens its title editor straight away, so the
  // "prise de notes en direct" flow is type -> Entrée -> next card.
  const autoEditConsumed = useRef(false)
  useEffect(() => {
    if (!autoEdit || autoEditConsumed.current) return
    autoEditConsumed.current = true
    setDraftTitle(card.title)
    setEditing(true)
  }, [autoEdit, card.title])

  function startEditingTitle() {
    // Always re-seed the draft from the card as it is NOW: the initial
    // useState value goes stale as soon as the card changes underneath us
    // (an undo, a reload), and committing a stale draft on blur would
    // silently re-write the card with an old value.
    setDraftTitle(card.title)
    setEditing(true)
  }

  function startEditingDefinition() {
    setDraftDefinition(card.definition ?? '')
    setEditingDefinition(true)
  }

  function commitTitle() {
    const next = draftTitle.trim() || card.title
    // Skip no-op commits so blurring an untouched editor does not push an
    // empty entry onto the undo stack.
    if (next !== card.title) updateTitle(card.id, next)
    setEditing(false)
  }

  function cancelTitle() {
    setDraftTitle(card.title)
    setEditing(false)
  }

  function commitDefinition() {
    if (draftDefinition !== (card.definition ?? '')) updateDefinition(card.id, draftDefinition)
    setEditingDefinition(false)
  }

  function cancelDefinition() {
    setDraftDefinition(card.definition ?? '')
    setEditingDefinition(false)
  }

  function handleDeleteClick() {
    if (descendantCount(card.id) === 0) {
      deleteCard(card.id)
    } else {
      setConfirmOpen(true)
    }
  }

  return (
    <motion.div
      data-testid={`card-${card.id}`}
      data-flipped={flipped}
      className="card-node"
      animate={{ rotateY: flipped ? 180 : 0 }}
      transition={{ duration: 0.4 }}
      style={{
        background: toCss(colors.bg),
        borderColor: toCss(colors.border),
        color: toCss(colors.text),
        border: '2px solid',
        borderRadius: 8,
        // Room for the pinned edge buttons: the drag handle and the delete `x`
        // sit in the top corners, the `->` on the right edge.
        padding: '22px 26px 14px 22px',
        minWidth: 200,
        minHeight: 92,
        boxSizing: 'border-box',
        position: 'relative',
      }}
    >
      {/*
        Real Handles, not the static `handles` node field. React Flow's
        `updateNodeInternals` unconditionally rebuilds `internals.handleBounds`
        by scanning the node's DOM for handle elements; with none it stores
        `{source: null, target: null}`, which is present-but-empty and shadows
        any static `handles`, so edges stop rendering after the first
        measurement. They must stay laid out (`visibility: hidden`, never
        `display: none`, which would measure as a zero-size box).
      */}
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ visibility: 'hidden' }} />

      <span
        className="card-drag-handle"
        data-testid="drag-handle"
        aria-disabled={locked}
        style={{
          position: 'absolute',
          top: 4,
          left: 4,
          cursor: locked ? 'default' : 'grab',
          color: locked ? DISABLED_GREY : toCss(colors.border),
          pointerEvents: locked ? 'none' : 'auto',
        }}
      >
        ⠿
      </span>

      <EdgeButton
        label="Ajouter au-dessus"
        glyph="+"
        color={toCss(colors.border)}
        disabled={siblingDisabled}
        onActivate={() => addSibling(card.id, 'above')}
        position={{ top: -10, left: '50%', transform: 'translateX(-50%)' }}
      />

      <EdgeButton
        label="Ajouter en dessous"
        glyph="+"
        color={toCss(colors.border)}
        disabled={siblingDisabled}
        onActivate={() => addSibling(card.id, 'below')}
        position={{ bottom: -10, left: '50%', transform: 'translateX(-50%)' }}
      />

      <EdgeButton
        label="Ajouter un enfant"
        glyph="->"
        color={toCss((childColors ?? colors).border)}
        disabled={childDisabled}
        onActivate={() => addChild(card.id)}
        position={{ right: -4, top: '50%', transform: 'translateY(-50%)' }}
      />

      <EdgeButton
        label="Supprimer"
        glyph="×"
        color={toCss(colors.border)}
        disabled={deleteDisabled}
        onActivate={handleDeleteClick}
        position={{ top: 2, right: 4 }}
      />

      {editing ? (
        <input
          autoFocus
          aria-label="Titre"
          value={draftTitle}
          onChange={e => setDraftTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={e => {
            if (e.key === 'Enter') commitTitle()
            if (e.key === 'Escape') cancelTitle()
          }}
        />
      ) : (
        <span onClick={startEditingTitle}>{card.title}</span>
      )}

      {/*
        Mounted only while open: `descendantCount` is an O(n) walk of the whole
        card list and used to be called on every render of every card.
      */}
      {confirmOpen && (
        <Dialog open onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Supprimer cette card et ses {descendantCount(card.id)} enfants ?</DialogTitle>
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
      )}

      <TooltipProvider>
        <div className="card-footer" style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          {card.definition ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={definitionShown ? 'Masquer la définition' : 'Afficher la définition'}
                  onClick={() => setDefinitionShown(v => !v)}
                >
                  👁
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {definitionShown ? 'Masquer la définition' : 'Afficher la définition'}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Ajouter une définition"
                  onClick={startEditingDefinition}
                >
                  👁+
                </Button>
              </TooltipTrigger>
              <TooltipContent>Ajouter une définition</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Retourner" onClick={() => setFlipped(v => !v)}>
                ⟲
              </Button>
            </TooltipTrigger>
            <TooltipContent>Retourner</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>

      {editingDefinition && (
        <textarea
          autoFocus
          aria-label="Définition"
          value={draftDefinition}
          onChange={e => setDraftDefinition(e.target.value)}
          onBlur={commitDefinition}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commitDefinition()
            }
            if (e.key === 'Escape') cancelDefinition()
          }}
        />
      )}

      {definitionShown && card.definition && <p>{card.definition}</p>}

      <Handle type="source" position={Position.Right} isConnectable={false} style={{ visibility: 'hidden' }} />
    </motion.div>
  )
}
