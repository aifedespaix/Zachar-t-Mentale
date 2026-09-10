import { create } from 'zustand'
import type { CardBranch } from './cardsReducer'

/**
 * The app's own clipboard for cards.
 *
 * Deliberately NOT the system clipboard: a card is a branch of typed objects
 * (levels, icons, rich content, image references into the map's sidecar), and
 * round-tripping that through `text/plain` would either lose it or invent a
 * serialisation format nothing else can read. « Copier la branche en texte »
 * exists separately for getting an outline OUT of the app.
 *
 * It survives file switches on purpose: copying a definition from one chapter
 * into another is the single most useful thing this feature does. The branch is
 * a deep copy taken at copy time, so editing — or deleting — the original
 * afterwards leaves what you copied intact.
 */
interface CardClipboardState {
  branch: CardBranch | null
  copy: (branch: CardBranch) => void
  clear: () => void
}

export const useCardClipboardStore = create<CardClipboardState>(set => ({
  branch: null,
  copy: branch => set({ branch }),
  clear: () => set({ branch: null }),
}))
