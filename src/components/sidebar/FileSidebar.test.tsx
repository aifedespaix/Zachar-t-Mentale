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

describe('FileSidebar', () => {
  beforeEach(() => {
    // The remembered sidebar width lives in localStorage, so each test starts
    // from "never resized" rather than from whatever the previous one left.
    localStorage.clear()
    resetWorkspaceStore()
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

    await user.click(screen.getByRole('button', { name: 'Ajouter un dossier' }))

    expect(await screen.findByText('cours-svt')).toBeInTheDocument()
    expect(saveWorkspaceConfig).toHaveBeenCalledWith({ rootFolders: ['/cours-svt'] })
  })

  it('does not add a folder when the picker is cancelled', async () => {
    const user = userEvent.setup()
    vi.mocked(open).mockResolvedValue(null)
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Aucun dossier configuré.')

    await user.click(screen.getByRole('button', { name: 'Ajouter un dossier' }))

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

    expect(screen.queryByText('chapitre1.json')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'cours-svt' }))
    await user.click(await screen.findByText('chapitre1.json'))

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

    await user.click(screen.getByRole('button', { name: 'Ajouter un dossier' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/sélecteur indisponible/)
  })

  it('re-scans every root folder from the "Rafraîchir" button', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Rafraîchir' }))

    expect(await screen.findByText('ajouté-dehors.json')).toBeInTheDocument()
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

  it('collapses the panel, hiding its content, and expands it back', async () => {
    const user = userEvent.setup()
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Cartes mentales')

    await user.click(screen.getByRole('button', { name: 'Replier la barre latérale' }))
    expect(screen.queryByText('Cartes mentales')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Déplier la barre latérale' }))
    expect(screen.getByText('Cartes mentales')).toBeInTheDocument()
  })
})
