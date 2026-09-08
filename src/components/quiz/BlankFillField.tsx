import { useRef, useState } from 'react'
import { editableIndices, matchesTarget, slotsOf } from '../../quiz/blanks'

const CORRECT_COLOR = '#16a34a'
const WRONG_COLOR = '#dc2626'

interface BlankFillFieldProps {
  /** The answer being asked for. Never rendered except through `revealed`. */
  target: string
  /** Positions shown for free — the difficulty's help, plus what misses bought. */
  revealed: ReadonlySet<number>
  /** One entry per editable box, in order; shorter than the boxes while typing. */
  typed: readonly string[]
  onTypedChange: (next: string[]) => void
  /** Colour letters as they are typed rather than only once submitted. */
  liveFeedback?: boolean
  /** Set after a submission: every typed letter is coloured right/wrong. */
  graded?: boolean
  disabled?: boolean
  onSubmit?: () => void
  label?: string
}

/**
 * The answer field: one box per character of the title, filled letter by letter.
 *
 * The blanks ARE the input. The old design showed a row of « ___ » above a
 * field containing « ??? », which said how long the answer was but gave the
 * typing nowhere to land; here each keystroke drops into the next empty box, so
 * the shape of the word — its length, its spaces, its hyphens — is scaffolding
 * you type into rather than a caption you read.
 *
 * Structural characters and revealed letters are drawn but never typed: the
 * user only ever supplies what is genuinely missing, which is what makes a
 * half-revealed word (« B_n_o_r ») answerable in four keystrokes instead of
 * seven.
 *
 * Behind the boxes is a single real `<input>`, transparent and stretched over
 * them. That keeps ordinary typing, backspace, and select-all working exactly
 * as they do anywhere else — a grid of one-character inputs looks the same but
 * breaks every one of those.
 */
export function BlankFillField({
  target,
  revealed,
  typed,
  onTypedChange,
  liveFeedback = false,
  graded = false,
  disabled = false,
  onSubmit,
  label = 'Réponse',
}: BlankFillFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const editable = editableIndices(target, revealed)
  const value = typed.join('')
  const slots = slotsOf(target)

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      style={{ position: 'relative', cursor: disabled ? 'default' : 'text', padding: '4px 0' }}
    >
      <div
        aria-hidden
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          // A generous gap is not decoration here: with the boxes touching,
          // their underlines merged into one long rule and the field stopped
          // saying how many letters were missing — which is most of what it is
          // for. The space has to read as a gap between BOXES.
          gap: '10px 7px',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 24,
          lineHeight: 1.3,
          fontWeight: 700,
        }}
      >
        {slots.map(slot => {
          if (!slot.fillable) {
            // Spaces need a visible gap, or « le mot » collapses into one run
            // of boxes and the answer loses the word shape that makes it
            // guessable at all.
            return (
              <span
                key={slot.index}
                style={{ minWidth: slot.char === ' ' ? 18 : 10, textAlign: 'center', opacity: 0.55 }}
              >
                {slot.char === ' ' ? ' ' : slot.char}
              </span>
            )
          }

          if (revealed.has(slot.index)) {
            return (
              <span
                key={slot.index}
                style={{
                  minWidth: 22,
                  textAlign: 'center',
                  // Muted and underline-free: a given letter is context, and
                  // must not read as something the user got right.
                  color: 'var(--muted-foreground)',
                  borderBottom: '2px solid transparent',
                }}
              >
                {slot.char}
              </span>
            )
          }

          const position = editable.indexOf(slot.index)
          const char = typed[position] ?? ''
          const showVerdict = char !== '' && (graded || liveFeedback)
          const right = showVerdict && matchesTarget(char, slot.char)
          const caret = focused && !disabled && position === value.length

          return (
            <span
              key={slot.index}
              style={{
                minWidth: 22,
                textAlign: 'center',
                color: showVerdict ? (right ? CORRECT_COLOR : WRONG_COLOR) : 'inherit',
                borderBottom: `2px solid ${
                  showVerdict ? (right ? CORRECT_COLOR : WRONG_COLOR) : caret ? 'var(--primary)' : 'var(--border)'
                }`,
                background: caret ? 'color-mix(in oklch, var(--primary), transparent 90%)' : 'transparent',
                borderRadius: '3px 3px 0 0',
                transition: 'border-color 0.12s ease, color 0.12s ease',
              }}
            >
              {char === '' ? ' ' : char}
            </span>
          )
        })}
      </div>

      <input
        ref={inputRef}
        aria-label={label}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        value={value}
        maxLength={editable.length}
        onChange={event => onTypedChange(Array.from(event.target.value).slice(0, editable.length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onSubmit?.()
          }
        }}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          // Invisible, not hidden: the boxes above are the visible field, but
          // this is the one that actually holds focus, the caret and the text,
          // so it has to stay a real, reachable input.
          opacity: 0,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          font: 'inherit',
          cursor: disabled ? 'default' : 'text',
        }}
      />
    </div>
  )
}
