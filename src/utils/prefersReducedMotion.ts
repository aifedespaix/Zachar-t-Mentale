/**
 * The system's "reduce motion" preference, read fresh each call rather than
 * cached: it can change while the app is running, and every caller here only
 * reads it right before starting an animation.
 */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
