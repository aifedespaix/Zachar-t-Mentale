import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GeneralSettingsPanel } from './GeneralSettingsPanel'
import { DEFAULT_APPEARANCE_SETTINGS } from '../../types/appearanceSettings'

function renderPanel(status: 'idle' | 'checking' | 'up-to-date' | 'error', checkNow = vi.fn().mockResolvedValue(undefined)) {
  render(
    <GeneralSettingsPanel
      settings={DEFAULT_APPEARANCE_SETTINGS}
      onChange={() => {}}
      updateCheck={{ status, checkNow }}
    />
  )
  return { checkNow }
}

describe('GeneralSettingsPanel — update check', () => {
  it('calls checkNow when the "Rechercher les mises à jour" button is clicked', async () => {
    const user = userEvent.setup()
    const { checkNow } = renderPanel('idle')

    await user.click(screen.getByRole('button', { name: 'Rechercher les mises à jour' }))

    expect(checkNow).toHaveBeenCalled()
  })

  it('disables the button and shows a checking message while a check is in flight', () => {
    renderPanel('checking')

    expect(screen.getByRole('button', { name: 'Rechercher les mises à jour' })).toBeDisabled()
    expect(screen.getByText('Vérification en cours…')).toBeInTheDocument()
  })

  it('shows an up-to-date message after a check finds nothing', () => {
    renderPanel('up-to-date')

    expect(screen.getByText('À jour')).toBeInTheDocument()
  })

  it('shows an error message when the check fails', () => {
    renderPanel('error')

    expect(screen.getByText('Échec de la vérification')).toBeInTheDocument()
  })

  it('shows no status message while idle', () => {
    renderPanel('idle')

    expect(screen.queryByText('À jour')).not.toBeInTheDocument()
    expect(screen.queryByText('Vérification en cours…')).not.toBeInTheDocument()
    expect(screen.queryByText('Échec de la vérification')).not.toBeInTheDocument()
  })
})
