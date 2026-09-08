import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OklchSliderGroup } from './OklchSliderGroup'

describe('OklchSliderGroup', () => {
  const value = { l: 0.5, c: 0.1, h: 200 }

  it('renders a slider for lightness, chroma and hue', () => {
    render(<OklchSliderGroup label="Fond" value={value} onChange={() => {}} />)
    expect(screen.getByRole('slider', { name: 'Fond — luminosité' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Fond — chroma' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Fond — teinte' })).toBeInTheDocument()
  })

  it('reports a lightness change with chroma and hue unchanged', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<OklchSliderGroup label="Fond" value={value} onChange={onChange} />)

    screen.getByRole('slider', { name: 'Fond — luminosité' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(onChange).toHaveBeenCalledWith({ l: 0.51, c: 0.1, h: 200 })
  })

  it('reports a hue change with lightness and chroma unchanged', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<OklchSliderGroup label="Fond" value={value} onChange={onChange} />)

    screen.getByRole('slider', { name: 'Fond — teinte' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(onChange).toHaveBeenCalledWith({ l: 0.5, c: 0.1, h: 201 })
  })
})
