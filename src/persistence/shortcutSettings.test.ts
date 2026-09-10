import { describe, it, expect } from 'vitest'
import { sanitizeShortcutSettings } from './shortcutSettings'

describe('sanitizeShortcutSettings', () => {
  it('keeps the overrides it can act on, normalised', () => {
    expect(sanitizeShortcutSettings({ bindings: { 'edit.undo': 'Shift+Mod+U' } })).toEqual({
      bindings: { 'edit.undo': 'Mod+Shift+U' },
    })
  })

  it('keeps an explicit null, which is a decision and not an absence', () => {
    // « Cette action n'a plus de raccourci » has to survive a restart, or the
    // shipped default would come back on the next launch.
    expect(sanitizeShortcutSettings({ bindings: { 'edit.undo': null } })).toEqual({
      bindings: { 'edit.undo': null },
    })
  })

  it('drops an override for a command this version does not have', () => {
    // A file written by a later version, opened by an older one. Its unknown
    // entries must not shadow anything, and must not crash the load.
    expect(sanitizeShortcutSettings({ bindings: { 'file.teleport': 'Mod+T' } })).toEqual({ bindings: {} })
  })

  it('drops a binding it cannot parse rather than letting it shadow a working default', () => {
    expect(sanitizeShortcutSettings({ bindings: { 'edit.undo': 'Super+Z' } })).toEqual({ bindings: {} })
    expect(sanitizeShortcutSettings({ bindings: { 'edit.undo': 42 } })).toEqual({ bindings: {} })
  })

  it('degrades to the defaults on anything that is not a settings file', () => {
    expect(sanitizeShortcutSettings(null)).toEqual({ bindings: {} })
    expect(sanitizeShortcutSettings('[]')).toEqual({ bindings: {} })
    expect(sanitizeShortcutSettings({})).toEqual({ bindings: {} })
  })
})
