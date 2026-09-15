import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { AlertTriangle, Pencil, Save, Trash2, X } from 'lucide-react'
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

/** The title field's colours — the card's own level palette, resolved to CSS by the caller. */
export interface TitleChipColors {
  bg: string
  border: string
  text: string
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
  /**
   * Renames the card straight from the dialog's own title field. Omitted
   * leaves the title read-only — there is nowhere for a rename to write back
   * to.
   */
  onRenameTitle?: (title: string) => void
  /** Paints the title field like the card itself; omitted falls back to a neutral chip. */
  titleColors?: TitleChipColors
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
  onRenameTitle,
  titleColors,
}: DescriptionDialogProps) {
  // Seeded once, at mount. `blocks` is deliberately not watched afterwards:
  // this is a draft, and re-reading the card mid-edit would fight the typing.
  const initial = useRef(seedFrom(blocks))
  const [draft, setDraft] = useState<CardBlock[]>(initial.current)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Its own short-lived draft, same idea as the card's own title field but
  // simpler: this dialog is mounted fresh on every open (see the note above),
  // so there is no external re-render to re-seed against mid-edit.
  const [titleDraft, setTitleDraft] = useState(cardTitle)

  const dirty = blocksDiffer(draft, initial.current)

  function commitTitle() {
    const next = titleDraft.trim()
    if (next !== '' && next !== cardTitle) onRenameTitle?.(next)
    else setTitleDraft(cardTitle)
  }

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
          // The dialog opens ON the field being written in. Radix's default is
          // to focus the first tabbable element, which here is the mode
          // selector's « Texte » button — so the user's first keystroke went to
          // a button instead of into the description. Cancelling it lets the
          // editor's own auto-focus (see `autoFocusField` below) keep the
          // caret, without Radix taking it straight back afterwards.
          onOpenAutoFocus={event => event.preventDefault()}
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
            width: 'min(1400px, 95vw)',
            height: 'min(92vh, 1100px)',
            background: 'var(--popover)',
            color: 'var(--popover-foreground)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.28)',
            outline: 'none',
          }}
        >
          <header style={{ padding: '16px 20px 14px', borderBottom: '1px solid var(--border)' }}>
            {breadcrumb.length > 0 && (
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 6 }}>{breadcrumb.join(' › ')}</div>
            )}
            <DialogPrimitive.Title asChild>
              <div
                className={`description-dialog-title-chip${onRenameTitle ? ' is-editable' : ''}`}
                style={
                  {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: `2px solid ${titleColors?.border ?? 'var(--border)'}`,
                    background: titleColors?.bg ?? 'var(--muted)',
                    color: titleColors?.text ?? 'var(--foreground)',
                    '--chip-accent': titleColors?.border ?? 'var(--foreground)',
                  } as CSSProperties
                }
              >
                <input
                  aria-label="Titre de la carte"
                  value={titleDraft}
                  readOnly={!onRenameTitle}
                  size={Math.max(titleDraft.length, 1)}
                  onChange={event => setTitleDraft(event.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.blur()
                    }
                    if (event.key === 'Escape') setTitleDraft(cardTitle)
                  }}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    font: 'inherit',
                    fontSize: 16,
                    fontWeight: 600,
                    outline: 'none',
                    cursor: onRenameTitle ? 'text' : 'default',
                  }}
                />
                {onRenameTitle && <Pencil size={13} className="title-chip-pencil" aria-hidden />}
              </div>
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
                autoFocusField
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
              tone="warning"
              icon={<AlertTriangle size={18} />}
              title="Abandonner les modifications ?"
              message="Cette description a été modifiée. Si vous fermez sans enregistrer, vos changements seront perdus."
              actions={
                <>
                  <Button variant="outline" onClick={() => setConfirmingDiscard(false)}>
                    <Pencil />
                    Continuer l’édition
                  </Button>
                  <Button variant="destructive" onClick={onClose}>
                    <X />
                    Fermer sans enregistrer
                  </Button>
                  <Button onClick={save}>
                    <Save />
                    Enregistrer et fermer
                  </Button>
                </>
              }
            />
          )}

          {confirmingDelete && (
            <ConfirmOverlay
              tone="danger"
              icon={<Trash2 size={18} />}
              title="Supprimer cette description ?"
              message="Le contenu de cette fiche sera définitivement supprimé, sans possibilité de revenir en arrière."
              actions={
                <>
                  <Button variant="outline" onClick={() => setConfirmingDelete(false)}>
                    <X />
                    Annuler
                  </Button>
                  <Button variant="destructive" onClick={deleteDescription}>
                    <Trash2 />
                    Supprimer la description
                  </Button>
                </>
              }
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
 *
 * The action row WRAPS. That is the shape the bug demanded: three French
 * labels, each carrying an icon and each refusing to shrink (the shared
 * `Button` is `whitespace-nowrap`), need more width than the old 380px card
 * offered — and a non-wrapping flex row answered that by painting the last
 * button straight past the card's edge. Wrapping keeps every choice inside the
 * panel, and the panel is capped against the overlay it lives in so it cannot
 * outgrow the dialog hosting it either.
 */
function ConfirmOverlay({
  tone,
  icon,
  title,
  message,
  actions,
}: {
  /** Colours the badge glyph: `warning` when the choice risks work, `danger` when it destroys content. */
  tone: 'warning' | 'danger'
  /** Sits in the round badge beside the title; size it at the call site. */
  icon: ReactNode
  title: string
  message: string
  actions: ReactNode
}) {
  const accent = tone === 'danger' ? 'var(--destructive)' : 'var(--warning-fg)'

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'color-mix(in oklch, var(--popover), transparent 12%)',
        borderRadius: 12,
      }}
    >
      <div
        style={{
          width: 'min(460px, 100%)',
          maxHeight: '100%',
          overflowY: 'auto',
          padding: 20,
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: 'var(--popover)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              width: 32,
              height: 32,
              borderRadius: 9,
              color: accent,
              background: `color-mix(in oklch, ${accent}, transparent 88%)`,
            }}
          >
            {icon}
          </span>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{title}</p>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, opacity: 0.7 }}>{message}</p>
          </div>
        </div>

        <div
          role="group"
          aria-label="Choix possibles"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 18,
          }}
        >
          {actions}
        </div>
      </div>
    </div>
  )
}
