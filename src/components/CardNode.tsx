import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Plus, ArrowRight, X, GripVertical, AlignLeft, FlipHorizontal2, type LucideIcon } from 'lucide-react'
import type { Card } from '../types/card'
import { useCardsStore } from '../state/useCardsStore'
import { levelColors } from '../colors/levelColors'
import { toCss } from '../colors/contrast'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

type CardNodeProps = NodeProps & { data: { card: Card; autoEdit?: boolean } }

/**
 * Shared "structurally unavailable" grey. Only the delete `x` still uses
 * this: it stays in place and goes grey on the root (an existing card that
 * cannot be removed), while the add-actions (+, ->) are removed outright
 * when there is nowhere for the new card to go — see `canAddSibling` /
 * `canAddChild` below.
 */
const DISABLED_GREY = '#c0c0c0'
const EDGE_BUTTON_SIZE = '1.6rem'

// Centering offsets go through motion's own `x`/`y` style values, never a
// raw CSS `transform` string: `whileHover`'s `scale` is composed by Framer
// Motion into that same `transform` property, and a literal string there
// gets clobbered the instant the hover animation starts — the button loses
// its `translate(-50%)` centering and visibly jumps.
interface EdgeButtonProps {
  label: string
  icon: LucideIcon
  color: string
  disabled: boolean
  onActivate: () => void
  position: CSSProperties & { x?: string | number; y?: string | number }
}

/**
 * A structural button pinned to one edge/corner of the card, floating half
 * outside its border. All four (drag handle aside) share this one visual
 * family — same round badge, same hover/press feel — so they read as "the
 * actions that grow the tree" no matter which corner they sit in.
 */
