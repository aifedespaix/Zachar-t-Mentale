// src/components/DefinitionPopover.tsx
import { useState } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { AlignLeft, Pencil } from 'lucide-react'
import type { CardBlock } from '../types/cardBlock'
import { BlockView } from '../content/BlockView'
import { Button } from './ui/button'

interface DefinitionPopoverProps {
  blocks: CardBlock[]
  locked: boolean
  /** Opens the description editor. Absent capability is expressed by `locked`. */
  onEdit: () => void
  resolveAsset?: (asset: string) => string
}

/**
 * Reading surface for a card's definition — and only reading.
 *
 * It used to host the block editor too, in 340 px with an internal scroll. That
 * box is right for a glance and wrong for work: no room for a three-column
 * table beside a formula, no way to reorder blocks, and a commit-on-click-away
 * rule that silently wrote whatever the editor happened to hold. Editing now
 * happens in `DescriptionDialog`, which this popover opens.
 *
 * The fixed width stays, for the reason it was chosen (règles anti-décalage 1
 * et 2): nothing about a card's footprint, or about where this box lands under
 * the pointer, may depend on what the definition holds.
 */
export function DefinitionPopover({ blocks, locked, onEdit, resolveAsset = () => '' }: DefinitionPopoverProps) {
  const [open, setOpen] = useState(false)

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={open ? 'Masquer la définition' : 'Afficher la définition'}>
          <AlignLeft />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          sideOffset={8}
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
            {!locked && (
              <button
                type="button"
                aria-label="Modifier la définition"
                onClick={() => {
                  // Closed first: the editor is a modal, and leaving a popover
                  // open behind it would keep a second dismissable layer alive
                  // that Escape would reach before the dialog's own guard.
                  setOpen(false)
                  onEdit()
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  font: 'inherit',
                  textTransform: 'inherit',
                  letterSpacing: 'inherit',
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  padding: 0,
                }}
              >
                <Pencil size={11} />
                Modifier
              </button>
            )}
          </div>
          <div data-testid="definition-body">
            <BlockView blocks={blocks} resolveAsset={resolveAsset} />
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
