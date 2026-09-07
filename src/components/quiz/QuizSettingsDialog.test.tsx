import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { QuizSettingsDialog } from './QuizSettingsDialog'
import { useQuizSettingsStore } from '../../state/useQuizSettingsStore'

vi.mock('../../persistence/quizSettings', () => ({
  loadQuizSettings: vi.fn(),
  saveQuizSettings: vi.fn().mockResolvedValue(undefined),
}))

describe('QuizSettingsDialog', () => {
  beforeEach(() => {
    useQuizSettingsStore.setState({ similarityThreshold: 100, lengthGuideEnabled: true })
  })

  it('shows the current similarity threshold', () => {
    render(<QuizSettingsDialog open onOpenChange={() => {}} />)
    expect(screen.getByText('Précision exigée pour "correct" : 100%')).toBeInTheDocument()
  })

  it('lowers the similarity threshold in the store when the slider moves left', async () => {
    const user = userEvent.setup()
    render(<QuizSettingsDialog open onOpenChange={() => {}} />)

    screen.getByRole('slider').focus()
    await user.keyboard('{ArrowLeft}')

    expect(useQuizSettingsStore.getState().similarityThreshold).toBe(95)
  })

  it('toggles the length guide setting in the store', async () => {
    const user = userEvent.setup()
    render(<QuizSettingsDialog open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('switch'))

    expect(useQuizSettingsStore.getState().lengthGuideEnabled).toBe(false)
  })
})
