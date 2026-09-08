import { useEffect, useState } from 'react'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'

function systemPrefersDarkNow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
}

/**
 * Resolves `themeMode` ('light' | 'dark' | 'system') to an actual
 * 'light' | 'dark', tracking the OS preference live while in 'system' mode.
 */
export function useResolvedTheme(): 'light' | 'dark' {
  const themeMode = useAppearanceSettingsStore(s => s.themeMode)
  const [systemPrefersDark, setSystemPrefersDark] = useState(systemPrefersDarkNow)

  useEffect(() => {
    if (themeMode !== 'system') return
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [themeMode])

  if (themeMode === 'system') return systemPrefersDark ? 'dark' : 'light'
  return themeMode
}

/**
 * Applies the resolved theme to `<html>` as the `dark` class shadcn's tokens
 * key off (`src/index.css`'s `.dark { ... }` block). Call once, near the app
 * root — every other consumer of the theme should read `useResolvedTheme()`
 * for the value, not re-run this side effect.
 */
export function useThemeDomSync(): void {
  const resolved = useResolvedTheme()
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [resolved])
}
