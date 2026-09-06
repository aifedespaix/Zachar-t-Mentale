import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FileTreeRow } from './FileTreeRow'
import { useWorkspaceStore, createWorkspaceStore } from '../../state/useWorkspaceStore'
import type { FileTreeNode } from '../../types/workspace'

vi.mock('../../persistence/fileOps', () => ({
  createMindMapFile: vi.fn(),
  createSubfolder: vi.fn(),
  renamePath: vi.fn(),
  deletePath: vi.fn(),
}))
vi.mock('../../persistence/fileTree', async importOriginal => {
  const actual = await importOriginal<typeof import('../../persistence/fileTree')>()
  return { ...actual, scanFolder: vi.fn() }
})

import { createMindMapFile, createSubfolder, renamePath, deletePath } from '../../persistence/fileOps'
import { scanFolder } from '../../persistence/fileTree'

function resetWorkspaceStore() {
  const pristine = createWorkspaceStore().getState()
  useWorkspaceStore.setState({
    rootFolders: pristine.rootFolders,
    expandedPaths: pristine.expandedPaths,
    currentFilePath: pristine.currentFilePath,
  })
}

describe('FileTreeRow', () => {
  beforeEach(() => {
    resetWorkspaceStore()
    vi.mocked(createMindMapFile).mockReset()
    vi.mocked(createSubfolder).mockReset()
    vi.mocked(renamePath).mockReset()
    vi.mocked(deletePath).mockReset()
    vi.mocked(scanFolder).mockReset()
  })

  it('renders a mindmap file and opens it on click', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={onOpenFile} />)

    await user.click(screen.getByText('chapitre1.json'))

    expect(onOpenFile).toHaveBeenCalledWith('/cours/chapitre1.json')
  })

  it('highlights the row matching the currently open file', () => {
    useWorkspaceStore.setState({ currentFilePath: '/cours/chapitre1.json' })
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    expect(screen.getByRole('button', { name: 'chapitre1.json' })).toHaveStyle({ background: 'var(--muted)' })
  })

  it('renders an "other" file as visually inert and never calls onOpenFile', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    const node: FileTreeNode = { type: 'other', name: 'notes.pdf', path: '/cours/notes.pdf' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={onOpenFile} />)

    expect(screen.getByText('notes.pdf').closest('[aria-disabled]')).toBeInTheDocument()
    await user.click(screen.getByText('notes.pdf'))
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('toggles a folder open/closed and shows/hides its children', async () => {
    const user = userEvent.setup()
    const node: FileTreeNode = {
      type: 'folder',
      name: 'chimie',
      path: '/cours/chimie',
      children: [{ type: 'mindmap', name: 'atomes.json', path: '/cours/chimie/atomes.json' }],
    }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    expect(screen.queryByText('atomes.json')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /chimie/i }))
    expect(screen.getByText('atomes.json')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /chimie/i }))
    expect(screen.queryByText('atomes.json')).not.toBeInTheDocument()
  })

  it('shows a "retirer de la liste" action on a root folder row, and calls onRemoveRoot with its path', async () => {
    const user = userEvent.setup()
    const onRemoveRoot = vi.fn()
    const node: FileTreeNode = { type: 'folder', name: 'cours-svt', path: '/cours-svt', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot onRemoveRoot={onRemoveRoot} />)

    await user.click(screen.getByRole('button', { name: 'Retirer cours-svt de la liste' }))

    expect(onRemoveRoot).toHaveBeenCalledWith('/cours-svt')
  })

  it('does not show a "retirer" action on a non-root folder row', () => {
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours-svt/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    expect(screen.queryByRole('button', { name: /retirer/i })).not.toBeInTheDocument()
  })

  it('creates a new mind map file inside a folder and opens it', async () => {
    const user = userEvent.setup()
    vi.mocked(createMindMapFile).mockResolvedValue('/cours/chimie/nouveau.json')
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'nouveau.json', path: '/cours/chimie/nouveau.json' },
    ])
    const onOpenFile = vi.fn()
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={onOpenFile} />)

    await user.click(screen.getByRole('button', { name: 'Nouvelle carte mentale' }))
    await user.type(screen.getByRole('textbox', { name: /nom de la nouvelle carte mentale/i }), 'nouveau{Enter}')

    expect(createMindMapFile).toHaveBeenCalledWith('/cours/chimie', 'nouveau')
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith('/cours/chimie/nouveau.json'))
  })

  it('creates a new subfolder', async () => {
    const user = userEvent.setup()
    vi.mocked(createSubfolder).mockResolvedValue('/cours/chimie/atomes')
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Nouveau sous-dossier' }))
    await user.type(screen.getByRole('textbox', { name: /nom du nouveau dossier/i }), 'atomes{Enter}')

    expect(createSubfolder).toHaveBeenCalledWith('/cours/chimie', 'atomes')
  })

  it('renames a mind map file', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Renommer' }))
    const input = screen.getByRole('textbox', { name: /renommer chapitre1.json/i })
    await user.clear(input)
    await user.type(input, 'chapitre1-v2.json{Enter}')

    expect(renamePath).toHaveBeenCalledWith('/cours/chapitre1.json', '/cours/chapitre1-v2.json')
  })

  it('updates the current file path when renaming the file that is currently open', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    useWorkspaceStore.setState({ currentFilePath: '/cours/chapitre1.json' })
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Renommer' }))
    const input = screen.getByRole('textbox', { name: /renommer chapitre1.json/i })
    await user.clear(input)
    await user.type(input, 'chapitre1-v2.json{Enter}')

    await waitFor(() => expect(useWorkspaceStore.getState().currentFilePath).toBe('/cours/chapitre1-v2.json'))
  })

  it('deletes a mind map file after confirmation', async () => {
    const user = userEvent.setup()
    vi.mocked(deletePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Supprimer' }))
    expect(screen.getByRole('heading', { name: /supprimer le fichier « chapitre1.json » ?/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmer' }))

    expect(deletePath).toHaveBeenCalledWith('/cours/chapitre1.json', false)
  })

  it('clears the current file when deleting the file that is currently open', async () => {
    const user = userEvent.setup()
    vi.mocked(deletePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    useWorkspaceStore.setState({ currentFilePath: '/cours/chapitre1.json' })
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Supprimer' }))
    await user.click(screen.getByRole('button', { name: 'Confirmer' }))

    await waitFor(() => expect(useWorkspaceStore.getState().currentFilePath).toBeNull())
  })

  it('deletes a folder and its contents after confirmation, showing the descendant count', async () => {
    const user = userEvent.setup()
    vi.mocked(deletePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = {
      type: 'folder',
      name: 'chimie',
      path: '/cours/chimie',
      children: [
        { type: 'mindmap', name: 'atomes.json', path: '/cours/chimie/atomes.json' },
        { type: 'mindmap', name: 'liaisons.json', path: '/cours/chimie/liaisons.json' },
      ],
    }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Supprimer' }))
    expect(
      screen.getByRole('heading', { name: /supprimer le dossier « chimie » et son contenu \(2 éléments\)/i })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmer' }))

    expect(deletePath).toHaveBeenCalledWith('/cours/chimie', true)
  })

  it('does not show rename/delete on a root folder row, only creation and "retirer"', () => {
    const node: FileTreeNode = { type: 'folder', name: 'cours-svt', path: '/cours-svt', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot onRemoveRoot={() => {}} />)

    expect(screen.queryByRole('button', { name: 'Renommer' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nouvelle carte mentale' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nouveau sous-dossier' })).toBeInTheDocument()
  })
})
