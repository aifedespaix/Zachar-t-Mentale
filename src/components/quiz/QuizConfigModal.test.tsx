// src/components/quiz/QuizConfigModal.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { QuizConfigModal } from './QuizConfigModal'
import { useQuizStore, createQuizStore } from '../../state/useQuizStore'

describe('QuizConfigModal', () => {
  beforeEach(() => {
    const pristine = createQuizStore().getState()
    useQuizStore.setState({
      active: pristine.active,
      showSummary: pristine.showSummary,
      config: pristine.config,
      questions: pristine.questions,
      results: pristine.results,
      wasLockedBeforeQuiz: pristine.wasLockedBeforeQuiz,
    })
  })

  it('starts the quiz with all levels checked, "moyen" difficulty and QCM off by default', async () => {
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: /lancer le quiz/i }))

    expect(useQuizStore.getState().config).toEqual({ levels: [1, 2, 3, 4], difficulty: 'moyen', qcmMode: false })
  })

  it('excludes an unchecked level from the launched config', async () => {
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('checkbox', { name: /^titre$/i }))
    await user.click(screen.getByRole('button', { name: /lancer le quiz/i }))

    expect(useQuizStore.getState().config?.levels).toEqual([2, 3, 4])
  })

  it('uses the selected difficulty preset', async () => {
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('radio', { name: /^difficile$/i }))
    await user.click(screen.getByRole('button', { name: /lancer le quiz/i }))

    expect(useQuizStore.getState().config?.difficulty).toBe('difficile')
  })

  it('turns qcmMode on when the QCM toggle is switched', async () => {
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('switch', { name: /mode qcm/i }))
    await user.click(screen.getByRole('button', { name: /lancer le quiz/i }))

    expect(useQuizStore.getState().config?.qcmMode).toBe(true)
  })

  it('disables the launch button when no level is checked', async () => {
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    for (const name of [/^titre$/i, /^sous-titre$/i, /^sous-partie$/i, /^info$/i]) {
      await user.click(screen.getByRole('checkbox', { name }))
    }

    expect(screen.getByRole('button', { name: /lancer le quiz/i })).toBeDisabled()
  })

  it('closes the modal after launching', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<QuizConfigModal open onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('button', { name: /lancer le quiz/i }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('QuizConfigModal difficulty selector', () => {
  beforeEach(() => {
    const pristine = createQuizStore().getState()
    useQuizStore.setState({
      active: pristine.active,
      showSummary: pristine.showSummary,
      config: pristine.config,
      questions: pristine.questions,
      results: pristine.results,
      recallProgress: pristine.recallProgress,
      wasLockedBeforeQuiz: pristine.wasLockedBeforeQuiz,
    })
  })

  it('marks exactly one difficulty as chosen', () => {
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    const chosen = screen.getAllByRole('radio').filter(option => option.getAttribute('aria-checked') === 'true')
    expect(chosen).toHaveLength(1)
    expect(chosen[0]).toHaveAccessibleName('Moyen')
  })

  it('moves the selection when another difficulty is picked', async () => {
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('radio', { name: 'Facile' }))

    expect(screen.getByRole('radio', { name: 'Facile' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Moyen' })).toHaveAttribute('aria-checked', 'false')
  })

  it('says what each difficulty does to a written answer, not just how many cards it draws', () => {
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    expect(screen.getByText('La première lettre seulement')).toBeInTheDocument()
    expect(screen.getByText('La moitié des lettres offertes')).toBeInTheDocument()
  })
})
