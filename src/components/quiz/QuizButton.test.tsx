import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { QuizButton } from './QuizButton'

describe('QuizButton', () => {
  it('opens the quiz config modal on click', async () => {
    const user = userEvent.setup()
    render(<QuizButton />)

    await user.click(screen.getByRole('button', { name: /lancer un quiz/i }))

    expect(screen.getByRole('heading', { name: /configurer le quiz/i })).toBeInTheDocument()
  })
})
