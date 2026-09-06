import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { LockToggle } from './LockToggle'
import { useCardsStore } from '../state/useCardsStore'

describe('LockToggle', () => {
  beforeEach(() => useCardsStore.setState({ locked: false }))

  it('toggles the store lock flag on click', async () => {
    const user = userEvent.setup()
    render(<LockToggle />)
    const button = screen.getByRole('button', { name: /verrouiller/i })
    await user.click(button)
    expect(useCardsStore.getState().locked).toBe(true)
  })
})
