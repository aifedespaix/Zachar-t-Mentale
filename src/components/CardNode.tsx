import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Plus,
  ArrowRight,
  GripVertical,
  EllipsisVertical,
  Unlink,
  Trash2,
  Check,
  X,
  Eye,
  PenLine,
  Pencil,
  ListChecks,
  BookOpen,
  type LucideIcon,
} from 'lucide-react'
import type { Card, CardLevel } from '../types/card'
import type { CardBlock, CardBlockKind } from '../types/cardBlock'
import { isRootCard } from '../types/card'
import type { QuizQuestionType, QuizResult } from '../types/quiz'
import { EMPTY_RECALL_PROGRESS } from '../types/quiz'
import { useCardsStore, selectEditsBlocked } from '../state/useCardsStore'
import { useQuizStore } from '../state/useQuizStore'
import { useQuizSettingsStore } from '../state/useQuizSettingsStore'
import { revealedSet, slotsOf } from '../quiz/blanks'
import { clampCardLevel, detachedColors } from '../colors/levelColors'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'
import { useResolvedTheme } from '../hooks/useResolvedTheme'
import { toCss } from '../colors/contrast'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu'
import { QcmDialog } from './quiz/QcmDialog'
import { RecallDialog } from './quiz/RecallDialog'
import { useCardDetailStore } from '../state/useCardDetailStore'
import { useCardSelectionStore } from '../state/useCardSelectionStore'
import { useCardHoverStore } from '../state/useCardHoverStore'
import { CardContextMenu } from './commands/CardContextMenu'
import { CONTENT_KIND_ICONS } from '../content/ContentKindBadges'
import { contentOf, nonTextKinds } from '../content/blocks'
import { BlockView } from '../content/BlockView'
import { stripHighlightMarkers } from '../content/highlight'
import { assetSrc } from '../persistence/assets'
import { useWorkspaceStore } from '../state/useWorkspaceStore'
import { CARD_WIDTH } from '../layout/cardGeometry'

interface QuizData {
  type: QuizQuestionType
  result: QuizResult
  distractorDefinitions?: string[]
  distractorTitles?: string[]
  hint?: string
}

type CardNodeProps = NodeProps & {
  data: { card: Card; autoEdit?: boolean; isReparentTarget?: boolean; quiz?: QuizData }
}

/**
 * Shared "structurally unavailable" grey. Only the delete `x` still uses
 * this: it stays in place and goes grey on the root (an existing card that
 * cannot be removed), while the add-actions (+, ->) are removed outright
 * when there is nowhere for the new card to go — see `canAddSibling` /
 * `canAddChild` below.
 */
const DISABLED_GREY = '#c0c0c0'
const EDGE_BUTTON_SIZE = '1.6rem'

/**
 * The card fixed width, in px.
 *
 * Fixed, not content-driven, and that is the whole point (regle anti-decalage
 * 1: a card footprint never depends on its content). A card used to be sized
 * by its widest child, and its two title states are not the same kind of box:
 * the editor title is a textarea whose intrinsic width comes from its cols,
 * while the quiz masked title is a plain div sized by its own text — rendered
 * in a wide monospace with extra letter spacing, so a card being quizzed grew
 * to two or three times the width of the same card a moment earlier, pushing
 * everything around it.
 *
 * The value itself lives in layout/cardGeometry, next to the column pitch it
 * drives; re-exported here because MindMapCanvas and the tests read it from
 * this module.
 */export { CARD_WIDTH }

/**
 * The box the card title occupies — shared by BOTH of its states, so an
 * editing card and a quiz card keep exactly the same size.
 *
 * What matters is that its HEIGHT is fixed: TITLE_LINES lines of text, whatever
 * the title length, so the card footprint never depends on its content. The
 * quiz variant clamps to the same number of lines for the same reason — an
 * unclamped div would let a long masked title make the card taller than the
 * same card while it is being edited. The mask stays fully readable where it
 * matters — the answer dialog letter boxes.
 *//** How many lines of title every card reserves, whatever the title length. */
export const TITLE_LINES = 4
const TITLE_LINE_HEIGHT = 1.2

/**
 * The zone the title is centred in: a fixed TITLE_LINES-line box, the FIRST
 * thing in the card, right under a deliberately minimal top padding.
 *
 * Centring the text inside a box of fixed height is what keeps a one-line
 * title balanced in a box sized for four, and a four-line title filling it.
 * A title longer than that scrolls inside the box instead of growing the
 * card or getting cut off unreadably: `overflowY: auto` only shows a
 * scrollbar once content actually exceeds the box. The `nowheel` class is
 * @xyflow/react's own escape hatch (see ZoomPane) — without it, a wheel
 * scroll over that scrollbar zooms the whole canvas instead of scrolling
 * the title, because the pane's own wheel handler sees the event first.
 *
 * The height is written in em so it follows the card font size rather than
 * being a pixel count that would silently drift from TITLE_LINE_HEIGHT.
 */
