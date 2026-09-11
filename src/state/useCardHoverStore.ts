import { create } from 'zustand'

/**
 * Which card the pointer is currently over — on the canvas OR in the fiche
 * panel — so the card and its description can light up together.
 *
 * One shared id, rather than a flag on each side: the whole point is that
 * hovering EITHER surface marks BOTH, and a single source of truth is what
 * makes "vice-versa" fall out of the same mechanism instead of a second one
 * that could disagree with it.
 *
 * Its own store rather than a field on `useCardDetailStore`, because this is
 * transient pointer state refreshed on every `mouseenter`: keeping it apart
 * means the components that subscribe to the open-fiche list are not
 * re-rendered by pointer churn. Consumers select a BOOLEAN
 * (`s => s.hoveredCardId === card.id`), so moving the pointer between two
 * cards re-renders exactly those two nodes, never the whole canvas.
 */
interface CardHoverState {
  hoveredCardId: string | null
  hover: (cardId: string) => void
  /**
   * Clears the hover only if `cardId` is still the hovered one: the
   * `mouseenter` of the card the pointer moved TO can land before the
   * `mouseleave` of the one it left, and an unguarded clear would snuff out
   * the highlight the user just caused.
   */
  unhover: (cardId: string) => void
  /** Drops the hover — on a file switch and when a quiz starts, like the other per-map stores. */
  reset: () => void
}

export const useCardHoverStore = create<CardHoverState>(set => ({
  hoveredCardId: null,

  hover: cardId => set({ hoveredCardId: cardId }),

  unhover: cardId =>
    set(state => (state.hoveredCardId === cardId ? { hoveredCardId: null } : state)),

  reset: () => set({ hoveredCardId: null }),
}))
