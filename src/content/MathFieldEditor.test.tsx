import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MathFieldEditor, type MathFieldHandle } from './MathFieldEditor'

// MathLive registers a custom element as an import side effect; the real
// package is heavy and needs APIs jsdom lacks, so the seam under test is
// "does the dynamic import gate the swap correctly".
vi.mock('mathlive', () => {
  if (!customElements.get('math-field')) {
    customElements.define(
      'math-field',
      class extends HTMLElement {
        #value = ''
        get value() {
          return this.#value
        }
        set value(next: string) {
          this.#value = next
        }
      }
    )
  }
  return {}
})

describe('MathFieldEditor', () => {
  beforeEach(() => vi.clearAllMocks())

  // The module-level `loaded` flag is set by the first test that mounts the
  // component, so the "not yet loaded" case has to run FIRST and be the only
  // one that relies on it. Anything asserting the loaded state waits for it
  // explicitly rather than assuming a previous test warmed the flag.
  it('shows the fallback field until the editor has loaded', async () => {
    render(
      <MathFieldEditor
        latex="x^2"
        onChange={() => {}}
        ariaLabel="Formule"
        fallback={<textarea aria-label="Formule brute" defaultValue="x^2" />}
      />
    )
    // Synchronously, before the dynamic import resolves: the user must be able
    // to type immediately, and forever if the import never resolves.
    expect(screen.getByRole('textbox', { name: /formule brute/i })).toBeInTheDocument()

    // Let the pending import settle inside `act`: it triggers the upgrade below,
    // and a state update React does not know about is a warning, not a test.
    await act(async () => {})
  })

  it('swaps in the math field once loaded, seeded with the current formula', async () => {
    render(
      <MathFieldEditor latex="x^2" onChange={() => {}} ariaLabel="Formule" fallback={<textarea />} />
    )

    await waitFor(() => expect(screen.getByTestId('math-field')).toBeInTheDocument())
    const field = screen.getByTestId('math-field').firstElementChild as HTMLElement & { value: string }
    expect(field.tagName.toLowerCase()).toBe('math-field')
    expect(field.value).toBe('x^2')
    expect(field.getAttribute('aria-label')).toBe('Formule')
  })

  it('reports what the user types as LaTeX', async () => {
    const onChange = vi.fn()
    render(<MathFieldEditor latex="" onChange={onChange} ariaLabel="Formule" fallback={<textarea />} />)

    await waitFor(() => expect(screen.getByTestId('math-field')).toBeInTheDocument())
    const field = screen.getByTestId('math-field').firstElementChild as HTMLElement & { value: string }
    field.value = '\\frac{1}{2}'
    field.dispatchEvent(new Event('input'))

    expect(onChange).toHaveBeenCalledWith('\\frac{1}{2}')
  })

  it('upgrades the raw field once the editor lands, so one formula stops being two boxes', async () => {
    // The reported defect: on the first formula of a session, the raw-LaTeX
    // field and its preview sat there for good — "two fields for one formula" —
    // because the choice was made at mount and never revisited. Mounting before
    // the import resolves reproduces that window.
    vi.resetModules()
    const { MathFieldEditor: Fresh } = await import('./MathFieldEditor')

    render(
      <Fresh latex="x" onChange={() => {}} ariaLabel="Formule" fallback={<textarea aria-label="Brut" />} />
    )
    // Before the import settles: the caller's field, immediately typeable.
    expect(screen.getByRole('textbox', { name: /brut/i })).toBeInTheDocument()

    // `act` rather than `waitFor`: the upgrade IS the state update under test,
    // and letting it land outside `act` is what React warns about.
    await act(async () => {})

    expect(screen.getByTestId('math-field')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /brut/i })).not.toBeInTheDocument()
  })

  it('upgrades in place while the caret is inside it, instead of waiting for blur', async () => {
    // The reported defect this replaces: refusing to swap while focused left
    // whichever formula the user was actively typing into — often the first
    // one of the session — stuck showing the raw LaTeX pair until they
    // clicked away, which read as a broken field to someone who never asked
    // to see LaTeX source. The caret is carried across the swap instead (see
    // `mathFieldKeys.test.tsx` for the offset itself being preserved).
    vi.resetModules()
    const { MathFieldEditor: Fresh } = await import('./MathFieldEditor')

    render(
      <Fresh latex="x" onChange={() => {}} ariaLabel="Formule" fallback={<textarea aria-label="Brut" defaultValue="x" />} />
    )
    const raw = screen.getByRole('textbox', { name: /brut/i }) as HTMLTextAreaElement
    raw.focus()
    raw.setSelectionRange(1, 1)

    // Let the pending import settle inside `act`, exactly as focused as before.
    await act(async () => {})

    expect(screen.getByTestId('math-field')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /brut/i })).not.toBeInTheDocument()
  })

  it('stays on the caller’s field forever when the editor never loads', async () => {
    vi.resetModules()
    vi.doMock('mathlive', () => {
      throw new Error('no MathLive here')
    })
    const { MathFieldEditor: Broken } = await import('./MathFieldEditor')

    render(
      <Broken latex="x" onChange={() => {}} ariaLabel="Formule" fallback={<textarea aria-label="Brut" />} />
    )
    await new Promise(resolve => setTimeout(resolve, 50))

    // A failed import is a settled answer, not a loading state: the raw field is
    // the only editor this block will ever have.
    expect(screen.getByRole('textbox', { name: /brut/i })).toBeInTheDocument()
    expect(screen.queryByTestId('math-field')).not.toBeInTheDocument()

    // Including once focus leaves — `loaded` staying false must be what keeps
    // the raw field here, not incidentally never running the upgrade path.
    // Otherwise a blur would replace the one field the user can type in with an
    // empty host element they cannot.
    const raw = screen.getByRole('textbox', { name: /brut/i })
    raw.focus()
    raw.blur()

    expect(screen.getByRole('textbox', { name: /brut/i })).toBeInTheDocument()
    expect(screen.queryByTestId('math-field')).not.toBeInTheDocument()
    vi.doUnmock('mathlive')
  })

  it('grows the WYSIWYG host to fill its box, so a formula cell matches its column', async () => {
    // A table cell lays this out in a flex row. The host used to carry no style
    // at all, so it sized to its own content while the raw field filled the cell.
    render(<MathFieldEditor latex="x" onChange={() => {}} ariaLabel="Formule" fallback={<textarea />} />)

    await waitFor(() => expect(screen.getByTestId('math-field')).toBeInTheDocument())
    const host = screen.getByTestId('math-field')
    expect(host.style.width).toBe('100%')
    expect(host.parentElement?.style.flexGrow).toBe('1')
    expect(host.parentElement?.style.minWidth).toBe('0px')
  })

  it('focusEnd() focuses the live field and asks it to move the caret to its end', async () => {
    const handleRef: { current: MathFieldHandle | null } = { current: null }
    render(
      <MathFieldEditor
        ref={h => {
          handleRef.current = h
        }}
        latex="x^2"
        onChange={() => {}}
        ariaLabel="Formule"
        fallback={<textarea />}
      />
    )

    await waitFor(() => expect(screen.getByTestId('math-field')).toBeInTheDocument())
    const field = screen.getByTestId('math-field').firstElementChild as HTMLElement & {
      focus: () => void
      executeCommand: (command: string) => boolean
    }
    field.focus = vi.fn()
    field.executeCommand = vi.fn()

    handleRef.current?.focusEnd()

    expect(field.focus).toHaveBeenCalledTimes(1)
    expect(field.executeCommand).toHaveBeenCalledWith('moveToMathfieldEnd')
  })

  it('focusEnd() falls back to the caller’s own field before the editor has loaded', async () => {
    vi.resetModules()
    const { MathFieldEditor: Fresh } = await import('./MathFieldEditor')
    const handleRef: { current: MathFieldHandle | null } = { current: null }

    render(
      <Fresh
        ref={h => {
          handleRef.current = h
        }}
        latex="x"
        onChange={() => {}}
        ariaLabel="Formule"
        fallback={<textarea aria-label="Brut" defaultValue="x" />}
      />
    )

    const raw = screen.getByRole('textbox', { name: /brut/i }) as HTMLTextAreaElement
    handleRef.current?.focusEnd()

    expect(raw).toHaveFocus()
    expect(raw.selectionStart).toBe(raw.value.length)
  })

  it('pushes an external change in without rebuilding the element', async () => {
    const { rerender } = render(
      <MathFieldEditor latex="x" onChange={() => {}} ariaLabel="Formule" fallback={<textarea />} />
    )
    await waitFor(() => expect(screen.getByTestId('math-field')).toBeInTheDocument())
    const before = screen.getByTestId('math-field').firstElementChild

    rerender(<MathFieldEditor latex="y" onChange={() => {}} ariaLabel="Formule" fallback={<textarea />} />)

    const after = screen.getByTestId('math-field').firstElementChild as HTMLElement & { value: string }
    // Same element — rebuilding it on every keystroke would destroy the caret.
    expect(after).toBe(before)
    expect(after.value).toBe('y')
  })
})
