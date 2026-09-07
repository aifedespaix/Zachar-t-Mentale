// src/components/FlipCard.tsx
import type { ReactNode } from 'react'

export interface FlipCardProps {
  flipped: boolean
  front: ReactNode
  back: ReactNode
}

/**
 * A literal rotateY on a single face shows the SAME content mirrored past
 * 90deg — there is no true back face to swap to. This stacks two faces with
 * `backfaceVisibility: hidden`, so only ever one is legible at a time.
 */
export function FlipCard({ flipped, front, back }: FlipCardProps) {
  return (
    // `preserve-3d` alone still projects flat: without a perspective on an
    // ancestor the rotation reads as an instant swap, not a card turning over.
    <div style={{ position: 'relative', width: '100%', perspective: '600px' }}>
      <div
        data-testid="flip-card-inner"
        style={{
          position: 'relative',
          width: '100%',
          transformStyle: 'preserve-3d',
          transition: 'transform 0.4s',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        <div style={{ backfaceVisibility: 'hidden' }}>{front}</div>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          {back}
        </div>
      </div>
    </div>
  )
}
