import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
  it('shows the fallback field until the editor has loaded', () => {
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

  it('never swaps the field while it is mounted, whenever the import resolves', async () => {
    // The previous version of this test compared the same query to itself at
    // two moments, so it passed even with the regression it was meant to
    // catch reintroduced. This one mounts BEFORE the import can resolve, and
    // proves the fallback is still there afterwards — which is false the
    // instant the component reacts to the load.
    vi.resetModules()
    const { MathFieldEditor: Fresh } = await import('./MathFieldEditor')

    render(
      <Fresh latex="x" onChange={() => {}} ariaLabel="Formule" fallback={<textarea aria-label="Brut" />} />
    )
    expect(screen.getByRole('textbox', { name: /brut/i })).toBeInTheDocument()

    // Long enough for the dynamic import to have resolved several times over.
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(screen.getByRole('textbox', { name: /brut/i })).toBeInTheDocument()
    expect(screen.queryByTestId('math-field')).not.toBeInTheDocument()
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
