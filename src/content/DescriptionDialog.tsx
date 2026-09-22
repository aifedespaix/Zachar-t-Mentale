import { useCallback, useEffect, useRef, useState, type CSSProperties, type FocusEvent, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Keyboard, LayoutGrid, Maximize2, Minimize2, Pencil, Plus, Redo2, Trash2, Undo2, X } from 'lucide-react'
import type { CardBlock } from '../types/cardBlock'
import { blocksDiffer } from './blocks'
import { BlockEditor, type BlockEditorProps } from './BlockEditor'
import { BandOptionsOverlay } from './BandOptionsOverlay'
import { loadHiddenFamilies, saveHiddenFamilies } from '../persistence/bandFamilies'
import { loadDescriptionNarrow, saveDescriptionNarrow } from '../persistence/descriptionNarrow'
import { Button } from '../components/ui/button'
import { Hint } from '../components/ui/hint'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip'
import { isTypingTarget } from '../hooks/useGlobalShortcuts'
import {
  ensureDescriptionHistory,
  recordDescriptionState,
  redoDescription,
  undoDescription,
} from './descriptionHistory'
import { useDescriptionHistory } from './useDescriptionHistory'

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

/** One neighbouring card an edge arrow can jump to. */
export interface DescriptionNavTarget {
  id: string
  title: string
  /** Set only on the "children" target, when there is more than one — the arrow then names a count instead of picking one title for the user. */
  count?: number
  /**
   * That card's own palette, so its arrow can be painted like the card it
   * leads to. Optional because a host with no palette to offer still has a
   * navigable neighbour — the arrow then falls back to neutral colours rather
   * than to a wrong one.
   */
  colors?: TitleChipColors
}

/** The four edges around a description: where a neighbour can be reached — and created. */
export type NavSide = 'top' | 'bottom' | 'left' | 'right'

/**
 * A card that does not exist yet, offered on an edge with nothing to jump to.
 *
 * `colors` is the palette that card WILL wear, so the "+" can predict its level
 * before it is born — the same "colour means which level" language the arrows
 * already speak. Omitted falls back to neutral, never to a wrong palette.
 */
export interface DescriptionCreateTarget {
  colors?: TitleChipColors
  /** Called once the create-prompt (see `CreatePromptOverlay`) has a title — never on the bare click/shortcut, which only OPENS that prompt. */
  onSelect: (title: string) => void
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
  /** The parent card — the "←" arrow. Absent for a root or detached card. */
  parentTarget?: DescriptionNavTarget
  /** The first child — the "→" arrow. `count` is set when there is more than one. */
  childTarget?: DescriptionNavTarget
  /** The previous card at the same level — the "↑" arrow. Absent for the first one. */
  prevSibling?: DescriptionNavTarget
  /** The next card at the same level — the "↓" arrow. Absent for the last one. */
  nextSibling?: DescriptionNavTarget
  /** Jumps the dialog to another card without a discard prompt — autosave already committed whatever was being typed. */
  onNavigate?: (cardId: string) => void
  /**
   * Creation, edge by edge. An edge with no neighbour shows a "+" instead of an
   * arrow when a handler is given for it; an edge with neither a neighbour nor a
   * handler shows nothing at all. The caller decides which edges are creatable,
   * because that depends on the card's level and whether it is floating — rules
   * the store already owns.
   */
  onCreate?: Partial<Record<NavSide, DescriptionCreateTarget>>
  /**
   * Opens with the title focused and its text selected, so a card just created
   * from an edge's "+" can be named by typing over its placeholder title.
   */
  autoFocusTitle?: boolean
}

const AUTOSAVE_DELAY_MS = 600

/**
 * The dialog's two widths. The default is the roomy one a description has
 * always opened in; the toggle switches to roughly two thirds of the screen,
 * CAPPED so the 1080px reading column is never squeezed: on a very wide
 * screen the narrow dialog stops growing once the column fits, instead of
 * tracking 65vw past the point where extra width is only empty space.
 */
const DESCRIPTION_WIDTH_LARGE = 'min(1600px, 96vw)'
const DESCRIPTION_WIDTH_NARROW = 'min(1250px, 65vw)'

/**
 * The shared look for the dialog's two top-right buttons — the width toggle
 * and the cross. Same kind of chrome control, so they differ only in glyph
 * and action, never in shape. Positioning belongs to the row that holds them.
 */
