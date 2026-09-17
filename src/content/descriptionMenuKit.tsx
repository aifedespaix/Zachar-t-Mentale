/**
 * The one piece shared by the description modal's three right-click menus
 * (empty area, block, field): how an entry prints its keyboard shortcut.
 *
 * Deliberately NOT `ShortcutHint`/`CommandMenuItem` (see `components/commands`):
 * those read a REBINDABLE chord from the global command catalogue, and these
 * menus act on the description's own local state (its own undo history, its
 * own width/shortcuts-panel toggles) the same way the dialog's `Ctrl+Z` already
 * does — a fixed, dialog-scoped chord rather than an entry a user could remap
 * from the settings screen.
 */
export function MenuShortcut({ keys }: { keys?: string }) {
  if (keys === undefined || keys === '') return null
  return (
    <kbd
      style={{
        marginLeft: 'auto',
        paddingLeft: 12,
        fontFamily: 'inherit',
        fontSize: 11,
        fontWeight: 600,
        opacity: 0.6,
        whiteSpace: 'nowrap',
      }}
    >
      {keys}
    </kbd>
  )
}
