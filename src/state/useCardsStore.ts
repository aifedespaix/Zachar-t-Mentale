import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { Card } from '../types/card'
import type { CardBlock } from '../types/cardBlock'
import { reconcileCards } from '../content/blocks'
import { createHistory, pushState, undo as undoHistory, redo as redoHistory, type History } from './history'
import {
  createRootCard,
  addChild as addChildOp,
  addFloatingCard as addFloatingCardOp,
  addSibling as addSiblingOp,
  updateTitle as updateTitleOp,
  updateDefinition as updateDefinitionOp,
  updateIcon as updateIconOp,
  updateContent as updateContentOp,
  deleteCard as deleteCardOp,
  deleteCardDetachingChildren as deleteCardDetachingChildrenOp,
  moveCardToIndex as moveCardToIndexOp,
  moveCardToParent as moveCardToParentOp,
  moveCard as moveCardOp,
  detachCard as detachCardOp,
  duplicateCard as duplicateCardOp,
  pasteBranch as pasteBranchOp,
  extractBranch,
  branchToText,
  type CardBranch,
  countDescendants,
  flattenedCardCount,
  overflowingCardCount,
  hasChildren as hasChildrenOp,
} from './cardsReducer'

interface CardsState {
  history: History<Card[]>
  /** The user's own lock, toggled from the header — see `toggleLock`. */
  locked: boolean
  /**
   * The open map belongs to someone else (see the sync feature's `meta.author`).
   *
   * Distinct from `locked` because it is not the user's decision and they may
   * not lift it: unlocking would let them edit a file that is about to be
   * overwritten by the next pull. `selectEditsBlocked` is what the UI reads, so
   * neither reason has to be checked twice.
   */
  readOnly: boolean
  addChild: (parentId: string) => string
  addSibling: (siblingId: string, position: 'above' | 'below') => string
  addFloatingCard: () => string
  updateTitle: (id: string, title: string) => void
  /** Sets the card's mnemonic icon, or clears it with `undefined`. */
  updateIcon: (id: string, icon: string | undefined) => void
  updateDefinition: (id: string, definition: string | undefined) => void
  updateContent: (id: string, blocks: CardBlock[]) => void
  deleteCard: (id: string) => void
  /** Deletes the card but keeps its descendants, flattened into floating cards. */
  deleteCardDetachingChildren: (id: string) => void
  descendantCount: (id: string) => number
  hasChildren: (id: string) => boolean
  moveCardToIndex: (id: string, newIndex: number) => void
  moveCardToParent: (id: string, newParentId: string) => void
  /** Reparents a card (any level) and returns the ids detached past level 4. */
  moveCard: (id: string, newParentId: string, index?: number) => string[]
  detachCard: (id: string) => void
  /** A deep copy of the branch rooted at `id`, for the card clipboard. */
  copyBranch: (id: string) => CardBranch | null
  /** The branch rooted at `id` as an indented plain-text outline. */
  branchText: (id: string) => string
  /** Copies the branch in place, right after the original. Returns the copy's root id. */
  duplicateCard: (id: string) => string
  /**
   * Pastes a copied branch under `parentId` (or into the floating zone when
   * `null`). Returns the pasted root's id and the copies that had to become
   * floating cards because they fell past level 4.
   */
  pasteBranch: (branch: CardBranch, parentId: string | null, index?: number) => { newCardId: string; detachedIds: string[] }
  /** How many cards `detachCard` would turn into floating cards (the card included). */
  flattenedCount: (id: string) => number
  /** How many cards `moveCard` would detach past level 4 — 0 means the move fits. */
  overflowCount: (id: string, newParentId: string) => number
  undo: () => void
  redo: () => void
  toggleLock: () => void
  setReadOnly: (readOnly: boolean) => void
  loadCards: (cards: Card[]) => void
}

export type CardsStore = UseBoundStore<StoreApi<CardsState>>

/**
 * Every reason the map may not be edited right now, in one selector.
 *
 * The two reasons arrive from opposite directions — the user locked the map, or
 * the map is someone else's — and each new editing affordance would otherwise
 * have to remember to check both. Missing one is how a keyboard shortcut ends
 * up editing a read-only file that the canvas overlay only blocked the mouse
 * from reaching.
 */
export const selectEditsBlocked = (state: { locked: boolean; readOnly: boolean }): boolean =>
  state.locked || state.readOnly

