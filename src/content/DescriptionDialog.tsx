import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Trash2 } from 'lucide-react'
import type { CardBlock } from '../types/cardBlock'
import { BlockEditor, type BlockEditorProps } from './BlockEditor'
import { BlockView } from './BlockView'
import { Button } from '../components/ui/button'

/**
 * Whether two block lists differ, for the "are there unsaved changes?" guard.
 *
 * Structural rather than referential: `BlockEditor` rebuilds its array on
 * every keystroke, so identity would report a change the moment the editor was
 * touched at all — including by typing a character and deleting it again,
 * which must not raise a confirmation on the way out.
 */
export function blocksDiffer(a: CardBlock[], b: CardBlock[]): boolean {
  return JSON.stringify(a) !== JSON.stringify(b)
}

/**
 * A definition that has never been written yet still needs somewhere to type,
 * so an empty card opens on one empty text block rather than on nothing.
 * `normalizeContent` drops it again on save if it stayed empty, so cancelling
 * out of a card that had no description leaves it with none.
 */
function seedFrom(blocks: CardBlock[]): CardBlock[] {
  return blocks.length > 0 ? blocks : [{ kind: 'text', text: '' }]
}

export interface DescriptionDialogProps {
  /** Ancestors, root first — the breadcrumb that says which card this is. */
  breadcrumb: string[]
  cardTitle: string
  blocks: CardBlock[]
  onSave: (blocks: CardBlock[]) => void
  onClose: () => void
  resolveAsset: (asset: string) => string
  onInsertImage?: BlockEditorProps['onInsertImage']
  onPickImage?: BlockEditorProps['onPickImage']
  onError?: (message: string) => void
}

/**
 * The one place a card's description is written.
 *
 * It replaces two surfaces that disagreed with each other: a plain `<textarea>`
 * mounted inside the card for CREATING a definition — which could hold nothing
 * but text, and resized the card while it was open — and the popover's cramped
 * block editor for EDITING one. Getting a formula into an empty card meant
 * typing filler, saving, reopening and converting.
 *
 * Two panes, because the question the user actually has while writing is "what
 * will this look like?". The right-hand pane is `BlockView` — the very same
 * component the export renders, and the one the card's own fiche will use — so
 * the preview is not a rendition of the result, it IS the result.
 *
 * Mounted only while open, like the card's other dialogs: that is what makes
 * the draft start from the card as it is NOW. A dialog kept mounted would hold
 * a draft from a previous visit and write it back over later edits — the same
 * hazard the title field's re-seeding guards against.
 */
