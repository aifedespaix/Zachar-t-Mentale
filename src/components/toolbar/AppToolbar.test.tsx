import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn(async () => {}) }))

import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { AppToolbar } from './AppToolbar'
import { useCardsStore, createCardsStore } from '../../state/useCardsStore'
import { useCardDetailStore } from '../../state/useCardDetailStore'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { useAppearanceSettingsStore } from '../../state/useAppearanceSettingsStore'
import { useShortcutSettingsStore } from '../../state/useShortcutSettingsStore'
import { useCommandRegistry } from '../../state/useCommandRegistry'
import type { Card } from '../../types/card'

const CARDS: Card[] = [{ id: 'root', level: 1, title: 'Racine', parentId: null, order: 0 }]

const updateCheckStub = { status: 'idle' as const, checkNow: vi.fn(async () => {}) }

function renderToolbar(overrides: Partial<React.ComponentProps<typeof AppToolbar>> = {}) {
  const props = {
    filePath: '/cours/chapitre1.zmap',
    cards: CARDS,
    onOpenFile: vi.fn(),
    flush: vi.fn(async () => {}),
    updateCheck: updateCheckStub,
    ...overrides,
  }
  return { ...render(<AppToolbar {...props} />), props }
}

describe('AppToolbar', () => {
  beforeEach(() => {
    const pristine = createCardsStore().getState()
    useCardsStore.setState({ history: pristine.history, locked: pristine.locked })
    useCardDetailStore.getState().closeAll()
    useWorkspaceStore.setState({ currentFilePath: null, workspaceError: null })
    useShortcutSettingsStore.getState().resetAll()
    useCommandRegistry.setState({ registrations: {} })
    vi.mocked(revealItemInDir).mockClear()
  })

  it('names each button by its action and tells you the key that does the same thing', async () => {
    const user = userEvent.setup()
    renderToolbar()

    const save = screen.getByRole('button', { name: 'Enregistrer maintenant' })
    expect(save).toHaveAttribute('aria-keyshortcuts', 'Mod+S')
    await user.hover(save)
    // The tooltip is how a mouse-driven user discovers the keyboard.
    expect(await screen.findByText('Ctrl + S')).toBeInTheDocument()
  })

  it('writes the map immediately when asked to save', async () => {
    const user = userEvent.setup()
    const { props } = renderToolbar()
    await user.click(screen.getByRole('button', { name: 'Enregistrer maintenant' }))
    expect(props.flush).toHaveBeenCalled()
  })

  it('greys out everything that needs an open map when there is none', () => {
    renderToolbar({ filePath: null })
    expect(screen.getByRole('button', { name: 'Enregistrer maintenant' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Exporter la carte mentale…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Lancer un quiz' })).toBeDisabled()
  })

  it('locks and unlocks the map, saying which of the two the button now does', async () => {
    const user = userEvent.setup()
    renderToolbar()

    await user.click(screen.getByRole('button', { name: 'Verrouiller la carte' }))
    expect(useCardsStore.getState().locked).toBe(true)
    expect(screen.getByRole('button', { name: 'Déverrouiller la carte' })).toBeInTheDocument()
  })

  it('switches the theme', async () => {
    const user = userEvent.setup()
    act(() => useAppearanceSettingsStore.setState({ themeMode: 'light' }))
    renderToolbar()

    await user.click(screen.getByRole('button', { name: 'Passer au thème sombre' }))
    await waitFor(() => expect(useAppearanceSettingsStore.getState().themeMode).toBe('dark'))
  })

  it('closes every open fiche, and offers nothing to close when there are none', async () => {
    const user = userEvent.setup()
    renderToolbar()
    expect(screen.getByRole('button', { name: 'Fermer toutes les fiches' })).toBeDisabled()

    act(() => useCardDetailStore.getState().show('root'))
    await user.click(screen.getByRole('button', { name: 'Fermer toutes les fiches' }))
    expect(useCardDetailStore.getState().open).toHaveLength(0)
  })

  it('opens the export dialog on the map on screen', async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByRole('button', { name: 'Exporter la carte mentale…' }))
    expect(await screen.findByText('Exporter « chapitre1 »')).toBeInTheDocument()
  })

  it('gathers the file actions in one menu, each with its shortcut', async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByRole('button', { name: 'Fichier' }))

    const rename = await screen.findByRole('menuitem', { name: /Renommer la carte mentale/ })
    expect(rename).toHaveTextContent('Ctrl + Maj + R')
    // Destructive, and deliberately shipped without a key of its own.
    expect(screen.getByRole('menuitem', { name: /Supprimer la carte mentale/ })).toHaveTextContent(
      'Supprimer la carte mentale'
    )
  })

  it('asks before deleting the open file, and says what goes with it', async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByRole('button', { name: 'Fichier' }))
    await user.click(await screen.findByRole('menuitem', { name: /Supprimer la carte mentale/ }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Supprimer « chapitre1.zmap » ?')
    expect(dialog).toHaveTextContent('images')
  })

  it('shows the file in the system explorer', async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByRole('button', { name: 'Fichier' }))
    await user.click(await screen.findByRole('menuitem', { name: /Afficher dans l’explorateur/ }))
    await waitFor(() => expect(revealItemInDir).toHaveBeenCalledWith('/cours/chapitre1.zmap'))
  })

  it('opens the settings straight on the shortcuts list when that is what was asked for', async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByRole('button', { name: 'Paramètres et raccourcis' }))
    await user.click(await screen.findByRole('menuitem', { name: /Raccourcis clavier/ }))

    expect(await screen.findByLabelText('Rechercher un raccourci')).toBeInTheDocument()
  })

  it('opens the command palette', async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByRole('button', { name: 'Palette de commandes' }))
    expect(await screen.findByLabelText('Rechercher une commande')).toBeInTheDocument()
  })
})
