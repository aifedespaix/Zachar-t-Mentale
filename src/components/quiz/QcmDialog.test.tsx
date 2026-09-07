import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QcmDialog } from './QcmDialog'

describe('QcmDialog', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the title and all four options (correct + distractors)', () => {
    render(
      <QcmDialog
        open
        title="Photosynthèse"
        correctDefinition="Bonne définition"
        distractors={['Fausse A', 'Fausse B', 'Fausse C']}
        onAnswer={() => {}}
        onCancel={() => {}}
      />
    )

    expect(screen.getByRole('heading', { name: 'Photosynthèse' })).toBeInTheDocument()
    for (const text of ['Bonne définition', 'Fausse A', 'Fausse B', 'Fausse C']) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
  })

  it('disables every option once one has been chosen', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <QcmDialog open title="T" correctDefinition="Bonne" distractors={['Fausse']} onAnswer={() => {}} onCancel={() => {}} />
    )

    await user.click(screen.getByText('Fausse'))

    expect(screen.getByText('Bonne')).toBeDisabled()
    expect(screen.getByText('Fausse')).toBeDisabled()
  })

  it('calls onAnswer with the chosen definition after a short delay', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onAnswer = vi.fn()
    render(
      <QcmDialog
        open
        title="T"
        correctDefinition="Bonne"
        distractors={['Fausse']}
        onAnswer={onAnswer}
        onCancel={() => {}}
      />
    )

    await user.click(screen.getByText('Fausse'))
    expect(onAnswer).not.toHaveBeenCalled()

    vi.advanceTimersByTime(700)
    expect(onAnswer).toHaveBeenCalledWith('Fausse')
  })

  it('calls onCancel (not onAnswer) when dismissed via Escape before any choice is made', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onAnswer = vi.fn()
    const onCancel = vi.fn()
    render(
      <QcmDialog
        open
        title="T"
        correctDefinition="Bonne"
        distractors={['Fausse']}
        onAnswer={onAnswer}
        onCancel={onCancel}
      />
    )

    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('shows green/red visual feedback immediately after choosing a wrong option, and shows neither before any choice', () => {
    render(
      <QcmDialog
        open
        title="T"
        correctDefinition="Bonne"
        distractors={['Fausse']}
        onAnswer={() => {}}
        onCancel={() => {}}
      />
    )

    const correctButton = screen.getByText('Bonne').closest('button') as HTMLButtonElement
    const wrongButton = screen.getByText('Fausse').closest('button') as HTMLButtonElement

    // Before any choice: no Check/X feedback icons anywhere (lucide-react
    // renders each icon as an <svg class="lucide lucide-check|x ...">, with
    // no accessible role, so a class-based query is the reliable check here).
    expect(correctButton.querySelector('svg.lucide-check')).toBeNull()
    expect(wrongButton.querySelector('svg.lucide-x')).toBeNull()

    fireEvent.click(wrongButton)

    expect(correctButton).toHaveStyle({ borderColor: '#16a34a' })
    expect(wrongButton).toHaveStyle({ borderColor: '#dc2626' })
    expect(correctButton.querySelector('svg.lucide-check')).toBeInTheDocument()
    expect(wrongButton.querySelector('svg.lucide-x')).toBeInTheDocument()
  })
})
