import { create } from 'zustand'
import { loadStackMode, saveStackMode } from '../persistence/stackMode'

/**
 * One card open in the fiche panel.
 *
 * `pinned` is what separates the two ways a fiche gets there. Clicking a
 * card's description button opens it in PREVIEW: with stack mode off, the
 * next click replaces it, so browsing a map does not silently pile up a
 * dozen panels. Pinning makes it permanent, and only then does a second
 * fiche join it. That is the tab model an editor uses, and it is the one
 * that keeps "compare three cards" possible without making "look at one
 * card" expensive.
 *
 * With `stackMode` on (the default — see below), every newly opened card
 * joins the list instead, so at most one entry has `pinned: false` only
 * while stack mode is off; with it on, several unpinned entries can coexist.
 */
export interface OpenCard {
  cardId: string
  pinned: boolean
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
  /**
   * When on, `show` appends every newly opened card instead of replacing the
   * preview — the right sidebar's "pile" toggle. Persisted, and on by
   * default: piling fiches up as you browse, then trimming with
   * `clearUnpinned`, needs no per-card pinning to get there.
   */
  stackMode: boolean

  /**
   * Opens a card in preview. Replaces whatever preview was there when stack
   * mode is off; appends when it is on.
   */
  show: (cardId: string) => void
  /** Preview → pinned. Already-pinned cards are left alone. */
  pin: (cardId: string) => void
  /**
   * Pinned → preview. The fiche STAYS open — while stack mode is off the next
   * card opened replaces it again, which is exactly what « désépingler »
   * means; closing it is what « Fermer » is for.
   */
  unpin: (cardId: string) => void
  close: (cardId: string) => void
  toggleCollapsed: (cardId: string) => void
  setEditing: (cardId: string | null) => void
  /**
   * Drops every fiche. Called when the map changes and when a quiz starts —
   * see the notes on those two callers, both of which are correctness, not
   * tidiness.
   */
  closeAll: () => void
  /** Drops fiches for cards that no longer exist, after a deletion. */
  retain: (existingIds: Set<string>) => void
  toggleStackMode: () => void
  /** Drops every non-pinned fiche, keeping the ones pinned deliberately — the "vider la liste" button. */
  clearUnpinned: () => void
}

export const useCardDetailStore = create<CardDetailState>((set) => ({
  open: [],
  editingCardId: null,
  stackMode: loadStackMode(),

  show: cardId =>
    set(state => {
      // Already open, pinned or not: bring it to attention rather than adding a
      // second entry for the same card. Re-clicking a pinned fiche must not
      // demote it back to a preview that the next click would discard.
      const existing = state.open.find(entry => entry.cardId === cardId)
      if (existing !== undefined) {
        return {
          open: state.open.map(entry =>
            entry.cardId === cardId ? { ...entry, collapsed: false } : entry
          ),
        }
      }
      if (state.stackMode) {
        return { open: [...state.open, { cardId, pinned: false, collapsed: false }] }
      }
      const pinnedOnly = state.open.filter(entry => entry.pinned)
      return { open: [...pinnedOnly, { cardId, pinned: false, collapsed: false }] }
    }),

  pin: cardId =>
    set(state => ({
      open: state.open.map(entry => (entry.cardId === cardId ? { ...entry, pinned: true } : entry)),
    })),

  unpin: cardId =>
    set(state => ({
      open: state.open.map(entry => (entry.cardId === cardId ? { ...entry, pinned: false } : entry)),
    })),

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

  toggleStackMode: () =>
    set(state => {
      const next = !state.stackMode
      saveStackMode(next)
      return { stackMode: next }
    }),

  clearUnpinned: () =>
    set(state => {
      const kept = state.open.filter(entry => entry.pinned)
      if (kept.length === state.open.length) return state
      return {
        open: kept,
        editingCardId:
          state.editingCardId !== null && kept.some(entry => entry.cardId === state.editingCardId)
            ? state.editingCardId
            : null,
      }
    }),
}))
