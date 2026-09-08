import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UpdateReadyBanner } from './UpdateReadyBanner'

describe('UpdateReadyBanner', () => {
  it('shows a Redémarrer button that calls onApply when clicked', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(<UpdateReadyBanner onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: 'Redémarrer' }))

    expect(onApply).toHaveBeenCalled()
  })

  it('hides itself when the dismiss button is clicked, without calling onApply', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(<UpdateReadyBanner onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: 'Masquer le message de mise à jour' }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
  })
})
