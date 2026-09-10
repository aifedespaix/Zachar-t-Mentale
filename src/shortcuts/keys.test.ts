import { describe, it, expect } from 'vitest'
import { bindingFromEvent, formatBinding, hasCommandModifier, normalizeBinding } from './keys'

/** A keydown as the browser would report it. `code` matters for digits — see `keys.ts`. */
function keydown(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  })
}

describe('bindingFromEvent', () => {
  it('reads the command modifier as Mod, per platform', () => {
    expect(bindingFromEvent(keydown({ key: 'z', ctrlKey: true }), false)).toBe('Mod+Z')
    expect(bindingFromEvent(keydown({ key: 'z', metaKey: true }), true)).toBe('Mod+Z')
  })

  it('keeps Ctrl and Mod apart on macOS, where they are different keys', () => {
    expect(bindingFromEvent(keydown({ key: 'z', ctrlKey: true }), true)).toBe('Ctrl+Z')
    expect(bindingFromEvent(keydown({ key: 'z', ctrlKey: true, metaKey: true }), true)).toBe('Mod+Ctrl+Z')
  })

  it('spells modifiers in one canonical order whatever the combination', () => {
    expect(
      bindingFromEvent(keydown({ key: 'z', shiftKey: true, altKey: true, ctrlKey: true }), false)
    ).toBe('Mod+Alt+Shift+Z')
  })

  it('follows the LETTER printed on the key, not its physical position', () => {
    // On AZERTY the physical `KeyW` types "z", and Ctrl+Z has to be the key
    // marked Z — reading `event.code` here would bind the wrong key.
    expect(bindingFromEvent(keydown({ key: 'z', code: 'KeyW', ctrlKey: true }), false)).toBe('Mod+Z')
  })

  it('reads digits from the physical key, so AZERTY’s shifted digits still work', () => {
    // Unshifted on AZERTY, the top-row "0" types "à"; shifted, it types "0".
    // Both are `Digit0`, and both must mean the same shortcut.
    expect(bindingFromEvent(keydown({ key: 'à', code: 'Digit0', ctrlKey: true }), false)).toBe('Mod+0')
    expect(
      bindingFromEvent(keydown({ key: '0', code: 'Digit0', ctrlKey: true, shiftKey: true }), false)
    ).toBe('Mod+0')
  })

  it('folds punctuation to a name covering its shifted and unshifted forms', () => {
    // "+" is Shift+"=" on QWERTY and its own key elsewhere: one binding either way.
    expect(bindingFromEvent(keydown({ key: '=', ctrlKey: true }), false)).toBe('Mod+Plus')
    expect(bindingFromEvent(keydown({ key: '+', ctrlKey: true, shiftKey: true }), false)).toBe('Mod+Plus')
    expect(bindingFromEvent(keydown({ key: ',', ctrlKey: true }), false)).toBe('Mod+Comma')
  })

  it('names the keys that have no character', () => {
    expect(bindingFromEvent(keydown({ key: 'ArrowUp', altKey: true }), false)).toBe('Alt+ArrowUp')
    expect(bindingFromEvent(keydown({ key: ' ' }), false)).toBe('Space')
    expect(bindingFromEvent(keydown({ key: 'F2' }), false)).toBe('F2')
    expect(bindingFromEvent(keydown({ key: 'Delete' }), false)).toBe('Delete')
  })

  it('refuses anything that is not a chord yet', () => {
    // A modifier still held on its own, and AZERTY's dead keys (^ ¨), which
    // produce no character until the next keystroke.
    expect(bindingFromEvent(keydown({ key: 'Control', ctrlKey: true }), false)).toBeNull()
    expect(bindingFromEvent(keydown({ key: 'Shift', shiftKey: true }), false)).toBeNull()
    expect(bindingFromEvent(keydown({ key: 'Dead' }), false)).toBeNull()
    expect(bindingFromEvent(keydown({ key: 'Unidentified' }), false)).toBeNull()
  })
})

describe('normalizeBinding', () => {
  it('puts modifiers back in canonical order so two spellings compare equal', () => {
    expect(normalizeBinding('Shift+Mod+Z')).toBe('Mod+Shift+Z')
    expect(normalizeBinding('Mod+Shift+Z')).toBe('Mod+Shift+Z')
  })

  it('rejects a binding built on something that is not a modifier', () => {
    // What a hand-edited settings file may well contain.
    expect(normalizeBinding('Ctrl+Super+Z')).toBeNull()
    expect(normalizeBinding('')).toBeNull()
  })
})

describe('hasCommandModifier', () => {
  it('separates chords from bare keys', () => {
    expect(hasCommandModifier('Mod+S')).toBe(true)
    expect(hasCommandModifier('Alt+ArrowUp')).toBe(true)
    expect(hasCommandModifier('Shift+Enter')).toBe(false)
    expect(hasCommandModifier('F2')).toBe(false)
  })
})

describe('formatBinding', () => {
  it('spells a binding with French keyboard wording', () => {
    expect(formatBinding('Mod+Shift+Z', false)).toBe('Ctrl + Maj + Z')
    expect(formatBinding('Delete', false)).toBe('Suppr')
    expect(formatBinding('Alt+ArrowUp', false)).toBe('Alt + ↑')
    expect(formatBinding('Mod+Comma', false)).toBe('Ctrl + ,')
  })

  it('uses the Mac symbols on a Mac', () => {
    expect(formatBinding('Mod+Shift+Z', true)).toBe('⌘⇧Z')
  })

  it('renders an unbound command as nothing at all', () => {
    expect(formatBinding(null)).toBe('')
    expect(formatBinding('')).toBe('')
  })
})
