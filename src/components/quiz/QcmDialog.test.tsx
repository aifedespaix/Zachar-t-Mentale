import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QcmDialog } from './QcmDialog'

describe('QcmDialog', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the heading and all four options (correct + distractors)', () => {
    render(
      <QcmDialog
        open
        heading="Photosynthèse"
        correctOption="Bonne définition"
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

  it('shows a hint box when a hint is provided', () => {
    render(
      <QcmDialog
        open
        heading="Quel est le titre de cette carte ?"
        hint="Processus par lequel les plantes..."
        correctOption="La photosynthèse"
        distractors={['La respiration']}
        onAnswer={() => {}}
        onCancel={() => {}}
      />
    )

    expect(screen.getByText(/processus par lequel les plantes/i)).toBeInTheDocument()
  })

  it('shows the no-hint note instead when there is no hint', () => {
    render(
      <QcmDialog
        open
        heading="Quel est le titre de cette carte ?"
        noHintNote="Aide-toi de la position de la carte dans l'arbre."
        correctOption="La photosynthèse"
        distractors={['La respiration']}
        onAnswer={() => {}}
        onCancel={() => {}}
      />
    )

    expect(screen.getByText(/aide-toi de la position/i)).toBeInTheDocument()
  })

  it('disables every option once one has been chosen', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <QcmDialog open heading="T" correctOption="Bonne" distractors={['Fausse']} onAnswer={() => {}} onCancel={() => {}} />
    )

    await user.click(screen.getByText('Fausse'))

    expect(screen.getByText('Bonne').closest('button')).toBeDisabled()
    expect(screen.getByText('Fausse').closest('button')).toBeDisabled()
  })

  it('calls onAnswer with the chosen option after a short delay', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onAnswer = vi.fn()
    render(
      <QcmDialog open heading="T" correctOption="Bonne" distractors={['Fausse']} onAnswer={onAnswer} onCancel={() => {}} />
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
      <QcmDialog open heading="T" correctOption="Bonne" distractors={['Fausse']} onAnswer={onAnswer} onCancel={onCancel} />
    )

    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('shows green/red visual feedback immediately after choosing a wrong option, and shows neither before any choice', () => {
    render(
      <QcmDialog open heading="T" correctOption="Bonne" distractors={['Fausse']} onAnswer={() => {}} onCancel={() => {}} />
    )

    const correctButton = screen.getByText('Bonne').closest('button') as HTMLButtonElement
    const wrongButton = screen.getByText('Fausse').closest('button') as HTMLButtonElement

    expect(correctButton.querySelector('svg.lucide-check')).toBeNull()
    expect(wrongButton.querySelector('svg.lucide-x')).toBeNull()

    fireEvent.click(wrongButton)

    expect(correctButton).toHaveStyle({ borderColor: '#16a34a' })
    expect(wrongButton).toHaveStyle({ borderColor: '#dc2626' })
    expect(correctButton.querySelector('svg.lucide-check')).toBeInTheDocument()
    expect(wrongButton.querySelector('svg.lucide-x')).toBeInTheDocument()
  })
})

describe('rich option rendering', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const base = {
    open: true,
    heading: 'Avec calculatrice',
    correctOption: '20/100 × 425',
    distractors: ['425 / 20', '100 × 425'],
    onCancel: () => {},
  }

  it('displays an option through renderOption while keeping the string as identity', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onAnswer = vi.fn()
    render(
      <QcmDialog
        {...base}
        onAnswer={onAnswer}
        renderOption={option => <span data-testid="rendu">FORMULE:{option}</span>}
      />
    )

    // Displayed richly…
    expect(screen.getAllByTestId('rendu').length).toBe(3)
    // …but answered with the plain string, which is what grading compares.
    await user.click(screen.getByText('FORMULE:20/100 × 425').closest('button')!)
    vi.advanceTimersByTime(700)
    expect(onAnswer).toHaveBeenCalledWith('20/100 × 425')
  })

  it('falls back to the plain option when no renderer is given', () => {
    render(<QcmDialog {...base} onAnswer={() => {}} />)
    expect(screen.getByText('20/100 × 425')).toBeInTheDocument()
  })
})
