import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecallDialog } from './RecallDialog'
import { EMPTY_RECALL_PROGRESS } from '../../types/quiz'
import type { RecallProgress } from '../../types/quiz'

type DialogProps = Parameters<typeof RecallDialog>[0]

function renderDialog(overrides: Partial<DialogProps> = {}) {
  const props: DialogProps = {
    open: true,
    title: 'Bonsoir',
    difficulty: 'difficile',
    progress: EMPTY_RECALL_PROGRESS,
    onSubmit: vi.fn(() => ({ correct: false, similarity: 62 })),
    onGiveUp: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  const { rerender } = render(<RecallDialog {...props} />)
  return {
    ...props,
    /** Re-render with an updated progress, as the store does after a submit. */
    withProgress: (progress: RecallProgress) => rerender(<RecallDialog {...props} progress={progress} />),
  }
}

describe('RecallDialog', () => {
  it('asks for the title without ever printing it', () => {
    renderDialog()

    expect(screen.getByRole('heading', { name: /retrouve le titre/i })).toBeInTheDocument()
    expect(screen.queryByText('Bonsoir')).not.toBeInTheDocument()
  })

  it('shows where the card sits in the tree, the only clue a written answer gets', () => {
    renderDialog({ parentTitle: 'Salutations' })
    expect(screen.getByText('Salutations')).toBeInTheDocument()
  })

  it('will not validate an empty answer', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: 'Valider' })).toBeDisabled()
  })

  it('submits the answer woven into the revealed letters, not just what was typed', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderDialog({ onSubmit: vi.fn(() => ({ correct: true, similarity: 100 })) })

    await user.type(screen.getByLabelText('Réponse'), 'onsoir')
    await user.click(screen.getByRole('button', { name: 'Valider' }))

    // The conceded "B" belongs to the answer even though it was never typed.
    expect(onSubmit).toHaveBeenCalledWith('Bonsoir')
  })

  it('reports how close a wrong answer was, and does not print the right one', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByLabelText('Réponse'), 'onjour')
    await user.click(screen.getByRole('button', { name: 'Valider' }))

    expect(screen.getByRole('status')).toHaveTextContent('62% — pas encore ça.')
    expect(screen.queryByText('Bonsoir')).not.toBeInTheDocument()
  })

  it('offers another go after a miss instead of ending the question', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByLabelText('Réponse'), 'onjour')
    await user.click(screen.getByRole('button', { name: 'Valider' }))

    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Valider' })).not.toBeInTheDocument()
  })

  it('holds the new letter back until the feedback has been read', async () => {
    const user = userEvent.setup()
    const { withProgress } = renderDialog()

    await user.type(screen.getByLabelText('Réponse'), 'onjour')
    await user.click(screen.getByRole('button', { name: 'Valider' }))
    // The store grants the extra letter the moment the answer is graded.
    withProgress({ ...EMPTY_RECALL_PROGRESS, attempts: 1, extraReveals: 1 })

    // Still six boxes: the field must not shift under the red/green feedback.
    expect(screen.getByLabelText('Réponse')).toHaveAttribute('maxLength', '6')

    await user.click(screen.getByRole('button', { name: 'Réessayer' }))

    expect(screen.getByLabelText('Réponse')).toHaveAttribute('maxLength', '5')
  })

  it('carries the typed letters across the retry so a near miss is not retyped', async () => {
    const user = userEvent.setup()
    const { withProgress } = renderDialog()

    await user.type(screen.getByLabelText('Réponse'), 'onjour')
    await user.click(screen.getByRole('button', { name: 'Valider' }))
    withProgress({ ...EMPTY_RECALL_PROGRESS, attempts: 1, extraReveals: 1 })
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))

    // The final "r" is now given, so it leaves the field; the rest stays put.
    expect(screen.getByLabelText('Réponse')).toHaveValue('onjou')
  })

  it('congratulates a correct answer and closes by itself', async () => {
    vi.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { onClose } = renderDialog({ onSubmit: vi.fn(() => ({ correct: true, similarity: 100 })) })

    await user.type(screen.getByLabelText('Réponse'), 'onsoir')
    await user.click(screen.getByRole('button', { name: 'Valider' }))

    expect(screen.getByRole('status')).toHaveTextContent('Trouvé du premier coup !')
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1200)
    })
    expect(onClose).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('praises an answer found after retries without calling it a first-try success', async () => {
    const user = userEvent.setup()
    renderDialog({
      progress: { ...EMPTY_RECALL_PROGRESS, attempts: 2, extraReveals: 2 },
      onSubmit: vi.fn(() => ({ correct: true, similarity: 100 })),
    })

    await user.type(screen.getByLabelText('Réponse'), 'ons')
    await user.click(screen.getByRole('button', { name: 'Valider' }))

    expect(screen.getByRole('status')).toHaveTextContent('Trouvé — tu y es arrivé !')
  })

  it('gives the answer up only when the user asks for it', async () => {
    const user = userEvent.setup()
    const { onGiveUp } = renderDialog()

    await user.click(screen.getByRole('button', { name: /voir la réponse/i }))

    expect(onGiveUp).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('La réponse était Bonsoir')
  })

  it('stops accepting input once the answer has been given away', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: /voir la réponse/i }))

    expect(screen.getByLabelText('Réponse')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Valider' })).not.toBeInTheDocument()
  })

  it('says so when help has run out, rather than promising another letter', async () => {
    const user = userEvent.setup()
    // Six of "Bonsoir"'s seven letters already given: one box left.
    const { withProgress } = renderDialog({ progress: { ...EMPTY_RECALL_PROGRESS, attempts: 5, extraReveals: 5 } })

    await user.type(screen.getByLabelText('Réponse'), 'x')
    await user.click(screen.getByRole('button', { name: 'Valider' }))
    withProgress({ ...EMPTY_RECALL_PROGRESS, attempts: 6, extraReveals: 6 })

    expect(screen.getByRole('status')).toHaveTextContent('Toutes les lettres sont maintenant affichées')
  })

  it('still promises another letter while there are some left to give', async () => {
    const user = userEvent.setup()
    const { withProgress } = renderDialog()

    await user.type(screen.getByLabelText('Réponse'), 'onjour')
    await user.click(screen.getByRole('button', { name: 'Valider' }))
    withProgress({ ...EMPTY_RECALL_PROGRESS, attempts: 1, extraReveals: 1 })

    expect(screen.getByRole('status')).toHaveTextContent('Une lettre de plus t’est offerte')
  })
})
