// src/components/DefinitionPopover.tsx
import { useState } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { AlignLeft } from 'lucide-react'
import { Button } from './ui/button'

interface DefinitionPopoverProps {
  definition: string
  locked: boolean
  onCommit: (next: string) => void
}

/**
 * Replaces the old inline "toggle a <p> under the title" definition display:
 * that block resized the card to fit the text and never worked reliably.
 * A popover keeps the card's size constant regardless of definition length,
 * and Radix's collision-aware positioning keeps it from running off-canvas.
 */
export function DefinitionPopover({ definition, locked, onCommit }: DefinitionPopoverProps) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(definition)

  function commit() {
    if (draft !== definition) onCommit(draft)
    setEditing(false)
  }

  function cancel() {
    setDraft(definition)
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
          style={{
            maxWidth: 260,
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
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              opacity: 0.6,
              marginBottom: 6,
            }}
          >
            Définition
          </div>
          {editing ? (
            <textarea
              autoFocus
              aria-label="Définition"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  commit()
                }
                if (e.key === 'Escape') cancel()
              }}
              style={{ width: '100%', minHeight: 60 }}
            />
          ) : (
            <p onClick={() => !locked && setEditing(true)} style={{ margin: 0, cursor: locked ? 'default' : 'text' }}>
              {definition}
            </p>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