const TITLE_ZONE_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  height: `calc(${TITLE_LINES} * ${TITLE_LINE_HEIGHT}em + 0.2rem + 4px)`,
  overflowY: "auto",
  overflowX: "hidden",
}

/**
 * The bottom row height, and the reason it is a constant: EVERY card renders
 * the slot — the quiz "Répondre" row, the empty/filled description action
 * row — so all cards keep exactly the same height whatever state they are in.
 */
const ACTION_SLOT_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.25rem",
  height: 36,
}

const TITLE_BOX_STYLE: CSSProperties = {
  display: 'block',
  width: '100%',
  font: 'inherit',
  lineHeight: TITLE_LINE_HEIGHT,
  padding: '0.1rem 0.3rem',
  margin: '-0.1rem -0.3rem',
  border: '2px solid transparent',
  borderRadius: 4,
}

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
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.button
            aria-label={label}
            aria-disabled={disabled}
            onClick={event => {
              // The whole card is a click target of its own (see
              // `handleCardClick`) — an action button must not also open the
              // fiche panel underneath it.
              event.stopPropagation()
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
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * The card's whole bottom row — its one door into the description, filled or
 * empty. `règle anti-décalage 1` (a card's footprint never depends on its
 * content) is why this is a fixed-height row (`ACTION_SLOT_STYLE`, shared with
 * the quiz "Répondre" row) rather than text sized by whatever it holds.
 *
 * On an editable map it always opens the EDITOR, filled or empty — reading no
 * longer needs a click on the card body (see `handleCardClick`), and a second,
 * icon-only button shows the description in the right panel WITHOUT opening
 * the editor, for a glance that does not risk an accidental edit.
 *
 * On a LOCKED map there is nothing to write, so the row goes back to reading:
 * one full-width button, and no eye button since there is no separate "just
 * open the editor" action to spare it from.
 */
function DescriptionAction({
  card,
  locked,
  ficheOpen,
  borderColor,
  onEdit,
  onView,
}: {
  card: Card
  locked: boolean
  ficheOpen: boolean
  borderColor: string
  /** Opens the fiche and, unless locked, its editor. */
  onEdit: () => void
  /** Shows the fiche without ever opening the editor. */
  onView: () => void
}) {
  const blocks = contentOf(card)
  const hasContent = blocks.length > 0
  // A locked map cannot write, so a card with nothing to read has nothing the
  // row can honestly offer.
  if (locked && !hasContent) return null

  const dominant = nonTextKinds(blocks)[0]
  // The glyph for READING, used on a locked map: the content kind when the
  // description leads with something other than text, an open book for plain
  // text.
  const readIcon = dominant ? CONTENT_KIND_ICONS[dominant].icon : BookOpen
  const Icon = locked ? readIcon : hasContent ? Pencil : PenLine
  // `locked` reaches this point only with content (see the early return
  // above), so there is no "add" case to account for here.
  const label = locked
    ? card.kind === 'media'
      ? 'Afficher le média'
      : 'Afficher la définition'
    : hasContent
      ? 'Modifier la description'
      : 'Ajouter une description'

  return (
    <div className="card-footer" style={ACTION_SLOT_STYLE}>
      <button
        type="button"
        className="card-action-edit"
        aria-label={label}
        onClick={event => {
          event.stopPropagation()
          onEdit()
        }}
        style={
          {
            flex: 1,
            height: '100%',
            borderRadius: 8,
            border: 'none',
            background: borderColor,
            color: 'var(--background)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            // The card's own colour, for the hover shadow in `index.css`. It
            // cannot come from `currentColor` here: this button is FILLED with
            // that colour, so `currentColor` is the label sitting on top of it.
            '--card-action-accent': borderColor,
          } as CSSProperties
        }
      >
        <Icon size={14} strokeWidth={2.3} />
        {label}
      </button>

      {/* Editable AND already filled only: the one way to view the
          description without risking an edit. Empty has nothing to view,
          locked has no separate edit action to spare it from. */}
      {!locked && hasContent && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="card-action-view"
                aria-label="Afficher dans le panneau"
                aria-pressed={ficheOpen}
                onClick={event => {
                  event.stopPropagation()
                  onView()
                }}
                style={
                  {
                    flexShrink: 0,
                    width: 36,
                    height: '100%',
                    borderRadius: 8,
                    border: `1.5px solid ${borderColor}`,
                    background: 'var(--background)',
                    color: borderColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    '--card-action-accent': borderColor,
                  } as CSSProperties
                }
              >
                <Eye size={16} strokeWidth={2.3} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Afficher dans le panneau</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  )
}

// `question` is absent here, exactly as from `nonTextKinds`: a media title is
// asked about a picture, a table or a formula — never about a group header,
// which titles itself with the sentence the user wrote in it.
const MEDIA_TITLE_HEADINGS: Record<Exclude<CardBlockKind, 'text' | 'question'>, string> = {
  table: 'À quel titre correspond ce tableau ?',
  math: 'À quel titre correspond cette formule ?',
  equation: 'À quel titre correspond cette équation ?',
  image: 'À quel titre correspond cette image ?',
}

function headingForMediaTitle(blocks: CardBlock[]): string {
  const [dominant] = nonTextKinds(blocks)
  return dominant ? MEDIA_TITLE_HEADINGS[dominant] : 'À quel titre correspond ce contenu ?'
}

export function CardNode({ data }: CardNodeProps) {
  const { card, autoEdit = false, isReparentTarget = false, quiz } = data
  const similarityThreshold = useQuizSettingsStore(s => s.similarityThreshold)
  const lengthGuideEnabled = useQuizSettingsStore(s => s.lengthGuideEnabled)
  const liveLetterFeedback = useQuizSettingsStore(s => s.liveLetterFeedback)
  // A quiz is on somewhere in the app — true even for cards that were not
  // drawn. It is what silences the editing chrome map-wide: half the buttons
  // on an untouched card are noise while the user is meant to be revising.
  const quizActive = useQuizStore(s => s.active)
  const quizDifficulty = useQuizStore(s => s.config?.difficulty ?? 'moyen')
  const recallProgress = useQuizStore(s => s.recallProgress[card.id])
  const submitRecall = useQuizStore(s => s.submitRecall)
  const revealRecallAnswer = useQuizStore(s => s.revealRecallAnswer)
  const answerQcmDefinition = useQuizStore(s => s.answerQcmDefinition)
  const answerQcmTitle = useQuizStore(s => s.answerQcmTitle)
  const [answerOpen, setAnswerOpen] = useState(false)

  // This card was drawn and is still waiting for an answer. Everything about
  // the card's quiz appearance — the neutral "blank" surface, the call to
  // action, the masked title — hangs off this one flag.
  const isPending = quiz !== undefined && quiz.result === 'unanswered'
  const isRecallPending = quiz?.type === 'recall' && isPending
  const isQcmPending =
    (quiz?.type === 'qcm-definition' ||
      quiz?.type === 'qcm-title' ||
      quiz?.type === 'qcm-media' ||
      quiz?.type === 'qcm-media-title') &&
    isPending
  // `qcm-title`/`qcm-media-title` ask the user to pick the title out of four
  // options, so showing it on the card would hand them the answer;
  // `qcm-definition`/`qcm-media` show the title (that IS the question) and
  // hide nothing.
  const displayMasked =
    isPending && (quiz?.type === 'recall' || quiz?.type === 'qcm-title' || quiz?.type === 'qcm-media-title')
  const resultBorderColor = quiz?.result === 'correct' ? '#16a34a' : quiz?.result === 'incorrect' ? '#dc2626' : undefined

  // The shape of the answer, drawn on the card itself: same letters as the
  // answer dialog will show, so the card is a genuine preview of the question
  // rather than a separate riddle.
  // Same aid on recall, qcm-title AND qcm-media-title — the mission asked
  // for the letter-count hint to stay systematic across every Sens A
  // variant, not just recall. QCM questions have no retries, so
  // `recallProgress` naturally stays absent for them and `extraReveals`
  // falls back to 0 — the base difficulty count, never growing.
  const blankPreview =
    displayMasked && lengthGuideEnabled
      ? (() => {
          const revealed = revealedSet(card.title, quizDifficulty, recallProgress?.extraReveals ?? 0)
          return slotsOf(card.title)
            .map(slot => (slot.fillable && !revealed.has(slot.index) ? '_' : slot.char))
            .join('')
        })()
      : null

  // React Flow keeps CardNode mounted for the life of the app (nodes are keyed
  // by card id, not remounted between quizzes), so an answer dialog left open
  // by a PREVIOUS quiz must not reappear over a later one.
  useEffect(() => {
    if (!quiz) setAnswerOpen(false)
  }, [quiz])

  const updateTitle = useCardsStore(s => s.updateTitle)
  const allCards = useCardsStore(s => s.history.present)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  // ONE resolver for every read path of this card. Assets live in a sidecar
  // named after the open file, so it degrades to "not available" when there is
  // none — which `BlockView` renders as a named placeholder.
  //
  // Shared rather than passed per call site because it was not: the quiz's rich
  // QCM options passed `() => ''` unconditionally, so a definition illustrated
  // with a diagram read « Image introuvable » in the one place the user is
  // being asked to recognise it.
  const resolveAsset = useMemo(
    () => (currentFilePath === null ? () => '' : (asset: string) => assetSrc(currentFilePath, asset)),
    [currentFilePath]
  )
  const addChild = useCardsStore(s => s.addChild)
  const addSibling = useCardsStore(s => s.addSibling)
  const deleteCard = useCardsStore(s => s.deleteCard)
  const deleteCardDetachingChildren = useCardsStore(s => s.deleteCardDetachingChildren)
  const detachCard = useCardsStore(s => s.detachCard)
  const flattenedCount = useCardsStore(s => s.flattenedCount)
  const descendantCount = useCardsStore(s => s.descendantCount)
  const hasChildren = useCardsStore(s => s.hasChildren)
  const locked = useCardsStore(selectEditsBlocked)
  const titleInputRef = useRef<HTMLTextAreaElement>(null)
  const [titleFocused, setTitleFocused] = useState(false)
  const [draftTitle, setDraftTitle] = useState(card.title)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmDetachOpen, setConfirmDetachOpen] = useState(false)
  const showFiche = useCardDetailStore(s => s.show)
  const editFiche = useCardDetailStore(s => s.setEditing)
  const ficheOpen = useCardDetailStore(s => s.open.some(entry => entry.cardId === card.id))
  // Whether the pointer is on THIS card or on its fiche in the right panel: one
  // shared id makes the highlight symmetric, so "hover the description" and
  // "hover the card" are the same state seen from two places.
  const hovered = useCardHoverStore(s => s.hoveredCardId === card.id)
  const hoverCard = useCardHoverStore(s => s.hover)
  const unhoverCard = useCardHoverStore(s => s.unhover)
  // Whether THIS card is the one selection acts on (click, or keyboard/minimap
  // navigation) — see `useCardSelectionStore`. Deliberately a different colour
  // family than `hovered` (the app's neutral `--ring` rather than the card's
  // own level colour): hover reads as "what the pointer is over", selection as
  // "what the keyboard/commands act on", and the two must stay tellable apart
  // when they land on different cards at once.
  const selected = useCardSelectionStore(s => s.selectedCardId === card.id)
  const isDetached = card.detached === true
  // A floating card is painted grey whatever level it last had: its level is
  // vestigial once it leaves the hierarchy (see the `detached` field), so
  // colouring it by that stale value would read as "still a level-3 card".
  const theme = useResolvedTheme()
  const level = clampCardLevel(card.level)
  const levelAppearance = useAppearanceSettingsStore(s => s.levels[level])
  const childLevelAppearance = useAppearanceSettingsStore(s =>
    level < 4 ? s.levels[(level + 1) as CardLevel] : null
  )
  const colors = isDetached ? detachedColors[theme] : levelAppearance.color[theme]
  const childColors = !isDetached && childLevelAppearance ? childLevelAppearance.color[theme] : null

  const isRoot = isRootCard(card)
  // Add-actions that cannot apply here are removed outright, not greyed: a
  // root has no siblings to add above/below, and a card at level 4 (where
  // there is no level 5) has nowhere for a new "->" child to go. Only the
  // delete `x` keeps the "always present, greyed when inapplicable"
  // treatment — it is a destructive action on an existing structure, not a
  // slot for a card that cannot exist.
  // Floating cards are excluded from both: they have no sibling group (no
  // parent to add into) and may never have children — they are a scratch area,
  // and getting children back is exactly what dropping one back onto the tree
  // is for.
  const canAddSibling = !isRoot && !isDetached
  // A card that ALREADY has a child keeps the arrow: its child group is where a
  // new one goes (`addChild` appends to it), and hiding the button the moment
  // the first child existed left "add a second child" reachable only by
  // dragging a card onto its parent — the same gesture as reparenting, for a
  // different outcome.
  const canAddChild = childColors !== null
  // The root itself is never removed (single-root invariant), so its delete
  // action only makes sense while it still has descendants to empty out.
  const deleteDisabled = isRoot && !hasChildren(card.id)
  const canDetach = !isRoot && !isDetached

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

  /**
   * The card's one description action: on an editable map it opens the EDITOR,
   * whether or not a definition exists yet.
   *
   * Reading is what the eye beside it does, so this button is only ever about
   * writing — and it must be, because it is the sole way into the description
   * of a card that has none. On a LOCKED map editing is impossible, so it
   * falls back to the fiche: the one thing it can still honestly do.
   */
  function openDescription() {
    if (locked) {
      showFiche(card.id)
      return
    }
    // The EDITOR, and nothing else. It used to open the fiche as well, on the
    // reasoning that the dialog is rendered from inside the panel — which made
    // "write something down" and "read this card" the same gesture, and pushed
    // a fiche into the right panel that the user had not asked for. The panel
    // still hosts the dialog (it stays mounted, at zero width, while a card is
    // being edited); it just no longer shows anything for it.
    editFiche(card.id)
  }

  /**
   * The card's own body has exactly one job left: standing in for the answer
   * while a quiz question is pending. Reading and writing the description both
   * moved to the bottom row's own buttons (`DescriptionAction`) — a click on
   * the card elsewhere does nothing, so the eye button is the only way a
   * description reaches the right panel.
   */
  function handleCardClick() {
    if (isPending) setAnswerOpen(true)
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

  /**
   * The title field is autosized to its own content, which is what lets the
   * fixed-height zone above centre it: a one-line title is drawn as one line
   * and vertically centred, a four-line title fills the box, and nothing in
   * between can change the card height.
   *
   * jsdom reports every box as zero-sized, so the guard keeps the measurement
   * from writing a 0px height in tests.
   */
  useEffect(() => {
    const el = titleInputRef.current
    if (!el) return
    el.style.height = "auto"
    const next = el.scrollHeight + (el.offsetHeight - el.clientHeight)
    if (next > 0) el.style.height = `${next}px`
  }, [card.title, draftTitle, titleFocused])

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

  // Detaching a leaf is a one-click, reversible (undo) change of status, so it
  // happens straight away. Detaching a BRANCH also flattens it — every
  // descendant becomes its own floating card — which is a structural change
  // worth confirming, with the exact count of cards it will produce.
  function handleDetachClick() {
    if (hasChildren(card.id)) {
      setConfirmDetachOpen(true)
    } else {
      detachCard(card.id)
    }
  }

  function handleDeleteClick() {
    // A childless card is a one-click delete (undoable). As soon as there is a
    // branch under it — or the card IS the root, which survives either way —
    // the dialog asks what should happen to those descendants.
    if (descendantCount(card.id) === 0) {
      deleteCard(card.id)
    } else {
      setConfirmOpen(true)
    }
  }

  /**
   * Actions asked of this card from outside it — a keyboard shortcut, a
   * context-menu entry, the command palette.
   *
   * They land here rather than being re-implemented at canvas level because
   * each one ends in UI that belongs to the card: the inline title editor, the
   * "supprimer cette carte et ses N descendants ?" dialog with its « détacher
   * les enfants » alternative. One implementation, reached three ways, is what
   * keeps those wordings from drifting apart.
   */
  const request = useCardSelectionStore(s => s.request)
  useEffect(() => {
    if (request === null || request.cardId !== card.id) return
    // Consumed first: an action that throws must still not leave the request
    // pending, or it would re-fire on every render of this card.
    useCardSelectionStore.getState().consumeRequest(request.token)
    switch (request.action) {
      case 'rename':
        titleInputRef.current?.focus()
        break
      case 'delete':
        handleDeleteClick()
        break
      case 'detach':
        handleDetachClick()
        break
      case 'description':
        openDescription()
        break
    }
    // The handlers are re-created on every render but always act on the same
    // card; keying the effect on the request alone is what makes it fire once,
    // when the request arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, card.id])

  return (
    <CardContextMenu cardId={card.id} disabled={quizActive || locked}>
    <motion.div
      data-testid={`card-${card.id}`}
      data-reparent-target={isReparentTarget}
      data-detached={isDetached}
      data-hovered={hovered}
      data-selected={selected}
      // Publishes the hover so the fiche panel can light up the same card's
      // description (and vice-versa) — see `useCardHoverStore`.
      onMouseEnter={() => hoverCard(card.id)}
      onMouseLeave={() => unhoverCard(card.id)}
      className={[
        'card-node',
        isDetached ? 'card-node--detached' : null,
        isReparentTarget ? 'card-node--reparent-target' : null,
        isPending ? 'card-node--quiz-pending' : null,
      ]
        .filter(Boolean)
        .join(' ')}
      // The whole card is the target while it is waiting for an answer: people
      // click the thing they are being asked about, not the button under it.
      // Off a quiz, the same click opens the card's fiche — see
      // `handleCardClick`.
      onClick={handleCardClick}
      style={{
        // A card still waiting for an answer drops its level colour for a
        // neutral, deliberately EMPTY surface. That is the state it is in —
        // blank, yours to fill — and it makes "which card wants me?" readable
        // across a whole map at a glance, which a coloured card with a slightly
        // different border never was.
        background: isPending ? 'var(--quiz-pending-bg)' : toCss(colors.bg),
        color: isPending ? 'var(--quiz-pending-fg)' : toCss(colors.text),
        // Dashed: a second, colour-independent cue that this card hangs
        // outside the hierarchy (grey alone is easy to miss when zoomed out).
        border: isDetached ? '2px dashed' : '2px solid',
        borderColor: resultBorderColor ?? (isPending ? 'var(--quiz-pending-border)' : toCss(colors.border)),
        borderRadius: 8,
        // The floating "+" buttons straddle this card top and bottom edges by
        // 0.85rem, and the drag handle sits inside the top-left corner (4px of
        // offset + its 14px glyph). The paddings below are exactly the room
        // those need and nothing more: every extra pixel here is a pixel taken
        // from the title, and keeping them independent of the locked state is
        // what makes a card footprint independent of its state.
        padding: "14px 18px",
        // A fixed width, never content-driven — see CARD_WIDTH: the editor
        // title is a textarea and the quiz one is a masked div, and only a
        // width the card owns keeps the two the same size.
        width: CARD_WIDTH,
        boxSizing: 'border-box',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        // React Flow's own stylesheet puts a grab cursor on the whole
        // `.draggable` node (it only RESTRICTS the drag gesture to
        // `.card-drag-handle`, it does not restyle the rest of the node) —
        // an explicit cursor here overrides that for every part of the card
        // that is not itself interactive (buttons/handle/input set their own).
        // A card that responds to a click says so: only a pending quiz
        // question does, now that reading/writing moved to the bottom row.
        cursor: isPending ? 'pointer' : 'default',
        // The card half of the cross-highlight: a level-coloured halo drawn
        // with box-shadow, never a thicker border or a scale — the card's
        // footprint must not move because the pointer entered it (règle
        // anti-décalage 1). While the card is a reparent target its CSS pulse
        // animation wins over this inline shadow, so the drop cue is untouched.
        //
        // Selection stacks as a SECOND, wider ring in the neutral `--ring`
        // colour, listed after the hover ring so it paints behind it: the two
        // read as concentric bands (hover 0-2px, selection 2-4/0-3px) rather
        // than one fighting the other when a card is both hovered and
        // selected. Both entries are always present (falling back to
        // `transparent`) so the shared `transition` animates every edge —
        // in, out, and between the two.
        boxShadow: [
          `0 0 0 2px ${hovered ? toCss(colors.border) : 'transparent'}`,
          `0 0 0 ${hovered ? 4 : 3}px ${selected ? 'var(--ring)' : 'transparent'}`,
        ].join(', '),
        transition: 'box-shadow 140ms ease',
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
        // Grabbing the card is not clicking it: a drag that ends where it began
        // still fires a click, which must not open a fiche the user never asked
        // for.
        onClick={event => event.stopPropagation()}
        style={{
          position: 'absolute',
          top: 4,
          left: 4,
          width: 24,
          height: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '9999px',
          cursor: locked ? 'default' : 'grab',
          color: toCss(colors.border),
          visibility: locked ? 'hidden' : 'visible',
          pointerEvents: locked ? 'none' : 'auto',
        }}
      >
        <GripVertical size={18} />
      </span>

      {/*
        The one menu that used to be a whole row of ghost icon buttons pinned
        to the card's bottom edge: destructive/structural actions on a card
        that is mostly a title now live behind one corner button, so the
        bottom row is free for the description (see `DescriptionAction`).
        Hidden outright during a quiz, like the rest of the editing chrome —
        never rendered greyed, since the map is locked anyway for the whole
        quiz.
      */}
      {!quizActive && !isPending && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="card-options-btn"
              aria-label="Options"
              onClick={event => event.stopPropagation()}
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '9999px',
                border: 'none',
                // No `background` here, deliberately: an inline declaration
                // outranks every stylesheet rule, and this one used to cancel
                // the hover tint in `index.css` — the drag handle has no inline
                // background and lights up, this button did and stayed inert.
                // The transparency it needs lives in `.card-options-btn`.
                cursor: 'pointer',
                color: toCss(colors.border),
              }}
            >
              <EllipsisVertical size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={event => event.stopPropagation()}>
            {canDetach && (
              <DropdownMenuItem disabled={locked} onSelect={handleDetachClick}>
                <Unlink size={14} /> Détacher
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" disabled={locked || deleteDisabled} onSelect={handleDeleteClick}>
              <Trash2 size={14} /> Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {canAddSibling && (
        <span style={{ visibility: locked ? 'hidden' : 'visible' }}>
          <EdgeButton
            label="Ajouter au-dessus"
            icon={Plus}
            color={toCss(colors.border)}
            disabled={false}
            onActivate={() => addSibling(card.id, 'above')}
            position={{ top: '-0.85rem', left: '50%', x: '-50%' }}
          />
        </span>
      )}

      {canAddSibling && (
        <span style={{ visibility: locked ? 'hidden' : 'visible' }}>
          <EdgeButton
            label="Ajouter en dessous"
            icon={Plus}
            color={toCss(colors.border)}
            disabled={false}
            onActivate={() => addSibling(card.id, 'below')}
            position={{ bottom: '-0.85rem', left: '50%', x: '-50%' }}
          />
        </span>
      )}

      {canAddChild && (
        <span style={{ visibility: locked ? 'hidden' : 'visible' }}>
          <EdgeButton
            label="Ajouter un enfant"
            icon={ArrowRight}
            color={toCss((childColors ?? colors).border)}
            disabled={false}
            onActivate={() => addChild(card.id)}
            position={{ right: '-0.85rem', top: '50%', y: '-50%' }}
          />
        </span>
      )}

      {/*
        Always an <input>, never swapped for a <span>: the two elements
        default to different intrinsic sizes (padding, line-height), so
        toggling between them made the card visibly resize the instant
        editing started. Unfocused, it is styled to be indistinguishable
        from plain text (transparent border/background); focus alone reveals
        the editable affordance, at a border-width that matches both states
        so revealing it never shifts the layout either.
      */}
      {/*
        Two different things live in this slot, and they must not be the same
        widget. In the editor the title is an input you type into. During a
        quiz it is a QUESTION: the map is locked, the answer belongs in the
        answer dialog, and an editable-looking field there only invited people
        to type into a card that would never grade what they wrote.
      */}
      <div data-testid="title-zone" className="nowheel" style={TITLE_ZONE_STYLE}>
        {quiz ? (
          <div
            data-testid="quiz-title"
            style={{
              ...TITLE_BOX_STYLE,
              // Longer than TITLE_LINES lines simply overflows into the
              // scrollable TITLE_ZONE_STYLE box around it (same treatment as
              // the editor textarea below), rather than clamping to an
              // ellipsis that would hide part of the question for good.
              fontFamily: displayMasked ? 'ui-monospace, monospace' : 'inherit',
              letterSpacing: displayMasked ? '0.12em' : undefined,
              fontWeight: displayMasked ? 700 : 'inherit',
              // Not muted: the blank is the thing to look at on this card, and a
              // greyed-out placeholder read as "disabled" rather than "your turn".
              color: 'inherit',
              wordBreak: 'break-word',
            }}
          >
            {displayMasked ? (blankPreview ?? '? ? ?') : card.title}
          </div>
        ) : (
          <textarea
            ref={titleInputRef}
            aria-label="Titre"
            rows={1}
            readOnly={locked}
            value={titleFocused ? draftTitle : card.title}
            onFocus={handleTitleFocus}
            onChange={e => setDraftTitle(e.target.value)}
            onBlur={commitTitle}
            // Stops the right-click from reaching the canvas's context menu
            // (MindMapCanvas.tsx wraps the whole ReactFlow surface in one), so
            // a right-click here still opens the WebView's native Cut/Copy/Paste
            // menu instead of "Créer une carte volante".
            onContextMenu={e => e.stopPropagation()}
            onKeyDown={e => {
              // The title has no manual line breaks — it wraps by width alone,
              // same as the export's plain block text — so Enter still commits
              // instead of inserting a newline.
              if (e.key === 'Enter') {
                e.preventDefault()
                titleInputRef.current?.blur()
              }
              if (e.key === 'Escape') cancelTitle()
            }}
            style={{
              ...TITLE_BOX_STYLE,
              resize: 'none',
              color: 'inherit',
              background: titleFocused ? 'rgba(0, 0, 0, 0.04)' : 'transparent',
              border: `2px solid ${titleFocused ? toCss(colors.border) : 'transparent'}`,
              outline: 'none',
              cursor: 'text',
              transition: 'background 0.15s ease, border-color 0.15s ease',
            }}
          />
        )}
      </div>


      {/* A quiz card that has been answered keeps its verdict visible: the
          border alone is easy to miss at a glance across a whole map. */}
      {quiz && quiz.result !== 'unanswered' && (
        <span
          aria-label={quiz.result === 'correct' ? 'Bonne réponse' : 'Mauvaise réponse'}
          style={{
            position: 'absolute',
            top: -10,
            right: -10,
            width: 22,
            height: 22,
            borderRadius: '9999px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: quiz.result === 'correct' ? '#16a34a' : '#dc2626',
            color: '#fff',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.25)',
          }}
        >
          {quiz.result === 'correct' ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}
        </span>
      )}

      {/*
        Mounted only while open: `descendantCount` is an O(n) walk of the whole
        card list and used to be called on every render of every card.
      */}
      {confirmOpen && (
        <Dialog open onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {isRoot
                  ? `Supprimer les ${descendantCount(card.id)} descendants de la carte racine ?`
                  : `Supprimer cette carte et ses ${descendantCount(card.id)} descendants ?`}
              </DialogTitle>
            </DialogHeader>
            <p style={{ margin: 0, fontSize: 14 }}>
              {isRoot && 'La carte racine ne peut pas être supprimée : elle sera conservée. '}
              <strong>Tout supprimer</strong> retire {isRoot ? 'ses' : 'la carte et ses'}{' '}
              {descendantCount(card.id)} descendants du graphe.{' '}
              <strong>Détacher les enfants</strong>{' '}
              {isRoot ? 'conserve ses descendants' : 'ne supprime que cette carte et conserve ses descendants'} :
              ils sont aplatis et deviennent {descendantCount(card.id)} cartes volantes individuelles.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Annuler
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  deleteCardDetachingChildren(card.id)
                  setConfirmOpen(false)
                }}
              >
                Détacher les enfants
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  deleteCard(card.id)
                  setConfirmOpen(false)
                }}
              >
                Tout supprimer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/*
        Same mount-only-when-open trick as the delete dialog above:
        `flattenedCount` walks the whole card list.
      */}
      {confirmDetachOpen && (
        <Dialog open onOpenChange={setConfirmDetachOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Détacher cette carte et aplatir sa structure ?</DialogTitle>
            </DialogHeader>
            <p style={{ margin: 0, fontSize: 14 }}>
              Cette action va aplatir la structure : cette carte et ses {descendantCount(card.id)} descendants
              perdront leurs liens de parenté et deviendront {flattenedCount(card.id)} cartes volantes
              individuelles. Les cartes volantes ne peuvent pas avoir d’enfants ; glissez-en une sur la carte
              mentale pour la rattacher.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDetachOpen(false)}>
                Annuler
              </Button>
              {/* Focused on open, visibly — not just Radix's default focus on
                  « Annuler » — so the ring shows which action Entrée will
                  trigger, and Entrée actually triggers it. */}
              <Button
                autoFocus
                onClick={() => {
                  detachCard(card.id)
                  setConfirmDetachOpen(false)
                }}
              >
                Accepter
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/*
        The bottom row is hidden outright during a quiz, on every card — not
        just the drawn ones — and replaced by the answer prompt. Both branches
        share `ACTION_SLOT_STYLE`/`.card-footer`, so a card mid-quiz and the
        same card back in edit mode keep exactly the same height.
      */}
      {(quizActive || isPending) ? (
        /* The action slot, rendered on every card as soon as a quiz is on, so
           a card that has already been answered keeps the same height as one
           that is still asking. */
        <div className="card-footer" style={ACTION_SLOT_STYLE}>
          {isPending && (
            <Button
              size="sm"
              data-testid="answer-button"
              onClick={event => {
                event.stopPropagation()
                setAnswerOpen(true)
              }}
            >
              {quiz?.type === 'recall' ? <PenLine /> : <ListChecks />}
              Répondre
            </Button>
          )}
        </div>
      ) : (
        <DescriptionAction
          card={card}
          locked={locked}
          ficheOpen={ficheOpen}
          borderColor={toCss(colors.border)}
          onEdit={openDescription}
          onView={() => showFiche(card.id)}
        />
      )}

      {isQcmPending && (
        <QcmDialog
          open={answerOpen}
          heading={
            quiz.type === 'qcm-definition' || quiz.type === 'qcm-media'
              ? card.title
              : quiz.type === 'qcm-media-title'
                ? headingForMediaTitle(contentOf(card))
                : 'Quel est le titre de cette carte ?'
          }
          hint={quiz.type === 'qcm-title' ? quiz.hint : undefined}
          hintNode={
            // A media title question is asked from the media itself, at every
            // difficulty — never from the card's place in the tree.
            quiz.type === 'qcm-media-title' ? (
              <BlockView blocks={contentOf(card)} resolveAsset={resolveAsset} highlightKeywords={false} />
            ) : undefined
          }
          correctOption={
            quiz.type === 'qcm-definition' || quiz.type === 'qcm-media' ? (card.definition ?? '') : card.title
          }
          distractors={
            quiz.type === 'qcm-definition' || quiz.type === 'qcm-media'
              ? (quiz.distractorDefinitions ?? [])
              : (quiz.distractorTitles ?? [])
          }
          // Definition/media options are cards' plain-text mirrors, so a
          // formula question would otherwise offer « 20/100 × 425 » while the
          // card itself shows a stacked fraction, and a table question would
          // offer a flattened string instead of an actual table. The string
          // stays the identity — grading and pool dedupe still compare it —
          // and only the display is resolved back to the source blocks.
          // `highlightKeywords={false}`/`stripHighlightMarkers`: no option is
          // ever visually richer than another because of **markup** rather
          // than content — see the design spec. Titles get no resolver, they
          // are the quiz's comparison key and never carry markers.
          renderOption={
            quiz.type === 'qcm-definition' || quiz.type === 'qcm-media'
              ? option => {
                  const source = allCards.find(c => c.definition === option)
                  return source && source.content !== undefined ? (
                    <BlockView blocks={contentOf(source)} resolveAsset={resolveAsset} highlightKeywords={false} />
                  ) : (
                    stripHighlightMarkers(option)
                  )
                }
              : undefined
          }
          onAnswer={chosen => {
            if (quiz.type === 'qcm-definition' || quiz.type === 'qcm-media') answerQcmDefinition(card.id, chosen)
            else answerQcmTitle(card.id, chosen)
            setAnswerOpen(false)
          }}
          onCancel={() => setAnswerOpen(false)}
        />
      )}

      {/* Mounted only while open, so each visit starts from a clean field
          rather than resuming the letters left from the last time this card
          was opened and closed without answering. */}
      {isRecallPending && answerOpen && (
        <RecallDialog
          open
          title={card.title}
          parentTitle={allCards.find(c => c.id === card.parentId)?.title}
          difficulty={quizDifficulty}
          progress={recallProgress ?? EMPTY_RECALL_PROGRESS}
          liveFeedback={liveLetterFeedback}
          onSubmit={answer => submitRecall(card.id, answer, similarityThreshold)}
          onGiveUp={() => revealRecallAnswer(card.id)}
          onClose={() => setAnswerOpen(false)}
        />
      )}

      <Handle type="source" position={Position.Right} isConnectable={false} style={{ visibility: 'hidden' }} />
    </motion.div>
    </CardContextMenu>
  )
}
