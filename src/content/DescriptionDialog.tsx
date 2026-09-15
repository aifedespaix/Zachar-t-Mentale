import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Pencil, Trash2, X } from 'lucide-react'
import type { CardBlock } from '../types/cardBlock'
import { blocksDiffer } from './blocks'
import { BlockEditor, type BlockEditorProps } from './BlockEditor'
import { Button } from '../components/ui/button'
import {
  ensureDescriptionHistory,
  recordDescriptionState,
  redoDescription,
  undoDescription,
} from './descriptionHistory'

/**
 * A definition that has never been written yet still needs somewhere to type,
 * so an empty card opens on one empty text block rather than on nothing.
 * `normalizeContent` drops it again on save if it stayed empty, so leaving a
 * card that had no description leaves it with none.
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

/** One neighbouring card the edge arrows can jump to. */
export interface DescriptionNavTarget {
  id: string
  title: string
  /** Set only on the "children" target, when there is more than one — the arrow then names a count instead of picking one title for the user. */
  count?: number
}

export interface DescriptionDialogProps {
  /** The card whose description this is — the key the autosave debounce and the local undo history are both scoped by. */
  cardId: string
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
  /** The parent card — the "↑" arrow. Absent for a root or detached card. */
  parentTarget?: DescriptionNavTarget
  /** The first child — the "↓" arrow. `count` is set when there is more than one. */
  childTarget?: DescriptionNavTarget
  /** The previous card at the same level — the "←" arrow. Absent for the first one. */
  prevSibling?: DescriptionNavTarget
  /** The next card at the same level — the "→" arrow. Absent for the last one. */
  nextSibling?: DescriptionNavTarget
  /** Jumps the dialog to another card without a discard prompt — autosave already committed whatever was being typed. */
  onNavigate?: (cardId: string) => void
}

const AUTOSAVE_DELAY_MS = 600

/**
 * The one place a card's description is written.
 *
 * It replaces the popover this app used to edit a definition in — a plain
 * `<textarea>` for CREATING one, which could hold nothing but text and
 * resized the card while open, and a cramped block editor for EDITING one.
 *
 * Saving is automatic, on a short pause in typing, and flushed immediately on
 * every way out (closing, deleting, jumping to another card) — there is
 * nothing to lose by leaving, so there is nothing here to confirm. Undo is
 * still available, but it is the description's OWN history (see
 * `descriptionHistory`), separate from the app's document-wide one: `Ctrl+Z`
 * here walks back through the last few edits to THIS description, not
 * through whatever else was touched elsewhere in the map meanwhile.
 *
 * Mounted fresh every time it opens on a different card (`key={cardId}` at
 * the call site) — including when the edge arrows below "navigate" to a
 * neighbour, which is really closing this instance and opening another. The
 * local history survives that because it lives at module scope, not in this
 * component's state.
 */
