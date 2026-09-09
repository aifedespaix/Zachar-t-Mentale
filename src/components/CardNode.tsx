import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Plus,
  ArrowRight,
  GripVertical,
  FlipHorizontal2,
  Unlink,
  Trash2,
  Check,
  X,
  PenLine,
  ListChecks,
  Sparkles,
  BookOpen,
  type LucideIcon,
} from 'lucide-react'
import type { Card, CardLevel } from '../types/card'
import type { CardBlock, CardBlockKind } from '../types/cardBlock'
import { isRootCard } from '../types/card'
import type { QuizQuestionType, QuizResult } from '../types/quiz'
import { EMPTY_RECALL_PROGRESS } from '../types/quiz'
import { useCardsStore } from '../state/useCardsStore'
import { useQuizStore } from '../state/useQuizStore'
import { useQuizSettingsStore } from '../state/useQuizSettingsStore'
import { revealedSet, slotsOf } from '../quiz/blanks'
import { clampCardLevel, detachedColors } from '../colors/levelColors'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'
import { useResolvedTheme } from '../hooks/useResolvedTheme'
import { toCss } from '../colors/contrast'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { CardIconBadge } from './CardIconBadge'
import { IconPickerDialog } from './IconPickerDialog'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { QcmDialog } from './quiz/QcmDialog'
import { RecallDialog } from './quiz/RecallDialog'
import { FlipCard } from './FlipCard'
import { useCardDetailStore } from '../state/useCardDetailStore'
import { CONTENT_KIND_ICONS } from '../content/ContentKindBadges'
import { contentOf, nonTextKinds } from '../content/blocks'
import { BlockView } from '../content/BlockView'
import { stripHighlightMarkers } from '../content/highlight'
import { assetSrc } from '../persistence/assets'
import { useWorkspaceStore } from '../state/useWorkspaceStore'

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
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * The card's one door into its fiche — a fixed-size badge, not a text
 * preview: `règle anti-décalage 1` (a card's footprint never depends on its
 * content) is easier to keep with NO content-dependent sizing at all than
 * with an ellipsed line. Position and colour read as an ACTION (bottom-right,
 * the card's own level colour), distinct from the emoji identity badge
 * (top-right, inset) and from the ghost footer row (Détacher/Retourner/
 * Supprimer) it sits just outside of.
 */
function FicheBadge({
  card,
  locked,
  active,
  borderColor,
  onActivate,
}: {
  card: Card
  locked: boolean
  active: boolean
  borderColor: string
  onActivate: () => void
}) {
  const blocks = contentOf(card)
  const hasContent = blocks.length > 0
  // Not gated on `card.kind === 'media'`: a plain definition can still lead
  // with a formula, table or image block, and the badge should say so the
  // same way a media card does — `nonTextKinds` already reads the actual
  // blocks, independent of the card's own kind field.
  const dominant = nonTextKinds(blocks)[0]
  // Two different verbs need two different glyphs: a card with nothing yet
  // is an invitation to WRITE (pen), one that already has content is an
  // invitation to READ it (its content-kind icon, or an open book for plain
  // text). Sharing one icon between "add" and "view" — as this used to —
  // left opacity as the only distinguishing cue, which broke the moment the
  // badge needed an opaque background (see below).
  const Icon = dominant ? CONTENT_KIND_ICONS[dominant].icon : hasContent ? BookOpen : PenLine
  const label = !hasContent ? 'Ajouter une description' : card.kind === 'media' ? 'Afficher le média' : 'Afficher la définition'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={locked && !hasContent}
          onClick={event => {
            event.stopPropagation()
            onActivate()
          }}
          style={{
            position: 'absolute',
            bottom: -9,
            right: -9,
            width: 24,
            height: 24,
            borderRadius: '9999px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1.5px solid ${borderColor}`,
            // Always fully opaque: this badge straddles the card's own
            // border (bottom/right: -9), so a translucent background (the
            // old `opacity: hasContent ? 1 : 0.55` applied to the whole
            // button) let that border show through underneath it. The
            // "not filled in yet" cue now lives in the icon choice and the
            // dimmer icon below, not in the badge's own transparency.
            background: 'var(--background)',
            color: borderColor,
            boxShadow: hasContent ? '0 1px 3px rgba(0, 0, 0, 0.15)' : 'none',
            cursor: locked && !hasContent ? 'default' : 'pointer',
          }}
        >
          <Icon size={13} strokeWidth={2.3} style={{ opacity: hasContent ? 1 : 0.6 }} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const MEDIA_TITLE_HEADINGS: Record<Exclude<CardBlockKind, 'text'>, string> = {
  table: 'À quel titre correspond ce tableau ?',
  math: 'À quel titre correspond cette formule ?',
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
  const updateIcon = useCardsStore(s => s.updateIcon)
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
  const locked = useCardsStore(s => s.locked)
  const titleInputRef = useRef<HTMLTextAreaElement>(null)
  const [titleFocused, setTitleFocused] = useState(false)
  const [draftTitle, setDraftTitle] = useState(card.title)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmDetachOpen, setConfirmDetachOpen] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const showFiche = useCardDetailStore(s => s.show)
  const editFiche = useCardDetailStore(s => s.setEditing)
  const ficheOpen = useCardDetailStore(s => s.open.some(entry => entry.cardId === card.id))
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
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
  // root has no siblings to add above/below, and a card that already has a
  // child (or sits at level 4, where there is no level 5) has nowhere for a
  // new "->" child to go. Only the delete `x` keeps the "always present,
  // greyed when inapplicable" treatment — it is a destructive action on an
  // existing structure, not a slot for a card that cannot exist.
  // Floating cards are excluded from both: they have no sibling group (no
  // parent to add into) and may never have children — they are a scratch area,
  // and getting children back is exactly what dropping one back onto the tree
  // is for.
  const canAddSibling = !isRoot && !isDetached
  const canAddChild = childColors !== null && !hasChildren(card.id)
  // The root itself is never removed (single-root invariant), so its delete
  // action only makes sense while it still has descendants to empty out.
  const deleteDisabled = isRoot && !hasChildren(card.id)
  const canDetach = !isRoot && !isDetached
  // The icon slot is only a control while the map can actually be edited; on a
  // locked map or mid-quiz it degrades to a plain, unclickable badge.
  const iconSlotInteractive = !locked && !quizActive

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
   * The card's one description action, in both its states.
   *
   * A card with a description OPENS its fiche — reading is the common case, and
   * the fiche is where the whole thing fits. A card without one goes straight
   * to the editor: there is nothing to read, and making the user open an empty
   * panel to find an "add" button would be a click spent on nothing.
   */
  function openDescription() {
    showFiche(card.id)
    if (!locked && contentOf(card).length === 0) editFiche(card.id)
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

  return (
    <motion.div
      data-testid={`card-${card.id}`}
      data-flipped={flipped}
      data-reparent-target={isReparentTarget}
      data-detached={isDetached}
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
      onClick={isPending ? () => setAnswerOpen(true) : undefined}
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
        // A card awaiting an answer is itself the click target, so it says so.
        cursor: isPending ? 'pointer' : 'default',
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
          color: toCss(colors.border),
          visibility: locked ? 'hidden' : 'visible',
          pointerEvents: locked ? 'none' : 'auto',
        }}
      >
        <GripVertical size={14} />
      </span>

      {/*
        The mnemonic icon, pinned to the card's top-right corner.

        Three states in one slot: a card that HAS an icon always shows it —
        including while locked and during a quiz, where the picture is exactly
        the memory hook the card is meant to trigger — and only becomes
        clickable (to change or remove it) when the map is editable. A card
        with no icon shows a faint placeholder instead, and only while editing:
        an empty affordance is clutter on a locked map and noise during a quiz.
      */}
      {iconSlotInteractive ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-testid="card-icon-button"
                aria-label={card.icon ? 'Changer l’icône' : 'Ajouter une icône'}
                onClick={event => {
                  event.stopPropagation()
                  setIconPickerOpen(true)
                }}
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  display: 'flex',
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  // A card with no icon yet only hints at the slot; picking one
                  // is an option, not something the card is asking for.
                  opacity: card.icon ? 1 : 0.4,
                  lineHeight: 0,
                }}
              >
                <CardIconBadge name={card.icon} fallback={Sparkles} border={colors.border} theme={theme} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{card.icon ? 'Changer l’icône' : 'Ajouter une icône'}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        card.icon !== undefined && (
          <span style={{ position: 'absolute', top: 4, right: 4, lineHeight: 0 }}>
            <CardIconBadge name={card.icon} border={colors.border} theme={theme} />
          </span>
        )
      )}

      {iconPickerOpen && (
        <IconPickerDialog
          open
          onOpenChange={setIconPickerOpen}
          current={card.icon}
          border={colors.border}
          theme={theme}
          onSelect={icon => updateIcon(card.id, icon)}
        />
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
      {quiz ? (
        <div
          data-testid="quiz-title"
          style={{
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
        <FlipCard
          flipped={flipped}
          front={
            <textarea
              ref={titleInputRef}
              aria-label="Titre"
              rows={2}
              readOnly={locked}
              value={titleFocused ? draftTitle : card.title}
              onFocus={handleTitleFocus}
              onChange={e => setDraftTitle(e.target.value)}
              onBlur={commitTitle}
              // Stops the right-click from reaching the canvas's context menu
              // (MindMapCanvas.tsx wraps the whole ReactFlow surface in one),
              // so a right-click here still opens the WebView's native
              // Cut/Copy/Paste menu instead of "Créer une carte volante".
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
                display: 'block',
                width: '100%',
                resize: 'none',
                font: 'inherit',
                lineHeight: 1.2,
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
          }
          back={
            <div
              style={{
                width: '100%',
                height: '100%',
                minHeight: '1.4rem',
                borderRadius: 4,
                background: toCss(colors.border),
              }}
            />
          }
        />
      )}

      {/* The card's own answer button, rather than one more icon in the footer
          row: on a card that is waiting for you, "répondre" is the only thing
          there is to do, and it should look like it. */}
      {isPending && (
        <Button
          size="sm"
          data-testid="answer-button"
          onClick={event => {
            event.stopPropagation()
            setAnswerOpen(true)
          }}
          style={{ width: '100%', marginTop: 2 }}
        >
          {quiz?.type === 'recall' ? <PenLine /> : <ListChecks />}
          Répondre
        </Button>
      )}

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
              <Button
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
        The editing toolbar is hidden outright during a quiz, on every card —
        not just the drawn ones. Add, detach, delete and flip are all edits,
        the map is locked anyway, and a row of dead-looking icons under a
        question is exactly the clutter that made it unclear what the card
        wanted. What remains is the question and the way to answer it.
      */}
      {!quizActive && (
      <TooltipProvider>
        <FicheBadge card={card} locked={locked} active={ficheOpen} borderColor={toCss(colors.border)} onActivate={openDescription} />

        {/* `margin-top: auto` in the card's flex column keeps this pinned to
            the bottom of the card regardless of title length. */}
        <div className="card-footer" style={{ display: 'flex', gap: '0.25rem', marginTop: 'auto' }}>
          {canDetach && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Détacher"
                  disabled={locked}
                  onClick={handleDetachClick}
                >
                  <Unlink />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Détacher (carte volante)</TooltipContent>
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

          {/* Destructive action last in the row, and greyed rather than removed
              on the root: the root is an existing card that cannot be deleted,
              not a slot for something that cannot exist. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Supprimer"
                disabled={locked || deleteDisabled}
                onClick={handleDeleteClick}
              >
                <Trash2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isRoot ? 'Supprimer les descendants' : 'Supprimer'}
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
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
            // `quiz.hint !== undefined` is a proxy for "difficulty allows a hint",
            // since `buildHint` returns undefined exactly on difficulty
            // "difficile" or when the card has no definition at all. A media
            // card whose plain-text mirror happens to be empty (e.g. a table
            // with no header/rows) also gets `hint === undefined` and loses its
            // media hint even at "facile"/"moyen" — a rare, degenerate case not
            // worth a separate flag.
            quiz.type === 'qcm-media-title' && quiz.hint !== undefined ? (
              <BlockView blocks={contentOf(card)} resolveAsset={resolveAsset} highlightKeywords={false} />
            ) : undefined
          }
          noHintNote={
            (quiz.type === 'qcm-title' || quiz.type === 'qcm-media-title') && !quiz.hint
              ? 'Aide-toi de la position de la carte dans l’arbre.'
              : undefined
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
  )
}
