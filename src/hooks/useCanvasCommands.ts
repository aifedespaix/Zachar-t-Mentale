import { useCallback, useMemo } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { Card } from '../types/card'
import { canReceiveChildren, isRootCard } from '../types/card'
import { useCardsStore } from '../state/useCardsStore'
import { useCardSelectionStore } from '../state/useCardSelectionStore'
import { useCardClipboardStore } from '../state/useCardClipboardStore'
import { useCardDetailStore } from '../state/useCardDetailStore'
import { useQuizStore } from '../state/useQuizStore'
import { childrenOf, siblingsOf } from '../state/cardsReducer'
import { useCommand } from './useCommand'

/** Card-level zoom step, matching React Flow's own keyboard/button increments. */
const ZOOM_DURATION_MS = 180

interface CanvasCommandsOptions {
  cards: Card[]
  locked: boolean
  /** Centres the viewport on a card — the canvas already has the layout to do it. */
  focusCard: (cardId: string) => void
  /**
   * Selects a card (or clears the selection with `null`).
   *
   * Supplied by the canvas because selection belongs to React Flow: writing it
   * anywhere else would leave the outline on one card and the shortcuts acting
   * on another.
   */
  selectCard: (cardId: string | null) => void
  /**
   * Called just before an action that adds SEVERAL cards at once (paste,
   * duplicate). The canvas opens the title editor of any card it sees appear;
   * for a pasted branch that would put a ready-made title into overwrite mode,
   * one keystroke away from being destroyed.
   */
  suppressAutoEdit: () => void
}

/**
 * Registers every command the mind map canvas owns.
 *
 * Lives in the canvas because that is where the pieces are: the card list, the
 * selection, and React Flow's viewport. Registration is what makes each action
 * reachable from all three entry points at once — a keyboard shortcut, a
 * context-menu entry, a toolbar button — without any of them knowing how the
 * others are wired.
 */
