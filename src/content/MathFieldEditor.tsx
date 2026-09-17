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
  /**
   * Focuses the field with the caret at its very end.
   *
   * The merge gesture backspace on an empty formula line uses: the line above
   * disappears, and the caret has to land where writing would continue, the
   * same "end of the previous field" a text block already lands on. A live
   * MathLive field has no DOM "end" a caller could set like a textarea's
   * `selectionRange` — `executeCommand('moveToMathfieldEnd')` is MathLive's own
   * way of asking for it. On the raw-LaTeX fallback there is no live element to
   * ask, so this falls back to the plain field the `fallback` prop rendered.
   */
  focusEnd: () => void
  /**
   * Focuses the field with the caret at its very START.
   *
   * Le geste symétrique de `focusEnd` : Suppr sur une ligne (ou un bloc)
   * vide fait disparaître ce qui est DEVANT, et le curseur doit atterrir là où
   * ce qui suit commence — le début du champ suivant, comme un
   * `setSelectionRange(0, 0)` sur un texte. MathLive l'obtient par
   * `moveToMathfieldStart` ; le repli LaTeX brut pose la sélection à zéro.
   */
  focusStart: () => void
}

export interface MathFieldEditorProps {
  latex: string
  onChange: (latex: string) => void
  ariaLabel: string
  /** Shown until the editor is available, and kept if it never becomes available. */
  fallback: React.ReactNode
  /**
   * Entrée seule — jamais Maj+Entrée, que MathLive garde pour circuler entre
   * les rangées d'une construction multi-lignes : ajoute une LIGNE dans le
   * même bloc (ou la même cellule). C'est le « retour à la ligne » d'un texte,
   * transposé à une formule dont les lignes vivent côte à côte.
   */
  onEnter?: () => void
  /**
   * Ctrl/Cmd+Entrée : un NOUVEAU bloc après celui-ci — le geste « un bloc de
   * plus » de tous les autres champs. Absent dans une cellule de tableau, où
   * il n'y a pas de bloc à créer : `onEnter` prend alors la touche.
   */
  onEnterBlock?: () => void
  /** Retour arrière sur un champ vide : la ligne (ou le bloc) demande à être supprimée vers le précédent. */
  onEmptyBackspace?: () => void
  /** Suppr sur un champ vide : la ligne (ou le bloc) demande à disparaître vers le suivant. */
  onEmptyDelete?: () => void
  /**
   * Flèche haut : la ligne de formule PRÉCÉDENTE, dans le même champ. Absent
   * quand il n'y a qu'une ligne — la touche reste alors à MathLive, qui s'en
   * sert pour circuler dans une fraction.
   */
  onArrowUp?: () => void
  /** Flèche bas : la ligne de formule SUIVANTE, dans le même champ. Voir `onArrowUp`. */
  onArrowDown?: () => void
  ref?: React.Ref<MathFieldHandle>
}

/**
 * The `<math-field>` element as this app uses it, exported because a caller
 * sometimes has to reach the LIVE element rather than the declared handle — the
 * table's cell palette inserts into whichever cell holds the caret, and finds it
 * through `document.activeElement` rather than through a registry that a
 * column insertion would invalidate.
 */
export type MathfieldElement = HTMLElement & {
  value: string
  insert?: (fragment: string, options?: { focus?: boolean }) => void
  /** MathLive's generic command runner — `moveToMathfieldEnd`/`moveToMathfieldStart` (see `MathFieldHandle`). */
  executeCommand?: (command: string) => boolean
}

/** Module-level: the import is shared by every math block and resolves once. */
let loadPromise: Promise<boolean> | undefined
let loaded = false

/**
 * Masks the little keyboard button MathLive keeps in the corner of the field.
 *
 * `math-virtual-keyboard-policy="manual"` already stops the keyboard from
 * opening by itself, but the BUTTON is still drawn, and a button whose whole
 * promise is "open a keyboard" has no business on screen in an app that ships
 * a symbol palette instead. A stylesheet injected into the element's open
 * shadow root — MathLive styles that button with `.ML__virtual-keyboard-toggle`
 * inside its own shadow tree, so no rule written in `index.css` can reach it,
 * and MathLive documents no CSS part for it.
 *
 * Everything here is defensive: the shadow root may not exist yet if a future
 * MathLive attaches it lazily, and MathLive may not be there at all — in which
 * case this function is simply never called.
 */
