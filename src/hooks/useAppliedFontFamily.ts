import { useEffect } from 'react'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'

/**
 * Syncs the `--font-sans` CSS variable (consumed by `--font-heading` and
 * `html`'s `font-sans` utility in `src/index.css`) with the store. Call once,
 * near the app root.
 */
export function useAppliedFontFamily(): void {
  const fontFamily = useAppearanceSettingsStore(s => s.fontFamily)
  useEffect(() => {
    document.documentElement.style.setProperty('--font-sans', fontFamily)
  }, [fontFamily])
}
