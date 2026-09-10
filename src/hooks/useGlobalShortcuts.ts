import { useEffect } from 'react'
import { bindingFromEvent } from '../shortcuts/keys'
import { commandById, type CommandDefinition } from '../types/commands'
import { useCommandRegistry } from '../state/useCommandRegistry'
import { useShortcutSettingsStore } from '../state/useShortcutSettingsStore'
import { useQuizStore } from '../state/useQuizStore'

/**
 * Somewhere the user is typing. A shortcut fired here would be a keystroke
 * stolen mid-word: `Ctrl+Z` must undo the TEXT, `Suppr` must delete a
 * character, and `Entrée` must submit the field it is in.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLSelectElement) return true
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  // MathLive's editor is a custom element, not an input — the formula editor
  // in a card's description is one, and it must keep every key it is sent.
  return target.tagName === 'MATH-FIELD'
}

/**
 * Controls that own `Entrée` and `Espace` themselves: pressing either on a
 * focused button MEANS "activate this button", wherever the button happens to
 * sit. Several of them sit inside the canvas — every card carries its own row
 * of add/delete/detach buttons — so "inside the mind map" is not enough on its
 * own to decide a bare key belongs to the map.
 */
const INTERACTIVE_SELECTOR =
  'button, a[href], select, summary, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"]'

/**
 * The mind map itself has focus.
 *
 * This is what makes bare keys (`Entrée`, `Suppr`, `Tab`, the arrows) usable
 * as shortcuts at all. Bound globally they would break the rest of the app:
 * `Entrée` would stop activating a focused button, `Tab` would stop moving
 * focus. Restricted to the canvas — and to the parts of it that are not
 * themselves controls — they behave the way they do in every outliner, and
 * everywhere else the key still means what the browser says.
 *
 * `document.body` counts: nothing focused is the state the app is in right
 * after a click on empty canvas, and treating it as "outside" would make every
 * bare shortcut fail exactly when the user expects them most.
 */
export function isCanvasTarget(target: EventTarget | null): boolean {
  if (target === null) return true
  if (!(target instanceof HTMLElement)) return false
  if (target === document.body) return true
  if (target.closest('.react-flow') === null) return false
  return target.closest(INTERACTIVE_SELECTOR) === null
}

/**
 * A modal is up. Its own keyboard handling owns the window while it is: Escape
 * closes it, Entrée confirms it, and a global shortcut firing behind it would
 * act on a mind map the user cannot even see.
 */
export function isModalOpen(): boolean {
  return (
    document.querySelector('[data-slot="dialog-content"][data-state="open"]') !== null ||
    document.querySelector('[data-slot="context-menu-content"][data-state="open"]') !== null ||
    document.querySelector('[data-slot="dropdown-menu-content"][data-state="open"]') !== null
  )
}

/** The user has actually selected text — so `Ctrl+C` means "copy that", not "copy the card". */
function hasTextSelection(): boolean {
  const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
  return selection !== null && !selection.isCollapsed && selection.toString().trim() !== ''
}

/** Whether `event` is allowed to trigger `command`, given where focus is and what the app is doing. */
export function commandAcceptsEvent(command: CommandDefinition, event: KeyboardEvent): boolean {
  if (isTypingTarget(event.target) && command.allowInEditable !== true) return false
  // Nothing may change a card under a quiz in progress: an undo could move the
  // very card being asked about, a delete could remove it mid-question.
  if (useQuizStore.getState().active && command.allowInQuiz !== true) return false
  if ((command.scope ?? 'global') === 'canvas' && !isCanvasTarget(event.target)) return false
  if (command.skipWhenTextSelected === true && hasTextSelection()) return false
  return true
}

/**
 * The app's single keyboard entry point.
 *
 * Listens in the CAPTURE phase, so a bound chord is decided here before React
 * Flow's own pane handlers (which own the arrows and Backspace) or a Radix
 * menu see it. Nothing is swallowed speculatively: the event is only
 * `preventDefault`-ed once a registered, currently-enabled handler has
 * actually run it, so an unbound key — or one bound to an action that cannot
 * apply right now — reaches the browser untouched.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Something closer to the user already claimed this key — an editor's
      // own Escape handling, a menu's arrow navigation.
      if (event.defaultPrevented) return
      if (isModalOpen()) return

      const binding = bindingFromEvent(event)
      if (binding === null) return

      const id = useShortcutSettingsStore.getState().lookup.get(binding)
      if (id === undefined) return

      const command = commandById(id)
      if (command === undefined) return
      if (!commandAcceptsEvent(command, event)) return

      if (!useCommandRegistry.getState().run(id)) return
      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])
}
