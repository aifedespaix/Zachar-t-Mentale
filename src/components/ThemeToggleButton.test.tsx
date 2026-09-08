import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeToggleButton } from './ThemeToggleButton'
import { useAppearanceSettingsStore } from '../state/useAppearanceSettingsStore'
import { DEFAULT_APPEARANCE_SETTINGS } from '../types/appearanceSettings'
import * as circularReveal from '../theme/circularReveal'

vi.mock('../theme/circularReveal', () => ({
  startCircularThemeTransition: vi.fn(({ apply }: { apply: () => void }) => apply()),
}))

describe('ThemeToggleButton', () => {
  beforeEach(() => {
    useAppearanceSettingsStore.setState(DEFAULT_APPEARANCE_SETTINGS)
    useAppearanceSettingsStore.setState({ themeMode: 'light' })
    vi.mocked(circularReveal.startCircularThemeTransition).mockClear()
  })

  it('shows a "passer au sombre" label in light mode', () => {
    render(<ThemeToggleButton />)
    expect(screen.getByRole('button', { name: 'Passer au thème sombre' })).toBeInTheDocument()
  })

  it('switches to dark on click, via a circular transition centered on the click point', async () => {
    const user = userEvent.setup()
    render(<ThemeToggleButton />)

    await user.click(screen.getByRole('button', { name: 'Passer au thème sombre' }))

    expect(circularReveal.startCircularThemeTransition).toHaveBeenCalledWith(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), apply: expect.any(Function) })
    )
    expect(useAppearanceSettingsStore.getState().themeMode).toBe('dark')
  })

  it('switches to light when currently dark', async () => {
    useAppearanceSettingsStore.setState({ themeMode: 'dark' })
    const user = userEvent.setup()
    render(<ThemeToggleButton />)

    await user.click(screen.getByRole('button', { name: 'Passer au thème clair' }))

    expect(circularReveal.startCircularThemeTransition).toHaveBeenCalledWith(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), apply: expect.any(Function) })
    )
    expect(useAppearanceSettingsStore.getState().themeMode).toBe('light')
  })
})
