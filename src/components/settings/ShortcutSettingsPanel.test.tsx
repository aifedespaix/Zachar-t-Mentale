import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach } from 'vitest'
import { ShortcutSettingsPanel } from './ShortcutSettingsPanel'
import { useShortcutSettingsStore } from '../../state/useShortcutSettingsStore'

/** The row of the list whose action is `label`. */
function rowFor(label: string): HTMLElement {
  return screen.getByText(label).closest('li')!
}

describe('ShortcutSettingsPanel', () => {
  beforeEach(() => {
    useShortcutSettingsStore.getState().resetAll()
  })

  it('lists every action with what it does and the key that runs it', () => {
    render(<ShortcutSettingsPanel />)

    const row = rowFor('Annuler')
    expect(row).toHaveTextContent('Revient sur la dernière modification')
    expect(within(row).getByRole('button', { name: /Raccourci de « Annuler »/ })).toHaveTextContent('Ctrl + Z')
  })

  it('groups the actions by what they act on', () => {
    render(<ShortcutSettingsPanel />)
    expect(screen.getByRole('heading', { name: 'Fichier' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Navigation' })).toBeInTheDocument()
  })

  it('records a new chord onto the action being edited', async () => {
    const user = userEvent.setup()
    render(<ShortcutSettingsPanel />)

    await user.click(within(rowFor('Annuler')).getByRole('button', { name: /Raccourci de « Annuler »/ }))
    expect(screen.getByText('Appuie sur une combinaison…')).toBeInTheDocument()

    // Captured on the window, not on the button: half the chords worth binding
    // never reach a focused control as an ordinary keydown.
    fireEvent.keyDown(window, { key: 'u', ctrlKey: true })
    expect(useShortcutSettingsStore.getState().bindings['edit.undo']).toBe('Mod+U')
  })

  it('waits, rather than rejecting, while only a modifier is held', async () => {
    const user = userEvent.setup()
    render(<ShortcutSettingsPanel />)
    await user.click(within(rowFor('Annuler')).getByRole('button', { name: /Raccourci de « Annuler »/ }))

    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true })
    expect(screen.getByText('Appuie sur une combinaison…')).toBeInTheDocument()
    expect(useShortcutSettingsStore.getState().bindings['edit.undo']).toBe('Mod+Z')
  })

  it('backs out on Échap, which is the first key anyone tries', async () => {
    const user = userEvent.setup()
    render(<ShortcutSettingsPanel />)
    await user.click(within(rowFor('Annuler')).getByRole('button', { name: /Raccourci de « Annuler »/ }))

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('Appuie sur une combinaison…')).not.toBeInTheDocument()
    expect(useShortcutSettingsStore.getState().bindings['edit.undo']).toBe('Mod+Z')
  })

  it('says out loud which action just lost the chord it took', async () => {
    // Two commands on one key would leave one of them silently dead; the panel
    // takes the key and names the loser instead.
    const user = userEvent.setup()
    render(<ShortcutSettingsPanel />)

    await user.click(
      within(rowFor('Ouvrir la fiche')).getByRole('button', { name: /Raccourci de « Ouvrir la fiche »/ })
    )
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

    expect(screen.getByRole('status')).toHaveTextContent('appartenait à « Annuler »')
    expect(useShortcutSettingsStore.getState().bindings['edit.undo']).toBeNull()
  })

  it('removes a shortcut without touching the action', async () => {
    const user = userEvent.setup()
    render(<ShortcutSettingsPanel />)

    await user.click(within(rowFor('Annuler')).getByRole('button', { name: /Supprimer le raccourci/ }))
    expect(useShortcutSettingsStore.getState().bindings['edit.undo']).toBeNull()
    expect(within(rowFor('Annuler')).getByRole('button', { name: /Raccourci de « Annuler »/ })).toHaveTextContent(
      'Aucun'
    )
  })

  it('puts one action, or all of them, back to the shipped keys', async () => {
    const user = userEvent.setup()
    render(<ShortcutSettingsPanel />)

    await user.click(within(rowFor('Annuler')).getByRole('button', { name: /Raccourci de « Annuler »/ }))
    fireEvent.keyDown(window, { key: 'u', ctrlKey: true })
    expect(screen.getByText('1 raccourci personnalisé.')).toBeInTheDocument()

    await user.click(within(rowFor('Annuler')).getByRole('button', { name: /Réinitialiser le raccourci/ }))
    expect(useShortcutSettingsStore.getState().bindings['edit.undo']).toBe('Mod+Z')
    expect(screen.getByText('Tous les raccourcis sont ceux d’origine.')).toBeInTheDocument()

    await user.click(within(rowFor('Rétablir')).getByRole('button', { name: /Raccourci de « Rétablir »/ }))
    fireEvent.keyDown(window, { key: 'r', ctrlKey: true })
    await user.click(screen.getByRole('button', { name: 'Tout réinitialiser' }))
    expect(useShortcutSettingsStore.getState().overrides).toEqual({})
  })

  it('filters by action, by explanation and by key', async () => {
    const user = userEvent.setup()
    render(<ShortcutSettingsPanel />)
    const search = screen.getByLabelText('Rechercher un raccourci')

    // Unaccented, because nobody types the accent into a search box.
    await user.type(search, 'retablir')
    expect(screen.getByText('Rétablir')).toBeInTheDocument()
    expect(screen.queryByText('Zoom avant')).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'Maj')
    expect(screen.getByText('Rétablir')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'xyzzy')
    expect(screen.getByText(/Aucune action ne correspond/)).toBeInTheDocument()
  })
})
