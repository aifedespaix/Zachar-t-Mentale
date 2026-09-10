import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReadOnlyMapDialog } from './ReadOnlyMapDialog'

describe('ReadOnlyMapDialog', () => {
  it('names the author and offers both making a copy and staying read-only', () => {
    render(<ReadOnlyMapDialog author="aife" onDuplicate={vi.fn()} onContinue={vi.fn()} />)
    expect(screen.getByText(/Carte de aife — lecture seule/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Faire ma copie' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continuer en lecture seule' })).toBeInTheDocument()
  })

  it('only offers to continue when nobody is logged in to copy as', () => {
    render(<ReadOnlyMapDialog author="aife" onDuplicate={null} onContinue={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Faire ma copie' })).not.toBeInTheDocument()
    expect(screen.getByText(/connectez-vous/i)).toBeInTheDocument()
  })

  it('refusing closes the offer through onContinue', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()
    render(<ReadOnlyMapDialog author="aife" onDuplicate={vi.fn()} onContinue={onContinue} />)

    await user.click(screen.getByRole('button', { name: 'Continuer en lecture seule' }))

    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('calls onDuplicate on click and shows an error if it rejects', async () => {
    const user = userEvent.setup()
    const onDuplicate = vi.fn().mockRejectedValue(new Error('disque plein'))
    render(<ReadOnlyMapDialog author="aife" onDuplicate={onDuplicate} onContinue={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Faire ma copie' }))

    expect(onDuplicate).toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('disque plein')
  })
})
