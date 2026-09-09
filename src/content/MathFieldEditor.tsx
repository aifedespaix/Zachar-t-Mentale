import { useEffect, useImperativeHandle, useRef, useState } from 'react'

/**
 * What the symbol palette drives. Exposed as a handle rather than as another
 * `latex` prop because insertion is a POSITIONED act: it belongs where the
 * caret is, and only the live element knows that.
 */
export interface MathFieldHandle {
  /**
   * Inserts a fragment at the caret.
   *
   * `rich` may carry MathLive's placeholder syntax (`#0` for the selection,
   * `#?` for the next tab stop), which is what makes a palette button leave
   * the caret inside the fraction it just created. `plain` is the same
   * fragment as literal LaTeX, for the raw-field path where those tokens
   * would be typed out verbatim as text.
   */
  insert: (rich: string, plain?: string) => void
}

export interface MathFieldEditorProps {
  latex: string
  onChange: (latex: string) => void
  ariaLabel: string
  /** Shown until the editor is available, and kept if it never becomes available. */
  fallback: React.ReactNode
  ref?: React.Ref<MathFieldHandle>
}

type MathfieldElement = HTMLElement & {
  value: string
  insert?: (fragment: string, options?: { focus?: boolean }) => void
}

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
export function MathFieldEditor({ latex, onChange, ariaLabel, fallback, ref }: MathFieldEditorProps) {
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
  // Same reason as `onChangeRef`: the handle below is built once, so it must
  // not close over the formula as it was at mount.
  const latexRef = useRef(latex)
  latexRef.current = latex

  useImperativeHandle(
    ref,
    () => ({
      insert(rich, plain = rich) {
        const field = fieldRef.current
        // No live element — the raw-LaTeX path, before MathLive has loaded or
        // after it failed to. There is no caret to insert at through this
        // component (the textarea belongs to the caller), so the fragment goes
        // at the end: appending is degraded, losing the click is not.
        if (field === null || typeof field.insert !== 'function') {
          onChangeRef.current(latexRef.current + plain)
          return
        }
        field.insert(rich, { focus: true })
        // MathLive's `insert()` mutates the field without necessarily emitting
        // `input`, so the change is pushed out here rather than waited for.
        onChangeRef.current(field.value)
      },
    }),
    []
  )

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
