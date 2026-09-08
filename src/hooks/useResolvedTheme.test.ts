import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResolvedTheme, useThemeDomSync } from './useResolvedTheme'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'
import { DEFAULT_APPEARANCE_SETTINGS } from '../types/appearanceSettings'

function mockMatchMedia(initialMatches: boolean) {
  let handler: ((event: MediaQueryListEvent) => void) | null = null
  const mql = {
    matches: initialMatches,
    addEventListener: vi.fn((_event: string, cb: (event: MediaQueryListEvent) => void) => {
      handler = cb
    }),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql))
  return {
    mql,
    fireChange(matches: boolean) {
      mql.matches = matches
      handler?.({ matches } as MediaQueryListEvent)
    },
  }
}

describe('useResolvedTheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useAppearanceSettingsStore.setState(DEFAULT_APPEARANCE_SETTINGS)
  })

  it('returns the explicit mode without consulting the system preference', () => {
    mockMatchMedia(true)
    useAppearanceSettingsStore.setState({ themeMode: 'light' })
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('light')
  })

  it('follows the system preference when mode is "system"', () => {
    mockMatchMedia(true)
    useAppearanceSettingsStore.setState({ themeMode: 'system' })
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('dark')
  })

  it('reacts to a live system preference change while in "system" mode', () => {
    const media = mockMatchMedia(false)
    useAppearanceSettingsStore.setState({ themeMode: 'system' })
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('light')

    act(() => media.fireChange(true))

    expect(result.current).toBe('dark')
  })

  it('unsubscribes from the media query listener on unmount', () => {
    const { mql } = mockMatchMedia(false)
    const { unmount } = renderHook(() => useResolvedTheme())
    unmount()
    expect(mql.removeEventListener).toHaveBeenCalled()
  })
})

describe('useThemeDomSync', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useAppearanceSettingsStore.setState(DEFAULT_APPEARANCE_SETTINGS)
    document.documentElement.classList.remove('dark')
  })

  it('adds the dark class when the resolved theme is dark', () => {
    mockMatchMedia(false)
    useAppearanceSettingsStore.setState({ themeMode: 'dark' })
    renderHook(() => useThemeDomSync())
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes the dark class when the resolved theme is light', () => {
    mockMatchMedia(false)
    document.documentElement.classList.add('dark')
    useAppearanceSettingsStore.setState({ themeMode: 'light' })
    renderHook(() => useThemeDomSync())
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
