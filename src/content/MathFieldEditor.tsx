import { useEffect, useRef, useState } from 'react'

/**
 * WYSIWYG formula editing, on top of the same `latex` string the raw field
 * edits — so the two are interchangeable and neither is a dead end.
 *
 * Loaded through a dynamic `import()`, and only once a math block is actually
 * opened for editing: MathLive is ~5.7 MB unpacked, and startup must not pay
 * for a feature most cards never use.
 *
 * Which editor to show is decided ONCE at mount and never changes while the
 * block is open. Rendering `fallback` rather than a spinner is the same
 * principle: a slow — or failed — load must never leave the user unable to
 * type, and a field that swaps itself out mid-sentence is worse than one that
 * never upgrades.
 */
export interface MathFieldEditorProps {
  latex: string
  onChange: (latex: string) => void
  ariaLabel: string
  /** Shown until the editor is available, and kept if it never becomes available. */
  fallback: React.ReactNode
}

type MathfieldElement = HTMLElement & { value: string }

/** Module-level: the import is shared by every math block and resolves once. */
let loadPromise: Promise<void> | undefined
let loaded = false

function loadMathLive(): Promise<void> {
  loadPromise ??= import('mathlive')
    .then(() => {
      loaded = true
    })
    .catch(() => {
      // Left unloaded on purpose: the raw LaTeX field is a complete editor on
      // its own, so a failed import degrades to it rather than to nothing.
    })
  return loadPromise
}

export function MathFieldEditor({ latex, onChange, ariaLabel, fallback }: MathFieldEditorProps) {
  // Decided ONCE, at mount, and never revisited while this block is open.
  //
  // Reacting to the import resolving would mean the field can be replaced
  // mid-sentence — destroying the caret, the focus and possibly the keystroke
  // in flight. Deciding at mount makes that impossible by construction: the
  // first math block of a session edits as raw LaTeX (and starts the load),
  // every one opened afterwards gets the WYSIWYG field.
  const [showMathField] = useState(() => loaded)
  const hostRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<MathfieldElement | null>(null)
  // Kept in a ref so the element's listener always calls the latest handler
  // without the effect having to tear the element down and rebuild it.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Kicks the import off without waiting for it: this block keeps whichever
  // editor it decided on, the next one benefits.
  useEffect(() => {
    void loadMathLive()
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!showMathField || host === null) return

    // `document.createElement`, not JSX: both JSX and LaTeX use braces, so
    // passing a LaTeX string as a child would need escaping at every call site.
    const field = document.createElement('math-field') as MathfieldElement
    field.setAttribute('aria-label', ariaLabel)
    field.style.width = '100%'
    field.value = latex
    field.addEventListener('input', () => onChangeRef.current(field.value))
    host.replaceChildren(field)
    fieldRef.current = field

    return () => {
      host.replaceChildren()
      fieldRef.current = null
    }
    // `latex` is deliberately absent: re-creating the element on every
    // keystroke would destroy the caret. External changes are pushed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMathField, ariaLabel])

  useEffect(() => {
    const field = fieldRef.current
    // Only when the value really diverged — writing back what the user just
    // typed would move their caret to the end mid-formula.
    if (field !== null && field.value !== latex) field.value = latex
  }, [latex])

  if (!showMathField) return <>{fallback}</>
  return <div ref={hostRef} data-testid="math-field" />
}
