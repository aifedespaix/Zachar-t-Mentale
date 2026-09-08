// src/components/DefinitionPopover.tsx
import { useState } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { AlignLeft } from 'lucide-react'
import type { CardBlock } from '../types/cardBlock'
import { BlockView } from '../content/BlockView'
import { BlockEditor, type BlockEditorProps } from '../content/BlockEditor'
import { Button } from './ui/button'

interface DefinitionPopoverProps {
  blocks: CardBlock[]
  locked: boolean
  onCommit: (blocks: CardBlock[]) => void
  resolveAsset?: (asset: string) => string
  /** Image capabilities, forwarded verbatim; absent when no file is open. */
  onInsertImage?: BlockEditorProps['onInsertImage']
  onPickImage?: BlockEditorProps['onPickImage']
  onError?: (message: string) => void
}

/**
 * Replaces the old inline "toggle a <p> under the title" definition display:
 * that block resized the card to fit the text and never worked reliably.
 * A popover keeps the card's size constant regardless of definition length,
 * and Radix's collision-aware positioning keeps it from running off-canvas.
 *
 * That original reason now also governs the rich content: a formula, a table
 * and a picture all live in here, at a FIXED width with an internal scroll,
 * so nothing about the card's own footprint depends on what its definition
 * holds (règles anti-décalage 1 et 2).
 */
export function DefinitionPopover({
  blocks,
  locked,
  onCommit,
  resolveAsset = () => '',
  onInsertImage,
  onPickImage,
  onError,
}: DefinitionPopoverProps) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<CardBlock[]>(blocks)

  function startEditing() {
    if (locked) return
    // Re-seed from the card as it is NOW: a stale draft from a previous
    // session, committed later, would silently rewrite the card with an old
    // value — the same hazard the title field guards against.
    setDraft(blocks)
    setEditing(true)
  }

  function commit() {
    onCommit(draft)
    setEditing(false)
  }

  function cancel() {
    setDraft(blocks)
    setEditing(false)
  }

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={next => {
        setOpen(next)
        if (!next) setEditing(false)
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={open ? 'Masquer la définition' : 'Afficher la définition'}>
          <AlignLeft />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          sideOffset={8}
          onKeyDown={event => {
            if (event.key === 'Escape' && editing) {
              event.preventDefault()
              cancel()
            }
          }}
          style={{
            // Fixed, not max-content: a three-line formula and a 400px picture
            // must occupy the same box, or opening two different cards would
            // move the popover around under the pointer.
            width: 340,
            maxHeight: 420,
            overflowY: 'auto',
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '12px 14px',
            fontSize: 13,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              opacity: 0.6,
              marginBottom: 6,
            }}
          >
            <span>Définition</span>
            {editing && (
              <button
                type="button"
                onClick={commit}
                style={{
                  font: 'inherit',
                  textTransform: 'inherit',
                  letterSpacing: 'inherit',
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                Terminer
              </button>
            )}
          </div>
          {editing ? (
            <BlockEditor
              blocks={draft}
              onChange={setDraft}
              resolveAsset={resolveAsset}
              onInsertImage={onInsertImage}
              onPickImage={onPickImage}
              onError={onError}
            />
          ) : (
            <div
              onClick={startEditing}
              data-testid="definition-body"
              style={{ cursor: locked ? 'default' : 'text', minHeight: '1.2rem' }}
            >
              <BlockView blocks={blocks} resolveAsset={resolveAsset} />
            </div>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
