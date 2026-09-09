import { createBooleanFlagStorage } from './booleanFlag'

const storage = createBooleanFlagStorage({ key: 'zachart-mentale:show-unreadable-files', fallback: false })

/** Whether the file sidebar shows files it cannot open (hidden by default). */
export const loadShowUnreadableFiles = storage.load

export const saveShowUnreadableFiles = storage.save
