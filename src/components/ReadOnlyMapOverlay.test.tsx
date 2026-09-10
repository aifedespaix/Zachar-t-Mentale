import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReadOnlyMapOverlay } from './ReadOnlyMapOverlay'

describe('ReadOnlyMapOverlay', () => {
  it('shows the author and a Personnaliser button when onDuplicate is provided', () => {
    render(<ReadOnlyMapOverlay author="aife" onDuplicate={vi.fn()} />)
    expect(screen.getByText(/Fichier de aife — lecture seule/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /personnaliser/i })).toBeInTheDocument()
  })

  it('shows a login hint instead of the button when onDuplicate is null', () => {
    render(<ReadOnlyMapOverlay author="aife" onDuplicate={null} />)
    expect(screen.queryByRole('button', { name: /personnaliser/i })).not.toBeInTheDocument()
    expect(screen.getByText(/connectez-vous/i)).toBeInTheDocument()
  })

  it('calls onDuplicate on click and shows an error if it rejects', async () => {
    const user = userEvent.setup()
    const onDuplicate = vi.fn().mockRejectedValue(new Error('disque plein'))
    render(<ReadOnlyMapOverlay author="aife" onDuplicate={onDuplicate} />)

    await user.click(screen.getByRole('button', { name: /personnaliser/i }))

    expect(onDuplicate).toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('disque plein')
  })
})
