import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { Card } from '../types/card'
import { createHistory, pushState, undo as undoHistory, redo as redoHistory, type History } from './history'
import {
  createRootCard,
  addChild as addChildOp,
  addSibling as addSiblingOp,
  updateTitle as updateTitleOp,
  updateDefinition as updateDefinitionOp,
  deleteCard as deleteCardOp,
  moveCardToIndex as moveCardToIndexOp,
  moveCardToParent as moveCardToParentOp,
  countDescendants,
  hasChildren as hasChildrenOp,
} from './cardsReducer'

interface CardsState {
  history: History<Card[]>
  locked: boolean
  addChild: (parentId: string) => string
  addSibling: (siblingId: string, position: 'above' | 'below') => string
  updateTitle: (id: string, title: string) => void
  updateDefinition: (id: string, definition: string | undefined) => void
  deleteCard: (id: string) => void
  descendantCount: (id: string) => number
  hasChildren: (id: string) => boolean
  moveCardToIndex: (id: string, newIndex: number) => void
  moveCardToParent: (id: string, newParentId: string) => void
  undo: () => void
  redo: () => void
  toggleLock: () => void
  loadCards: (cards: Card[]) => void
}

export type CardsStore = UseBoundStore<StoreApi<CardsState>>

export function createCardsStore(): CardsStore {
  return create<CardsState>((set, get) => ({
    history: createHistory<Card[]>([createRootCard('Nouveau chapitre')]),
    locked: false,
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
    updateTitle: (id, title) => {
      const next = updateTitleOp(get().history.present, id, title)
      set(state => ({ history: pushState(state.history, next) }))
    },
    updateDefinition: (id, definition) => {
      const next = updateDefinitionOp(get().history.present, id, definition)
      set(state => ({ history: pushState(state.history, next) }))
    },
    deleteCard: id => {
      const next = deleteCardOp(get().history.present, id)
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
    undo: () => set(state => ({ history: undoHistory(state.history) })),
    redo: () => set(state => ({ history: redoHistory(state.history) })),
    toggleLock: () => set(state => ({ locked: !state.locked })),
    loadCards: cards => set({ history: createHistory(cards) }),
  }))
}

export const useCardsStore = createCardsStore()
