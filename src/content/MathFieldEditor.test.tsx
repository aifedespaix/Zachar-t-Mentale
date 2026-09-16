import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MathFieldEditor } from './MathFieldEditor'

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

  it('never replaces the field the caret is in, and upgrades as soon as it leaves', async () => {
    // The guarantee the old decide-once rule existed to protect, kept intact:
    // swapping the element under a typing user would destroy the caret, the
    // focus and the keystroke in flight. The upgrade waits instead.
    vi.resetModules()
    const { MathFieldEditor: Fresh } = await import('./MathFieldEditor')

    render(
      <Fresh latex="x" onChange={() => {}} ariaLabel="Formule" fallback={<textarea aria-label="Brut" />} />
    )
    const raw = screen.getByRole('textbox', { name: /brut/i })
    raw.focus()

    // Long enough for the dynamic import to have resolved several times over.
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(screen.getByRole('textbox', { name: /brut/i })).toBeInTheDocument()
    expect(screen.queryByTestId('math-field')).not.toBeInTheDocument()

    // Looking away is what unblocks it — deferred, not lost.
    await act(async () => {
      raw.blur()
    })
    expect(screen.getByTestId('math-field')).toBeInTheDocument()
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

    // Including once focus leaves — the guard that blocks the upgrade while the
    // caret is in the field must NOT be the only thing keeping it there.
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
