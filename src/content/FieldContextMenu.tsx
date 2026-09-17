import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { Check, ClipboardPaste, Copy, Scissors, SpellCheck, TextSelect } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../components/ui/context-menu'
import type { MathfieldElement } from './MathFieldEditor'
import { MenuShortcut } from './descriptionMenuKit'

export interface FieldContextMenuProps {
  /** Whether the zone holds prose (spellcheck applies) or a formula (it never does). */
  kind: 'text' | 'math'
  /** Same convention as `BlockEditor`'s own: never silent about a failed paste. */
  onError?: (message: string) => void
  children: ReactNode
}

/** The actual editable node inside the wrapper — a `<textarea>`, an `<input>`, or MathLive's custom element. */
function editableIn(wrapper: HTMLElement): HTMLElement | null {
  return wrapper.querySelector<HTMLElement>('textarea, input, math-field')
}

/** `execCommand('copy'/'cut')` still fires the same clipboard event a real `Ctrl+C`/`Ctrl+X` does — MathLive and the browser both already listen for it, so one call covers a formula and a text field alike. */
function runClipboardCommand(command: 'copy' | 'cut') {
  document.execCommand(command)
}

/**
 * Reads the clipboard and inserts it at the caret.
 *
 * Deliberately NOT `execCommand('paste')`: unlike copy/cut, most engines
 * block that call for unprivileged content, so it would fail silently and
 * unpredictably depending on the platform the app happens to run on. The
 * async Clipboard API gives one predictable outcome — it works, or the
 * `catch` below says so — instead of a coin flip per platform.
 */
async function pasteInto(el: HTMLElement, onError?: (message: string) => void) {
  try {
    const text = await navigator.clipboard.readText()
    if (text === '') return
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
      // The native setter, not `el.value = …`: React tracks the DOM value
      // through its own installed setter, so writing through THAT would make
      // it believe nothing changed and never fire the field's `onChange`.
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? start
      const next = el.value.slice(0, start) + text + el.value.slice(end)
      setter?.call(el, next)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.setSelectionRange(start + text.length, start + text.length)
    } else if (el.tagName === 'MATH-FIELD') {
      ;(el as MathfieldElement).insert?.(text, { focus: true })
    }
  } catch {
    onError?.('Impossible de coller : le presse-papiers n’est pas accessible.')
  }
}

/**
 * The right-click menu of a text or formula ZONE — as opposed to
 * `BlockContextMenu` (the block it sits in) and `EmptyAreaContextMenu` (the
 * space around every block). Wraps its children in a plain trigger rather
 * than `asChild`: the zone can be a `<textarea>` or MathLive's `<math-field>`
 * host, rendered by components (`AutoGrowTextarea`, `MathFieldEditor`) that do
 * not forward arbitrary props to their own root element, so cloning onto them
 * would silently attach nothing. `display: contents` keeps the wrapper out of
 * layout entirely — it is invisible to a table cell's own flex sizing — while
 * still being a real DOM node events bubble through, which is how
 * `editableIn` finds the actual field to act on.
 *
 * `Couper`/`Copier`/`Coller` and `Ctrl+C`/`Ctrl+X`/`Ctrl+V` already do the same
 * thing without this menu — a right-click here is the mouse-only path to the
 * same three gestures, not a new one.
 */
export function FieldContextMenu({ kind, onError, children }: FieldContextMenuProps) {
  // Set from `onContextMenu` itself, never via a `ref` prop: the shared
  // `ContextMenuTrigger` wrapper does not declare one, and the event already
  // hands over `currentTarget` — the exact node the listener is attached to —
  // the moment the menu opens, which is all `withField` needs later.
  const wrapperRef = useRef<HTMLElement | null>(null)
  const [spellcheck, setSpellcheck] = useState(true)

  /** Re-focuses the field before acting: Radix returns focus to whatever opened the menu as it closes. */
  function withField(run: (field: HTMLElement) => void) {
    const wrapper = wrapperRef.current
    const field = wrapper === null ? null : editableIn(wrapper)
    if (field === null) return
    setTimeout(() => {
      field.focus()
      run(field)
    }, 0)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        style={{ display: 'contents' }}
        onContextMenu={event => {
          event.stopPropagation()
          wrapperRef.current = event.currentTarget
          const field = editableIn(event.currentTarget)
          if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
            setSpellcheck(field.spellcheck)
          }
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => withField(() => runClipboardCommand('cut'))}>
          <Scissors size={14} />
          <span style={{ flex: 1 }}>Couper</span>
          <MenuShortcut keys="Ctrl + X" />
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => withField(() => runClipboardCommand('copy'))}>
          <Copy size={14} />
          <span style={{ flex: 1 }}>Copier</span>
          <MenuShortcut keys="Ctrl + C" />
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => withField(field => void pasteInto(field, onError))}>
          <ClipboardPaste size={14} />
          <span style={{ flex: 1 }}>Coller</span>
          <MenuShortcut keys="Ctrl + V" />
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={() => withField(() => document.execCommand('selectAll'))}>
          <TextSelect size={14} />
          <span style={{ flex: 1 }}>Tout sélectionner</span>
          <MenuShortcut keys="Ctrl + A" />
        </ContextMenuItem>

        {kind === 'text' && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() =>
                withField(field => {
                  if (!(field instanceof HTMLTextAreaElement) && !(field instanceof HTMLInputElement)) return
                  field.spellcheck = !field.spellcheck
                  setSpellcheck(field.spellcheck)
                })
              }
            >
              <SpellCheck size={14} />
              <span style={{ flex: 1 }}>Vérifier l’orthographe</span>
              {spellcheck && <Check size={13} />}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
