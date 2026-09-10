import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FileSidebar } from './FileSidebar'
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from '../../persistence/sidebarWidth'
import { useWorkspaceStore, createWorkspaceStore } from '../../state/useWorkspaceStore'
import { useSyncStore } from '../../state/useSyncStore'

vi.mock('../../persistence/workspaceConfig', () => ({
  loadWorkspaceConfig: vi.fn(),
  saveWorkspaceConfig: vi.fn(),
}))
vi.mock('../../persistence/fileTree', () => ({ scanFolder: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('../../persistence/sessionState', () => ({
  loadSessionState: vi.fn(),
  saveSessionState: vi.fn(),
}))
vi.mock('../../hooks/useMindMapFormatValid', () => ({ useMindMapFormatValid: vi.fn() }))

import { loadWorkspaceConfig, saveWorkspaceConfig } from '../../persistence/workspaceConfig'
import { scanFolder } from '../../persistence/fileTree'
import { open } from '@tauri-apps/plugin-dialog'
import { loadSessionState } from '../../persistence/sessionState'

/**
 * The sidebar panel itself — the element the width is set on. It has no role
 * of its own (it is a plain container), so it is reached through the resize
 * border it owns rather than by adding a test id purely for the test.
 */
function sidebarPanel(): HTMLElement {
  return screen.getByRole('separator', { name: 'Redimensionner la barre latérale' }).parentElement as HTMLElement
}

function resetWorkspaceStore() {
  const pristine = createWorkspaceStore().getState()
  useWorkspaceStore.setState({
    rootFolders: pristine.rootFolders,
    expandedPaths: pristine.expandedPaths,
    currentFilePath: pristine.currentFilePath,
    workspaceError: pristine.workspaceError,
  })
}

/**
 * The sync store is a module singleton too, and its `syncNow` is stubbed: the
 * real one would reach the network, which no unit test of this panel should.
 */
function resetSyncStore() {
  useSyncStore.setState({
    serverUrl: '',
    syncFolderPath: null,
    currentUser: null,
    status: 'idle',
    error: null,
    lastResult: null,
    syncNow: vi.fn().mockResolvedValue(undefined),
  })
}

describe('FileSidebar', () => {
  beforeEach(() => {
    // The remembered sidebar width lives in localStorage, so each test starts
    // from "never resized" rather than from whatever the previous one left.
    localStorage.clear()
    resetWorkspaceStore()
    resetSyncStore()
    vi.mocked(loadWorkspaceConfig).mockReset().mockResolvedValue({ rootFolders: [] })
    vi.mocked(saveWorkspaceConfig).mockReset().mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockReset().mockResolvedValue([])
    vi.mocked(open).mockReset()
    vi.mocked(loadSessionState).mockReset().mockReturnValue({ currentFilePath: null, expandedPaths: [] })
  })

  it('loads the configured workspace on mount and shows an empty state with no root folders', async () => {
    render(<FileSidebar onOpenFile={() => {}} />)

    await waitFor(() => expect(loadWorkspaceConfig).toHaveBeenCalled())
    expect(await screen.findByText('Aucun dossier configuré.')).toBeInTheDocument()
  })

  it('adds a folder chosen from the native picker and lists it', async () => {
    const user = userEvent.setup()
    vi.mocked(open).mockResolvedValue('/cours-svt')
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Aucun dossier configuré.')

    await user.click(screen.getByRole('button', { name: 'Ajouter un dossier de travail' }))

    expect(await screen.findByText('cours-svt')).toBeInTheDocument()
    expect(saveWorkspaceConfig).toHaveBeenCalledWith({ rootFolders: ['/cours-svt'] })
  })

  it('does not add a folder when the picker is cancelled', async () => {
    const user = userEvent.setup()
    vi.mocked(open).mockResolvedValue(null)
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Aucun dossier configuré.')

    await user.click(screen.getByRole('button', { name: 'Ajouter un dossier de travail' }))

    expect(saveWorkspaceConfig).not.toHaveBeenCalled()
  })

  it('expands a root folder to reveal its files, and opens a mindmap file on click', async () => {
    const user = userEvent.setup()
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours-svt'] })
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'chapitre1.json', path: '/cours-svt/chapitre1.json' },
    ])
    const onOpenFile = vi.fn()
    render(<FileSidebar onOpenFile={onOpenFile} />)
    await screen.findByText('cours-svt')

    expect(screen.queryByText('chapitre1')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'cours-svt' }))
    await user.click(await screen.findByText('chapitre1'))

    expect(onOpenFile).toHaveBeenCalledWith('/cours-svt/chapitre1.json')
  })

  it('removes a root folder from the list and persists the config', async () => {
    const user = userEvent.setup()
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours-svt'] })
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('cours-svt')

    // The row's actions moved into a right-click context menu (Task 4).
    fireEvent.contextMenu(screen.getByRole('button', { name: /cours-svt/i }))
    await user.click(await screen.findByRole('menuitem', { name: 'Retirer cours-svt de la liste' }))

    await waitFor(() => expect(screen.queryByText('cours-svt')).not.toBeInTheDocument())
    expect(saveWorkspaceConfig).toHaveBeenCalledWith({ rootFolders: [] })
  })

  it('shows an unreadable root folder in the list AND explains why it looks empty', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours-svt'] })
    vi.mocked(scanFolder).mockRejectedValue(new Error('accès refusé'))
    render(<FileSidebar onOpenFile={() => {}} />)

    expect(await screen.findByText('cours-svt')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Impossible de lire le dossier « cours-svt »/)
  })

  it('dismisses the workspace error banner on demand', async () => {
    const user = userEvent.setup()
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours-svt'] })
    vi.mocked(scanFolder).mockRejectedValue(new Error('accès refusé'))
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Masquer le message d’erreur' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('surfaces a failure of the native folder picker instead of doing nothing', async () => {
    const user = userEvent.setup()
    vi.mocked(open).mockRejectedValue(new Error('sélecteur indisponible'))
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Aucun dossier configuré.')

    await user.click(screen.getByRole('button', { name: 'Ajouter un dossier de travail' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/sélecteur indisponible/)
  })

  it('re-scans every root folder from the "Actualiser l’arborescence" button', async () => {
    const user = userEvent.setup()
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours-svt'] })
    vi.mocked(scanFolder).mockResolvedValue([])
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('cours-svt')
    await user.click(screen.getByRole('button', { name: 'cours-svt' }))

    // A file created outside the app: only a manual refresh can reveal it,
    // there is no live file-watching in this lot.
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'ajouté-dehors.json', path: '/cours-svt/ajouté-dehors.json' },
    ])
    await user.click(screen.getByRole('button', { name: 'Actualiser l’arborescence' }))

    expect(await screen.findByText('ajouté-dehors')).toBeInTheDocument()
  })

  it('opens at the width saved by the previous session', async () => {
    localStorage.setItem('zachart-mentale:sidebar-width', '320')
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Cartes mentales')

    expect(sidebarPanel()).toHaveStyle({ width: '320px' })
  })

  it('resizes on a drag of its right border and remembers the new width', async () => {
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Cartes mentales')
    const handle = screen.getByRole('separator', { name: 'Redimensionner la barre latérale' })

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 240 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 330 })
    expect(sidebarPanel()).toHaveStyle({ width: '330px' })

    // Persisted on release, not on every move: a drag is hundreds of events
    // for a value only the next launch reads.
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 330 })
    expect(localStorage.getItem('zachart-mentale:sidebar-width')).toBe('330')
  })

  it('clamps a drag past either bound instead of following it', async () => {
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Cartes mentales')
    const handle = screen.getByRole('separator', { name: 'Redimensionner la barre latérale' })

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 240 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 20 })
    expect(sidebarPanel()).toHaveStyle({ width: `${MIN_SIDEBAR_WIDTH}px` })

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 2000 })
    expect(sidebarPanel()).toHaveStyle({ width: `${MAX_SIDEBAR_WIDTH}px` })
  })

  it('ignores pointer moves that are not part of a drag', async () => {
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Cartes mentales')
    const handle = screen.getByRole('separator', { name: 'Redimensionner la barre latérale' })

    // Just moving the mouse over the border must not resize anything.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 })
    expect(sidebarPanel()).toHaveStyle({ width: `${DEFAULT_SIDEBAR_WIDTH}px` })
  })

  it('resizes with the arrow keys once the border has focus', async () => {
    const user = userEvent.setup()
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Cartes mentales')
    const handle = screen.getByRole('separator', { name: 'Redimensionner la barre latérale' })

    handle.focus()
    await user.keyboard('{ArrowRight}')
    expect(sidebarPanel()).toHaveStyle({ width: `${DEFAULT_SIDEBAR_WIDTH + 16}px` })
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(sidebarPanel()).toHaveStyle({ width: `${DEFAULT_SIDEBAR_WIDTH - 16}px` })
    expect(localStorage.getItem('zachart-mentale:sidebar-width')).toBe(String(DEFAULT_SIDEBAR_WIDTH - 16))
  })

  it('restores the default width on a double-click of the border', async () => {
    const user = userEvent.setup()
    localStorage.setItem('zachart-mentale:sidebar-width', '480')
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Cartes mentales')

    await user.dblClick(screen.getByRole('separator', { name: 'Redimensionner la barre latérale' }))

    expect(sidebarPanel()).toHaveStyle({ width: `${DEFAULT_SIDEBAR_WIDTH}px` })
    expect(localStorage.getItem('zachart-mentale:sidebar-width')).toBe(String(DEFAULT_SIDEBAR_WIDTH))
  })

  it('hides unreadable files by default, and reveals them from the toggle', async () => {
    const user = userEvent.setup()
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours-svt'] })
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'chapitre1.json', path: '/cours-svt/chapitre1.json' },
      { type: 'other', name: 'notes.pdf', path: '/cours-svt/notes.pdf' },
    ])
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('cours-svt')
    await user.click(screen.getByRole('button', { name: 'cours-svt' }))
    await screen.findByText('chapitre1')

    expect(screen.queryByText('notes.pdf')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /afficher les fichiers non lisibles/i }))

    expect(screen.getByText('notes.pdf')).toBeInTheDocument()
  })

  it('remembers the unreadable-files toggle across a remount', async () => {
    const user = userEvent.setup()
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours-svt'] })
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'other', name: 'notes.pdf', path: '/cours-svt/notes.pdf' }])
    const { unmount } = render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('cours-svt')
    await user.click(screen.getByRole('button', { name: /afficher les fichiers non lisibles/i }))
    unmount()

    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('cours-svt')
    await user.click(screen.getByRole('button', { name: 'cours-svt' }))

    expect(await screen.findByText('notes.pdf')).toBeInTheDocument()
  })

  it('collapses the panel, hiding its content, and expands it back', async () => {
    const user = userEvent.setup()
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Cartes mentales')

    await user.click(screen.getByRole('button', { name: 'Replier la barre latérale' }))
    expect(screen.queryByText('Cartes mentales')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Déplier la barre latérale' }))
    expect(screen.getByText('Cartes mentales')).toBeInTheDocument()
  })

  it('runs a full manual sync from the footer button', async () => {
    const user = userEvent.setup()
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Cartes mentales')

    await user.click(screen.getByRole('button', { name: 'Synchroniser' }))

    expect(useSyncStore.getState().syncNow).toHaveBeenCalledTimes(1)
  })

  it('shows the sync in progress: spinning icon, in-progress wording, disabled button', async () => {
    useSyncStore.setState({ status: 'syncing' })
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Cartes mentales')

    const button = screen.getByRole('button', { name: 'Synchronisation…' })

    expect(button).toBeDisabled()
    expect(button.querySelector('svg')).toHaveClass('animate-spin')
  })

  it('reports a failed sync in a dismissible banner instead of crashing', async () => {
    const user = userEvent.setup()
    useSyncStore.setState({ error: 'Serveur injoignable. Vérifiez l’adresse et votre connexion.' })
    render(<FileSidebar onOpenFile={() => {}} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/Serveur injoignable/)

    await user.click(screen.getByRole('button', { name: 'Masquer le message de synchronisation' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('summarises the last sync, and re-reads the tree when chapters were received', async () => {
    const user = userEvent.setup()
    useSyncStore.setState({ syncFolderPath: '/cours-svt' })
    vi.mocked(useSyncStore.getState().syncNow).mockImplementation(async () => {
      useSyncStore.setState({ lastResult: { pushed: 2, pulled: 1, errors: [] } })
    })
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Cartes mentales')

    await user.click(screen.getByRole('button', { name: 'Synchroniser' }))

    expect(await screen.findByText(/2 envoyé\(s\), 1 reçu\(s\)/)).toBeInTheDocument()
    // A pull writes files on disk behind the app's back: without this re-scan
    // the chapter the student just received would be invisible in the tree.
    expect(scanFolder).toHaveBeenCalledWith('/cours-svt')
  })

  it('opens a tooltip on a command-backed icon of the action bar', async () => {
    const user = userEvent.setup()
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Cartes mentales')

    await user.hover(screen.getByRole('button', { name: 'Actualiser l’arborescence' }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Actualiser l’arborescence')
  })

  it('opens a tooltip on the one action bar icon that is not a command', async () => {
    const user = userEvent.setup()
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Cartes mentales')

    await user.hover(screen.getByRole('button', { name: 'Afficher les fichiers non lisibles' }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Fichiers que l’application ne peut pas ouvrir')
  })

  it('gathers every action into one bar BELOW the tree, instead of the header', async () => {
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Cartes mentales')

    const panel = sidebarPanel()
    const tree = panel.children[1]
    // The tooltip trigger renders the button directly, so the button's parent
    // IS the action bar — reached through the button rather than by index.
    const bar = screen.getByRole('button', { name: 'Synchroniser' }).parentElement as HTMLElement

    expect(panel.children[0]).toHaveTextContent('Cartes mentales')
    expect(tree).not.toHaveTextContent('Synchroniser')
    // Under the tree, not in the heading above it.
    expect(tree.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(bar.style.borderTop).toContain('solid')

    for (const name of [
      'Ajouter un dossier de travail',
      'Actualiser l’arborescence',
      'Afficher les fichiers non lisibles',
      'Synchroniser',
      'Replier la barre latérale',
    ]) {
      expect(bar.contains(screen.getByRole('button', { name }))).toBe(true)
    }
  })
})
