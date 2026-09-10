/**
 * Keyboard bindings, as strings.
 *
 * A binding is written `Mod+Shift+Z`: modifiers first, in a canonical order,
 * then one key name. `Mod` is the platform's command modifier — Ctrl on
 * Windows and Linux, ⌘ on macOS — so a single catalogue of defaults reads
 * correctly everywhere and a rebinding made on one machine means the same
 * thing on another.
 *
 * Two layout problems shape the normalisation below, and both matter here:
 * this app is written for a French AZERTY keyboard.
 *
 *  - **Digits need Shift on AZERTY.** `event.key` for the top-row "1" is `&`
 *    unshifted, `1` shifted. Reading digits from `event.code` (`Digit1`)
 *    instead, and ignoring Shift for them, makes `Mod+0` (« zoom 100 % ») the
 *    same physical gesture on both layouts.
 *  - **Letters must NOT come from `event.code`.** The physical `KeyW` types
 *    `z` on AZERTY, so `Mod+Z` has to follow the letter printed on the key,
 *    which is exactly what `event.key` gives.
 *
 * Punctuation is folded to a name (`Plus`, `Comma`, `Minus`…) covering both
 * its shifted and unshifted characters, so `Mod+Plus` works whether the plus
 * sign needs Shift on the user's layout or not. The trade-off is deliberate:
 * `Shift` cannot take part in a digit or punctuation binding. Letters, function
 * keys and named keys are unaffected.
 */

/** Canonical modifier order, so two spellings of the same chord are one string. */
const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const

/**
 * Characters that mean the same key whether or not Shift was needed to type
 * them. The value is the canonical name a binding uses.
 */
const PUNCTUATION_NAMES: Record<string, string> = {
  '+': 'Plus',
  '=': 'Plus',
  '-': 'Minus',
  _: 'Minus',
  ',': 'Comma',
  '<': 'Comma',
  '.': 'Period',
  '>': 'Period',
  '/': 'Slash',
  '?': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
  '"': 'Quote',
  '[': 'BracketLeft',
  '{': 'BracketLeft',
  ']': 'BracketRight',
  '}': 'BracketRight',
  '\\': 'Backslash',
  '|': 'Backslash',
  '*': 'Star',
  '$': 'Dollar',
}

/** `event.key` values that are only ever a modifier — never a binding on their own. */
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'])

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const platform = navigator.platform ?? ''
  return /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X/i.test(navigator.userAgent ?? '')
}

/**
 * The canonical key name for a keydown, plus whether Shift is part of the
 * key's identity rather than part of the chord.
 *
 * `null` means there is nothing to bind: a bare modifier press, a dead key
 * (AZERTY's `^` and `¨`), or a key the browser could not identify.
 */
function keyNameFromEvent(event: KeyboardEvent): { key: string; shiftIsImplicit: boolean } | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  if (event.key === 'Dead' || event.key === 'Unidentified' || event.key === '') return null

  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code ?? '')
  if (digit) return { key: digit[1], shiftIsImplicit: true }

  if (event.key === ' ' || event.key === 'Spacebar') return { key: 'Space', shiftIsImplicit: false }

  if (event.key.length === 1) {
    const punctuation = PUNCTUATION_NAMES[event.key]
    if (punctuation) return { key: punctuation, shiftIsImplicit: true }
    return { key: event.key.toUpperCase(), shiftIsImplicit: false }
  }

  return { key: event.key, shiftIsImplicit: false }
}

/** The binding string a keydown corresponds to, or `null` when it cannot be bound. */
export function bindingFromEvent(event: KeyboardEvent, mac = isMacPlatform()): string | null {
  const resolved = keyNameFromEvent(event)
  if (resolved === null) return null

  const parts: string[] = []
  if (mac ? event.metaKey : event.ctrlKey) parts.push('Mod')
  // The literal Control key, which on macOS is a modifier of its own rather
  // than the command modifier. On Windows/Linux the same physical key IS
  // `Mod`, so it is never pushed twice.
  if (mac && event.ctrlKey) parts.push('Ctrl')
  if (!mac && event.metaKey) parts.push('Meta')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey && !resolved.shiftIsImplicit) parts.push('Shift')
  parts.push(resolved.key)
  return parts.join('+')
}

interface ParsedBinding {
  modifiers: Set<string>
  key: string
}

function parseBinding(binding: string): ParsedBinding | null {
  const parts = binding.split('+').filter(part => part.length > 0)
  if (parts.length === 0) return null
  const key = parts[parts.length - 1]
  const modifiers = new Set(parts.slice(0, -1))
  for (const modifier of modifiers) {
    if (!MODIFIER_ORDER.includes(modifier as (typeof MODIFIER_ORDER)[number])) return null
  }
  return { modifiers, key }
}

/**
 * Re-spells a binding in canonical form, so `Shift+Mod+Z` and `Mod+Shift+Z`
 * compare equal. Returns `null` for anything unparseable — which is what a
 * hand-edited settings file may well contain.
 */
export function normalizeBinding(binding: string): string | null {
  const parsed = parseBinding(binding)
  if (parsed === null) return null
  const modifiers = MODIFIER_ORDER.filter(modifier => parsed.modifiers.has(modifier))
  return [...modifiers, parsed.key].join('+')
}

/** Whether a binding carries a command-ish modifier — see `CommandScope`. */
export function hasCommandModifier(binding: string): boolean {
  const parsed = parseBinding(binding)
  if (parsed === null) return false
  return parsed.modifiers.has('Mod') || parsed.modifiers.has('Ctrl') || parsed.modifiers.has('Meta') || parsed.modifiers.has('Alt')
}

const MAC_MODIFIER_SYMBOLS: Record<string, string> = {
  Mod: '⌘',
  Ctrl: '⌃',
  Meta: '⌘',
  Alt: '⌥',
  Shift: '⇧',
}

const MODIFIER_LABELS: Record<string, string> = {
  Mod: 'Ctrl',
  Ctrl: 'Ctrl',
  Meta: 'Win',
  Alt: 'Alt',
  Shift: 'Maj',
}

/**
 * How each key is printed. French keyboard wording throughout — a user
 * looking for « Suppr » on their keyboard should read « Suppr » in the app,
 * not `Delete`.
 */
const KEY_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: 'Entrée',
  Escape: 'Échap',
  Backspace: 'Retour arr.',
  Delete: 'Suppr',
  Insert: 'Inser',
  Home: 'Début',
  End: 'Fin',
  PageUp: 'Page préc.',
  PageDown: 'Page suiv.',
  Space: 'Espace',
  Tab: 'Tab',
  Plus: '+',
  Minus: '-',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: '’',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Star: '*',
  Dollar: '$',
}

/** A binding as the user should read it: « Ctrl + Maj + Z », « ⌘⇧Z » on a Mac. */
export function formatBinding(binding: string | null, mac = isMacPlatform()): string {
  if (binding === null || binding === '') return ''
  const parsed = parseBinding(binding)
  if (parsed === null) return binding
  const modifiers = MODIFIER_ORDER.filter(modifier => parsed.modifiers.has(modifier))
  const key = KEY_LABELS[parsed.key] ?? parsed.key
  if (mac) return [...modifiers.map(modifier => MAC_MODIFIER_SYMBOLS[modifier]), key].join('')
  return [...modifiers.map(modifier => MODIFIER_LABELS[modifier]), key].join(' + ')
}
