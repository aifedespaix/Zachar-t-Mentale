import { create } from 'zustand'

/**
 * Actions a command can ask a card node to perform on itself.
 *
 * They are requests rather than direct calls because each one ends in UI that
 * belongs to the card: the title's inline editor, the icon picker, the
 * "supprimer cette carte et ses N descendants ?" dialog. Re-implementing those
 * at canvas level to serve a keyboard shortcut would mean two delete
 * confirmations with two wordings, drifting apart. Instead the keyboard, the
 * context menu and the card's own buttons all end up in the same code.
 */
export type CardRequestAction = 'rename' | 'delete' | 'detach' | 'icon' | 'description'

export interface CardRequest {
  cardId: string
  action: CardRequestAction
  /**
   * Makes an identical request distinguishable from the previous one — asking
   * twice in a row to rename the same card must work the second time.
   */
  token: number
}

/**
 * Which card the keyboard acts on, and the request it is currently making of
 * it.
 *
 * Selection itself lives in React Flow — a click on a card sets it, and it is
 * what draws the outline. This store mirrors it so that command handlers can be
 * registered ONCE, at canvas level, instead of every card node registering its
 * own copy of every card command and fighting over who owns the id.
 */
interface CardSelectionState {
  selectedCardId: string | null
  request: CardRequest | null

  select: (cardId: string | null) => void
  /** Asks the node for `cardId` to start `action`; also selects it. */
  requestAction: (cardId: string, action: CardRequestAction) => void
  /** Called by the node that handled a request, so it fires exactly once. */
  consumeRequest: (token: number) => void
  /** Drops selection and any pending request — on a file switch, or when a quiz starts. */
  reset: () => void
}

let nextToken = 1

export const useCardSelectionStore = create<CardSelectionState>(set => ({
  selectedCardId: null,
  request: null,

  select: cardId => set({ selectedCardId: cardId }),

  requestAction: (cardId, action) =>
    set({ selectedCardId: cardId, request: { cardId, action, token: nextToken++ } }),

  // Guarded by token: a request re-issued for another card between the render
  // and the effect consuming it must not be swallowed by the previous one.
  consumeRequest: token => set(state => (state.request?.token === token ? { request: null } : state)),

  reset: () => set({ selectedCardId: null, request: null }),
}))
