import { render, screen } from '@testing-library/react'
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
      <QcmDialog open title="T" correctDefinition="Bonne" distractors={['Fausse']} onAnswer={() => {}} />
    )

    await user.click(screen.getByText('Fausse'))

    expect(screen.getByText('Bonne')).toBeDisabled()
    expect(screen.getByText('Fausse')).toBeDisabled()
  })

  it('calls onAnswer with the chosen definition after a short delay', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onAnswer = vi.fn()
    render(<QcmDialog open title="T" correctDefinition="Bonne" distractors={['Fausse']} onAnswer={onAnswer} />)

    await user.click(screen.getByText('Fausse'))
    expect(onAnswer).not.toHaveBeenCalled()

    vi.advanceTimersByTime(700)
    expect(onAnswer).toHaveBeenCalledWith('Fausse')
  })
})
