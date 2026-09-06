import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { LockToggle } from './LockToggle'
import { useCardsStore, createCardsStore } from '../state/useCardsStore'

describe('LockToggle', () => {
  // LockToggle reads the module-level singleton, so isolation is a reset of
  // that singleton's DATA slices from a pristine store. Only `history`/`locked`
  // are copied: the pristine store's actions are bound to that throwaway store.
  beforeEach(() => {
    const pristine = createCardsStore().getState()
    useCardsStore.setState({ history: pristine.history, locked: pristine.locked })
  })

  it('toggles the store lock flag on click', async () => {
    const user = userEvent.setup()
    render(<LockToggle />)
    const button = screen.getByRole('button', { name: /verrouiller/i })
    await user.click(button)
    expect(useCardsStore.getState().locked).toBe(true)
  })
})
