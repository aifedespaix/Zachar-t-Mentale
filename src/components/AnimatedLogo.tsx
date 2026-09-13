// src/components/AnimatedLogo.tsx

interface AnimatedLogoProps {
  /**
   * `draw-fade`: draws once, holds, fades out, loops — reads as "loading".
   * `draw-pulse`: draws once, then breathes gently forever, no reset —
   * reads as "waiting" (used on the empty-state screen).
   */
  mode: 'draw-fade' | 'draw-pulse'
  size?: number
}

/**
 * The app mark (four corner dots joined by a Z), animated: each dot slides
 * in from wherever the previous one landed, in the same order as the static
 * `favicon.svg` — red, orange, blue, yellow.
 */
export function AnimatedLogo({ mode, size = 96 }: AnimatedLogoProps) {
  return (
    <svg
      className={`animated-logo animated-logo--${mode}`}
      viewBox="0 0 128 128"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <line className="animated-logo-seg animated-logo-seg--1" x1="36" y1="36" x2="92" y2="36" />
      <line className="animated-logo-seg animated-logo-seg--2" x1="92" y1="36" x2="36" y2="92" />
      <line className="animated-logo-seg animated-logo-seg--3" x1="36" y1="92" x2="92" y2="92" />
      <circle className="animated-logo-dot animated-logo-dot--red" cx="36" cy="36" r="20" fill="#EF4444" />
      <circle className="animated-logo-dot animated-logo-dot--orange" cx="92" cy="36" r="20" fill="#F97316" />
      <circle className="animated-logo-dot animated-logo-dot--blue" cx="36" cy="92" r="20" fill="#3B82F6" />
      <circle className="animated-logo-dot animated-logo-dot--yellow" cx="92" cy="92" r="20" fill="#EAB308" />
    </svg>
  )
}