export function createCardsStore(): CardsStore {
  return create<CardsState>((set, get) => ({
    history: createHistory<Card[]>([createRootCard('Nouveau chapitre')]),
    locked: false,
    readOnly: false,
    addChild: parentId => {
      const { cards: next, newCardId } = addChildOp(get().history.present, parentId)
      set(state => ({ history: pushState(state.history, next) }))
      return newCardId
    },
    addSibling: (siblingId, position) => {
      const { cards: next, newCardId } = addSiblingOp(get().history.present, siblingId, position)
      set(state => ({ history: pushState(state.history, next) }))
      return newCardId
    },
    addFloatingCard: () => {
      const { cards: next, newCardId } = addFloatingCardOp(get().history.present)
      set(state => ({ history: pushState(state.history, next) }))
      return newCardId
    },
    updateTitle: (id, title) => {
      const next = updateTitleOp(get().history.present, id, title)
      set(state => ({ history: pushState(state.history, next) }))
    },
    updateIcon: (id, icon) => {
      const present = get().history.present
      const next = updateIconOp(present, id, icon)
      // Identity means the card already had this icon — re-picking it from the
      // dialog must not cost an undo step.
      if (next === present) return
      set(state => ({ history: pushState(state.history, next) }))
    },
    updateDefinition: (id, definition) => {
      const next = updateDefinitionOp(get().history.present, id, definition)
      set(state => ({ history: pushState(state.history, next) }))
    },
    updateContent: (id, blocks) => {
      const present = get().history.present
      const next = updateContentOp(present, id, blocks)
      // `updateContent` returns the same array when nothing actually changed;
      // pushing it anyway would spend an undo step on a no-op.
      if (next === present) return
      set(state => ({ history: pushState(state.history, next) }))
    },
    deleteCard: id => {
      const next = deleteCardOp(get().history.present, id)
      set(state => ({ history: pushState(state.history, next) }))
    },
    deleteCardDetachingChildren: id => {
      const next = deleteCardDetachingChildrenOp(get().history.present, id)
      set(state => ({ history: pushState(state.history, next) }))
    },
    descendantCount: id => countDescendants(get().history.present, id),
    hasChildren: id => hasChildrenOp(get().history.present, id),
    moveCardToIndex: (id, newIndex) => {
      const next = moveCardToIndexOp(get().history.present, id, newIndex)
      set(state => ({ history: pushState(state.history, next) }))
    },
    moveCardToParent: (id, newParentId) => {
      const next = moveCardToParentOp(get().history.present, id, newParentId)
      set(state => ({ history: pushState(state.history, next) }))
    },
    moveCard: (id, newParentId, index) => {
      const { cards: next, detachedIds } = moveCardOp(get().history.present, id, newParentId, index)
      set(state => ({ history: pushState(state.history, next) }))
      return detachedIds
    },
    detachCard: id => {
      const next = detachCardOp(get().history.present, id)
      set(state => ({ history: pushState(state.history, next) }))
    },
    copyBranch: id => extractBranch(get().history.present, id),
    branchText: id => branchToText(get().history.present, id),
    duplicateCard: id => {
      const { cards: next, newCardId } = duplicateCardOp(get().history.present, id)
      set(state => ({ history: pushState(state.history, next) }))
      return newCardId
    },
    pasteBranch: (branch, parentId, index) => {
      const { cards: next, newCardId, detachedIds } = pasteBranchOp(get().history.present, branch, parentId, index)
      set(state => ({ history: pushState(state.history, next) }))
      return { newCardId, detachedIds }
    },
    flattenedCount: id => flattenedCardCount(get().history.present, id),
    overflowCount: (id, newParentId) => overflowingCardCount(get().history.present, id, newParentId),
    undo: () => set(state => ({ history: undoHistory(state.history) })),
    redo: () => set(state => ({ history: redoHistory(state.history) })),
    toggleLock: () => set(state => ({ locked: !state.locked })),
    setReadOnly: readOnly => set(state => (state.readOnly === readOnly ? state : { readOnly })),
    // Reconciled on the way in: `content` is authoritative and `definition` is
    // its mirror, so a file whose two fields disagree is made consistent
    // before anything reads it. See `reconcileCards`.
    loadCards: cards => set({ history: createHistory(reconcileCards(cards)) }),
  }))
}

export const useCardsStore = createCardsStore()
