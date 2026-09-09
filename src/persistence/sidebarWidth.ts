import { createPanelWidthStorage } from './panelWidth'

/**
 * The bounds a drag on the sidebar's right border may land in. Below the
 * minimum a nested mind map's name is already elided down to nothing usable,
 * and past the maximum the sidebar starts eating the canvas — which is the
 * part of the app the user is actually working in.
 */
export const MIN_SIDEBAR_WIDTH = 180
export const MAX_SIDEBAR_WIDTH = 520
export const DEFAULT_SIDEBAR_WIDTH = 240

const storage = createPanelWidthStorage({
  key: 'zachart-mentale:sidebar-width',
  min: MIN_SIDEBAR_WIDTH,
  max: MAX_SIDEBAR_WIDTH,
  fallback: DEFAULT_SIDEBAR_WIDTH,
})

/** Keeps a width inside the bounds; a non-finite value falls back to the default. */
export const clampSidebarWidth = storage.clamp

/** The sidebar width from the last session; see `panelWidth.ts` for why localStorage. */
export const loadSidebarWidth = storage.load

export const saveSidebarWidth = storage.save
