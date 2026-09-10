import { useEffect, useMemo, useRef } from 'react'
import { useCommandRegistry, type CommandRegistration } from '../state/useCommandRegistry'
import { useShortcutSettingsStore } from '../state/useShortcutSettingsStore'
import { formatBinding } from '../shortcuts/keys'
import type { CommandId } from '../types/commands'

/**
 * Publishes `run` as the handler for `id` for as long as the component is
 * mounted.
 *
 * `run` is read through a ref, so a component may pass an inline arrow without
 * re-registering on every render — the registration only changes when the
 * command's availability (or its contextual label) actually changes.
 */
export function useCommand(id: CommandId, run: () => void, enabled = true, label?: string): void {
  const runRef = useRef(run)
  runRef.current = run

  useEffect(() => {
    const registration: CommandRegistration = { run: () => runRef.current(), enabled, label }
    const { register, unregister } = useCommandRegistry.getState()
    register(id, registration)
    return () => unregister(id, registration)
  }, [id, enabled, label])
}

/** Whether the command can be run right now — what a menu entry disables itself on. */
export function useCommandEnabled(id: CommandId): boolean {
  return useCommandRegistry(state => state.registrations[id]?.enabled === true)
}

/** The contextual label a handler published, falling back to the catalogue's. */
export function useCommandLabel(id: CommandId): string | undefined {
  return useCommandRegistry(state => state.registrations[id]?.label)
}

/** Runs a command by id — the same entry point a keystroke, a menu and the palette all use. */
export function runCommand(id: CommandId): boolean {
  return useCommandRegistry.getState().run(id)
}

/** The command's binding as configured, or `null` when it has none. */
export function useBinding(id: CommandId): string | null {
  return useShortcutSettingsStore(state => state.bindings[id])
}

/** The binding spelled for a human — « Ctrl + Maj + Z » — or `''` when unbound. */
export function useShortcutLabel(id: CommandId): string {
  const binding = useBinding(id)
  return useMemo(() => formatBinding(binding), [binding])
}
