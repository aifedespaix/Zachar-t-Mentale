import { createBooleanFlagStorage } from './booleanFlag'

const storage = createBooleanFlagStorage({ key: 'zachart-mentale:card-detail-stack-mode', fallback: true })

/** Whether opening a card fiche stacks it onto the panel instead of replacing the preview. */
export const loadStackMode = storage.load

export const saveStackMode = storage.save
