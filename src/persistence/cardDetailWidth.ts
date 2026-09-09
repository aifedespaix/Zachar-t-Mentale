import { createPanelWidthStorage } from './panelWidth'

/**
 * The bounds for the fiche panel on the right.
 *
 * Wider than the file tree's, and deliberately: this panel exists to give a
 * definition the room the 340 px popover could not — a formula, a table and a
 * picture at once. Below the minimum a stacked fraction starts wrapping, which
 * would put us back where we started.
 *
 * The maximum is what stops the panel from swallowing the canvas. On a 1280 px
 * window, file tree (240) + fiche (640) still leaves 400 px of tree visible;
 * past that the user is reading a definition with no idea where it sits.
 */
export const MIN_CARD_DETAIL_WIDTH = 300
export const MAX_CARD_DETAIL_WIDTH = 640
export const DEFAULT_CARD_DETAIL_WIDTH = 400

const storage = createPanelWidthStorage({
  key: 'zachart-mentale:card-detail-width',
  min: MIN_CARD_DETAIL_WIDTH,
  max: MAX_CARD_DETAIL_WIDTH,
  fallback: DEFAULT_CARD_DETAIL_WIDTH,
})

export const clampCardDetailWidth = storage.clamp
export const loadCardDetailWidth = storage.load
export const saveCardDetailWidth = storage.save
