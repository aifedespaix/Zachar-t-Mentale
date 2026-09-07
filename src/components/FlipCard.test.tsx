// src/components/FlipCard.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { FlipCard } from './FlipCard'

describe('FlipCard', () => {
  it('renders both faces and rotates the inner wrapper based on `flipped`', () => {
    const { rerender } = render(<FlipCard flipped={false} front={<span>Front</span>} back={<span>Back</span>} />)

    expect(screen.getByText('Front')).toBeInTheDocument()
    expect(screen.getByText('Back')).toBeInTheDocument()
    expect(screen.getByTestId('flip-card-inner')).toHaveStyle({ transform: 'rotateY(0deg)' })

    rerender(<FlipCard flipped front={<span>Front</span>} back={<span>Back</span>} />)

    expect(screen.getByTestId('flip-card-inner')).toHaveStyle({ transform: 'rotateY(180deg)' })
  })

  // Without a perspective on an ancestor, `preserve-3d` + rotateY reads as a
  // flat instant swap rather than a card turning over in space.
  it('gives the rotation a 3D perspective', () => {
    render(<FlipCard flipped={false} front={<span>Front</span>} back={<span>Back</span>} />)

    expect(screen.getByTestId('flip-card-inner').parentElement).toHaveStyle({ perspective: '600px' })
  })
})