const CORNER_BUTTON: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  width: 30,
  height: 30,
  padding: 0,
  borderRadius: 8,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'inherit',
  opacity: 0.65,
  cursor: 'pointer',
}

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
 * The dialog is deliberately HARD to leave by accident: an outside click does
 * nothing (see `onInteractOutside`). A definition is the longest thing anyone
 * writes in this app, and losing it to a stray click on the canvas behind — the
 * canvas the user is very likely to be aiming at, since it is where the card
 * they came from lives — is not a risk worth taking for the convenience of a
 * gesture nobody asked for. Two deliberate gestures close it: the cross in the
 * top-right corner, and the "Fermer" button.
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
  onCreate,
  autoFocusTitle,
}: DescriptionDialogProps) {
  // Seeded once, at mount. `blocks` is deliberately not watched afterwards:
  // this is a draft, and re-reading the card mid-edit would fight the typing.
  const initial = useRef(seedFrom(blocks))
  const [draft, setDraft] = useState<CardBlock[]>(initial.current)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  /**
   * Which edge's "+" is asking for a title — `null` when none is.
   *
   * A card is never created blind any more: Ctrl+flèche and the "+" button
   * both land HERE first, never straight on `onCreate[side].onSelect`. Only
   * the prompt's own Valider calls that, with the title it collected.
   */
  const [createPrompt, setCreatePrompt] = useState<NavSide | null>(null)
  // The width the dialog was last closed in, read SYNCHRONOUSLY at mount so
  // the first paint is already the chosen one. The dialog is remounted on
  // every opening (`key={cardId}`), so this flag — not a component state that
  // outlives it — is what carries the choice from one opening to the next.
  const [narrow, setNarrow] = useState(loadDescriptionNarrow)
  // What the toggle offers: the width the dialog is NOT wearing. One string
  // for both the tooltip and the accessible name, so the two cannot drift.
  const widthToggleLabel = narrow ? 'Élargir la modale' : 'Rétrécir la modale'
  // Density follows the WIDE dialog, not the narrow one: the roomy default is
  // where someone lands to write out something complex — a long formula-heavy
  // definition, several tables — and there the goal is fitting as much of it
  // on screen as possible, so the spacing condenses. The narrow dialog is
  // reached for short, simple text, which was never fighting for vertical
  // room in the first place, so it keeps the comfortable spacing instead.
  const condensed = !narrow
  // Its own short-lived draft, same idea as the card's own title field but
  // simpler: this dialog is mounted fresh on every open (see the note above),
  // so there is no external re-render to re-seed against mid-edit.
  const [titleDraft, setTitleDraft] = useState(cardTitle)
  // Whether the title field is the one currently focused — separate from
  // `autoFocusTitle` (which only ever fires once, on mount): this is what
  // makes a later click on the title, same as a click on the card's own
  // title in `CardNode`, select the whole text for overwrite instead of
  // just dropping a caret.
  const [titleFocused, setTitleFocused] = useState(false)

  // Where the caret is, so the shortcuts panel can say what `Entrée` does THERE
  // rather than reciting one hard-coded line that is already false in two of the
  // editor's surfaces. Kept from the last focus, not read from the DOM when the
  // panel opens: the panel is opened by a footer BUTTON, so at that instant the
  // focus is on the button, and the answer the user wants is where they were
  // working just before.
  const [caretScope, setCaretScope] = useState<EnterScope>('block')
  const titleRef = useRef<HTMLInputElement>(null)

  /**
   * Focuses and selects the title the moment its field attaches.
   *
   * A callback ref rather than an effect, because the dialog renders through a
   * Radix PORTAL: its content — the title input included — mounts a render LATER
   * than this component, so a `[]` effect here ran while `titleRef.current` was
   * still null and focused nothing. A ref callback fires exactly when there is a
   * field to focus. It is memoised on `autoFocusTitle` (constant for the life of
   * the dialog) so it is not re-run, and the title re-selected, on every keystroke
   * render.
   */
  const registerTitleField = useCallback(
    (node: HTMLInputElement | null) => {
      titleRef.current = node
      if (node === null || !autoFocusTitle) return
      node.focus()
      node.select()
    },
    [autoFocusTitle]
  )

  // Chrome collapses an input's selection when React re-commits its `value`
  // right after — which happens here, since focusing the title queues the
  // `titleFocused` state update below. Selecting in an effect (after that
  // commit has landed) avoids the race, same fix as the card's own title
  // field in `CardNode`.
  useEffect(() => {
    if (titleFocused) titleRef.current?.select()
  }, [titleFocused])

  /**
   * Remembers which editable surface a focus landed on.
   *
   * Only the three that change what `Entrée` means matter; anything else — the
   * footer buttons, the panel's own close — leaves the last answer alone, which
   * is exactly what keeps "click Raccourcis" from erasing the context.
   */
  function noteCaretScope(event: FocusEvent<HTMLElement>) {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target === titleRef.current) setCaretScope('title')
    else if (target.closest('[data-cell]') !== null) setCaretScope('cell')
    else if (target.closest('[data-row-index]') !== null) setCaretScope('block')
  }

  // The undo/redo buttons' state, read from the description's own history rather
  // than tracked here. Undo used to be reachable only by `Ctrl+Z` — nothing on
  // screen said it existed, which is the worst place to put the one gesture that
  // makes it safe to try things. Reading it from the store (rather than keeping
  // a copy in step) is what makes the buttons follow a step recorded by the
  // autosave debounce, by the keyboard or by the palette.
  const { canUndo, canRedo } = useDescriptionHistory(cardId)

  /**
   * Le réglage des familles de signes vit ICI, et pas dans l'éditeur, parce que
   * le bouton qui l'ouvre est dans le pied de la modale : le réglage et sa
   * commande doivent être au même endroit. Le pied est aussi un support plus
   * stable que le bandeau, qui se replie sur deux ou trois lignes — une commande
   * posée en fin de bandeau atterrit sur la dernière ligne, souvent hors de vue.
   *
   * Lu SYNCHRONEMENT à l'initialisation, pas dans un effet : un effet ferait
   * peindre le bandeau complet, puis le réduirait — exactement le saut visuel que
   * tout ce bandeau existe pour éviter.
   */
  const [hiddenFamilies, setHiddenFamilies] = useState<string[]>(() => loadHiddenFamilies())
  const [bandOptionsOpen, setBandOptionsOpen] = useState(false)

  /** Retient le réglage ET l'applique : les deux vont ensemble, jamais l'un sans l'autre. */
  function setFamilies(next: string[]) {
    setHiddenFamilies(next)
    saveHiddenFamilies(next)
  }

  /** Flips the dialog between its wide and narrow widths, and remembers the choice. */
  function toggleWidth() {
    const next = !narrow
    setNarrow(next)
    saveDescriptionNarrow(next)
  }

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
    setTitleFocused(false)
  }

  function close() {
    flush()
    onClose()
  }

  function navigate(targetId: string) {
    flush()
    onNavigate?.(targetId)
  }

  /** Opens the title prompt for the edge's own « + » — never `onCreate[side].onSelect` directly; see `createPrompt`. */
  function openCreatePrompt(side: NavSide) {
    setCreatePrompt(side)
  }

  const edgeTarget: Record<NavSide, DescriptionNavTarget | undefined> = {
    top: prevSibling,
    bottom: nextSibling,
    left: parentTarget,
    right: childTarget,
  }

  /**
   * What an edge does when activated — by Ctrl+flèche or by clicking its
   * arrow, the same one step either way: jump straight there when there is
   * already a neighbour, ask for a title first when there is not.
   */
  function activateEdge(side: NavSide) {
    const target = edgeTarget[side]
    if (target !== undefined && onNavigate !== undefined) {
      navigate(target.id)
      return
    }
    if (onCreate?.[side] !== undefined) openCreatePrompt(side)
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
  //
  // `Ctrl/Cmd + <letter>` here, `Alt + <letter>` for the per-block shortcuts in
  // `BlockEditor` : the split is deliberate and is what the shortcuts panel
  // documents it as — this modifier is for what the whole DIALOG owns (width,
  // the shortcuts panel itself, the symbol families overlay, this history),
  // `Alt` is for what one BLOCK owns. Safe from the app's own global shortcuts
  // regardless: `useGlobalShortcuts` disables itself entirely while any dialog
  // is open (see `isModalOpen`), which is also why none of these need to avoid
  // colliding with a `COMMANDS` binding.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (key === 'm') {
        event.preventDefault()
        toggleWidth()
        return
      }
      if (key === '/') {
        event.preventDefault()
        setShortcutsOpen(open => !open)
        return
      }
      if (event.shiftKey && key === 'f') {
        event.preventDefault()
        setBandOptionsOpen(open => !open)
        return
      }
      // Ctrl+flèches, comme les quatre flèches du cadre — mais seulement hors
      // d'un champ où elles ont déjà un sens : dans un texte, Ctrl+←/→ saute
      // d'un mot, et voler cette touche pour changer de carte casserait la
      // frappe en plein milieu d'une phrase.
      if (isTypingTarget(event.target)) return
      const side = ARROW_SIDE[event.key]
      if (side !== undefined) {
        event.preventDefault()
        activateEdge(side)
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
        if (confirmingDelete) {
          setConfirmingDelete(false)
          return
        }
        if (createPrompt !== null) {
          setCreatePrompt(null)
          return
        }
        close()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0, 0, 0, 0.35)' }}
        />
        {/* ONE provider for the whole dialog, mounted here rather than per
            button. The app's tooltip defaults are used unchanged — every other
            surface's provider does the same — so a hint in this dialog appears
            and disappears exactly like a hint anywhere else. Radix renders a
            provider as context alone, so it adds no element to the modal's
            layout. A provider per button would be the mistake this avoids: each
            one carries its own skip-delay state, which is what makes a row of
            instant tooltips flicker as the pointer crosses it. */}
        <TooltipProvider>
        <DialogPrimitive.Content
          // `data-slot` is not decoration: `isModalOpen` (see
          // `hooks/useGlobalShortcuts`) recognises an open modal by
          // `[data-slot="dialog-content"][data-state="open"]`, and the shared
          // `ui/dialog` is the only thing that used to set it. This dialog
          // renders `DialogPrimitive.Content` directly, so without this
          // attribute the global dispatcher — which listens in CAPTURE on
          // `window`, and therefore runs BEFORE this dialog's own key handlers —
          // stayed armed while the description was open. With the caret on a
          // button rather than in a field, `isTypingTarget` no longer protected
          // it either, so `Ctrl+Z` ran the DOCUMENT undo instead of the
          // description's own, and its `stopPropagation` swallowed the local
          // one: the meaning of an undo depended on where focus happened to be.
          data-slot="dialog-content"
          // Tied to the WIDE dialog (`condensed`, i.e. `!narrow`), not the
          // narrow one: the wide dialog is where complex content — long
          // formula-heavy definitions, several tables — needs to fit on
          // screen with as little scrolling as possible, so the spacing
          // condenses there. The narrow dialog is reached for short, simple
          // text that was never short on room, so it keeps the comfortable
          // spacing. `index.css` reads this attribute to shrink the header,
          // the block list, the symbol band and the footer together — see the
          // `--dd-*`/`--be-*`/`--sb-*` custom properties it sets from here
          // down.
          data-density={condensed ? 'compact' : 'comfortable'}
          aria-label={`Description de « ${cardTitle} »`}
          // The dialog opens ON the field being written in. Radix's default is
          // to focus the first tabbable element, which here is a panel
          // button — so the user's first keystroke went to a button instead
          // of into the description. Cancelling it lets the editor's own
          // auto-focus (see `autoFocusField` below) keep the caret, without
          // Radix taking it straight back afterwards.
          onOpenAutoFocus={event => event.preventDefault()}
          // The whole point: the modal does not close on an outside click.
          // `onInteractOutside` covers the pointer and the focus leaving;
          // `onPointerDownOutside` is the same gesture one event earlier, and
          // cancelling both is what makes the promise hold for a real click
          // rather than only in principle.
          onInteractOutside={event => event.preventDefault()}
          onPointerDownOutside={event => event.preventDefault()}
          // Which surface the caret is on decides what the shortcuts panel is
          // allowed to promise (see `noteCaretScope`).
          onFocusCapture={noteCaretScope}
          // Inline styles rather than utility classes: the shared
          // `DialogContent` caps itself at `sm:max-w-sm` and lays out as a
          // grid, and this dialog is deliberately the roomiest surface in the
          // app — narrowed only when the corner toggle asks for that.
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            width: narrow ? DESCRIPTION_WIDTH_NARROW : DESCRIPTION_WIDTH_LARGE,
            height: 'min(94vh, 1180px)',
            background: 'var(--popover)',
            color: 'var(--popover-foreground)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.28)',
            outline: 'none',
          }}
        >
          <NavArrow side="top" target={prevSibling} create={onCreate?.top} onNavigate={onNavigate && navigate} onOpenCreatePrompt={openCreatePrompt} narrow={narrow} />
          <NavArrow side="bottom" target={nextSibling} create={onCreate?.bottom} onNavigate={onNavigate && navigate} onOpenCreatePrompt={openCreatePrompt} narrow={narrow} />
          <NavArrow side="left" target={parentTarget} create={onCreate?.left} onNavigate={onNavigate && navigate} onOpenCreatePrompt={openCreatePrompt} narrow={narrow} />
          <NavArrow side="right" target={childTarget} create={onCreate?.right} onNavigate={onNavigate && navigate} onOpenCreatePrompt={openCreatePrompt} narrow={narrow} />

          {/* The two chrome controls of the top-right corner, in ONE
              absolutely-positioned row: the width toggle and the cross. The row
              — not each button — is what the header's right padding clears, and
              holding them in flow together is what keeps them from drifting
              apart when the dialog itself resizes. */}
          <div
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              zIndex: 3,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {/* One button, two states: it offers the width the dialog is NOT
                wearing, and says so both to the eye (the glyph) and to a screen
                reader (aria-pressed plus the same label). Rendered BEFORE the
                cross, so the cross stays the outermost, most reachable control. */}
            <Hint label={widthToggleLabel}>
            <button
              type="button"
              aria-label={widthToggleLabel}
              aria-pressed={narrow}
              onClick={toggleWidth}
              style={CORNER_BUTTON}
            >
              {narrow ? <Maximize2 size={17} /> : <Minimize2 size={17} />}
            </button>
            </Hint>

            {/* The cross, one of the only two ways out. It carries its own
                accessible name because the glyph says nothing about what it
                closes. */}
            <Hint label="Fermer">
            <button type="button" aria-label="Fermer la description" onClick={close} style={CORNER_BUTTON}>
              <X size={17} />
            </button>
            </Hint>
          </div>

          <header
            style={{
              padding: 'var(--dd-header-pad, 16px 90px 14px 20px)',
              borderBottom: '1px solid var(--border)',
              // Comfortable stacks the breadcrumb ABOVE the title — the
              // long-standing layout, and costs its own line of height. In
              // condensed (the wide dialog, see `condensed`) the breadcrumb
              // moves onto the title's own line instead, as a small label
              // beside it, saving that line entirely rather than just
              // shrinking it — exactly the line back that dense content needs.
              display: condensed ? 'flex' : 'block',
              alignItems: condensed ? 'center' : undefined,
              gap: condensed ? 10 : undefined,
            }}
          >
            {breadcrumb.length > 0 && (
              <div
                style={{
                  flex: condensed ? '0 1 auto' : undefined,
                  minWidth: condensed ? 0 : undefined,
                  maxWidth: condensed ? '40%' : undefined,
                  overflow: condensed ? 'hidden' : undefined,
                  textOverflow: condensed ? 'ellipsis' : undefined,
                  whiteSpace: 'nowrap',
                  fontSize: 11,
                  opacity: 0.6,
                  marginBottom: condensed ? 0 : 'var(--dd-breadcrumb-mb, 7px)',
                }}
              >
                {breadcrumb.join(' › ')}
              </div>
            )}
            <DialogPrimitive.Title asChild>
              <div
                className={`description-dialog-title-chip${onRenameTitle ? ' is-editable' : ''}`}
                style={
                  {
                    // ALL the width, not a chip hugging its text: the title is
                    // the thing being identified, and a long one used to be
                    // squeezed into a pill that grew with the string, pushing
                    // the breadcrumb and the whole header around as it changed.
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: condensed ? undefined : '100%',
                    flex: condensed ? '1 1 auto' : undefined,
                    minWidth: condensed ? 0 : undefined,
                    boxSizing: 'border-box',
                    padding: 'var(--dd-title-pad, 9px 14px)',
                    borderRadius: 9,
                    border: `2px solid ${titleColors?.border ?? 'var(--border)'}`,
                    background: titleColors?.bg ?? 'var(--muted)',
                    color: titleColors?.text ?? 'var(--foreground)',
                    '--chip-accent': titleColors?.border ?? 'var(--foreground)',
                  } as CSSProperties
                }
              >
                <span
                  aria-hidden
                  style={{
                    flex: '0 0 auto',
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: titleColors?.border ?? 'currentColor',
                  }}
                />
                <input
                  ref={registerTitleField}
                  aria-label="Titre de la carte"
                  value={titleDraft}
                  readOnly={!onRenameTitle}
                  onChange={event => setTitleDraft(event.target.value)}
                  onFocus={() => setTitleFocused(true)}
                  onBlur={commitTitle}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.blur()
                    }
                    if (event.key === 'Escape') setTitleDraft(cardTitle)
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    font: 'inherit',
                    fontSize: 'var(--dd-title-fs, 17px)',
                    fontWeight: 650,
                    outline: 'none',
                    cursor: onRenameTitle ? 'text' : 'default',
                  }}
                />
                {onRenameTitle && <Pencil size={14} className="title-chip-pencil" aria-hidden />}
              </div>
            </DialogPrimitive.Title>
          </header>

          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: 'var(--dd-content-pad, 14px 20px 6px)' }}>
            {/* A readable measure, not the full width of a 1600px dialog: the
                side panel that used to hold this column back is gone, and
                prose across the whole modal would run to ~180 characters a
                line. Tables and formulas have room to spare at this width. */}
            <div style={{ height: '100%', maxWidth: 1080, margin: '0 auto' }}>
              <BlockEditor
                blocks={draft}
                onChange={setDraft}
                resolveAsset={resolveAsset}
                onInsertImage={onInsertImage}
                onPickImage={onPickImage}
                onError={onError}
                autoFocusField={!autoFocusTitle}
                hiddenFamilies={hiddenFamilies}
                dialogMenuActions={{
                  // La même confirmation que le bouton du pied : une
                  // suppression totale n'est jamais à un seul clic droit
                  // malencontreux de distance.
                  onDeleteDescription: () => setConfirmingDelete(true),
                  onOpenBandOptions: () => setBandOptionsOpen(open => !open),
                  narrow,
                  onToggleNarrow: toggleWidth,
                  shortcutsOpen,
                  onToggleShortcuts: () => setShortcutsOpen(open => !open),
                  canUndo,
                  canRedo,
                  onUndo: undo,
                  onRedo: redo,
                  onClose: close,
                }}
              />
            </div>
          </div>

          {shortcutsOpen && (
            <ShortcutsPanel
              scope={caretScope}
              canRename={onRenameTitle !== undefined}
              onClose={() => setShortcutsOpen(false)}
            />
          )}

          <footer
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 'var(--dd-footer-gap, 8px)',
              padding: 'var(--dd-footer-pad, 10px 16px)',
              borderTop: '1px solid var(--border)',
            }}
          >
            {/* Icon-only, et à gauche de « Supprimer » : c'est un réglage
                d'affichage, pas une action sur la fiche, donc il ne doit pas se
                mêler au groupe d'actions de droite (Raccourcis, Fermer) ni
                concurrencer la seule action destructive. */}
            <Hint label="Choisir les familles de symboles affichées">
              <Button
                variant="outline"
                size="icon"
                aria-label="Choisir les familles de symboles affichées"
                aria-expanded={bandOptionsOpen}
                onClick={() => setBandOptionsOpen(open => !open)}
              >
                <LayoutGrid />
              </Button>
            </Hint>
            {blocks.length > 0 && (
              <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>
                <Trash2 />
                Supprimer
              </Button>
            )}
            {/* Beside the destructive action rather than beside "Fermer": these
                are edits to the description, which is what "Supprimer" acts on
                too. `disabled` is a real attribute, not a dimmed style — the
                hook can answer "is there anything to walk back to?" because
                `canUndoDescription` reads the history instead of consuming it,
                and a greyed-out button that is still clickable would be a lie
                to a screen reader. */}
            <Hint label="Annuler (Ctrl+Z)">
            <Button
              variant="outline"
              size="icon"
              aria-label="Annuler la dernière modification de la description"
              disabled={!canUndo}
              onClick={undo}
            >
              <Undo2 />
            </Button>
            </Hint>
            <Hint label="Rétablir (Ctrl+Maj+Z)">
            <Button
              variant="outline"
              size="icon"
              aria-label="Rétablir la modification annulée"
              disabled={!canRedo}
              onClick={redo}
            >
              <Redo2 />
            </Button>
            </Hint>
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
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: 0.7 }} />
              Enregistré automatiquement
            </span>
            {/* Kept where the side panel's shortcut list used to be: the panel
                is gone (its tools moved onto the blocks themselves), but the
                keyboard is still the fastest way to write a definition, and a
                shortcut nobody can look up is a shortcut nobody uses. */}
            <Button variant="outline" aria-expanded={shortcutsOpen} onClick={() => setShortcutsOpen(open => !open)}>
              <Keyboard />
              Raccourcis
            </Button>
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
          {createPrompt !== null && onCreate?.[createPrompt] !== undefined && (
            <CreatePromptOverlay
              side={createPrompt}
              colors={onCreate[createPrompt]?.colors}
              onCreate={title => {
                onCreate[createPrompt]?.onSelect(title)
                setCreatePrompt(null)
              }}
              onCancel={() => setCreatePrompt(null)}
            />
          )}
          {bandOptionsOpen && (
            <BandOptionsOverlay
              hidden={hiddenFamilies}
              onToggle={family =>
                setFamilies(
                  hiddenFamilies.includes(family)
                    ? hiddenFamilies.filter(name => name !== family)
                    : [...hiddenFamilies, family]
                )
              }
              onShowAll={() => setFamilies([])}
              onClose={() => setBandOptionsOpen(false)}
            />
          )}
        </DialogPrimitive.Content>
        </TooltipProvider>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

