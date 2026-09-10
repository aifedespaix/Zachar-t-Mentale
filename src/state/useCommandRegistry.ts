import { create } from 'zustand'
import type { CommandId } from '../types/commands'

export interface CommandRegistration {
  run: () => void
  /**
   * Whether the action can be taken RIGHT NOW — no card selected, nothing in
   * the clipboard, map locked. Menus grey the entry out, the palette dims it,
   * and the keyboard dispatcher lets the key through to the browser instead of
   * swallowing it for an action that would do nothing.
   */
  enabled: boolean
  /**
   * Replaces the catalogue label where the action reads differently in
   * context — « Supprimer la carte » becomes « Supprimer la branche » on a
   * card that has children.
   */
  label?: string
}

interface CommandRegistryState {
  registrations: Partial<Record<CommandId, CommandRegistration>>
  /**
   * Publishes a handler for `id`. The component that owns the state an action
   * needs is the one that registers it: the canvas owns "add a sub-card", the
   * sidebar owns "toggle the tree", so no store has to grow a mirror of a
   * component's local state just to be reachable from a keystroke.
   */
  register: (id: CommandId, registration: CommandRegistration) => void
  /**
   * Removes `registration` — but only if it is still the current one. Two
   * components can hold the same command across a remount (the new one
   * registers before the old one's cleanup runs), and an unconditional delete
   * would leave the command dead until the next render.
   */
  unregister: (id: CommandId, registration: CommandRegistration) => void
  /** Runs the command if something registered it and it is currently enabled. */
  run: (id: CommandId) => boolean
  isEnabled: (id: CommandId) => boolean
}

export const useCommandRegistry = create<CommandRegistryState>((set, get) => ({
  registrations: {},

  register: (id, registration) =>
    set(state => ({ registrations: { ...state.registrations, [id]: registration } })),

  unregister: (id, registration) =>
    set(state => {
      if (state.registrations[id] !== registration) return state
      const next = { ...state.registrations }
      delete next[id]
      return { registrations: next }
    }),

  run: id => {
    const registration = get().registrations[id]
    if (registration === undefined || !registration.enabled) return false
    registration.run()
    return true
  },

  isEnabled: id => get().registrations[id]?.enabled === true,
}))
