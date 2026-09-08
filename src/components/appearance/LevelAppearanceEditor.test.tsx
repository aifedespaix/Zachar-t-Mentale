import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LevelAppearanceEditor } from './LevelAppearanceEditor'
import { useAppearanceSettingsStore } from '../../state/useAppearanceSettingsStore'
import { DEFAULT_APPEARANCE_SETTINGS } from '../../types/appearanceSettings'

describe('LevelAppearanceEditor', () => {
  beforeEach(() => {
    useAppearanceSettingsStore.setState(DEFAULT_APPEARANCE_SETTINGS)
  })

  it('shows the level label in an editable field', () => {
    render(<LevelAppearanceEditor level={1} />)
    expect(screen.getByDisplayValue('Titre')).toBeInTheDocument()
  })

  it('updates the label in the store when edited', async () => {
    const user = userEvent.setup()
    render(<LevelAppearanceEditor level={1} />)

    const input = screen.getByDisplayValue('Titre')
    await user.clear(input)
    await user.type(input, 'Chapitre')

    expect(useAppearanceSettingsStore.getState().levels[1].label).toBe('Chapitre')
  })

  it('shows a contrast warning when a custom color falls below WCAG AA', () => {
    useAppearanceSettingsStore.setState({
      levels: {
        ...DEFAULT_APPEARANCE_SETTINGS.levels,
        1: {
          ...DEFAULT_APPEARANCE_SETTINGS.levels[1],
          color: {
            ...DEFAULT_APPEARANCE_SETTINGS.levels[1].color,
            light: {
              bg: { l: 0.5, c: 0.02, h: 25 },
              border: { l: 0.55, c: 0.18, h: 25 },
              text: { l: 0.52, c: 0.15, h: 25 },
            },
          },
        },
      },
    })
    render(<LevelAppearanceEditor level={1} />)
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Contraste texte/fond insuffisant')
  })

  it('does not show a contrast warning for the default palette', () => {
    render(<LevelAppearanceEditor level={1} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('updates the light background color when its lightness slider moves', async () => {
    const user = userEvent.setup()
    render(<LevelAppearanceEditor level={1} />)

    screen.getByRole('slider', { name: 'Clair — Fond — luminosité' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(useAppearanceSettingsStore.getState().levels[1].color.light.bg.l).toBeCloseTo(0.97)
  })
})
