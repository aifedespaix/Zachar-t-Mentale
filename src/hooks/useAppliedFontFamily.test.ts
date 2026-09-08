import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAppliedFontFamily } from './useAppliedFontFamily'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'
import { DEFAULT_APPEARANCE_SETTINGS } from '../types/appearanceSettings'

describe('useAppliedFontFamily', () => {
  beforeEach(() => {
    useAppearanceSettingsStore.setState(DEFAULT_APPEARANCE_SETTINGS)
    document.documentElement.style.removeProperty('--font-sans')
  })
  afterEach(() => {
    document.documentElement.style.removeProperty('--font-sans')
  })

  it('sets --font-sans to the store default on mount', () => {
    renderHook(() => useAppliedFontFamily())
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe(DEFAULT_APPEARANCE_SETTINGS.fontFamily)
  })

  it('updates --font-sans when the store value changes', () => {
    renderHook(() => useAppliedFontFamily())
    act(() => {
      useAppearanceSettingsStore.setState({ fontFamily: 'Georgia, serif' })
    })
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe('Georgia, serif')
  })
})
