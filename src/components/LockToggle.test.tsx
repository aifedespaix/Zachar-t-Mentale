import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { LockToggle } from './LockToggle'
import { useCardsStore, createCardsStore } from '../state/useCardsStore'

describe('LockToggle', () => {
  beforeEach(() => {
    const pristine = createCardsStore().getState()
    useCardsStore.setState({ history: pristine.history, locked: pristine.locked })
  })

  it('shows an accessible label to lock the mind map when unlocked', () => {
    render(<LockToggle />)
    expect(screen.getByRole('button', { name: 'Verrouiller la carte mentale' })).toBeInTheDocument()
  })

  it('shows an accessible label to unlock the mind map when locked', () => {
    useCardsStore.setState({ locked: true })
    render(<LockToggle />)
    expect(screen.getByRole('button', { name: 'Déverrouiller la carte mentale' })).toBeInTheDocument()
  })

  it('toggles the store lock flag on click', async () => {
    const user = userEvent.setup()
    render(<LockToggle />)
    await user.click(screen.getByRole('button', { name: 'Verrouiller la carte mentale' }))
    expect(useCardsStore.getState().locked).toBe(true)
  })
})
