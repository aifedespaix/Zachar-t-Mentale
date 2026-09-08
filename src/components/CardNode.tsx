import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Plus,
  ArrowRight,
  GripVertical,
  AlignLeft,
  FlipHorizontal2,
  Unlink,
  Trash2,
  Check,
  X,
  PenLine,
  ListChecks,
  type LucideIcon,
} from 'lucide-react'
import type { Card, CardLevel } from '../types/card'
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
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { QcmDialog } from './quiz/QcmDialog'
import { RecallDialog } from './quiz/RecallDialog'
import { FlipCard } from './FlipCard'
import { DefinitionPopover } from './DefinitionPopover'
import { contentOf } from '../content/blocks'
import { BlockView } from '../content/BlockView'
import { imageBlockFrom } from '../content/imageBlock'
import { pickImageFile } from '../content/pickImage'
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
  const isQcmPending = (quiz?.type === 'qcm-definition' || quiz?.type === 'qcm-title') && isPending
  // `qcm-title` asks the user to pick the title out of four options, so showing
  // it on the card would hand them the answer; `qcm-definition` shows its title
  // (that IS the question) and hides nothing.
  const displayMasked = isPending && (quiz?.type === 'recall' || quiz?.type === 'qcm-title')
  const resultBorderColor = quiz?.result === 'correct' ? '#16a34a' : quiz?.result === 'incorrect' ? '#dc2626' : undefined

  // The shape of the answer, drawn on the card itself: same letters as the
  // answer dialog will show, so the card is a genuine preview of the question
  // rather than a separate riddle. Only for typed answers — on a multiple
  // choice it would narrow the four options down for free.
  const blankPreview =
    isRecallPending && lengthGuideEnabled
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
  const updateDefinition = useCardsStore(s => s.updateDefinition)
  const updateContent = useCardsStore(s => s.updateContent)
  const allCards = useCardsStore(s => s.history.present)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const setWorkspaceError = useWorkspaceStore(s => s.setWorkspaceError)
  const addChild = useCardsStore(s => s.addChild)
  const addSibling = useCardsStore(s => s.addSibling)
  const deleteCard = useCardsStore(s => s.deleteCard)
  const deleteCardDetachingChildren = useCardsStore(s => s.deleteCardDetachingChildren)
  const detachCard = useCardsStore(s => s.detachCard)
  const flattenedCount = useCardsStore(s => s.flattenedCount)
  const descendantCount = useCardsStore(s => s.descendantCount)
  const hasChildren = useCardsStore(s => s.hasChildren)
  const locked = useCardsStore(s => s.locked)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [titleFocused, setTitleFocused] = useState(false)
  const [draftTitle, setDraftTitle] = useState(card.title)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmDetachOpen, setConfirmDetachOpen] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [editingDefinition, setEditingDefinition] = useState(false)
  const [draftDefinition, setDraftDefinition] = useState(card.definition ?? '')
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
    if (locked) return
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
            <input
              ref={titleInputRef}
              aria-label="Titre"
              readOnly={locked}
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
        {/* `margin-top: auto` in the card's flex column keeps this pinned to
            the bottom of the card regardless of title length or whether the
            definition text below it is shown. */}
        <div className="card-footer" style={{ display: 'flex', gap: '0.25rem', marginTop: 'auto' }}>
          {/* `contentOf` rather than `card.definition`: a card whose whole
              definition is a picture has blocks but, defensively, might not
              have text — it must still get the popover, not the "add" button. */}
          {contentOf(card).length > 0 ? (
            <DefinitionPopover
              blocks={contentOf(card)}
              locked={locked}
              onCommit={blocks => updateContent(card.id, blocks)}
              // Assets live in a sidecar named after the open file, so every
              // image capability is gated on there being one. With no file
              // open the affordances stay hidden rather than failing on click.
              resolveAsset={currentFilePath ? asset => assetSrc(currentFilePath, asset) : undefined}
              onInsertImage={
                currentFilePath ? source => imageBlockFrom(currentFilePath, source) : undefined
              }
              onPickImage={
                currentFilePath
                  ? async () => {
                      const source = await pickImageFile()
                      return source === null ? undefined : imageBlockFrom(currentFilePath, source)
                    }
                  : undefined
              }
              onError={setWorkspaceError}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Ajouter une définition"
                  disabled={locked}
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

      {isQcmPending && (
        <QcmDialog
          open={answerOpen}
          heading={quiz.type === 'qcm-definition' ? card.title : 'Quel est le titre de cette carte ?'}
          hint={quiz.type === 'qcm-title' ? quiz.hint : undefined}
          noHintNote={
            quiz.type === 'qcm-title' && !quiz.hint ? 'Aide-toi de la position de la carte dans l’arbre.' : undefined
          }
          correctOption={quiz.type === 'qcm-definition' ? (card.definition ?? '') : card.title}
          distractors={quiz.type === 'qcm-definition' ? (quiz.distractorDefinitions ?? []) : (quiz.distractorTitles ?? [])}
          // Definition options are cards' plain-text mirrors, so a formula
          // question would otherwise offer « 20/100 × 425 » while the card
          // itself shows a stacked fraction. The string stays the identity —
          // grading and pool dedupe still compare it — and only the display is
          // resolved back to the source blocks. Titles are plain by design
          // (they are the quiz's comparison key), so they get no resolver.
          renderOption={
            quiz.type === 'qcm-definition'
              ? option => {
                  const source = allCards.find(c => c.definition === option)
                  return source && source.content !== undefined ? (
                    <BlockView blocks={contentOf(source)} resolveAsset={() => ''} />
                  ) : (
                    option
                  )
                }
              : undefined
          }
          onAnswer={chosen => {
            if (quiz.type === 'qcm-definition') answerQcmDefinition(card.id, chosen)
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
