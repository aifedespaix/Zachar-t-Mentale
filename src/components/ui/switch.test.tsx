// src/components/ui/switch.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Switch } from './switch'

describe('Switch', () => {
  it('reports the new checked state on click', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Switch onCheckedChange={onCheckedChange} />)

    await user.click(screen.getByRole('switch'))

    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('reflects a controlled checked prop', () => {
    render(<Switch checked aria-label="test" />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })
})
