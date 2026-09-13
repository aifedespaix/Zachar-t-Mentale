// src/components/quiz/QuizConfigModal.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { QuizConfigModal } from './QuizConfigModal'
import { useQuizStore, createQuizStore } from '../../state/useQuizStore'
import { useCardsStore, createCardsStore } from '../../state/useCardsStore'
import { useQuizSettingsStore } from '../../state/useQuizSettingsStore'
import { DEFAULT_QUIZ_SETTINGS } from '../../types/quizSettings'
import { createHistory } from '../../state/history'
import { saveQuizSettings } from '../../persistence/quizSettings'
import type { Card, CardLevel } from '../../types/card'
import type { QuizConfig } from '../../types/quiz'

vi.mock('../../persistence/quizSettings', () => ({
  loadQuizSettings: vi.fn(),
  saveQuizSettings: vi.fn().mockResolvedValue(undefined),
}))

function cardAt(level: CardLevel, id: string): Card {
  return { id, level, title: id, parentId: null, order: 0 }
}

/** One card per requested level, so that level counts as present in the map. */
function setCards(...levels: CardLevel[]) {
  useCardsStore.setState({
    history: createHistory(levels.map((level, index) => cardAt(level, 'card-' + index))),
  })
}

function resetStores() {
  const quiz = createQuizStore().getState()
  useQuizStore.setState({
    active: quiz.active,
    showSummary: quiz.showSummary,
    config: quiz.config,
    questions: quiz.questions,
    results: quiz.results,
    recallProgress: quiz.recallProgress,
    wasLockedBeforeQuiz: quiz.wasLockedBeforeQuiz,
  })
  const cards = createCardsStore().getState()
  useCardsStore.setState({ history: cards.history, locked: cards.locked, readOnly: cards.readOnly })
  useQuizSettingsStore.setState({
    ...DEFAULT_QUIZ_SETTINGS,
    lastQuizConfig: { ...DEFAULT_QUIZ_SETTINGS.lastQuizConfig, levels: [...DEFAULT_QUIZ_SETTINGS.lastQuizConfig.levels] },
  })
  vi.mocked(saveQuizSettings).mockClear()
}

function rememberLastConfig(lastQuizConfig: QuizConfig) {
  useQuizSettingsStore.setState({ lastQuizConfig })
}

const launchButton = () => screen.getByRole('button', { name: /lancer le quiz/i })
const checkbox = (name: RegExp) => screen.getByRole('checkbox', { name })

