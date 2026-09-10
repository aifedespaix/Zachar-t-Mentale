import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAutoSync } from './useAutoSync'
import { useSyncStore } from '../state/useSyncStore'

const syncNow = vi.fn().mockResolvedValue(undefined)

/** Sets the slice of the store the hook reads, through act: the hook is mounted. */
function setStore(patch: Record<string, unknown>) {
  act(() => useSyncStore.setState({ syncNow, ...patch }))
}

beforeEach(() => {
  vi.useFakeTimers()
  syncNow.mockClear()
  setStore({
    currentUser: null,
    syncFolderPath: null,
    autoSyncOnLaunch: false,
    autoSyncIntervalMinutes: 0,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAutoSync', () => {
  it('does nothing at all by default — automatic sync is opt-in', () => {
    renderHook(() => useAutoSync())
    act(() => void vi.advanceTimersByTime(60 * 60_000))

    expect(syncNow).not.toHaveBeenCalled()
  })

  it('syncs once at launch, and only once however often it re-renders', () => {
    setStore({
      currentUser: { username: 'aife', role: 'prof' },
      syncFolderPath: '/cours',
      autoSyncOnLaunch: true,
    })

    const { rerender } = renderHook(() => useAutoSync())
    rerender()
    rerender()

    expect(syncNow).toHaveBeenCalledTimes(1)
    expect(syncNow).toHaveBeenCalledWith({ trigger: 'auto' })
  })

  it('waits for an account rather than syncing a folder nobody owns', () => {
    setStore({ syncFolderPath: '/cours', autoSyncOnLaunch: true })
    const { rerender } = renderHook(() => useAutoSync())
    expect(syncNow).not.toHaveBeenCalled()

    setStore({ currentUser: { username: 'aife', role: 'prof' } })
    rerender()

    expect(syncNow).toHaveBeenCalledTimes(1)
  })

  it('repeats on the chosen interval', () => {
    setStore({
      currentUser: { username: 'aife', role: 'prof' },
      syncFolderPath: '/cours',
      autoSyncIntervalMinutes: 5,
    })
    renderHook(() => useAutoSync())
    expect(syncNow).not.toHaveBeenCalled() // the first tick is the interval, not the mount

    act(() => void vi.advanceTimersByTime(15 * 60_000))

    expect(syncNow).toHaveBeenCalledTimes(3)
    expect(syncNow).toHaveBeenCalledWith({ trigger: 'auto' })
  })

  it('stops the timer when the panel that owned it goes away', () => {
    setStore({
      currentUser: { username: 'aife', role: 'prof' },
      syncFolderPath: '/cours',
      autoSyncIntervalMinutes: 5,
    })
    const { unmount } = renderHook(() => useAutoSync())

    unmount()
    act(() => void vi.advanceTimersByTime(60 * 60_000))

    expect(syncNow).not.toHaveBeenCalled()
  })
})