export function useCanvasCommands({
  cards,
  locked,
  focusCard,
  selectCard,
  suppressAutoEdit,
}: CanvasCommandsOptions): void {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow()
  const selectedCardId = useCardSelectionStore(s => s.selectedCardId)
  const requestAction = useCardSelectionStore(s => s.requestAction)
  const clipboard = useCardClipboardStore(s => s.branch)
  const copyToClipboard = useCardClipboardStore(s => s.copy)

  const canUndo = useCardsStore(s => s.history.past.length > 0)
  const canRedo = useCardsStore(s => s.history.future.length > 0)
  // Undo/redo live here rather than in the header for the same reason as every
  // other card command: this is where the card history is. It also means the
  // canvas's own right-click menu keeps working when the header is not on
  // screen. No card may change under a quiz, so both go away while one runs.
  const quizActive = useQuizStore(s => s.active)

  const selected = useMemo(
    () => (selectedCardId === null ? null : (cards.find(card => card.id === selectedCardId) ?? null)),
    [cards, selectedCardId]
  )
  const editable = !locked && selected !== null

  /** Selects a card AND brings it into view — arrow navigation is useless if the card is off-screen. */
  const goTo = useCallback(
    (cardId: string) => {
      selectCard(cardId)
      focusCard(cardId)
    },
    [focusCard, selectCard]
  )

  useCommand('edit.undo', () => useCardsStore.getState().undo(), canUndo && !locked && !quizActive)
  useCommand('edit.redo', () => useCardsStore.getState().redo(), canRedo && !locked && !quizActive)

  // ── Création ──────────────────────────────────────────────────────────────

  useCommand(
    'card.addChild',
    () => {
      if (selected === null) return
      useCardsStore.getState().addChild(selected.id)
    },
    editable && selected !== null && canReceiveChildren(selected)
  )

  useCommand(
    'card.addSiblingBelow',
    () => {
      if (selected === null) return
      useCardsStore.getState().addSibling(selected.id, 'below')
    },
    editable && selected !== null && !isRootCard(selected) && selected.detached !== true
  )

  useCommand(
    'card.addSiblingAbove',
    () => {
      if (selected === null) return
      useCardsStore.getState().addSibling(selected.id, 'above')
    },
    editable && selected !== null && !isRootCard(selected) && selected.detached !== true
  )

  useCommand('card.addFloating', () => useCardsStore.getState().addFloatingCard(), !locked)

  // ── Presse-papiers ────────────────────────────────────────────────────────

  const copySelection = useCallback(() => {
    if (selectedCardId === null) return false
    const branch = useCardsStore.getState().copyBranch(selectedCardId)
    if (branch === null) return false
    copyToClipboard(branch)
    return true
  }, [copyToClipboard, selectedCardId])

  useCommand('edit.copy', copySelection, selected !== null)

  useCommand(
    'edit.cut',
    () => {
      if (selected === null) return
      // Copy FIRST: a failed extraction must not leave the card deleted with
      // nothing in the clipboard to paste back.
      if (!copySelection()) return
      useCardsStore.getState().deleteCard(selected.id)
      selectCard(null)
    },
    editable && selected !== null && !isRootCard(selected)
  )

  useCommand(
    'edit.paste',
    () => {
      const branch = useCardClipboardStore.getState().branch
      if (branch === null) return
      // A card that cannot take children (level 4, or a floating card) is not a
      // refusal: the branch goes to the floating zone, where it stays reachable
      // and can be dragged back onto the tree.
      const parentId = selected !== null && canReceiveChildren(selected) ? selected.id : null
      suppressAutoEdit()
      const { newCardId } = useCardsStore.getState().pasteBranch(branch, parentId)
      goTo(newCardId)
    },
    !locked && clipboard !== null
  )

  useCommand(
    'edit.duplicateCard',
    () => {
      if (selected === null) return
      suppressAutoEdit()
      const newCardId = useCardsStore.getState().duplicateCard(selected.id)
      goTo(newCardId)
    },
    editable && selected !== null && !isRootCard(selected)
  )

  useCommand(
    'edit.copyBranchText',
    () => {
      if (selectedCardId === null) return
      const text = useCardsStore.getState().branchText(selectedCardId)
      // Best-effort: the system clipboard needs a secure context and a user
      // gesture, and a rejected write must not take the keystroke down with it.
      void navigator.clipboard?.writeText(text).catch(() => {})
    },
    selected !== null
  )

  // ── Actions déléguées à la carte (dialogues de confirmation compris) ───────

  useCommand('edit.rename', () => selected && requestAction(selected.id, 'rename'), editable)
  useCommand('edit.delete', () => selected && requestAction(selected.id, 'delete'), editable)
  useCommand(
    'card.detach',
    () => selected && requestAction(selected.id, 'detach'),
    editable && selected !== null && !isRootCard(selected) && selected.detached !== true
  )
  useCommand('card.pickIcon', () => selected && requestAction(selected.id, 'icon'), editable)
  useCommand(
    'card.editDescription',
    () => selected && requestAction(selected.id, 'description'),
    editable
  )

  useCommand(
    'card.openFiche',
    () => selectedCardId !== null && useCardDetailStore.getState().show(selectedCardId),
    selected !== null
  )

  // ── Réorganisation ────────────────────────────────────────────────────────

  const siblings = useMemo(
    () => (selectedCardId === null ? [] : siblingsOf(cards, selectedCardId)),
    [cards, selectedCardId]
  )
  const positionInGroup = siblings.findIndex(card => card.id === selectedCardId)

  useCommand(
    'card.moveUp',
    () => selectedCardId && useCardsStore.getState().moveCardToIndex(selectedCardId, positionInGroup - 1),
    editable && positionInGroup > 0
  )

  useCommand(
    'card.moveDown',
    () => selectedCardId && useCardsStore.getState().moveCardToIndex(selectedCardId, positionInGroup + 1),
    editable && positionInGroup >= 0 && positionInGroup < siblings.length - 1
  )

  const parent = useMemo(
    () => (selected?.parentId ? (cards.find(card => card.id === selected.parentId) ?? null) : null),
    [cards, selected]
  )
  // Promoting means "become your parent's sibling", which only exists when the
  // parent itself has a parent — a level-2 card cannot rise beside the root.
  const promoteTargetId = parent !== null && parent.parentId !== null && !parent.detached ? parent.parentId : null
  // Demoting means "become the child of the card just above you", the standard
  // outliner gesture. The previous sibling has to be able to take children.
  const demoteTarget = positionInGroup > 0 ? siblings[positionInGroup - 1] : undefined

  useCommand(
    'card.promote',
    () => {
      if (selectedCardId === null || promoteTargetId === null || parent === null) return
      // Right after the parent, so the card stays where the eye expects it
      // rather than jumping to the end of its new sibling group.
      const grandChildren = siblingsOf(cards, parent.id)
      const parentPosition = grandChildren.findIndex(card => card.id === parent.id)
      useCardsStore.getState().moveCard(selectedCardId, promoteTargetId, parentPosition + 1)
    },
    editable && promoteTargetId !== null && selected?.detached !== true
  )

  useCommand(
    'card.demote',
    () => {
      if (selectedCardId === null || demoteTarget === undefined) return
      useCardsStore.getState().moveCard(selectedCardId, demoteTarget.id)
    },
    editable && demoteTarget !== undefined && canReceiveChildren(demoteTarget) && selected?.detached !== true
  )

  // ── Navigation ────────────────────────────────────────────────────────────

  const children = useMemo(
    () => (selectedCardId === null ? [] : childrenOf(cards, selectedCardId)),
    [cards, selectedCardId]
  )
  const rootCard = useMemo(() => cards.find(isRootCard) ?? null, [cards])

  useCommand('nav.parent', () => parent && goTo(parent.id), parent !== null)
  useCommand('nav.child', () => children[0] && goTo(children[0].id), children.length > 0)
  useCommand(
    'nav.previous',
    () => goTo(siblings[positionInGroup - 1].id),
    positionInGroup > 0
  )
  useCommand(
    'nav.next',
    () => goTo(siblings[positionInGroup + 1].id),
    positionInGroup >= 0 && positionInGroup < siblings.length - 1
  )
  useCommand('nav.root', () => rootCard && goTo(rootCard.id), rootCard !== null)

  // ── Zoom ──────────────────────────────────────────────────────────────────

  useCommand('view.zoomIn', () => void zoomIn({ duration: ZOOM_DURATION_MS }))
  useCommand('view.zoomOut', () => void zoomOut({ duration: ZOOM_DURATION_MS }))
  useCommand('view.zoomReset', () => void zoomTo(1, { duration: ZOOM_DURATION_MS }))
  useCommand('view.fitView', () => void fitView({ duration: ZOOM_DURATION_MS }))
}
