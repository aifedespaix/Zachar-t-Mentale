import { vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

/*
 * @testing-library/react's async event wrapper (used by userEvent's `await user.click(...)`
 * etc.) drains the microtask queue with a real `setTimeout(fn, 0)`, then flushes it itself —
 * but only if it detects fake timers, and it only ever looks for Jest's, via a global `jest`
 * with a faked `setTimeout` (`_isMockFunction` or a `.clock` property). Vitest's `vi.useFakeTimers()`
 * gives `setTimeout` that `.clock` property but never defines a global `jest`, so that detection
 * always reports "no fake timers" and the library never advances its own flush timer: any
 * `await user.<action>()` issued while `vi.useFakeTimers()` is active hangs forever.
 *
 * This shim gives the detection a `jest` global that forwards to Vitest's real fake-timer
 * control, so it correctly recognizes Vitest's fake timers when they're active (the `.clock`
 * check on `setTimeout` still gates it — this is a no-op under real timers).
 */
if (typeof (globalThis as { jest?: unknown }).jest === 'undefined') {
  ;(globalThis as unknown as { jest: { advanceTimersByTime: typeof vi.advanceTimersByTime } }).jest = {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
  }
}

/*
 * jsdom implements neither ResizeObserver nor layout, and React Flow depends on
 * both: it measures every node through a ResizeObserver, marks any node it has
 * not measured `visibility: hidden`, and refuses to draw an edge between
 * unmeasured nodes. The previous no-op ResizeObserver meant `updateNodeInternals`
 * never ran under test, which made the canvas structurally untestable and hid
 * the "edges silently stop rendering" class of bug entirely.
 *
 * The shims below are the ones React Flow's own testing guide prescribes,
 * adapted so an element with no explicit inline size still reports a plausible
 * card-sized box.
 */
const MOCK_ELEMENT_WIDTH = 200
const MOCK_ELEMENT_HEIGHT = 92

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element) {
    const entry = {
      target,
      contentRect: {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: MOCK_ELEMENT_WIDTH,
        bottom: MOCK_ELEMENT_HEIGHT,
        width: MOCK_ELEMENT_WIDTH,
        height: MOCK_ELEMENT_HEIGHT,
      },
    } as unknown as ResizeObserverEntry
    this.callback([entry], this as unknown as ResizeObserver)
  }

  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

// d3-zoom (React Flow's pan/zoom engine) reads the pane's transform through
// DOMMatrixReadOnly, which jsdom does not implement.
class DOMMatrixReadOnlyMock {
  m22: number

  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1]
    this.m22 = scale !== undefined ? Number(scale) : 1
  }
}

globalThis.DOMMatrixReadOnly = DOMMatrixReadOnlyMock as unknown as typeof DOMMatrixReadOnly

Object.defineProperties(HTMLElement.prototype, {
  offsetWidth: {
    configurable: true,
    get(this: HTMLElement) {
      return parseFloat(this.style.width) || MOCK_ELEMENT_WIDTH
    },
  },
  offsetHeight: {
    configurable: true,
    get(this: HTMLElement) {
      return parseFloat(this.style.height) || MOCK_ELEMENT_HEIGHT
    },
  },
})

if (!('getBBox' in SVGElement.prototype)) {
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  })
}
