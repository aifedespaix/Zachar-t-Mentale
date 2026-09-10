import { useEffect, useRef, useState } from 'react'
import { bindingFromEvent, formatBinding } from '../../shortcuts/keys'

interface ShortcutRecorderProps {
  /** The binding currently assigned, shown while not recording. */
  binding: string | null
  /** A chord was captured. The caller decides what to do about conflicts. */
  onCapture: (binding: string) => void
  onCancel: () => void
  recording: boolean
  onStartRecording: () => void
  /** Accessible name — the command this button binds. */
  commandLabel: string
}

/**
 * The button you press, then press a key combination into.
 *
 * Capture happens in the CAPTURE phase on the window, not on the button's own
 * `onKeyDown`: half the chords worth binding (`Tab`, `Entrée`, `Échap`, the
 * arrows) never reach a focused button as an ordinary keydown — the browser
 * moves focus or the dialog closes first. Listening above them, and stopping
 * the event dead, is what makes those bindable at all.
 *
 * Escape cancels rather than being captured: a recorder you cannot back out of
 * is a trap, and it is the one key every user will try first.
 */
export function ShortcutRecorder({
  binding,
  onCapture,
  onCancel,
  recording,
  onStartRecording,
  commandLabel,
}: ShortcutRecorderProps) {
  const [pressed, setPressed] = useState<string | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!recording) {
      setPressed(null)
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        onCancel()
        return
      }
      const captured = bindingFromEvent(event)
      // A bare modifier press is not a chord — it is the user still on their
      // way to one, so the recorder waits rather than rejecting.
      if (captured === null) {
        setPressed(null)
        return
      }
      setPressed(captured)
      onCapture(captured)
    }

    // `keyup` too, so a chord released without ever producing a keydown we
    // could read (a lone modifier) does not leave the recorder armed forever
    // — it stays armed, but the browser has nothing pending either way.
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [recording, onCapture, onCancel])

  useEffect(() => {
    if (recording) buttonRef.current?.focus()
  }, [recording])

  const label = recording
    ? (pressed !== null ? formatBinding(pressed) : 'Appuie sur une combinaison…')
    : binding === null
      ? 'Aucun'
      : formatBinding(binding)

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={`Raccourci de « ${commandLabel} » : ${binding === null ? 'aucun' : formatBinding(binding)}`}
      onClick={() => (recording ? onCancel() : onStartRecording())}
      style={{
        minWidth: 150,
        padding: '6px 10px',
        borderRadius: 8,
        border: `1px solid ${recording ? 'var(--primary)' : 'var(--border)'}`,
        background: recording ? 'color-mix(in oklch, var(--primary), transparent 90%)' : 'var(--background)',
        color: binding === null && !recording ? 'var(--muted-foreground)' : 'inherit',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}
