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
