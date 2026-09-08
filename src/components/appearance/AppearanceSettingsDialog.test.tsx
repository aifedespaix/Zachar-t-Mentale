import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppearanceSettingsDialog } from './AppearanceSettingsDialog'
import { useAppearanceSettingsStore } from '../../state/useAppearanceSettingsStore'
import { DEFAULT_APPEARANCE_SETTINGS } from '../../types/appearanceSettings'

vi.mock('../../persistence/appearanceSettings', () => ({
  loadAppearanceSettings: vi.fn(),
  saveAppearanceSettings: vi.fn().mockResolvedValue(undefined),
}))

describe('AppearanceSettingsDialog', () => {
  beforeEach(() => {
    useAppearanceSettingsStore.setState(DEFAULT_APPEARANCE_SETTINGS)
  })

  it('shows a label editor for all 4 levels', () => {
    render(<AppearanceSettingsDialog open onOpenChange={() => {}} />)
    expect(screen.getByDisplayValue('Titre')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Sous-titre')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Sous-partie')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Info')).toBeInTheDocument()
  })

  it('marks "Système" as the selected theme by default', () => {
    render(<AppearanceSettingsDialog open onOpenChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Système' })).toHaveAttribute('aria-checked', 'true')
  })

  it('switches the theme mode in the store when a theme option is clicked', async () => {
    const user = userEvent.setup()
    render(<AppearanceSettingsDialog open onOpenChange={() => {}} />)

    await user.click(screen.getByRole('radio', { name: 'Sombre' }))

    expect(useAppearanceSettingsStore.getState().themeMode).toBe('dark')
  })

  it('updates the font family in the store when a different font is selected', async () => {
    const user = userEvent.setup()
    render(<AppearanceSettingsDialog open onOpenChange={() => {}} />)

    await user.selectOptions(screen.getByRole('combobox'), 'Georgia, serif')

    expect(useAppearanceSettingsStore.getState().fontFamily).toBe('Georgia, serif')
  })
})