const NAV_ICON: Record<NavSide, typeof ArrowUp> = {
  top: ArrowUp,
  bottom: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
}

/** `Ctrl + <flèche>` names the same edge its arrow button sits on. */
const ARROW_SIDE: Record<string, NavSide> = {
  ArrowUp: 'top',
  ArrowDown: 'bottom',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

/**
 * Where each relation sits, and it is the geometry that carries the meaning:
 * **depth is horizontal, order is vertical.**
 *
 * The parent is to the LEFT and the first child to the RIGHT — the two
 * directions that read as "up a level" and "down a level" in a mind map laid
 * out left to right. The cards either side of this one at the same level are
 * ABOVE and BELOW, which is where they already are in the sibling order the
 * user is looking at.
 *
 * It used to be the other way round (parent above, siblings left/right), which
 * put a hierarchy move on the vertical axis and a same-level move on the
 * horizontal one — exactly the two relations a reader is most likely to
 * confuse, on the two axes that were most likely to suggest the opposite.
 *
 * The centering offsets are written as motion's own `x`/`y` style values, never
 * as a CSS `transform` string: `whileHover` below composes its `scale` into that
 * same `transform` property, so a literal `translateX(-50%)` here would be
 * clobbered the instant the pointer landed on an arrow and the button would
 * visibly jump off its edge. `CardNode`'s `EdgeButton` documents the same trap.
 */
type NavPosition = CSSProperties & { x?: string; y?: string }
/**
 * `narrow` pushes the button further OUTSIDE the dialog's border instead of
 * shrinking it: the button already sits more outside than in at the default
 * offset (30px wide, so -18 leaves 18px outside against 12px overlapping the
 * content), and moving it out further is what actually gives the content
 * back the few pixels it was losing to the overlap, rather than making the
 * button itself harder to hit.
 */
function navPosition(side: NavSide, narrow: boolean): NavPosition {
  const offset = narrow ? -22 : -18
  switch (side) {
    case 'top':
      return { top: offset, left: '50%', x: '-50%' }
    case 'bottom':
      return { bottom: offset, left: '50%', x: '-50%' }
    case 'left':
      return { left: offset, top: '50%', y: '-50%' }
    case 'right':
      return { right: offset, top: '50%', y: '-50%' }
  }
}

/** What each edge leads to, in one word, so the arrow does not have to be decoded. */
const NAV_RELATION: Record<NavSide, string> = {
  top: 'Précédent',
  bottom: 'Suivant',
  left: 'Parent',
  right: 'Sous-partie',
}

/** What each edge CREATES when it has no neighbour to jump to. */
const NAV_CREATE_LABEL: Record<NavSide, string> = {
  top: 'Nouvelle carte avant',
  bottom: 'Nouvelle carte après',
  left: 'Nouvelle carte parente',
  right: 'Nouvelle sous-partie',
}

/**
 * How much of a neighbour's title the hover card shows before eliding it.
 *
 * A fixed character budget rather than a width: the hover card is dressed as a
 * card, and a card is a small thing — a title stretching across the dialog
 * would be the opposite of the glance it exists for. Enough to recognise where
 * the jump lands, never enough to become a paragraph.
 */
const TITLE_PREVIEW_CHARS = 42

function previewTitle(title: string): string {
  const trimmed = title.trim()
  if (trimmed.length <= TITLE_PREVIEW_CHARS) return trimmed
  return `${trimmed.slice(0, TITLE_PREVIEW_CHARS).trimEnd()}…`
}

const NAV_TIP_LABEL: CSSProperties = { fontWeight: 700, opacity: 0.85, whiteSpace: 'nowrap' }
const NAV_TIP_TITLE: CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

/**
 * One edge of the dialog, as an icon-only button.
 *
 * The parent is on the left, the first child on the right, the previous/next
 * card at the same level above and below. This used to be a wide pill carrying
 * the relation AND the neighbour's title; that title has moved into a hover card
 * dressed like the destination itself, which is what let the control shrink to
 * the single glyph that says where it points.
 *
 * Painted in the TARGET card's own colours. The four buttons lead to four
 * different cards, and colour is the one thing that already means "which card is
 * this" everywhere else in the app: the level palette. A neutral button would
 * make the user read four titles to find the one they want; a coloured one lets
 * them recognise it, including the level it belongs to, before reading anything.
 *
 * An edge with no neighbour shows a "+" — but only when the caller supplied a
 * way to create one for that edge, which it can only do when the store would
 * accept it (a level-4 card has no child to add, the root has no sibling). An
 * edge with neither shows nothing, rather than a greyed-out button for a
 * relation that does not apply.
 */
function NavArrow({
  side,
  target,
  create,
  onNavigate,
  onOpenCreatePrompt,
  narrow,
}: {
  side: NavSide
  target?: DescriptionNavTarget
  create?: DescriptionCreateTarget
  onNavigate?: (id: string) => void
  /** Opens the title prompt instead of creating blind — see `createPrompt` on the dialog. */
  onOpenCreatePrompt: (side: NavSide) => void
  /** Pushes the button further outside the dialog's border — see `navPosition`. */
  narrow: boolean
}) {
  const Icon = NAV_ICON[side]

  if (target !== undefined && onNavigate !== undefined) {
    // More than one child: naming one of them would be picking for the user, so
    // the hover card says how many there are instead — and then the count IS the
    // label, leaving no room for one title among several.
    const manyChildren = side === 'right' && target.count !== undefined && target.count > 1
    return (
      <EdgeButton
        side={side}
        narrow={narrow}
        colors={target.colors}
        ariaLabel={`Aller à « ${target.title} »`}
        onActivate={() => onNavigate(target.id)}
        tip={
          manyChildren ? (
            <span style={NAV_TIP_LABEL}>{target.count} sous-parties</span>
          ) : (
            <>
              <span style={NAV_TIP_LABEL}>{NAV_RELATION[side]}</span>
              <span style={NAV_TIP_TITLE}>{previewTitle(target.title)}</span>
            </>
          )
        }
      >
        <Icon size={16} />
      </EdgeButton>
    )
  }

  if (create !== undefined) {
    return (
      <EdgeButton
        side={side}
        narrow={narrow}
        colors={create.colors}
        ariaLabel={NAV_CREATE_LABEL[side]}
        onActivate={() => onOpenCreatePrompt(side)}
        tip={<span style={NAV_TIP_LABEL}>{NAV_CREATE_LABEL[side]}</span>}
      >
        <Plus size={16} />
      </EdgeButton>
    )
  }

  return null
}

/**
 * The button both jobs share: an arrow that jumps to a neighbour, a "+" that
 * creates one.
 *
 * Its hover card is dressed in the same border, fill and text as the card it
 * leads to — hence `arrow={false}` on the shared `TooltipContent`, whose little
 * pointer has no border to line up with that outline. `delayDuration` stays the
 * app default (the one `TooltipProvider` mounting the dialog already set).
 */
function EdgeButton({
  side,
  narrow,
  colors,
  ariaLabel,
  onActivate,
  tip,
  children,
}: {
  side: NavSide
  narrow: boolean
  colors?: TitleChipColors
  ariaLabel: string
  onActivate: () => void
  tip: ReactNode
  children: ReactNode
}) {
  // `reduceMotion ? undefined` is load-bearing: motion does NOT consult
  // `prefers-reduced-motion` on its own (`reducedMotion` defaults to
  // `"never"`), so without the gate this would animate for the users who asked
  // it not to.
  const reduceMotion = useReducedMotion()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          type="button"
          aria-label={ariaLabel}
          onClick={onActivate}
          // The pills had no hover or press feedback at all, while the palette's
          // own keys did — so the four controls that move you around the map were
          // the only ones that did not look clickable. This is the app's existing
          // feel for a small action chip (the spring `CardNode`'s edge buttons
          // use), with a slightly firmer scale now that the chip is round.
          whileHover={reduceMotion ? undefined : { scale: 1.12 }}
          whileTap={reduceMotion ? undefined : { scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          style={{
            position: 'absolute',
            zIndex: 2,
            display: 'grid',
            placeItems: 'center',
            width: 30,
            height: 30,
            padding: 0,
            borderRadius: 999,
            border: `2px solid ${colors?.border ?? 'var(--border)'}`,
            background: colors?.bg ?? 'var(--popover)',
            color: colors?.text ?? 'inherit',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.2)',
            cursor: 'pointer',
            ...navPosition(side, narrow),
          }}
        >
          {children}
        </motion.button>
      </TooltipTrigger>
      <TooltipContent
        arrow={false}
        sideOffset={8}
        className="z-[60] max-w-xs"
        style={{
          padding: '6px 10px',
          borderRadius: 9,
          border: `2px solid ${colors?.border ?? 'var(--border)'}`,
          background: colors?.bg ?? 'var(--popover)',
          color: colors?.text ?? 'inherit',
        }}
      >
        {tip}
      </TooltipContent>
    </Tooltip>
  )
}

/** Which surface the caret is on — what the shortcuts panel has to speak about. */
type EnterScope = 'title' | 'cell' | 'block'

/**
 * The keyboard, listed — opened from the footer, in the flow rather than floating
 * over the field being written in.
 *
 * The list is CONTEXTUAL to the surface the caret is on, because the same key
 * does different things depending on where it is pressed: `Entrée` validates a
 * rename in the title field, adds a row in a table cell, and inserts a block
 * everywhere else. A single hard-coded "Entrée — Nouveau bloc" was already false
 * in two of those surfaces, which is worse than saying nothing.
 */
function ShortcutsPanel({
  scope,
  canRename,
  onClose,
}: {
  scope: EnterScope
  /** A title only validates a rename when the host can actually write one back. */
  canRename: boolean
  onClose: () => void
}) {
  return (
    <div
      role="group"
      aria-label="Raccourcis clavier"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 22px',
        alignItems: 'center',
        padding: 'var(--dd-shortcuts-pad, 9px 20px)',
        borderTop: '1px solid var(--border)',
        background: 'color-mix(in oklch, var(--border), transparent 70%)',
      }}
    >
      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.6 }}>
        Raccourcis
      </span>
      {scope === 'title' && canRename && <Shortcut keys="Entrée" label="Valider le renommage" />}
      {scope === 'cell' && <Shortcut keys="Entrée" label="Ajouter une ligne dans la cellule" />}
      {/* Entrée écrit une LIGNE dans le champ où est le curseur — un texte, une
          cellule, une formule. C'est Ctrl/Cmd+Entrée qui ajoute un BLOC, comme
          dans un traitement de texte. */}
      {scope === 'block' && <Shortcut keys="Ctrl/Cmd + Entrée" label="Nouveau bloc" />}
      {scope === 'block' && <Shortcut keys="Entrée (en formule)" label="Ajoute une ligne de formule" />}
      {scope === 'block' && <Shortcut keys="Tab / Maj + Tab" label="Type de bloc suivant / précédent" />}
      {scope === 'block' && <Shortcut keys="Alt + ↑ / ↓" label="Déplacer le bloc" />}
      {scope === 'block' && <Shortcut keys="Alt + D" label="Dupliquer le bloc" />}
      {scope === 'block' && <Shortcut keys="Alt + Q" label="Marquer comme question" />}
      {scope === 'block' && <Shortcut keys="Alt + 1…5 / 0" label="Onglet du bandeau / aucun" />}
      {scope === 'block' && <Shortcut keys="Ctrl/Cmd + Maj + Entrée" label="Ajouter un bloc" />}
      {/* `$$` is a text-block gesture only: it does nothing in the title, and a
          table cell keeps its two dollar signs as literal text. */}
      {scope === 'block' && <Shortcut keys="$$" label="Transforme le texte en formule" />}
      <Shortcut keys="Ctrl/Cmd + M" label="Rétrécir / élargir la modale" />
      <Shortcut keys="Ctrl/Cmd + /" label="Afficher / masquer les raccourcis" />
      <Shortcut keys="Ctrl/Cmd + Maj + F" label="Familles de symboles" />
      {/* Hors d'un champ de texte seulement — Ctrl+←/→ y saute déjà d'un mot. */}
      <Shortcut keys="Ctrl/Cmd + flèches" label="Carte parente / sous-partie / précédente / suivante" />
      <Shortcut keys="Ctrl/Cmd + Z" label="Annuler" />
      <Shortcut keys="Ctrl/Cmd + Maj + Z" label="Rétablir" />
      <Shortcut keys="Échap" label="Fermer" />
      <Hint label="Masquer les raccourcis">
      <button
        type="button"
        aria-label="Masquer les raccourcis"
        onClick={onClose}
        style={{
          marginLeft: 'auto',
          display: 'grid',
          placeItems: 'center',
          width: 26,
          height: 26,
          padding: 0,
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'transparent',
          color: 'inherit',
          opacity: 0.6,
          cursor: 'pointer',
        }}
      >
        <X size={14} />
      </button>
      </Hint>
    </div>
  )
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, opacity: 0.8 }}>
      <kbd style={{ font: 'inherit', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px' }}>{keys}</kbd>
      {label}
    </span>
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

/**
 * The title prompt an edge's « + » opens — by click or by Ctrl+flèche, never
 * straight into `onCreate[side].onSelect` any more (see `activateEdge`).
 *
 * Dressed in the SAME chip the dialog's own title wears (`titleColors`) and
 * the header title chip below it — `colors` here is the palette the new card
 * WILL carry, exactly what the "+" already predicted with its own border —
 * so the prompt reads as "the card about to be born", not a bare form pasted
 * over the description.
 */
function CreatePromptOverlay({
  side,
  colors,
  onCreate,
  onCancel,
}: {
  side: NavSide
  colors?: TitleChipColors
  onCreate: (title: string) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')

  function commit() {
    const trimmed = title.trim()
    if (trimmed === '') return
    onCreate(trimmed)
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={NAV_CREATE_LABEL[side]}
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
          width: 'min(420px, 100%)',
          padding: 20,
          borderRadius: 10,
          border: '1px solid var(--border)',
          background: 'var(--popover)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
        }}
      >
        <p style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{NAV_CREATE_LABEL[side]}</p>

        {/* Le même chip que le titre de la modale : bordure, fond et texte de
            la palette que la carte va porter — la carte qui va naître, montrée
            avant d'exister. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 14px',
            borderRadius: 9,
            border: `2px solid ${colors?.border ?? 'var(--border)'}`,
            background: colors?.bg ?? 'var(--muted)',
            color: colors?.text ?? 'var(--foreground)',
          }}
        >
          <span
            aria-hidden
            style={{ flexShrink: 0, width: 10, height: 10, borderRadius: 999, background: colors?.border ?? 'currentColor' }}
          />
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            aria-label="Titre de la nouvelle carte"
            placeholder="Titre de la carte"
            value={title}
            onChange={event => setTitle(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commit()
              }
            }}
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              fontSize: 17,
              fontWeight: 650,
              outline: 'none',
            }}
          />
        </div>

        <div
          role="group"
          aria-label="Choix possibles"
          style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}
        >
          <Button variant="outline" onClick={onCancel}>
            <X />
            Annuler
          </Button>
          <Button onClick={commit} disabled={title.trim() === ''}>
            <Plus />
            Valider
          </Button>
        </div>
      </div>
    </div>
  )
}
