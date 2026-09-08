import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NewMindMapDialog, folderOptions } from './NewMindMapDialog'
import { useWorkspaceStore, createWorkspaceStore } from '../state/useWorkspaceStore'
import type { RootFolder } from '../types/workspace'

vi.mock('../persistence/fileOps', async importOriginal => {
  const actual = await importOriginal<typeof import('../persistence/fileOps')>()
  return { ...actual, createMindMapFile: vi.fn() }
})
vi.mock('../persistence/fileStore', () => ({ mindMapExists: vi.fn(), loadMindMap: vi.fn(), saveMindMap: vi.fn() }))
vi.mock('../persistence/fileTree', async importOriginal => {
  const actual = await importOriginal<typeof import('../persistence/fileTree')>()
  return { ...actual, scanFolder: vi.fn() }
})

import { createMindMapFile } from '../persistence/fileOps'
import { mindMapExists } from '../persistence/fileStore'
import { scanFolder } from '../persistence/fileTree'

const ROOTS: RootFolder[] = [
  {
    path: '/cours',
    tree: [
      {
        type: 'folder',
        name: 'maths',
        path: '/cours/maths',
        children: [{ type: 'folder', name: 'algebre', path: '/cours/maths/algebre', children: [] }],
      },
      { type: 'mindmap', name: 'intro.zmap', path: '/cours/intro.zmap' },
    ],
  },
]

function resetWorkspaceStore() {
  const pristine = createWorkspaceStore().getState()
  useWorkspaceStore.setState({
    rootFolders: pristine.rootFolders,
    expandedPaths: pristine.expandedPaths,
    currentFilePath: pristine.currentFilePath,
    workspaceError: pristine.workspaceError,
  })
}

describe('folderOptions', () => {
  it('flattens every folder depth-first, with the trail needed to reveal it', () => {
    expect(folderOptions(ROOTS)).toEqual([
      { path: '/cours', name: 'cours', depth: 0, trail: ['/cours'] },
      { path: '/cours/maths', name: 'maths', depth: 1, trail: ['/cours', '/cours/maths'] },
      {
        path: '/cours/maths/algebre',
        name: 'algebre',
        depth: 2,
        trail: ['/cours', '/cours/maths', '/cours/maths/algebre'],
      },
    ])
  })

  it('leaves files out — a map cannot be created inside another map', () => {
    expect(folderOptions(ROOTS).map(option => option.path)).not.toContain('/cours/intro.zmap')
  })
})

describe('NewMindMapDialog', () => {
  beforeEach(() => {
    resetWorkspaceStore()
    useWorkspaceStore.setState({ rootFolders: ROOTS })
    vi.mocked(createMindMapFile).mockReset()
    vi.mocked(mindMapExists).mockReset().mockResolvedValue(false)
    vi.mocked(scanFolder).mockReset().mockResolvedValue([])
  })

  it('creates the map, opens it, and reveals its folder in the tree', async () => {
    const user = userEvent.setup()
    vi.mocked(createMindMapFile).mockResolvedValue('/cours/maths/algebre/Chapitre 1.zmap')
    const onCreated = vi.fn()
    const onClose = vi.fn()
    render(<NewMindMapDialog onClose={onClose} onCreated={onCreated} />)

    await user.selectOptions(screen.getByLabelText('Dossier de destination'), '/cours/maths/algebre')
    await user.type(screen.getByLabelText('Nom de la nouvelle carte mentale'), 'Chapitre 1')
    await user.click(screen.getByRole('button', { name: 'Créer' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('/cours/maths/algebre/Chapitre 1.zmap'))
    expect(createMindMapFile).toHaveBeenCalledWith('/cours/maths/algebre', 'Chapitre 1')
    expect(onClose).toHaveBeenCalled()
    // Every folder down to the destination, so the new file is actually visible.
    expect([...useWorkspaceStore.getState().expandedPaths]).toEqual(
      expect.arrayContaining(['/cours', '/cours/maths', '/cours/maths/algebre'])
    )
  })

  it('defaults to the folder of the map already open', async () => {
    useWorkspaceStore.setState({ currentFilePath: '/cours/maths/trigo.zmap' })
    render(<NewMindMapDialog onClose={vi.fn()} onCreated={vi.fn()} />)

    expect(screen.getByLabelText<HTMLSelectElement>('Dossier de destination').value).toBe('/cours/maths')
  })

  it('refuses a name already taken rather than overwriting that map', async () => {
    const user = userEvent.setup()
    vi.mocked(mindMapExists).mockResolvedValue(true)
    const onCreated = vi.fn()
    render(<NewMindMapDialog onClose={vi.fn()} onCreated={onCreated} />)

    await user.type(screen.getByLabelText('Nom de la nouvelle carte mentale'), 'intro')
    await user.click(screen.getByRole('button', { name: 'Créer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('existe déjà')
    expect(createMindMapFile).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('reports a failed creation and stays open so the name can be changed', async () => {
    const user = userEvent.setup()
    vi.mocked(createMindMapFile).mockRejectedValue(new Error('accès refusé'))
    const onClose = vi.fn()
    render(<NewMindMapDialog onClose={onClose} onCreated={vi.fn()} />)

    await user.type(screen.getByLabelText('Nom de la nouvelle carte mentale'), 'Chapitre 1')
    await user.click(screen.getByRole('button', { name: 'Créer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('accès refusé')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('cannot be submitted with an empty name', () => {
    render(<NewMindMapDialog onClose={vi.fn()} onCreated={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Créer' })).toBeDisabled()
  })

  it('explains what to do first when no folder is configured', () => {
    useWorkspaceStore.setState({ rootFolders: [] })
    render(<NewMindMapDialog onClose={vi.fn()} onCreated={vi.fn()} />)

    expect(screen.getByText(/Aucun dossier configuré/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Créer' })).not.toBeInTheDocument()
  })
})
