import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useAppUpdater } from './useAppUpdater'

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}))

import { check } from '@tauri-apps/plugin-updater'

function makeUpdate(
  overrides: Partial<{
    download: () => Promise<void>
    install: () => Promise<void>
    close: () => Promise<void>
  }> = {}
) {
  return {
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('useAppUpdater', () => {
  beforeEach(() => {
    vi.mocked(check).mockReset()
  })

  it('stays not-ready and never downloads when no update is available', async () => {
    vi.mocked(check).mockResolvedValue(null)
    const { result } = renderHook(() => useAppUpdater())
    await waitFor(() => expect(check).toHaveBeenCalled())
    expect(result.current.updateReady).toBe(false)
  })

  it('downloads automatically (but does not install) and becomes ready when an update is available', async () => {
    const update = makeUpdate()
    vi.mocked(check).mockResolvedValue(update as never)
    const { result } = renderHook(() => useAppUpdater())
    await waitFor(() => expect(result.current.updateReady).toBe(true))
    expect(update.download).toHaveBeenCalled()
    expect(update.install).not.toHaveBeenCalled()
  })

  it('stays not-ready and does not throw when check() rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(check).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useAppUpdater())
    await waitFor(() => expect(check).toHaveBeenCalled())
    expect(result.current.updateReady).toBe(false)
  })

  it('stays not-ready and does not throw when download() rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const update = makeUpdate({ download: vi.fn().mockRejectedValue(new Error('network dropped')) })
    vi.mocked(check).mockResolvedValue(update as never)
    const { result } = renderHook(() => useAppUpdater())
    await waitFor(() => expect(update.download).toHaveBeenCalled())
    expect(result.current.updateReady).toBe(false)
    expect(update.install).not.toHaveBeenCalled()
  })

  it('applyUpdate() installs the downloaded update', async () => {
    const update = makeUpdate()
    vi.mocked(check).mockResolvedValue(update as never)
    const { result } = renderHook(() => useAppUpdater())
    await waitFor(() => expect(result.current.updateReady).toBe(true))

    await result.current.applyUpdate()

    expect(update.install).toHaveBeenCalled()
  })

  it('applyUpdate() is a no-op when no update was ever found', async () => {
    vi.mocked(check).mockResolvedValue(null)
    const { result } = renderHook(() => useAppUpdater())
    await waitFor(() => expect(check).toHaveBeenCalled())

    await expect(result.current.applyUpdate()).resolves.toBeUndefined()
  })

  it('dismissUpdate() sets dismissed to true', async () => {
    vi.mocked(check).mockResolvedValue(null)
    const { result } = renderHook(() => useAppUpdater())
    expect(result.current.dismissed).toBe(false)

    act(() => {
      result.current.dismissUpdate()
    })

    await waitFor(() => expect(result.current.dismissed).toBe(true))
  })
})