function EdgeButton({ label, icon: Icon, color, disabled, onActivate, position }: EdgeButtonProps) {
  return (
    <motion.button
      aria-label={label}
      aria-disabled={disabled}
      onClick={() => {
        // Defence in depth: `pointerEvents: none` already blocks real clicks,
        // but the store action must never run for an inapplicable button.
        if (disabled) return
        onActivate()
      }}
      whileHover={disabled ? undefined : { scale: 1.15 }}
      whileTap={disabled ? undefined : { scale: 0.85 }}
      transition={{ type: 'spring', stiffness: 500, damping: 25 }}
      style={{
        position: 'absolute',
        ...position,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: EDGE_BUTTON_SIZE,
        height: EDGE_BUTTON_SIZE,
        borderRadius: '9999px',
        color: disabled ? DISABLED_GREY : color,
        pointerEvents: disabled ? 'none' : 'auto',
        cursor: disabled ? 'default' : 'pointer',
        background: 'var(--background)',
        border: `1.5px solid ${disabled ? DISABLED_GREY : color}`,
        boxShadow: disabled ? 'none' : '0 1px 3px rgba(0, 0, 0, 0.15)',
        padding: 0,
      }}
    >
      <Icon size={14} strokeWidth={2.5} />
    </motion.button>
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
  const hasChildren = useCardsStore(s => s.hasChildren)
  const locked = useCardsStore(s => s.locked)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [titleFocused, setTitleFocused] = useState(false)
  const [draftTitle, setDraftTitle] = useState(card.title)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [definitionShown, setDefinitionShown] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [editingDefinition, setEditingDefinition] = useState(false)
  const [draftDefinition, setDraftDefinition] = useState(card.definition ?? '')
  const colors = levelColors[card.level]
  const childColors = card.level < 4 ? levelColors[(card.level + 1) as 1 | 2 | 3 | 4] : null

  const isRoot = card.parentId === null
  // Add-actions that cannot apply here are removed outright, not greyed: a
  // root has no siblings to add above/below, and a card that already has a
  // child (or sits at level 4, where there is no level 5) has nowhere for a
  // new "->" child to go. Only the delete `x` keeps the "always present,
  // greyed when inapplicable" treatment — it is a destructive action on an
  // existing structure, not a slot for a card that cannot exist.
  const canAddSibling = !isRoot
  const canAddChild = childColors !== null && !hasChildren(card.id)
  const deleteDisabled = isRoot // the root cannot be deleted

  // A freshly created card opens its title editor straight away, so the
  // "prise de notes en direct" flow is type -> Entrée -> next card. The field
  // itself is always mounted (see render below), so "opening the editor"
  // here means moving real DOM focus onto it — onFocus below does the rest
  // (seeding the draft, selecting the text).
  const autoEditConsumed = useRef(false)
  useEffect(() => {
    if (!autoEdit || autoEditConsumed.current) return
    autoEditConsumed.current = true
    titleInputRef.current?.focus()
  }, [autoEdit])

  function startEditingDefinition() {
    setDraftDefinition(card.definition ?? '')
    setEditingDefinition(true)
  }

  function handleTitleFocus() {
    // Re-seed the draft from the card as it is NOW: a stale draft (from a
    // previous focus session) committed on blur would silently re-write the
    // card with an old value. The actual `select()` happens in the effect
    // below, not here.
    setDraftTitle(card.title)
    setTitleFocused(true)
  }

  // Chrome collapses an input's selection when React re-commits its `value`
  // right after — which happens here, since `handleTitleFocus` just queued a
  // state update. Selecting in an effect (after that commit has landed)
  // avoids the race; keying it on `titleFocused` alone (not `draftTitle`)
  // means it fires once per focus session, not on every keystroke, so the
  // first click highlights the whole title for overwrite, while a second
  // click (already focused) gets the browser's native caret placement
  // instead of being re-selected.
  useEffect(() => {
    if (titleFocused) titleInputRef.current?.select()
  }, [titleFocused])

  // Escape triggers a real DOM blur() synchronously, which fires `onBlur`
  // (commitTitle) before React has flushed the `setDraftTitle` queued just
  // above it — so commitTitle would still see the pre-Escape draft, not the
  // reverted one. A ref sidesteps that batching gap instead of racing it.
  const cancellingTitleRef = useRef(false)

  function commitTitle() {
    if (cancellingTitleRef.current) {
      cancellingTitleRef.current = false
    } else {
      const next = draftTitle.trim() || card.title
      // Skip no-op commits so blurring an untouched field does not push an
      // empty entry onto the undo stack.
      if (next !== card.title) updateTitle(card.id, next)
    }
    setTitleFocused(false)
  }

  function cancelTitle() {
    cancellingTitleRef.current = true
    setDraftTitle(card.title)
    titleInputRef.current?.blur()
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
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        // React Flow's own stylesheet puts a grab cursor on the whole
        // `.draggable` node (it only RESTRICTS the drag gesture to
        // `.card-drag-handle`, it does not restyle the rest of the node) —
        // an explicit cursor here overrides that for every part of the card
        // that is not itself interactive (buttons/handle/input set their own).
        cursor: 'default',
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
          display: 'flex',
          cursor: locked ? 'default' : 'grab',
          color: locked ? DISABLED_GREY : toCss(colors.border),
          pointerEvents: locked ? 'none' : 'auto',
        }}
      >
        <GripVertical size={14} />
      </span>

      {canAddSibling && (
        <EdgeButton
          label="Ajouter au-dessus"
          icon={Plus}
          color={toCss(colors.border)}
          disabled={false}
          onActivate={() => addSibling(card.id, 'above')}
          position={{ top: '-0.85rem', left: '50%', x: '-50%' }}
        />
      )}

      {canAddSibling && (
        <EdgeButton
          label="Ajouter en dessous"
          icon={Plus}
          color={toCss(colors.border)}
          disabled={false}
          onActivate={() => addSibling(card.id, 'below')}
          position={{ bottom: '-0.85rem', left: '50%', x: '-50%' }}
        />
      )}

      {canAddChild && (
        <EdgeButton
          label="Ajouter un enfant"
          icon={ArrowRight}
          color={toCss((childColors ?? colors).border)}
          disabled={false}
          onActivate={() => addChild(card.id)}
          position={{ right: '-0.85rem', top: '50%', y: '-50%' }}
        />
      )}

      <EdgeButton
        label="Supprimer"
        icon={X}
        color={toCss(colors.border)}
        disabled={deleteDisabled}
        onActivate={handleDeleteClick}
        position={{ top: '-0.6rem', right: '-0.6rem' }}
      />

      {/*
        Always an <input>, never swapped for a <span>: the two elements
        default to different intrinsic sizes (padding, line-height), so
        toggling between them made the card visibly resize the instant
        editing started. Unfocused, it is styled to be indistinguishable
        from plain text (transparent border/background); focus alone reveals
        the editable affordance, at a border-width that matches both states
        so revealing it never shifts the layout either.
      */}
      <input
        ref={titleInputRef}
        aria-label="Titre"
        value={titleFocused ? draftTitle : card.title}
        onFocus={handleTitleFocus}
        onChange={e => setDraftTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            titleInputRef.current?.blur()
          }
          if (e.key === 'Escape') cancelTitle()
        }}
        style={{
          display: 'block',
          width: '100%',
          font: 'inherit',
          color: 'inherit',
          background: titleFocused ? 'rgba(0, 0, 0, 0.04)' : 'transparent',
          border: `2px solid ${titleFocused ? toCss(colors.border) : 'transparent'}`,
          borderRadius: 4,
          padding: '0.1rem 0.3rem',
          margin: '-0.1rem -0.3rem',
          outline: 'none',
          cursor: 'text',
          transition: 'background 0.15s ease, border-color 0.15s ease',
        }}
      />

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
        {/* `margin-top: auto` in the card's flex column keeps this pinned to
            the bottom of the card regardless of title length or whether the
            definition text below it is shown. */}
        <div className="card-footer" style={{ display: 'flex', gap: '0.25rem', marginTop: 'auto' }}>
          {card.definition ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={definitionShown ? 'Masquer la définition' : 'Afficher la définition'}
                  onClick={() => setDefinitionShown(v => !v)}
                >
                  <AlignLeft />
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
                  <span style={{ position: 'relative', display: 'inline-flex' }}>
                    <AlignLeft />
                    <Plus
                      size={9}
                      strokeWidth={3}
                      style={{
                        position: 'absolute',
                        right: -4,
                        bottom: -4,
                        background: 'var(--background)',
                        borderRadius: '9999px',
                      }}
                    />
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Ajouter une définition</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Retourner" onClick={() => setFlipped(v => !v)}>
                <FlipHorizontal2 />
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
