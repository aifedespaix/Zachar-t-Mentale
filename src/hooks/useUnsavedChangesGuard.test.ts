import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

type CloseHandler = (event: { preventDefault: () => void }) => void | Promise<void>

const destroy = vi.fn().mockResolvedValue(undefined)
let closeHandler: CloseHandler = () => {}
const onCloseRequested = vi.fn((handler: CloseHandler) => {
  closeHandler = handler
  return Promise.resolve(vi.fn())
})
let getCurrentWindowThrows = false
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => {
    if (getCurrentWindowThrows) throw new Error('not running inside a Tauri window')
    return { onCloseRequested, destroy }
  },
}))

vi.mock('../state/useSyncStore', () => ({
  useSyncStore: { getState: vi.fn(() => ({ syncNow: vi.fn(), syncOneFile: vi.fn() })) },
}))

import { useSyncStore } from '../state/useSyncStore'
import { useWorkspaceStore } from '../state/useWorkspaceStore'

import { CLOSE_SYNC_TIMEOUT_MS, useUnsavedChangesGuard } from './useUnsavedChangesGuard'

describe('useUnsavedChangesGuard', () => {
  beforeEach(() => {
    destroy.mockReset()
    destroy.mockResolvedValue(undefined)
    onCloseRequested.mockClear()
    getCurrentWindowThrows = false
    useWorkspaceStore.setState({ currentFilePath: '/cours/a.json' })
    // Le mock partagé : chaque test repart avec les DEUX méthodes, sinon un test
    // qui n'en stubbe qu'une laisse l'autre absente pour le suivant.
    vi.mocked(useSyncStore.getState).mockReset()
    vi.mocked(useSyncStore.getState).mockReturnValue({
      syncNow: vi.fn().mockResolvedValue(undefined),
      syncOneFile: vi.fn().mockResolvedValue(undefined),
    } as any)
  })

  describe('requestOpenFile', () => {
    it('opens the file directly when the flush succeeds', async () => {
      const flush = vi.fn().mockResolvedValue(undefined)
      const setCurrentFile = vi.fn()
      const { result } = renderHook(() => useUnsavedChangesGuard(flush, setCurrentFile))

      act(() => result.current.requestOpenFile('/cours/b.json'))
      await waitFor(() => expect(setCurrentFile).toHaveBeenCalledWith('/cours/b.json'))

      expect(result.current.prompt).toBeNull()
    })

    it('prompts instead of opening when the flush fails', async () => {
      const flush = vi.fn().mockRejectedValue(new Error('disque plein'))
      const setCurrentFile = vi.fn()
      const { result } = renderHook(() => useUnsavedChangesGuard(flush, setCurrentFile))

      act(() => result.current.requestOpenFile('/cours/b.json'))
      await waitFor(() => expect(result.current.prompt).not.toBeNull())

      expect(result.current.prompt?.message).toMatch(/disque plein/)
      expect(result.current.prompt?.continueLabel).toBe('Ouvrir quand même')
      expect(setCurrentFile).not.toHaveBeenCalled()
    })

    it('opens the file when the prompt is confirmed', async () => {
      const flush = vi.fn().mockRejectedValue(new Error('disque plein'))
      const setCurrentFile = vi.fn()
      const { result } = renderHook(() => useUnsavedChangesGuard(flush, setCurrentFile))
      act(() => result.current.requestOpenFile('/cours/b.json'))
      await waitFor(() => expect(result.current.prompt).not.toBeNull())

      act(() => result.current.prompt?.onContinue?.())

      expect(setCurrentFile).toHaveBeenCalledWith('/cours/b.json')
      expect(result.current.prompt).toBeNull()
    })

    it('dismissPrompt clears the prompt without opening the file', async () => {
      const flush = vi.fn().mockRejectedValue(new Error('disque plein'))
      const setCurrentFile = vi.fn()
      const { result } = renderHook(() => useUnsavedChangesGuard(flush, setCurrentFile))
      act(() => result.current.requestOpenFile('/cours/b.json'))
      await waitFor(() => expect(result.current.prompt).not.toBeNull())

      act(() => result.current.dismissPrompt())

      expect(result.current.prompt).toBeNull()
      expect(setCurrentFile).not.toHaveBeenCalled()
    })

    it('syncs the file it is LEAVING, not the one it is opening, after a successful flush', async () => {
      const syncOneFile = vi.fn().mockResolvedValue(undefined)
      vi.mocked(useSyncStore.getState).mockReturnValue({ syncOneFile } as any)
      useWorkspaceStore.setState({ currentFilePath: '/cours/a.json' })
      const flush = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() => useUnsavedChangesGuard(flush, vi.fn()))

      act(() => result.current.requestOpenFile('/cours/b.json'))
      await waitFor(() => expect(syncOneFile).toHaveBeenCalledWith('/cours/a.json'))
    })

    it('syncs nothing when there was no file open to leave', async () => {
      const syncOneFile = vi.fn().mockResolvedValue(undefined)
      const syncNow = vi.fn().mockResolvedValue(undefined)
      vi.mocked(useSyncStore.getState).mockReturnValue({ syncOneFile, syncNow } as any)
      useWorkspaceStore.setState({ currentFilePath: null })
      const flush = vi.fn().mockResolvedValue(undefined)
      const setCurrentFile = vi.fn()
      const { result } = renderHook(() => useUnsavedChangesGuard(flush, setCurrentFile))

      act(() => result.current.requestOpenFile('/cours/b.json'))
      await waitFor(() => expect(setCurrentFile).toHaveBeenCalledWith('/cours/b.json'))

      expect(syncOneFile).not.toHaveBeenCalled()
      expect(syncNow).not.toHaveBeenCalled()
    })

    it('does not trigger a sync when the flush fails', async () => {
      const syncOneFile = vi.fn().mockResolvedValue(undefined)
      vi.mocked(useSyncStore.getState).mockReturnValue({ syncOneFile } as any)
      const flush = vi.fn().mockRejectedValue(new Error('disque plein'))
      const { result } = renderHook(() => useUnsavedChangesGuard(flush, vi.fn()))

      act(() => result.current.requestOpenFile('/cours/b.json'))
      await waitFor(() => expect(result.current.prompt).not.toBeNull())

      expect(syncOneFile).not.toHaveBeenCalled()
    })
  })

  describe('window close', () => {
    it('flushes and closes the window when the flush succeeds', async () => {
      const flush = vi.fn().mockResolvedValue(undefined)
      renderHook(() => useUnsavedChangesGuard(flush, vi.fn()))
      await waitFor(() => expect(onCloseRequested).toHaveBeenCalled())
      const preventDefault = vi.fn()

      await act(async () => closeHandler({ preventDefault }))

      expect(preventDefault).toHaveBeenCalled()
      expect(flush).toHaveBeenCalled()
      expect(destroy).toHaveBeenCalled()
    })

    it('runs a full sync on close when online, before closing the window', async () => {
      const order: string[] = []
      const syncNow = vi.fn(async () => {
        order.push('sync')
      })
      vi.mocked(useSyncStore.getState).mockReturnValue({ syncNow } as any)
      destroy.mockImplementation(async () => {
        order.push('destroy')
      })
      useWorkspaceStore.setState({ currentFilePath: '/cours/a.json' })
      const flush = vi.fn().mockResolvedValue(undefined)
      renderHook(() => useUnsavedChangesGuard(flush, vi.fn()))
      await waitFor(() => expect(onCloseRequested).toHaveBeenCalled())

      await act(async () => closeHandler({ preventDefault: vi.fn() }))

      expect(syncNow).toHaveBeenCalledWith({ trigger: 'auto' })
      expect(order).toEqual(['sync', 'destroy'])
    })

    it('closes normally, without syncing, when there is no internet', async () => {
      const syncNow = vi.fn().mockResolvedValue(undefined)
      vi.mocked(useSyncStore.getState).mockReturnValue({ syncNow } as any)
      const flush = vi.fn().mockResolvedValue(undefined)
      renderHook(() => useUnsavedChangesGuard(flush, vi.fn(), { isOnline: () => false }))
      await waitFor(() => expect(onCloseRequested).toHaveBeenCalled())

      await act(async () => closeHandler({ preventDefault: vi.fn() }))

      expect(syncNow).not.toHaveBeenCalled()
      expect(destroy).toHaveBeenCalled()
    })

    it('shows the closing screen while the close-time sync is running', async () => {
      let resolveSync: () => void = () => {}
      const syncNow = vi.fn(
        () =>
          new Promise<void>(resolve => {
            resolveSync = resolve
          })
      )
      vi.mocked(useSyncStore.getState).mockReturnValue({ syncNow } as any)
      const flush = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() => useUnsavedChangesGuard(flush, vi.fn()))
      await waitFor(() => expect(onCloseRequested).toHaveBeenCalled())

      let pending: Promise<void> = Promise.resolve()
      await act(async () => {
        pending = closeHandler({ preventDefault: vi.fn() }) as Promise<void>
      })

      expect(result.current.closing).toBe(true)

      await act(async () => {
        resolveSync()
        await pending
      })

      expect(result.current.closing).toBe(false)
      expect(destroy).toHaveBeenCalled()
    })

    it('closes anyway when the close-time sync never finishes', async () => {
      const syncNow = vi.fn(() => new Promise<void>(() => {}))
      vi.mocked(useSyncStore.getState).mockReturnValue({ syncNow } as any)
      const flush = vi.fn().mockResolvedValue(undefined)
      renderHook(() => useUnsavedChangesGuard(flush, vi.fn()))
      await waitFor(() => expect(onCloseRequested).toHaveBeenCalled())

      vi.useFakeTimers()
      await act(async () => {
        const pending = closeHandler({ preventDefault: vi.fn() })
        await vi.advanceTimersByTimeAsync(CLOSE_SYNC_TIMEOUT_MS)
        await pending
      })
      vi.useRealTimers()

      expect(destroy).toHaveBeenCalled()
    })

    it('prompts instead of closing when the flush fails', async () => {
      const flush = vi.fn().mockRejectedValue(new Error('disque plein'))
      const { result } = renderHook(() => useUnsavedChangesGuard(flush, vi.fn()))
      await waitFor(() => expect(onCloseRequested).toHaveBeenCalled())

      await act(async () => closeHandler({ preventDefault: vi.fn() }))

      expect(destroy).not.toHaveBeenCalled()
      expect(result.current.prompt?.continueLabel).toBe('Quitter quand même')
    })

    it('closes the window when the close prompt is confirmed', async () => {
      const flush = vi.fn().mockRejectedValue(new Error('disque plein'))
      const { result } = renderHook(() => useUnsavedChangesGuard(flush, vi.fn()))
      await waitFor(() => expect(onCloseRequested).toHaveBeenCalled())
      await act(async () => closeHandler({ preventDefault: vi.fn() }))
      await waitFor(() => expect(result.current.prompt).not.toBeNull())

      act(() => result.current.prompt?.onContinue?.())

      expect(destroy).toHaveBeenCalled()
    })

    it('blames the close, not the save, when the window refuses to be destroyed', async () => {
      // The real case this comes from: `core:window:allow-destroy` missing from
      // the Tauri capability. The save had in fact succeeded, and the dialog
      // still announced « La sauvegarde a échoué ».
      destroy.mockRejectedValueOnce(new Error('window.destroy not allowed'))
      const flush = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() => useUnsavedChangesGuard(flush, vi.fn()))
      await waitFor(() => expect(onCloseRequested).toHaveBeenCalled())

      await act(async () => closeHandler({ preventDefault: vi.fn() }))

      expect(result.current.prompt?.message).toMatch(/Impossible de fermer la fenêtre/)
      expect(result.current.prompt?.message).not.toMatch(/sauvegarde/)
      // Nothing left to continue TO: the window is staying open either way, so
      // the dialog must not offer a « Quitter quand même » that cannot quit.
      expect(result.current.prompt?.continueLabel).toBeNull()
      expect(result.current.prompt?.onContinue).toBeNull()
    })

    it('reports the failure when "Quitter quand même" cannot close the window either', async () => {
      // The bug as the user hit it: confirming the prompt dismissed the dialog
      // and nothing else happened — the app just stayed there.
      destroy.mockRejectedValue(new Error('window.destroy not allowed'))
      const flush = vi.fn().mockRejectedValue(new Error('disque plein'))
      const { result } = renderHook(() => useUnsavedChangesGuard(flush, vi.fn()))
      await waitFor(() => expect(onCloseRequested).toHaveBeenCalled())
      await act(async () => closeHandler({ preventDefault: vi.fn() }))
      await waitFor(() => expect(result.current.prompt).not.toBeNull())

      await act(async () => result.current.prompt?.onContinue?.())

      await waitFor(() => expect(result.current.prompt?.message).toMatch(/Impossible de fermer la fenêtre/))
    })

    it('does not crash and never prompts outside a Tauri window', () => {
      getCurrentWindowThrows = true
      const flush = vi.fn().mockResolvedValue(undefined)

      const { result } = renderHook(() => useUnsavedChangesGuard(flush, vi.fn()))

      expect(result.current.prompt).toBeNull()
    })
  })
})
