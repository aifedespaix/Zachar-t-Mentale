import { formatBinding } from '../../shortcuts/keys'

interface ShortcutHintProps {
  binding: string | null
  /** Dimmed, for a menu entry where the shortcut is secondary to the label. */
  muted?: boolean
}

/**
 * A binding, printed the way a keyboard prints it.
 *
 * Every place the app mentions a shortcut goes through this: menu entries,
 * button tooltips, the settings list. One renderer means one wording — a user
 * who learns « Ctrl + Maj + Z » from a menu reads the same string in the
 * settings, and both change together when the binding does.
 */
export function ShortcutHint({ binding, muted = true }: ShortcutHintProps) {
  if (binding === null || binding === '') return null
  return (
    <kbd
      style={{
        fontFamily: 'inherit',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        color: muted ? 'var(--muted-foreground)' : 'inherit',
        opacity: muted ? 0.85 : 1,
      }}
    >
      {formatBinding(binding)}
    </kbd>
  )
}
