import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FileSidebar } from './FileSidebar'
import { useWorkspaceStore, createWorkspaceStore } from '../../state/useWorkspaceStore'

vi.mock('../../persistence/workspaceConfig', () => ({
  loadWorkspaceConfig: vi.fn(),
  saveWorkspaceConfig: vi.fn(),
}))
vi.mock('../../persistence/fileTree', () => ({ scanFolder: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

import { loadWorkspaceConfig, saveWorkspaceConfig } from '../../persistence/workspaceConfig'
import { scanFolder } from '../../persistence/fileTree'
import { open } from '@tauri-apps/plugin-dialog'

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
    resetWorkspaceStore()
    vi.mocked(loadWorkspaceConfig).mockReset().mockResolvedValue({ rootFolders: [] })
    vi.mocked(saveWorkspaceConfig).mockReset().mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockReset().mockResolvedValue([])
    vi.mocked(open).mockReset()
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

    await user.click(screen.getByRole('button', { name: 'Retirer cours-svt de la liste' }))

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
