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
    // Structural, not timing-dependent: replacing a focused element
    // mid-sentence would destroy the caret and the keystroke in flight.
    const { rerender } = render(
      <MathFieldEditor latex="x" onChange={() => {}} ariaLabel="Formule" fallback={<textarea aria-label="Brut" />} />
    )
    const first = screen.queryByTestId('math-field')

    await new Promise(resolve => setTimeout(resolve, 20))
    rerender(
      <MathFieldEditor latex="y" onChange={() => {}} ariaLabel="Formule" fallback={<textarea aria-label="Brut" />} />
    )

    expect(screen.queryByTestId('math-field') === null).toBe(first === null)
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