describe('QuizConfigModal', () => {
  beforeEach(resetStores)

  it('starts the quiz with all levels checked, "moyen" difficulty and QCM off by default', async () => {
    setCards(1, 2, 3, 4)
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(launchButton())

    expect(useQuizStore.getState().config).toEqual({ levels: [1, 2, 3, 4], difficulty: 'moyen', qcmMode: false })
  })

  it('excludes an unchecked level from the launched config', async () => {
    setCards(1, 2, 3, 4)
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(checkbox(/^titre$/i))
    await user.click(launchButton())

    expect(useQuizStore.getState().config?.levels).toEqual([2, 3, 4])
  })

  it('uses the selected difficulty preset', async () => {
    setCards(1, 2, 3, 4)
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('radio', { name: /^difficile$/i }))
    await user.click(launchButton())

    expect(useQuizStore.getState().config?.difficulty).toBe('difficile')
  })

  it('turns qcmMode on when the QCM toggle is switched', async () => {
    setCards(1, 2, 3, 4)
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('switch', { name: /mode qcm/i }))
    await user.click(launchButton())

    expect(useQuizStore.getState().config?.qcmMode).toBe(true)
  })

  it('disables the launch button when no level is checked', async () => {
    setCards(1, 2, 3, 4)
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    for (const name of [/^titre$/i, /^sous-titre$/i, /^sous-partie$/i, /^info$/i]) {
      await user.click(checkbox(name))
    }

    expect(launchButton()).toBeDisabled()
  })

  it('closes the modal after launching', async () => {
    setCards(1, 2, 3, 4)
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<QuizConfigModal open onOpenChange={onOpenChange} />)

    await user.click(launchButton())

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('QuizConfigModal absent levels', () => {
  beforeEach(resetStores)

  it('greys out and disables a level with no card in the mind map', () => {
    setCards(1, 2)
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    expect(checkbox(/^titre$/i)).toBeEnabled()
    expect(checkbox(/^sous-titre$/i)).toBeEnabled()
    expect(checkbox(/^sous-partie$/i)).toBeDisabled()
    expect(checkbox(/^info$/i)).toBeDisabled()
  })

  it('stays unchecked when an absent level is clicked, and out of the launched quiz', async () => {
    setCards(1, 2)
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    const info = checkbox(/^info$/i)
    await user.click(info)

    expect(info).not.toBeChecked()
    await user.click(launchButton())
    expect(useQuizStore.getState().config?.levels).toEqual([1, 2])
  })

  it('treats a floating card as not making its level present', () => {
    useCardsStore.setState({
      history: createHistory([
        cardAt(1, 'root'),
        { ...cardAt(4, 'floating'), detached: true },
      ]),
    })
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    expect(checkbox(/^info$/i)).toBeDisabled()
  })
})

describe('QuizConfigModal remembered configuration', () => {
  beforeEach(resetStores)

  it('reopens with the levels, difficulty and QCM mode of the last launch', () => {
    rememberLastConfig({ levels: [2, 3], difficulty: 'difficile', qcmMode: true })
    setCards(1, 2, 3, 4)
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    expect(checkbox(/^titre$/i)).not.toBeChecked()
    expect(checkbox(/^sous-titre$/i)).toBeChecked()
    expect(checkbox(/^sous-partie$/i)).toBeChecked()
    expect(checkbox(/^info$/i)).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Difficile' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: /mode qcm/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('persists levels, difficulty and QCM mode on launch', async () => {
    setCards(1, 2, 3, 4)
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('radio', { name: 'Difficile' }))
    await user.click(screen.getByRole('switch', { name: /mode qcm/i }))
    await user.click(launchButton())

    expect(useQuizSettingsStore.getState().lastQuizConfig).toEqual({
      levels: [1, 2, 3, 4],
      difficulty: 'difficile',
      qcmMode: true,
    })
    expect(saveQuizSettings).toHaveBeenCalledWith(
      expect.objectContaining({ lastQuizConfig: { levels: [1, 2, 3, 4], difficulty: 'difficile', qcmMode: true } })
    )
  })

  it('keeps the manual choice for a level that currently has no card', async () => {
    rememberLastConfig({ levels: [1, 4], difficulty: 'moyen', qcmMode: false })
    setCards(1)
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    expect(checkbox(/^info$/i)).toBeDisabled()
    await user.click(launchButton())

    expect(useQuizStore.getState().config?.levels).toEqual([1])
    expect(useQuizSettingsStore.getState().lastQuizConfig.levels).toEqual([1, 4])
  })

  it('brings a remembered level back checked once cards return to it', () => {
    rememberLastConfig({ levels: [1, 4], difficulty: 'moyen', qcmMode: false })
    setCards(1)
    const { unmount } = render(<QuizConfigModal open onOpenChange={() => {}} />)
    expect(checkbox(/^info$/i)).toBeDisabled()

    unmount()
    setCards(1, 4)
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    expect(checkbox(/^info$/i)).toBeChecked()
  })
})

describe('QuizConfigModal difficulty selector', () => {
  beforeEach(resetStores)

  it('marks exactly one difficulty as chosen', () => {
    setCards(1, 2, 3, 4)
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    const chosen = screen.getAllByRole('radio').filter(option => option.getAttribute('aria-checked') === 'true')
    expect(chosen).toHaveLength(1)
    expect(chosen[0]).toHaveAccessibleName('Moyen')
  })

  it('moves the selection when another difficulty is picked', async () => {
    setCards(1, 2, 3, 4)
    const user = userEvent.setup()
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('radio', { name: 'Facile' }))

    expect(screen.getByRole('radio', { name: 'Facile' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Moyen' })).toHaveAttribute('aria-checked', 'false')
  })

  it('says what each difficulty does to a written answer, not just how many cards it draws', () => {
    setCards(1, 2, 3, 4)
    render(<QuizConfigModal open onOpenChange={() => {}} />)

    expect(screen.getByText('La première lettre seulement')).toBeInTheDocument()
    expect(screen.getByText('La moitié des lettres offertes')).toBeInTheDocument()
  })
})
