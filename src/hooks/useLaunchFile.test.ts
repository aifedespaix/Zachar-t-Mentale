import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useLaunchFile } from './useLaunchFile'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

type Handler = (event: { payload: string }) => void

/** Captures the `open-mind-map` handler so a test can fire a second launch. */
function captureHandler(): { fire: (path: string) => void; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn()
  let handler: Handler | undefined
  vi.mocked(listen).mockImplementation((_event, callback) => {
    handler = callback as Handler
    return Promise.resolve(stop)
  })
  return {
    fire: path => handler?.({ payload: path }),
    stop,
  }
}

describe('useLaunchFile', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(null)
    vi.mocked(listen).mockReset().mockResolvedValue(vi.fn())
  })

  it('opens the map the app was launched with', async () => {
    vi.mocked(invoke).mockResolvedValue('C:\\cours\\fractions.zmap')
    const openFile = vi.fn()
    renderHook(() => useLaunchFile(openFile))
    await waitFor(() => expect(openFile).toHaveBeenCalledWith('C:\\cours\\fractions.zmap'))
  })

  it('opens nothing on a plain launch', async () => {
    const openFile = vi.fn()
    renderHook(() => useLaunchFile(openFile))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('launch_mind_map'))
    expect(openFile).not.toHaveBeenCalled()
  })

  it('stays quiet outside a Tauri window rather than surfacing the rejection', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('not a tauri window'))
    const openFile = vi.fn()
    renderHook(() => useLaunchFile(openFile))
    await waitFor(() => expect(invoke).toHaveBeenCalled())
    expect(openFile).not.toHaveBeenCalled()
  })

  it('opens a map double-clicked while the app is already running', async () => {
    const { fire } = captureHandler()
    const openFile = vi.fn()
    renderHook(() => useLaunchFile(openFile))
    await waitFor(() => expect(listen).toHaveBeenCalledWith('open-mind-map', expect.any(Function)))
    fire('C:\\cours\\vecteurs.zmap')
    expect(openFile).toHaveBeenCalledWith('C:\\cours\\vecteurs.zmap')
  })

  it('calls the latest callback, not the one captured on mount', async () => {
    const { fire } = captureHandler()
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ open }) => useLaunchFile(open), {
      initialProps: { open: first },
    })
    await waitFor(() => expect(listen).toHaveBeenCalled())
    rerender({ open: second })
    fire('C:\\cours\\vecteurs.zmap')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('C:\\cours\\vecteurs.zmap')
  })

  it('unsubscribes on unmount so a stale window never reopens files', async () => {
    const { stop } = captureHandler()
    const { unmount } = renderHook(() => useLaunchFile(vi.fn()))
    await waitFor(() => expect(listen).toHaveBeenCalled())
    unmount()
    await waitFor(() => expect(stop).toHaveBeenCalled())
  })

  it('does not re-run the launch query when the callback identity changes', async () => {
    const { rerender } = renderHook(({ open }) => useLaunchFile(open), {
      initialProps: { open: vi.fn() },
    })
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    rerender({ open: vi.fn() })
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
