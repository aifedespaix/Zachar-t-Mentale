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

import { useUnsavedChangesGuard } from './useUnsavedChangesGuard'

describe('useUnsavedChangesGuard', () => {
  beforeEach(() => {
    destroy.mockClear()
    onCloseRequested.mockClear()
    getCurrentWindowThrows = false
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

      act(() => result.current.prompt?.onContinue())

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

      act(() => result.current.prompt?.onContinue())

      expect(destroy).toHaveBeenCalled()
    })

    it('does not crash and never prompts outside a Tauri window', () => {
      getCurrentWindowThrows = true
      const flush = vi.fn().mockResolvedValue(undefined)

      const { result } = renderHook(() => useUnsavedChangesGuard(flush, vi.fn()))

      expect(result.current.prompt).toBeNull()
    })
  })
})