export function DescriptionDialog({
  cardId,
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
  parentTarget,
  childTarget,
  prevSibling,
  nextSibling,
  onNavigate,
}: DescriptionDialogProps) {
  // Seeded once, at mount. `blocks` is deliberately not watched afterwards:
  // this is a draft, and re-reading the card mid-edit would fight the typing.
  const initial = useRef(seedFrom(blocks))
  const [draft, setDraft] = useState<CardBlock[]>(initial.current)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Its own short-lived draft, same idea as the card's own title field but
  // simpler: this dialog is mounted fresh on every open (see the note above),
  // so there is no external re-render to re-seed against mid-edit.
  const [titleDraft, setTitleDraft] = useState(cardTitle)

  const draftRef = useRef(draft)
  draftRef.current = draft
  const lastSavedRef = useRef(initial.current)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    ensureDescriptionHistory(cardId, initial.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Commits the draft now, cancelling any pending debounce — every exit path calls this first. */
  function flush() {
    clearTimeout(debounceRef.current)
    recordDescriptionState(cardId, draftRef.current)
    if (blocksDiffer(draftRef.current, lastSavedRef.current)) {
      lastSavedRef.current = draftRef.current
      onSave(draftRef.current)
    }
  }

  useEffect(() => {
    if (!blocksDiffer(draft, lastSavedRef.current)) return
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      recordDescriptionState(cardId, draftRef.current)
      lastSavedRef.current = draftRef.current
      onSave(draftRef.current)
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(debounceRef.current)
  }, [draft, cardId, onSave])

  function commitTitle() {
    const next = titleDraft.trim()
    if (next !== '' && next !== cardTitle) onRenameTitle?.(next)
    else setTitleDraft(cardTitle)
  }

  function close() {
    flush()
    onClose()
  }

  function navigate(targetId: string) {
    flush()
    onNavigate?.(targetId)
  }

  function deleteDescription() {
    clearTimeout(debounceRef.current)
    onSave([])
    onClose()
  }

  function undo() {
    // Checkpoints whatever is still mid-typing — pending, not yet debounced
    // into the history — as its own step first. Without this, the first
    // Ctrl+Z during an unfinished burst of typing would have nothing recorded
    // to undo FROM and silently do nothing.
    recordDescriptionState(cardId, draftRef.current)
    const previous = undoDescription(cardId)
    if (previous === null) return
    setDraft(previous)
  }
  function redo() {
    const next = redoDescription(cardId)
    if (next === null) return
    setDraft(next)
  }

  // No dependency array on purpose: the handler must close over the CURRENT
  // draft (through the refs above) and re-registering one listener per render
  // is cheaper than the ref dance that avoiding it would need.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={next => {
        if (next) return
        if (confirmingDelete) {
          setConfirmingDelete(false)
          return
        }
        close()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0, 0, 0, 0.35)' }}
        />
        <DialogPrimitive.Content
          aria-label={`Description de « ${cardTitle} »`}
          // The dialog opens ON the field being written in. Radix's default is
          // to focus the first tabbable element, which here is a panel
          // button — so the user's first keystroke went to a button instead
          // of into the description. Cancelling it lets the editor's own
          // auto-focus (see `autoFocusField` below) keep the caret, without
          // Radix taking it straight back afterwards.
          onOpenAutoFocus={event => event.preventDefault()}
          // Inline styles rather than utility classes: the shared
          // `DialogContent` caps itself at `sm:max-w-sm` and lays out as a
          // grid, and this dialog is deliberately the widest surface in the
          // app.
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            width: 'min(1600px, 96vw)',
            height: 'min(94vh, 1180px)',
            background: 'var(--popover)',
            color: 'var(--popover-foreground)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.28)',
            outline: 'none',
          }}
        >
          <NavArrow side="top" target={parentTarget} onNavigate={onNavigate && navigate} />
          <NavArrow side="bottom" target={childTarget} onNavigate={onNavigate && navigate} />
          <NavArrow side="left" target={prevSibling} onNavigate={onNavigate && navigate} />
          <NavArrow side="right" target={nextSibling} onNavigate={onNavigate && navigate} />

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

          <div style={{ flex: 1, minHeight: 0, padding: '14px 20px' }}>
            <BlockEditor
              blocks={draft}
              onChange={setDraft}
              resolveAsset={resolveAsset}
              onInsertImage={onInsertImage}
              onPickImage={onPickImage}
              onError={onError}
              autoFocusField
            />
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
            <span
              aria-hidden
              style={{
                marginRight: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                opacity: 0.55,
              }}
            >
              <span
                style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: 0.7 }}
              />
              Enregistré automatiquement
            </span>
            <Button onClick={close}>Fermer</Button>
          </footer>

          {confirmingDelete && (
            <ConfirmOverlay
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

const NAV_GLYPH = { top: '↑', bottom: '↓', left: '←', right: '→' } as const

const NAV_POSITION: Record<keyof typeof NAV_GLYPH, CSSProperties> = {
  top: { top: -17, left: '50%', transform: 'translateX(-50%)' },
  bottom: { bottom: -17, left: '50%', transform: 'translateX(-50%)' },
  left: { left: -17, top: '50%', transform: 'translateY(-50%)' },
  right: { right: -17, top: '50%', transform: 'translateY(-50%)' },
}

/**
 * One edge of the dialog: the parent above, the first child below, the
 * previous/next card at the same level on either side. Shown only when that
 * neighbour exists — a card with no siblings simply has no left/right arrow,
 * rather than one greyed out for a relation that does not apply to it.
 */
function NavArrow({
  side,
  target,
  onNavigate,
}: {
  side: keyof typeof NAV_GLYPH
  target?: DescriptionNavTarget
  onNavigate?: (id: string) => void
}) {
  if (target === undefined || onNavigate === undefined) return null
  const label = target.count !== undefined && target.count > 1 ? `${target.count} sous-parties` : target.title

  return (
    <button
      type="button"
      aria-label={`Aller à « ${label} »`}
      title={label}
      onClick={() => onNavigate(target.id)}
      style={{
        position: 'absolute',
        zIndex: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: side === 'left' || side === 'right' ? 120 : 260,
        padding: '6px 12px',
        borderRadius: 999,
        border: '1px solid var(--border)',
        background: 'var(--popover)',
        boxShadow: '0 4px 14px rgba(0, 0, 0, 0.2)',
        color: 'inherit',
        fontSize: 12,
        cursor: 'pointer',
        ...NAV_POSITION[side],
      }}
    >
      <span aria-hidden>{NAV_GLYPH[side]}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  )
}

/**
 * The "are you sure?" overlay for the delete-description prompt.
 *
 * The action row WRAPS. That is the shape the bug demanded: French labels,
 * each carrying an icon and each refusing to shrink (the shared `Button` is
 * `whitespace-nowrap`), need more width than a narrow card offered — and a
 * non-wrapping flex row answered that by painting the last button straight
 * past the card's edge. Wrapping keeps every choice inside the panel, and the
 * panel is capped against the overlay it lives in so it cannot outgrow the
 * dialog hosting it either.
 */
function ConfirmOverlay({
  icon,
  title,
  message,
  actions,
}: {
  icon: ReactNode
  title: string
  message: string
  actions: ReactNode
}) {
  const accent = 'var(--destructive)'

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
