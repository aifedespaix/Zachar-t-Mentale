import type { LucideIcon } from 'lucide-react'
import { ContextMenuItem } from '../ui/context-menu'
import { DropdownMenuItem } from '../ui/dropdown-menu'
import { ShortcutHint } from './ShortcutHint'
import { commandById, type CommandId } from '../../types/commands'
import { runCommand, useBinding, useCommandEnabled, useCommandLabel } from '../../hooks/useCommand'

interface CommandMenuItemProps {
  command: CommandId
  icon?: LucideIcon
  /** Overrides the catalogue label where the menu's context makes a shorter one clearer. */
  label?: string
}

/**
 * Runs the command a beat after the menu closes.
 *
 * Radix still owns focus through its roving focus group when `onSelect` fires,
 * and it restores focus as it closes — which would steal it straight back from
 * a dialog or an inline editor the command just opened. The same one-tick
 * deferral the file tree's rename already needed, applied once for every
 * command-driven menu entry.
 */
function runDeferred(command: CommandId) {
  setTimeout(() => runCommand(command), 0)
}

interface ItemContentProps {
  icon?: LucideIcon
  label: string
  binding: string | null
}

function ItemContent({ icon: Icon, label, binding }: ItemContentProps) {
  return (
    <>
      {Icon && <Icon size={14} aria-hidden />}
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      <ShortcutHint binding={binding} />
    </>
  )
}

/** One command as a right-click menu entry: label, icon, live shortcut, disabled when it cannot run. */
export function CommandMenuItem({ command, icon, label }: CommandMenuItemProps) {
  const definition = commandById(command)
  const enabled = useCommandEnabled(command)
  const contextualLabel = useCommandLabel(command)
  const binding = useBinding(command)
  if (definition === undefined) return null

  return (
    <ContextMenuItem
      disabled={!enabled}
      variant={definition.destructive ? 'destructive' : 'default'}
      onSelect={() => runDeferred(command)}
    >
      <ItemContent icon={icon} label={label ?? contextualLabel ?? definition.label} binding={binding} />
    </ContextMenuItem>
  )
}

/** The same entry, for a toolbar dropdown rather than a right-click menu. */
export function CommandDropdownItem({ command, icon, label }: CommandMenuItemProps) {
  const definition = commandById(command)
  const enabled = useCommandEnabled(command)
  const contextualLabel = useCommandLabel(command)
  const binding = useBinding(command)
  if (definition === undefined) return null

  return (
    <DropdownMenuItem
      disabled={!enabled}
      variant={definition.destructive ? 'destructive' : 'default'}
      onSelect={() => runDeferred(command)}
    >
      <ItemContent icon={icon} label={label ?? contextualLabel ?? definition.label} binding={binding} />
    </DropdownMenuItem>
  )
}
