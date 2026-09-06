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

  it('starts the quiz with all levels checked and "moyen" difficulty by default', async () => {
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: /lancer le quiz/i }))

    expect(useQuizStore.getState().config).toEqual({ levels: [1, 2, 3, 4], difficulty: 'moyen' })
  })

  it('excludes an unchecked level from the launched config', async () => {
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('checkbox', { name: /rouge/i }))
    await user.click(screen.getByRole('button', { name: /lancer le quiz/i }))

    expect(useQuizStore.getState().config?.levels).toEqual([2, 3, 4])
  })

  it('uses the selected difficulty preset', async () => {
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: /^difficile$/i }))
    await user.click(screen.getByRole('button', { name: /lancer le quiz/i }))

    expect(useQuizStore.getState().config?.difficulty).toBe('difficile')
  })

  it('disables the launch button when no level is checked', async () => {
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    for (const name of [/rouge/i, /orange/i, /bleu/i, /jaune/i]) {
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
