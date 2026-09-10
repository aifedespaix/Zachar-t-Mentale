import { useLayoutEffect, useRef, useState } from 'react'
import { editableIndices, matchesTarget, resolveTypedInsert, slotsOf } from '../../quiz/blanks'

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
  /**
   * The `typed` array exactly as it stood at the last submission. A box is
   * coloured right/wrong only while its current letter still matches what was
   * graded there — edit that one box and it reverts to unmarked, but the rest
   * keep their colour. `null`/`undefined` before any submission.
   */
  gradedSnapshot?: readonly string[] | null
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
 * There is no "insert" here, only "fill the next box" and "overwrite the box
 * you went back to" — the answer has a fixed length, so a keystroke in the
 * middle of what is already written replaces that letter instead of pushing
 * the rest of the title along.
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
  gradedSnapshot = null,
  disabled = false,
  onSubmit,
  label = 'Réponse',
}: BlankFillFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const editable = editableIndices(target, revealed)
  const value = typed.join('')
  const slots = slotsOf(target)
  // Tracks where the NEXT keystroke lands — normally the end of what's typed,
  // but a click on an already-answered box moves it there instead, so typing
  // corrects that one letter without retyping everything after it.
  const [cursorPosition, setCursorPosition] = useState(value.length)
  // Where the resolved edit wants the caret, applied once React has rewritten
  // the input's value. Overwriting a box changes that value under the caret,
  // and assigning `value` drops the selection to the end — without this the
  // caret would jump past the letters the user still means to correct.
  const pendingSelection = useRef<number | null>(null)
  useLayoutEffect(() => {
    const selection = pendingSelection.current
    if (selection === null) return
    pendingSelection.current = null
    inputRef.current?.setSelectionRange(selection, selection)
  }, [typed])

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
          // Positioned above the real (invisible, absolutely-stretched) input
          // below, so a click actually lands on the box the user is looking
          // at instead of always hitting the input underneath — that's what
          // lets a click teleport the caret to the right box at all.
          position: 'relative',
          zIndex: 1,
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
          const gradedChar = gradedSnapshot?.[position]
          const stillGraded = gradedChar !== undefined && gradedChar !== '' && char === gradedChar
          const showVerdict = char !== '' && (liveFeedback || stillGraded)
          const right = showVerdict && matchesTarget(char, slot.char)
          const caret = focused && !disabled && position === cursorPosition

          return (
            <span
              key={slot.index}
              onClick={
                disabled
                  ? undefined
                  : () => {
                      const pos = Math.min(position, value.length)
                      inputRef.current?.focus()
                      inputRef.current?.setSelectionRange(pos, pos)
                      setCursorPosition(pos)
                    }
              }
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
        onChange={event => {
          const input = event.target
          const raw = Array.from(input.value)
          const nativeCursor = input.selectionStart ?? raw.length
          // The resolver gets the caret along with the untruncated value: a
          // middle edit on a full field briefly overflows, and that extra
          // letter is exactly what says which box was corrected. Truncating
          // first would hide it and reintroduce the shift.
          const resolved = resolveTypedInsert(target, revealed, typed, raw, nativeCursor).slice(
            0,
            editable.length
          )
          onTypedChange(resolved)

          // A swallowed keystroke — an echo of a letter the field just
          // skipped, or an overflow past the last box — leaves the answer
          // untouched, so the caret must stay on the box the user was working
          // in rather than step past it. Anything else follows the browser.
          const grown = raw.length === typed.length + 1
          const swallowed =
            grown && resolved.length === typed.length && resolved.every((char, i) => char === typed[i])
          const caret = swallowed ? nativeCursor - 1 : nativeCursor
          const nextCursor = Math.max(0, Math.min(caret, resolved.length))
          pendingSelection.current = nextCursor
          setCursorPosition(nextCursor)
        }}
        onSelect={event => setCursorPosition(event.currentTarget.selectionStart ?? value.length)}
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
