import { create } from 'zustand'

/**
 * One card open in the fiche panel.
 *
 * The panel is always a stack: every card opened joins the list rather than
 * replacing what was there, and the only way one leaves is `close` or
 * `closeAll`. There used to be a "preview vs pinned" distinction with a
 * stack-mode toggle deciding which one `show` produced — removed because it
 * was a second way to answer the same question the close button already
 * answers plainly: is this fiche worth keeping open or not.
 */
export interface OpenCard {
  cardId: string
  collapsed: boolean
}

interface CardDetailState {
  /** Display order. */
  open: OpenCard[]
  /**
   * Which card's description editor is up, if any. Lives here rather than in
   * the panel so the editor survives the panel re-rendering underneath it, and
   * so the card node and the fiche cannot both open one for the same card.
   */
  editingCardId: string | null

  /** Opens a card's fiche, joining the stack. Already open just unfolds it. */
  show: (cardId: string) => void
  close: (cardId: string) => void
  toggleCollapsed: (cardId: string) => void
  setEditing: (cardId: string | null) => void
  /**
   * Drops every fiche. Called when the map changes and when a quiz starts —
   * see the notes on those two callers, both of which are correctness, not
   * tidiness. Also what the panel's own « tout fermer » button does.
   */
  closeAll: () => void
  /** Drops fiches for cards that no longer exist, after a deletion. */
  retain: (existingIds: Set<string>) => void
}

export const useCardDetailStore = create<CardDetailState>((set) => ({
  open: [],
  editingCardId: null,

  show: cardId =>
    set(state => {
      // Already open: bring it to attention rather than adding a second entry
      // for the same card.
      const existing = state.open.find(entry => entry.cardId === cardId)
      if (existing !== undefined) {
        return {
          open: state.open.map(entry =>
            entry.cardId === cardId ? { ...entry, collapsed: false } : entry
          ),
        }
      }
      return { open: [...state.open, { cardId, collapsed: false }] }
    }),

  close: cardId =>
    set(state => ({
      open: state.open.filter(entry => entry.cardId !== cardId),
      // A fiche cannot be closed out from under its own editor.
      editingCardId: state.editingCardId === cardId ? null : state.editingCardId,
    })),

  toggleCollapsed: cardId =>
    set(state => ({
      open: state.open.map(entry =>
        entry.cardId === cardId ? { ...entry, collapsed: !entry.collapsed } : entry
      ),
    })),

  setEditing: cardId => set({ editingCardId: cardId }),

  closeAll: () => set({ open: [], editingCardId: null }),

  retain: existingIds =>
    set(state => {
      const kept = state.open.filter(entry => existingIds.has(entry.cardId))
      if (kept.length === state.open.length) return state
      return {
        open: kept,
        editingCardId:
          state.editingCardId !== null && existingIds.has(state.editingCardId) ? state.editingCardId : null,
      }
    }),
}))