export function DescriptionDialog({
  breadcrumb,
  cardTitle,
  blocks,
  onSave,
  onClose,
  resolveAsset,
  onInsertImage,
  onPickImage,
  onError,
}: DescriptionDialogProps) {
  // Seeded once, at mount. `blocks` is deliberately not watched afterwards:
  // this is a draft, and re-reading the card mid-edit would fight the typing.
  const initial = useRef(seedFrom(blocks))
  const [draft, setDraft] = useState<CardBlock[]>(initial.current)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const dirty = blocksDiffer(draft, initial.current)

  function save() {
    onSave(draft)
    onClose()
  }

  function deleteDescription() {
    onSave([])
    onClose()
  }

  /**
   * Leaving without saving.
   *
   * The popover this replaces committed on click-away, which is the right
   * trade for a two-line field and the wrong one for a surface someone may sit
   * in for twenty minutes: an accidental click outside would silently write
   * whatever state the editor happened to be in. So closing DISCARDS, and
   * discarding real work asks first.
   */
  function requestClose() {
    if (dirty) {
      setConfirmingDiscard(true)
      return
    }
    onClose()
  }

  // No dependency array on purpose: the handler must close over the CURRENT
  // draft, and re-registering one listener per render is cheaper than the ref
  // dance that avoiding it would need.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Ctrl/Cmd+Enter saves from anywhere in the dialog, including from
      // inside a textarea where plain Enter has to keep inserting a newline.
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        save()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={next => {
        if (next) return
        // Escape while the discard prompt is up dismisses the PROMPT, not the
        // dialog: the safe reading of Escape here is "no, keep editing", and
        // making it close through the very warning it just raised would be the
        // one keystroke that loses work.
        if (confirmingDiscard) {
          setConfirmingDiscard(false)
          return
        }
        if (confirmingDelete) {
          setConfirmingDelete(false)
          return
        }
        requestClose()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0, 0, 0, 0.35)' }}
        />
        <DialogPrimitive.Content
          aria-label={`Description de « ${cardTitle} »`}
          // Inline styles rather than utility classes: the shared
          // `DialogContent` caps itself at `sm:max-w-sm` and lays out as a
          // grid, and this dialog is deliberately the widest surface in the
          // app. Overriding through the class list would depend on which
          // declaration the stylesheet happened to emit last.
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            width: 'min(1100px, 92vw)',
            height: 'min(85vh, 900px)',
            background: 'var(--popover)',
            color: 'var(--popover-foreground)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.28)',
            outline: 'none',
          }}
        >
          <header style={{ padding: '14px 18px 10px', borderBottom: '1px solid var(--border)' }}>
            {breadcrumb.length > 0 && (
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 2 }}>{breadcrumb.join(' › ')}</div>
            )}
            <DialogPrimitive.Title style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              {cardTitle}
            </DialogPrimitive.Title>
          </header>

          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <section
              aria-label="Édition"
              style={{ flex: '3 1 0', minWidth: 0, overflowY: 'auto', padding: '12px 16px' }}
            >
              <BlockEditor
                blocks={draft}
                onChange={setDraft}
                resolveAsset={resolveAsset}
                onInsertImage={onInsertImage}
                onPickImage={onPickImage}
                onError={onError}
              />
            </section>

            <section
              aria-label="Aperçu"
              style={{
                flex: '2 1 0',
                minWidth: 0,
                overflowY: 'auto',
                padding: '12px 16px',
                borderLeft: '1px solid var(--border)',
                background: 'color-mix(in oklch, var(--border), transparent 88%)',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  opacity: 0.6,
                  marginBottom: 8,
                }}
              >
                Aperçu
              </div>
              <BlockView blocks={draft} resolveAsset={resolveAsset} />
            </section>
          </div>

          <footer
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              borderTop: '1px solid var(--border)',
            }}
          >
            {blocks.length > 0 && (
              <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>
                <Trash2 />
                Supprimer
              </Button>
            )}
            <span style={{ marginRight: 'auto', fontSize: 12, opacity: 0.55 }}>
              Ctrl + Entrée pour enregistrer
            </span>
            <Button variant="outline" onClick={requestClose}>
              Annuler
            </Button>
            <Button onClick={save}>Enregistrer</Button>
          </footer>

          {confirmingDiscard && (
            <ConfirmOverlay
              label="Abandonner les modifications ?"
              message="Cette description a été modifiée. Fermer sans enregistrer perdra les changements."
              onCancel={() => setConfirmingDiscard(false)}
              cancelLabel="Continuer l’édition"
              confirmLabel="Fermer sans enregistrer"
              onConfirm={onClose}
              extra={<Button onClick={save}>Enregistrer</Button>}
            />
          )}

          {confirmingDelete && (
            <ConfirmOverlay
              label="Supprimer cette description ?"
              message="Le contenu de cette fiche sera définitivement supprimé."
              onCancel={() => setConfirmingDelete(false)}
              cancelLabel="Annuler"
              confirmLabel="Supprimer"
              onConfirm={deleteDescription}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/**
 * The "are you sure?" overlay shared by the discard-changes and
 * delete-description prompts — same modal-within-a-modal treatment so a
 * second nested Radix dialog isn't needed for either.
 */
function ConfirmOverlay({
  label,
  message,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  extra,
}: {
  label: string
  message: string
  cancelLabel: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
  extra?: ReactNode
}) {
  return (
    <div
      role="alertdialog"
      aria-label={label}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'color-mix(in oklch, var(--popover), transparent 12%)',
        borderRadius: 12,
      }}
    >
      <div
        style={{
          maxWidth: 380,
          padding: 20,
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: 'var(--popover)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
        }}
      >
        <p style={{ margin: '0 0 14px', fontSize: 14 }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
          {extra}
        </div>
      </div>
    </div>
  )
}
