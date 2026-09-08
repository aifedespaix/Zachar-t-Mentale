import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RefObject } from 'react'

type Position = { x: number; y: number }
type Payload =
  | { type: 'enter'; paths: string[]; position: Position }
  | { type: 'over'; position: Position }
  | { type: 'drop'; paths: string[]; position: Position }
  | { type: 'leave' }

let dragDropHandler: (event: { payload: Payload }) => void = () => {}
const unlisten = vi.fn()
const onDragDropEvent = vi.fn((handler: (event: { payload: Payload }) => void) => {
  dragDropHandler = handler
  return Promise.resolve(unlisten)
})
let getCurrentWindowThrows = false
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => {
    if (getCurrentWindowThrows) throw new Error('not running inside a Tauri window')
    return { onDragDropEvent }
  },
}))

import { useFileDropZone } from './useFileDropZone'

function makeZoneRef(): RefObject<HTMLElement | null> {
  const el = document.createElement('div')
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect
  return { current: el }
}

describe('useFileDropZone', () => {
  beforeEach(() => {
    onDragDropEvent.mockClear()
    unlisten.mockClear()
    getCurrentWindowThrows = false
  })

  it('activates while a drag hovers over the zone', () => {
    const zoneRef = makeZoneRef()
    const { result } = renderHook(() => useFileDropZone(zoneRef, vi.fn()))

    act(() => dragDropHandler({ payload: { type: 'over', position: { x: 100, y: 100 } } }))

    expect(result.current.isDragActive).toBe(true)
  })

  it('does not activate for a drag outside the zone', () => {
    const zoneRef = makeZoneRef()
    const { result } = renderHook(() => useFileDropZone(zoneRef, vi.fn()))

    act(() => dragDropHandler({ payload: { type: 'over', position: { x: 900, y: 900 } } }))

    expect(result.current.isDragActive).toBe(false)
  })

  it('deactivates on leave', () => {
    const zoneRef = makeZoneRef()
    const { result } = renderHook(() => useFileDropZone(zoneRef, vi.fn()))
    act(() => dragDropHandler({ payload: { type: 'over', position: { x: 100, y: 100 } } }))

    act(() => dragDropHandler({ payload: { type: 'leave' } }))

    expect(result.current.isDragActive).toBe(false)
  })

  it('opens a .json file dropped inside the zone', () => {
    const zoneRef = makeZoneRef()
    const onOpenFile = vi.fn()
    renderHook(() => useFileDropZone(zoneRef, onOpenFile))

    act(() =>
      dragDropHandler({
        payload: { type: 'drop', paths: ['/cours/fractions.json'], position: { x: 100, y: 100 } },
      })
    )

    expect(onOpenFile).toHaveBeenCalledWith('/cours/fractions.json')
  })

  it('ignores a file dropped outside the zone', () => {
    const zoneRef = makeZoneRef()
    const onOpenFile = vi.fn()
    renderHook(() => useFileDropZone(zoneRef, onOpenFile))

    act(() =>
      dragDropHandler({
        payload: { type: 'drop', paths: ['/cours/fractions.json'], position: { x: 900, y: 900 } },
      })
    )

    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('reports an error and does not open a non-.json file', () => {
    const zoneRef = makeZoneRef()
    const onOpenFile = vi.fn()
    const { result } = renderHook(() => useFileDropZone(zoneRef, onOpenFile))

    act(() =>
      dragDropHandler({
        payload: { type: 'drop', paths: ['/cours/photo.png'], position: { x: 100, y: 100 } },
      })
    )

    expect(onOpenFile).not.toHaveBeenCalled()
    expect(result.current.dropError).toMatch(/\.json/)
  })

  it('clears a previous drop error once a valid file is dropped', () => {
    const zoneRef = makeZoneRef()
    const { result } = renderHook(() => useFileDropZone(zoneRef, vi.fn()))
    act(() =>
      dragDropHandler({ payload: { type: 'drop', paths: ['/cours/photo.png'], position: { x: 100, y: 100 } } })
    )
    expect(result.current.dropError).not.toBeNull()

    act(() =>
      dragDropHandler({
        payload: { type: 'drop', paths: ['/cours/fractions.json'], position: { x: 100, y: 100 } },
      })
    )

    expect(result.current.dropError).toBeNull()
  })

  it('does nothing and does not crash outside a Tauri window', () => {
    getCurrentWindowThrows = true
    const zoneRef = makeZoneRef()

    const { result } = renderHook(() => useFileDropZone(zoneRef, vi.fn()))

    expect(result.current.isDragActive).toBe(false)
  })

  it('unlistens on unmount', async () => {
    const zoneRef = makeZoneRef()
    const { unmount } = renderHook(() => useFileDropZone(zoneRef, vi.fn()))
    await act(async () => {})

    unmount()

    expect(unlisten).toHaveBeenCalled()
  })
})

describe('dropping an image onto a card', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  /**
   * Puts a card element under `elementFromPoint`, as the canvas would.
   * jsdom does not implement it at all, so it is defined rather than spied on.
   */
  function stubElementFromPoint(result: Element | null) {
    const fn = vi.fn(() => result)
    Object.defineProperty(document, 'elementFromPoint', { value: fn, configurable: true, writable: true })
    return fn
  }

  function cardUnderPointer(cardId: string) {
    const card = document.createElement('div')
    card.setAttribute('data-testid', `card-${cardId}`)
    document.body.appendChild(card)
    return stubElementFromPoint(card)
  }

  it('routes the image to the card it landed on', () => {
    cardUnderPointer('c1')
    const onOpenFile = vi.fn()
    const onDropImageOnCard = vi.fn()
    renderHook(() => useFileDropZone(makeZoneRef(), onOpenFile, onDropImageOnCard))

    act(() => {
      dragDropHandler({ payload: { type: 'drop', paths: ['/cours/schema.png'], position: { x: 100, y: 100 } } })
    })

    expect(onDropImageOnCard).toHaveBeenCalledWith('c1', '/cours/schema.png')
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('still opens a mind map, which takes precedence', () => {
    cardUnderPointer('c1')
    const onOpenFile = vi.fn()
    const onDropImageOnCard = vi.fn()
    renderHook(() => useFileDropZone(makeZoneRef(), onOpenFile, onDropImageOnCard))

    act(() => {
      dragDropHandler({ payload: { type: 'drop', paths: ['/cours/carte.json'], position: { x: 10, y: 10 } } })
    })

    expect(onOpenFile).toHaveBeenCalledWith('/cours/carte.json')
    expect(onDropImageOnCard).not.toHaveBeenCalled()
  })

  it('explains itself when an image lands beside a card rather than on one', () => {
    stubElementFromPoint(null)
    const { result } = renderHook(() => useFileDropZone(makeZoneRef(), vi.fn(), vi.fn()))

    act(() => {
      dragDropHandler({ payload: { type: 'drop', paths: ['/cours/schema.png'], position: { x: 10, y: 10 } } })
    })

    expect(result.current.dropError).toMatch(/sur une carte/i)
  })

  it('reports an unsupported file when the host cannot store images', () => {
    cardUnderPointer('c1')
    const { result } = renderHook(() => useFileDropZone(makeZoneRef(), vi.fn()))

    act(() => {
      dragDropHandler({ payload: { type: 'drop', paths: ['/cours/schema.png'], position: { x: 10, y: 10 } } })
    })

    expect(result.current.dropError).toMatch(/images/i)
  })

  it('converts the physical drop position to logical pixels before hit-testing', () => {
    // Tauri reports physical pixels; the DOM works in CSS pixels.
    const spy = cardUnderPointer('c1')
    const original = window.devicePixelRatio
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true })

    renderHook(() => useFileDropZone(makeZoneRef(), vi.fn(), vi.fn()))
    act(() => {
      dragDropHandler({ payload: { type: 'drop', paths: ['/x/a.png'], position: { x: 200, y: 100 } } })
    })

    expect(spy).toHaveBeenCalledWith(100, 50)
    Object.defineProperty(window, 'devicePixelRatio', { value: original, configurable: true })
  })
})