function hideVirtualKeyboardToggle(field: MathfieldElement): void {
  const shadow = field.shadowRoot
  if (shadow === null) return
  const style = document.createElement('style')
  style.textContent = '.ML__virtual-keyboard-toggle { display: none !important; }'
  shadow.append(style)
}

function loadMathLive(): Promise<boolean> {
  loadPromise ??= import('mathlive')
    .then(() => {
      loaded = true
      return true
    })
    .catch(() => {
      // Left unloaded on purpose: the raw LaTeX field is a complete editor on
      // its own, so a failed import degrades to it rather than to nothing.
      // `false` is a settled answer rather than a failure to retry — the caller
      // keeps the raw field for good instead of waiting on an editor that is
      // never coming.
      return false
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
 * While the import is in flight — and forever if it fails — the caller's
 * `fallback` is what the user types into, so a slow or failed load never leaves
 * a formula unwritable. That field is a PAIR of boxes (the raw LaTeX source and
 * its KaTeX preview), which is the right thing to show when MathLive is never
 * arriving and the wrong thing to leave on screen once it has: it is what the
 * user sees as "two fields for one formula". So the block is upgraded to the
 * real editor as soon as the import settles, EXCEPT while the caret is inside
 * it — see `upgradeWhenIdle` in the component.
 */
export function MathFieldEditor({
  latex,
  onChange,
  ariaLabel,
  fallback,
  onEnter,
  onEnterBlock,
  onEmptyBackspace,
  onEmptyDelete,
  onArrowUp,
  onArrowDown,
  ref,
}: MathFieldEditorProps) {
  // Which editor this block shows. It starts on the caller's field whenever
  // MathLive is not already in memory, so the user can type IMMEDIATELY, and it
  // is upgraded to the real editor once the import settles.
  //
  // This used to be decide-once-and-never-revisit, on the reasoning that
  // swapping mid-sentence destroys the caret and the keystroke in flight. That
  // reasoning still holds — which is why the upgrade refuses to run while the
  // caret is inside this field — but making it absolute meant the FIRST formula
  // of every session kept the degraded pair of boxes (raw LaTeX plus preview)
  // permanently, reported as "two fields for one formula" and only cleared by a
  // text→formula round-trip, which remounts this component and re-reads the
  // flag.
  const [showMathField, setShowMathField] = useState(() => loaded)
  const hostRef = useRef<HTMLDivElement>(null)
  // Wraps BOTH branches, so "is the user typing in this field?" is a single
  // `contains` call whichever editor is on screen.
  const rootRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<MathfieldElement | null>(null)
  // Kept in a ref so the element's listener always calls the latest handler
  // without the effect having to tear the element down and rebuild it.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onEnterRef = useRef(onEnter)
  onEnterRef.current = onEnter
  const onEnterBlockRef = useRef(onEnterBlock)
  onEnterBlockRef.current = onEnterBlock
  const onEmptyBackspaceRef = useRef(onEmptyBackspace)
  onEmptyBackspaceRef.current = onEmptyBackspace
  const onEmptyDeleteRef = useRef(onEmptyDelete)
  onEmptyDeleteRef.current = onEmptyDelete
  const onArrowUpRef = useRef(onArrowUp)
  onArrowUpRef.current = onArrowUp
  const onArrowDownRef = useRef(onArrowDown)
  onArrowDownRef.current = onArrowDown
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
      focusEnd() {
        const field = fieldRef.current
        if (field !== null) {
          field.focus()
          field.executeCommand?.('moveToMathfieldEnd')
          return
        }
        // No live element — the raw-LaTeX fallback owns its own textarea, which
        // this component does not create, only wrap (see `rootRef` below).
        const raw = rootRef.current?.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea, input')
        raw?.focus()
        raw?.setSelectionRange(raw.value.length, raw.value.length)
      },
      focusStart() {
        const field = fieldRef.current
        if (field !== null) {
          field.focus()
          field.executeCommand?.('moveToMathfieldStart')
          return
        }
        // Same raw-LaTeX fallback as `focusEnd`, at the other end.
        const raw = rootRef.current?.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea, input')
        raw?.focus()
        raw?.setSelectionRange(0, 0)
      },
    }),
    []
  )

  /**
   * Moves this block from the caller's raw field to the real editor — but only
   * when nothing of the user's is at stake.
   *
   * Two guards, and both are load-bearing. `loaded` is the module flag, set only
   * once the import has actually SUCCEEDED: without it, a blur would upgrade a
   * block whose editor never arrived, replacing the raw LaTeX field the user can
   * type in with an empty host element they cannot. And if the caret is anywhere
   * inside this field's own markup they are mid-edit, so replacing the element
   * under them would throw away the caret, the focus and possibly the keystroke
   * in flight; `onBlur` below catches that case the moment they look away, so
   * the upgrade is deferred rather than lost.
   */
  function upgradeWhenIdle() {
    if (showMathField || !loaded) return
    const root = rootRef.current
    if (root !== null && root.contains(document.activeElement)) return
    setShowMathField(true)
  }

  // Kicks the import off without waiting for it, and upgrades THIS field when it
  // lands — unless the import failed, in which case the caller's raw-LaTeX pair
  // is not a loading state but the only editor this block will ever have.
  useEffect(() => {
    let cancelled = false
    void loadMathLive().then(available => {
      if (cancelled || !available) return
      upgradeWhenIdle()
    })
    return () => {
      cancelled = true
    }
    // Runs once: the import is started at mount and settles once per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!showMathField || host === null) return

    // `document.createElement`, not JSX: both JSX and LaTeX use braces, so
    // passing a LaTeX string as a child would need escaping at every call site.
    const field = document.createElement('math-field') as MathfieldElement
    field.setAttribute('aria-label', ariaLabel)
    // Le clavier virtuel de MathLive ne sert à rien ici : l'élève écrit sur un
    // vrai clavier, et les symboles dont il a besoin sont déjà à portée de clic
    // dans le bandeau au-dessus de la description (voir `SymbolBand`). Le
    // laisser s'ouvrir à chaque focus recouvrait la formule qu'on était en train
    // d'écrire. « manual » dit à MathLive de ne JAMAIS l'afficher tout seul ;
    // `index.css` masque aussi le bouton qui restait dans la barre latérale du
    // champ.
    field.setAttribute('math-virtual-keyboard-policy', 'manual')
    field.style.width = '100%'
    field.value = latex
    field.addEventListener('input', () => onChangeRef.current(field.value))
    field.addEventListener('keydown', event => {
      // ↑/↓ ne changent de ligne que si le bloc en a PLUSIEURS : une formule
      // mono-ligne laisse la touche à MathLive, qui s'en sert dans une fraction.
      // Voir `MathLinesField`.
      if (event.key === 'ArrowUp' && onArrowUpRef.current !== undefined) {
        event.preventDefault()
        onArrowUpRef.current()
        return
      }
      if (event.key === 'ArrowDown' && onArrowDownRef.current !== undefined) {
        event.preventDefault()
        onArrowDownRef.current()
        return
      }
      if (event.key === 'Backspace' && field.value === '' && onEmptyBackspaceRef.current !== undefined) {
        event.preventDefault()
        onEmptyBackspaceRef.current()
        return
      }
      if (event.key === 'Delete' && field.value === '' && onEmptyDeleteRef.current !== undefined) {
        event.preventDefault()
        onEmptyDeleteRef.current()
        return
      }
      if (event.key !== 'Enter' || event.shiftKey) return
      event.preventDefault()
      // Ctrl/Cmd+Entrée demande un NOUVEAU bloc ; Entrée seule une ligne de plus
      // dans celui-ci. Dans une cellule (pas de `onEnterBlock`), les deux
      // ajoutent une ligne : il n'y a pas de bloc à créer.
      if ((event.ctrlKey || event.metaKey) && onEnterBlockRef.current !== undefined) onEnterBlockRef.current()
      else onEnterRef.current?.()
    })
    host.replaceChildren(field)
    fieldRef.current = field
    hideVirtualKeyboardToggle(field)

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

  return (
    <div
      ref={rootRef}
      onBlur={upgradeWhenIdle}
      // `flexGrow`/`flexBasis` and `minWidth: 0` are what let a formula CELL
      // fill its column. A table cell lays this out as an item of a flex ROW,
      // where a block element that only sets `width: 100%` still sizes to its
      // own content — which is why the raw field (an `<input>`, itself a flex
      // item that grows) filled the cell while the WYSIWYG host did not. Written
      // as longhands so the intent is exact rather than at the mercy of a
      // shorthand. In the description's own flow the parent is not a flex row,
      // so the grow is inert and only the width applies.
      style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, width: '100%' }}
    >
      {showMathField ? (
        <div ref={hostRef} data-testid="math-field" style={{ width: '100%' }} />
      ) : (
        fallback
      )}
    </div>
  )
}
