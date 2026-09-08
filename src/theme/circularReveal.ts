interface CircularThemeTransitionOptions {
  x: number
  y: number
  apply: () => void
}

const TRANSITION_DURATION_MS = 500

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

/**
 * Runs `apply()` (a theme change) inside a circular reveal centered on
 * (x, y) — typically the click that triggered the change. Falls back to
 * calling `apply()` directly, with no animation, when the View Transitions
 * API is unavailable (older WebView, test environment) or the user has
 * requested reduced motion.
 */
export function startCircularThemeTransition({ x, y, apply }: CircularThemeTransitionOptions): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
  if (typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) {
    apply()
    return
  }

  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  const transition = doc.startViewTransition(apply)

  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: TRANSITION_DURATION_MS, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' }
      )
    })
    .catch(() => {
      // The transition was skipped (e.g. the document became hidden) — the
      // theme is already applied via `apply()` above, nothing left to animate.
    })
}
