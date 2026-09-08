import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const setTitle = vi.fn().mockResolvedValue(undefined)
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setTitle }),
}))

import { useWindowTitle } from './useWindowTitle'

describe('useWindowTitle', () => {
  beforeEach(() => {
    setTitle.mockClear()
  })

  it('sets the window title to just the app name when no file is open', () => {
    renderHook(() => useWindowTitle(null))
    expect(setTitle).toHaveBeenCalledWith("Zachar’t Mentale")
  })

  it('sets the window title to the app name plus the open file name', () => {
    renderHook(() => useWindowTitle('/cours/fractions.json'))
    expect(setTitle).toHaveBeenCalledWith("Zachar’t Mentale - fractions")
  })

  it('updates the title again when the open file changes', () => {
    const { rerender } = renderHook(({ path }) => useWindowTitle(path), {
      initialProps: { path: '/cours/fractions.json' as string | null },
    })
    rerender({ path: '/cours/pourcentages.json' })
    expect(setTitle).toHaveBeenLastCalledWith("Zachar’t Mentale - pourcentages")
  })
})
