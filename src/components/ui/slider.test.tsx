// src/components/ui/slider.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Slider } from './slider'

describe('Slider', () => {
  it('calls onValueChange when the focused thumb is moved with arrow keys', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Slider defaultValue={[50]} min={0} max={100} step={5} onValueChange={onValueChange} />)

    screen.getByRole('slider').focus()
    await user.keyboard('{ArrowRight}')

    expect(onValueChange).toHaveBeenCalledWith([55])
  })
})
