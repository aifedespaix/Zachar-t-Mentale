import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAppUpdater } from './useAppUpdater'

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}))

import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

describe('useAppUpdater', () => {
  beforeEach(() => {
    vi.mocked(check).mockReset()
    vi.mocked(relaunch).mockReset()
  })

  it('stays not-ready and never downloads when no update is available', async () => {
    vi.mocked(check).mockResolvedValue(null)
    const { result } = renderHook(() => useAppUpdater())
    await waitFor(() => expect(check).toHaveBeenCalled())
    expect(result.current.updateReady).toBe(false)
  })

  it('downloads automatically and becomes ready when an update is available', async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined)
    vi.mocked(check).mockResolvedValue({ available: true, downloadAndInstall } as never)
    const { result } = renderHook(() => useAppUpdater())
    await waitFor(() => expect(result.current.updateReady).toBe(true))
    expect(downloadAndInstall).toHaveBeenCalled()
  })

  it('stays not-ready and does not throw when check() rejects', async () => {
    vi.mocked(check).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useAppUpdater())
    await waitFor(() => expect(check).toHaveBeenCalled())
    expect(result.current.updateReady).toBe(false)
  })

  it('stays not-ready and does not throw when downloadAndInstall() rejects', async () => {
    const downloadAndInstall = vi.fn().mockRejectedValue(new Error('network dropped'))
    vi.mocked(check).mockResolvedValue({ available: true, downloadAndInstall } as never)
    const { result } = renderHook(() => useAppUpdater())
    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalled())
    expect(result.current.updateReady).toBe(false)
  })

  it('applyUpdate() relaunches the app', async () => {
    vi.mocked(check).mockResolvedValue(null)
    const { result } = renderHook(() => useAppUpdater())
    await result.current.applyUpdate()
    expect(relaunch).toHaveBeenCalled()
  })
})
