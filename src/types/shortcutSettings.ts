/**
 * What the app remembers about keyboard shortcuts: nothing but the user's
 * DIFFERENCES from the catalogue.
 *
 * Storing the resolved table instead would freeze every default at the version
 * that first wrote the file — a command added later would arrive unbound, and
 * a default the app improves would never reach anyone who had opened the
 * settings once. An override map means "everything as shipped, except these".
 *
 * A `null` value is meaningful and is NOT the same as an absent key: it is the
 * user having deliberately removed a shortcut the app ships with.
 */
export interface ShortcutSettings {
  bindings: Record<string, string | null>
}

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = { bindings: {} }
