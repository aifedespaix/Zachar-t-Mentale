import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LevelAppearanceEditor } from './LevelAppearanceEditor'
import { DEFAULT_APPEARANCE_SETTINGS } from '../../types/appearanceSettings'
import type { LevelAppearance } from '../../types/appearanceSettings'

const defaultLevel1 = DEFAULT_APPEARANCE_SETTINGS.levels[1]

function renderEditor(appearance: LevelAppearance = defaultLevel1) {
  const onChange = vi.fn()
  render(<LevelAppearanceEditor level={1} appearance={appearance} onChange={onChange} />)
  return onChange
}

describe('LevelAppearanceEditor', () => {
  it('shows the level label in an editable field', () => {
    renderEditor()
    expect(screen.getByDisplayValue('Titre')).toBeInTheDocument()
  })

  it('reports an edited label to its parent rather than writing it itself', async () => {
    const user = userEvent.setup()
    const onChange = renderEditor()

    await user.type(screen.getByDisplayValue('Titre'), 'X')

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ label: 'TitreX' }))
  })

  it('shows a contrast warning when a custom color falls below WCAG AA', () => {
    renderEditor({
      ...defaultLevel1,
      color: {
        ...defaultLevel1.color,
        light: {
          bg: { l: 0.5, c: 0.02, h: 25 },
          border: { l: 0.55, c: 0.18, h: 25 },
          text: { l: 0.52, c: 0.15, h: 25 },
        },
      },
    })

    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Contraste texte/fond insuffisant')
  })

  it('does not show a contrast warning for the default palette', () => {
    renderEditor()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports a colour change while leaving the level\'s other colours untouched', async () => {
    const user = userEvent.setup()
    const onChange = renderEditor()

    screen.getByRole('slider', { name: 'Clair — Fond — luminosité' }).focus()
    await user.keyboard('{ArrowRight}')

    const next = onChange.mock.calls[0][0] as LevelAppearance
    expect(next.color.light.bg.l).toBeCloseTo(0.97)
    expect(next.color.light.text).toEqual(defaultLevel1.color.light.text)
    expect(next.color.dark).toEqual(defaultLevel1.color.dark)
  })
})
