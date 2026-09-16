import { createBooleanFlagStorage } from './booleanFlag'

const storage = createBooleanFlagStorage({ key: 'zachart-mentale:description-narrow', fallback: false })

/**
 * Whether the card-description dialog remembered its NARROW width. `false` is
 * the roomy default it has always opened in; see `booleanFlag.ts` for the
 * storage contract (best-effort `localStorage`, never throws, read
 * synchronously so the first paint is already the chosen width).
 */
export const loadDescriptionNarrow = storage.load

export const saveDescriptionNarrow = storage.save
