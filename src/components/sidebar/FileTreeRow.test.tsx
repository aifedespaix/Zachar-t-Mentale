import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FileTreeRow } from './FileTreeRow'
import { useWorkspaceStore, createWorkspaceStore } from '../../state/useWorkspaceStore'
import type { FileTreeNode } from '../../types/workspace'

vi.mock('../../persistence/fileOps', async importOriginal => {
  const actual = await importOriginal<typeof import('../../persistence/fileOps')>()
  return {
    ...actual,
    createMindMapFile: vi.fn(),
    createSubfolder: vi.fn(),
    renamePath: vi.fn(),
    deletePath: vi.fn(),
    duplicatePath: vi.fn(),
    freeSiblingPath: vi.fn(),
  }
})
vi.mock('../../persistence/fileTree', async importOriginal => {
  const actual = await importOriginal<typeof import('../../persistence/fileTree')>()
  return { ...actual, scanFolder: vi.fn() }
})
vi.mock('../../persistence/fileStore', () => ({ loadMindMap: vi.fn(), saveMindMap: vi.fn(), mindMapExists: vi.fn() }))
vi.mock('../../persistence/exportIO', () => ({ pickXmindFile: vi.fn(), readBinaryFile: vi.fn() }))
vi.mock('../../xmind/importXmind', () => ({ readXmindFile: vi.fn() }))
vi.mock('../../hooks/useMindMapFormatValid', () => ({ useMindMapFormatValid: vi.fn() }))

import {
  createMindMapFile,
  createSubfolder,
  renamePath,
  deletePath,
  duplicatePath,
  freeSiblingPath,
} from '../../persistence/fileOps'
import { scanFolder } from '../../persistence/fileTree'
import { loadMindMap, saveMindMap, mindMapExists } from '../../persistence/fileStore'
import { pickXmindFile, readBinaryFile } from '../../persistence/exportIO'
import { readXmindFile } from '../../xmind/importXmind'
import { useMindMapFormatValid } from '../../hooks/useMindMapFormatValid'

function resetWorkspaceStore() {
  const pristine = createWorkspaceStore().getState()
  useWorkspaceStore.setState({
    rootFolders: pristine.rootFolders,
    expandedPaths: pristine.expandedPaths,
    currentFilePath: pristine.currentFilePath,
    workspaceError: pristine.workspaceError,
  })
}

/** Opens the row's context menu — the only way any action but open/toggle is reachable. */
function openMenu(rowName: string | RegExp) {
  fireEvent.contextMenu(screen.getByRole('button', { name: rowName }))
}

describe('FileTreeRow', () => {
  beforeEach(() => {
    resetWorkspaceStore()
    vi.mocked(createMindMapFile).mockReset()
    vi.mocked(createSubfolder).mockReset()
    vi.mocked(renamePath).mockReset()
    vi.mocked(deletePath).mockReset()
    vi.mocked(duplicatePath).mockReset()
    vi.mocked(scanFolder).mockReset()
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(saveMindMap).mockReset()
    vi.mocked(mindMapExists).mockReset().mockResolvedValue(false)
    vi.mocked(pickXmindFile).mockReset()
    vi.mocked(readBinaryFile).mockReset()
    vi.mocked(readXmindFile).mockReset()
    vi.mocked(useMindMapFormatValid).mockReset()
    // The naming modal's pre-filled default always comes from `freeSiblingPath` —
    // most tests care about the name the user actually submits, not this
    // default, so simulate "always free" (no numbered suffix) unless a test
    // overrides it.
    vi.mocked(freeSiblingPath)
      .mockReset()
      .mockImplementation(async (folderPath, baseName, isFolder) => {
        const separator = folderPath.includes('\\') ? '\\' : '/'
        return `${folderPath}${separator}${isFolder ? baseName : `${baseName}.json`}`
      })
  })

  it('renders a mindmap file and opens it on click', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={onOpenFile} />)

    await user.click(screen.getByText('chapitre1.json'))

    expect(onOpenFile).toHaveBeenCalledWith('/cours/chapitre1.json')
  })

  it('shows the generic icon while the mind map format check has not resolved to valid', () => {
    vi.mocked(useMindMapFormatValid).mockReturnValue(undefined)
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    const { container } = render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)
    expect(container.querySelector('img[src="/favicon.svg"]')).not.toBeInTheDocument()
  })

  it('shows the app favicon once the mind map format check resolves to valid', () => {
    vi.mocked(useMindMapFormatValid).mockReturnValue(true)
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    const { container } = render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)
    expect(container.querySelector('img[src="/favicon.svg"]')).toBeInTheDocument()
  })

  it('keeps the generic icon when the mind map format check resolves to invalid', () => {
    vi.mocked(useMindMapFormatValid).mockReturnValue(false)
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    const { container } = render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)
    expect(container.querySelector('img[src="/favicon.svg"]')).not.toBeInTheDocument()
  })

  it('passes the node path to the format-validity hook', () => {
    vi.mocked(useMindMapFormatValid).mockReturnValue(false)
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)
    expect(useMindMapFormatValid).toHaveBeenCalledWith('/cours/chapitre1.json')
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

  it('hides "other" (unreadable) children by default', () => {
    const node: FileTreeNode = {
      type: 'folder',
      name: 'chimie',
      path: '/cours/chimie',
      children: [
        { type: 'mindmap', name: 'atomes.json', path: '/cours/chimie/atomes.json' },
        { type: 'other', name: 'notes.pdf', path: '/cours/chimie/notes.pdf' },
      ],
    }
    useWorkspaceStore.setState({ expandedPaths: new Set(['/cours/chimie']) })
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    expect(screen.getByText('atomes.json')).toBeInTheDocument()
    expect(screen.queryByText('notes.pdf')).not.toBeInTheDocument()
  })

  it('shows "other" (unreadable) children when showUnreadable is true', () => {
    const node: FileTreeNode = {
      type: 'folder',
      name: 'chimie',
      path: '/cours/chimie',
      children: [{ type: 'other', name: 'notes.pdf', path: '/cours/chimie/notes.pdf' }],
    }
    useWorkspaceStore.setState({ expandedPaths: new Set(['/cours/chimie']) })
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} showUnreadable />)

    expect(screen.getByText('notes.pdf')).toBeInTheDocument()
  })

  it('threads showUnreadable down to nested folders', () => {
    const node: FileTreeNode = {
      type: 'folder',
      name: 'chimie',
      path: '/cours/chimie',
      children: [
        {
          type: 'folder',
          name: 'td',
          path: '/cours/chimie/td',
          children: [{ type: 'other', name: 'archive.zip', path: '/cours/chimie/td/archive.zip' }],
        },
      ],
    }
    useWorkspaceStore.setState({
      expandedPaths: new Set(['/cours/chimie', '/cours/chimie/td']),
    })
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} showUnreadable />)

    expect(screen.getByText('archive.zip')).toBeInTheDocument()
  })

  it('hides an .assets sidecar folder by default, even when it has visible children', () => {
    const node: FileTreeNode = {
      type: 'folder',
      name: 'chimie',
      path: '/cours/chimie',
      children: [
        { type: 'mindmap', name: 'atomes.json', path: '/cours/chimie/atomes.json' },
        {
          type: 'folder',
          name: 'atomes.assets',
          path: '/cours/chimie/atomes.assets',
          children: [{ type: 'other', name: 'photo.png', path: '/cours/chimie/atomes.assets/photo.png' }],
        },
      ],
    }
    useWorkspaceStore.setState({ expandedPaths: new Set(['/cours/chimie']) })
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    expect(screen.getByText('atomes.json')).toBeInTheDocument()
    expect(screen.queryByText('atomes.assets')).not.toBeInTheDocument()
  })

  it('shows an .assets sidecar folder when showUnreadable is true', () => {
    const node: FileTreeNode = {
      type: 'folder',
      name: 'chimie',
      path: '/cours/chimie',
      children: [{ type: 'folder', name: 'atomes.assets', path: '/cours/chimie/atomes.assets', children: [] }],
    }
    useWorkspaceStore.setState({ expandedPaths: new Set(['/cours/chimie']) })
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} showUnreadable />)

    expect(screen.getByText('atomes.assets')).toBeInTheDocument()
  })

  it('does not hide an ordinary empty folder, or one with only "other" children, by default', () => {
    const node: FileTreeNode = {
      type: 'folder',
      name: 'chimie',
      path: '/cours/chimie',
      children: [
        { type: 'folder', name: 'vide', path: '/cours/chimie/vide', children: [] },
        {
          type: 'folder',
          name: 'archives',
          path: '/cours/chimie/archives',
          children: [{ type: 'other', name: 'notes.pdf', path: '/cours/chimie/archives/notes.pdf' }],
        },
      ],
    }
    useWorkspaceStore.setState({ expandedPaths: new Set(['/cours/chimie']) })
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    expect(screen.getByText('vide')).toBeInTheDocument()
    expect(screen.getByText('archives')).toBeInTheDocument()
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

  it('renames a mind map file via double-click, with no menu involved', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.dblClick(screen.getByRole('button', { name: 'chapitre1.json' }))
    const input = screen.getByRole('textbox', { name: /renommer chapitre1.json/i })
    await user.clear(input)
    await user.type(input, 'chapitre1-v2.json{Enter}')

    expect(renamePath).toHaveBeenCalledWith('/cours/chapitre1.json', '/cours/chapitre1-v2.json')
  })

  it('does not reopen the context menu on right-click while the rename input is active, and leaves it uncommitted', async () => {
    const user = userEvent.setup()
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.dblClick(screen.getByRole('button', { name: 'chapitre1.json' }))
    const input = screen.getByRole('textbox', { name: /renommer chapitre1.json/i })
    await user.type(input, 'draft-en-cours')

    fireEvent.contextMenu(input)

    expect(screen.queryByRole('menuitem', { name: 'Renommer' })).not.toBeInTheDocument()
    expect(renamePath).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: /renommer chapitre1.json/i })).toHaveValue('chapitre1.jsondraft-en-cours')
  })

  it('renames a non-root folder via double-click', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.dblClick(screen.getByRole('button', { name: /chimie/i }))
    const input = screen.getByRole('textbox', { name: /renommer chimie/i })
    await user.clear(input)
    await user.type(input, 'chimie-2026{Enter}')

    expect(renamePath).toHaveBeenCalledWith('/cours/chimie', '/cours/chimie-2026')
  })

  it('does not offer renaming a root folder, even via double-click', async () => {
    const user = userEvent.setup()
    const node: FileTreeNode = { type: 'folder', name: 'cours-svt', path: '/cours-svt', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot onRemoveRoot={() => {}} />)

    await user.dblClick(screen.getByRole('button', { name: /cours-svt/i }))

    expect(screen.queryByRole('textbox', { name: /renommer/i })).not.toBeInTheDocument()
  })

  it('renames a mind map file via the context menu', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Renommer' }))
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

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Renommer' }))
    const input = screen.getByRole('textbox', { name: /renommer chapitre1.json/i })
    await user.clear(input)
    await user.type(input, 'chapitre1-v2.json{Enter}')

    await waitFor(() => expect(useWorkspaceStore.getState().currentFilePath).toBe('/cours/chapitre1-v2.json'))
  })

  it('rewrites the current file path when renaming a FOLDER that contains the open file', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    useWorkspaceStore.setState({ currentFilePath: '/cours/chimie/atomes.json' })
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Renommer' }))
    const input = screen.getByRole('textbox', { name: /renommer chimie/i })
    await user.clear(input)
    await user.type(input, 'chimie-2026{Enter}')

    expect(renamePath).toHaveBeenCalledWith('/cours/chimie', '/cours/chimie-2026')
    await waitFor(() => expect(useWorkspaceStore.getState().currentFilePath).toBe('/cours/chimie-2026/atomes.json'))
  })

  it('leaves the current file alone when renaming a folder that merely shares a name prefix', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    useWorkspaceStore.setState({ currentFilePath: '/cours/chimie-avancee/atomes.json' })
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Renommer' }))
    const input = screen.getByRole('textbox', { name: /renommer chimie/i })
    await user.clear(input)
    await user.type(input, 'chimie-2026{Enter}')

    await waitFor(() => expect(renamePath).toHaveBeenCalled())
    expect(useWorkspaceStore.getState().currentFilePath).toBe('/cours/chimie-avancee/atomes.json')
  })

  it('reports a failed rename instead of silently doing nothing', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockRejectedValue(new Error('fichier verrouillé'))
    useWorkspaceStore.setState({ currentFilePath: '/cours/chapitre1.json' })
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Renommer' }))
    const input = screen.getByRole('textbox', { name: /renommer chapitre1.json/i })
    await user.clear(input)
    await user.type(input, 'chapitre1-v2.json{Enter}')

    await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/fichier verrouillé/))
    expect(useWorkspaceStore.getState().currentFilePath).toBe('/cours/chapitre1.json')
  })

  it('shows a "retirer de la liste" action in the context menu of a root folder, and calls onRemoveRoot with its path', async () => {
    const user = userEvent.setup()
    const onRemoveRoot = vi.fn()
    const node: FileTreeNode = { type: 'folder', name: 'cours-svt', path: '/cours-svt', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot onRemoveRoot={onRemoveRoot} />)

    openMenu(/cours-svt/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Retirer cours-svt de la liste' }))

    expect(onRemoveRoot).toHaveBeenCalledWith('/cours-svt')
  })

  it('does not show "retirer", "renommer", "supprimer" or "dupliquer" on a root folder, only creation actions', async () => {
    const node: FileTreeNode = { type: 'folder', name: 'cours-svt', path: '/cours-svt', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot onRemoveRoot={() => {}} />)

    openMenu(/cours-svt/i)

    expect(await screen.findByRole('menuitem', { name: 'Nouvelle carte mentale' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Nouveau sous-dossier' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Importer XMind' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Retirer cours-svt de la liste' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Renommer' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Supprimer' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Dupliquer' })).not.toBeInTheDocument()
  })

  it('does not show "retirer" on a non-root folder, but does show renommer/supprimer/dupliquer', async () => {
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours-svt/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu(/chimie/i)

    expect(await screen.findByRole('menuitem', { name: 'Renommer' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Supprimer' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Dupliquer' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /retirer/i })).not.toBeInTheDocument()
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

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Nouvelle carte mentale' }))
    const input = await screen.findByRole('textbox', { name: 'Nom de la nouvelle carte mentale' })
    await user.clear(input)
    await user.type(input, 'nouveau{Enter}')

    expect(createMindMapFile).toHaveBeenCalledWith('/cours/chimie', 'nouveau')
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith('/cours/chimie/nouveau.json'))
  })

  it('pre-fills the new-mind-map dialog with a name already free in the folder', async () => {
    const user = userEvent.setup()
    vi.mocked(freeSiblingPath).mockResolvedValue('/cours/chimie/Nouvelle carte mentale (2).json')
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Nouvelle carte mentale' }))

    expect(freeSiblingPath).toHaveBeenCalledWith('/cours/chimie', 'Nouvelle carte mentale', false)
    expect(await screen.findByRole('textbox', { name: 'Nom de la nouvelle carte mentale' })).toHaveValue(
      'Nouvelle carte mentale (2)'
    )
  })

  it('creates a new subfolder', async () => {
    const user = userEvent.setup()
    vi.mocked(createSubfolder).mockResolvedValue('/cours/chimie/atomes')
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Nouveau sous-dossier' }))
    const input = await screen.findByRole('textbox', { name: 'Nom du nouveau dossier' })
    await user.clear(input)
    await user.type(input, 'atomes{Enter}')

    expect(createSubfolder).toHaveBeenCalledWith('/cours/chimie', 'atomes')
  })

  it('reports a failed creation instead of silently doing nothing', async () => {
    const user = userEvent.setup()
    vi.mocked(createMindMapFile).mockRejectedValue(new Error('lecture seule'))
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Nouvelle carte mentale' }))
    const input = await screen.findByRole('textbox', { name: 'Nom de la nouvelle carte mentale' })
    await user.type(input, '{Enter}')

    await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/lecture seule/))
  })

  it('refuses to create a mind map file that would overwrite an existing one, instead of silently overwriting it', async () => {
    const user = userEvent.setup()
    vi.mocked(mindMapExists).mockResolvedValue(true)
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Nouvelle carte mentale' }))
    const input = await screen.findByRole('textbox')
    await user.clear(input)
    await user.type(input, 'existant{Enter}')

    expect(mindMapExists).toHaveBeenCalledWith('/cours/chimie/existant.zmap')
    expect(createMindMapFile).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(useWorkspaceStore.getState().workspaceError).toMatch(/existant\.zmap[^]*existe déjà/)
    )
  })

  it('duplicates a mind map file and opens the copy', async () => {
    const user = userEvent.setup()
    vi.mocked(freeSiblingPath).mockResolvedValue('/cours/chapitre1 (copie).json')
    vi.mocked(duplicatePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const onOpenFile = vi.fn()
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={onOpenFile} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Dupliquer' }))

    expect(freeSiblingPath).toHaveBeenCalledWith('/cours', 'chapitre1 (copie)', false)
    const input = await screen.findByRole('textbox', { name: /dupliquer/i })
    await user.type(input, '{Enter}')

    expect(duplicatePath).toHaveBeenCalledWith('/cours/chapitre1.json', '/cours/chapitre1 (copie).zmap', false)
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith('/cours/chapitre1 (copie).zmap'))
  })

  it('duplicates a folder without opening anything', async () => {
    const user = userEvent.setup()
    vi.mocked(freeSiblingPath).mockResolvedValue('/cours/chimie (copie)')
    vi.mocked(duplicatePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const onOpenFile = vi.fn()
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={onOpenFile} />)

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Dupliquer' }))
    expect(freeSiblingPath).toHaveBeenCalledWith('/cours', 'chimie (copie)', true)
    const input = await screen.findByRole('textbox', { name: /dupliquer/i })
    await user.type(input, '{Enter}')

    expect(duplicatePath).toHaveBeenCalledWith('/cours/chimie', '/cours/chimie (copie)', true)
    await waitFor(() => expect(scanFolder).toHaveBeenCalledWith('/cours'))
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('reports a failed duplication instead of silently doing nothing', async () => {
    const user = userEvent.setup()
    vi.mocked(freeSiblingPath).mockResolvedValue('/cours/chapitre1 (copie).json')
    vi.mocked(duplicatePath).mockRejectedValue(new Error('disque plein'))
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Dupliquer' }))
    const input = await screen.findByRole('textbox', { name: /dupliquer/i })
    await user.type(input, '{Enter}')

    await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/disque plein/))
  })

  it('refuses to duplicate a mind map file onto an existing one, instead of silently overwriting it', async () => {
    const user = userEvent.setup()
    vi.mocked(freeSiblingPath).mockResolvedValue('/cours/chapitre1 (copie).json')
    vi.mocked(mindMapExists).mockResolvedValue(true)
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Dupliquer' }))
    const input = await screen.findByRole('textbox')
    await user.clear(input)
    await user.type(input, 'chapitre2{Enter}')

    expect(mindMapExists).toHaveBeenCalledWith('/cours/chapitre2.zmap')
    expect(duplicatePath).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(useWorkspaceStore.getState().workspaceError).toMatch(/chapitre2\.zmap[^]*existe déjà/)
    )
  })

  it('reports a failed deletion instead of silently doing nothing', async () => {
    const user = userEvent.setup()
    vi.mocked(deletePath).mockRejectedValue(new Error('fichier verrouillé'))
    useWorkspaceStore.setState({ currentFilePath: '/cours/chapitre1.json' })
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Supprimer' }))
    await user.click(screen.getByRole('button', { name: 'Confirmer' }))

    await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/fichier verrouillé/))
    expect(useWorkspaceStore.getState().currentFilePath).toBe('/cours/chapitre1.json')
  })

  it('deletes a mind map file after confirmation', async () => {
    const user = userEvent.setup()
    vi.mocked(deletePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Supprimer' }))
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

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Supprimer' }))
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

    openMenu(/chimie/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Supprimer' }))
    expect(
      screen.getByRole('heading', { name: /supprimer le dossier « chimie » et son contenu \(2 éléments\)/i })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmer' }))

    expect(deletePath).toHaveBeenCalledWith('/cours/chimie', true)
  })

  it('opens the export dialog with the file\'s cards once they are loaded and validated', async () => {
    const user = userEvent.setup()
    vi.mocked(loadMindMap).mockResolvedValue([{ id: 'root', level: 1, title: 'Racine', parentId: null, order: 0 }])
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Exporter' }))

    expect(await screen.findByText('Exporter « chapitre1 »')).toBeInTheDocument()
  })

  it('reports an error instead of opening the dialog when the file no longer exists', async () => {
    const user = userEvent.setup()
    vi.mocked(loadMindMap).mockResolvedValue(null)
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Exporter' }))

    await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/n’existe plus/))
    expect(screen.queryByText(/^Exporter «/)).not.toBeInTheDocument()
  })

  it('reports an error instead of opening the dialog when the file fails validation', async () => {
    const user = userEvent.setup()
    vi.mocked(loadMindMap).mockResolvedValue([
      { id: 'a', level: 1, title: 'A', parentId: null, order: 0 },
      { id: 'b', level: 1, title: 'B', parentId: null, order: 0 },
    ])
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    openMenu('chapitre1.json')
    await user.click(await screen.findByRole('menuitem', { name: 'Exporter' }))

    await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/structure du fichier est invalide/))
  })

  it('imports every sheet of a picked XMind file as its own .zmap in the folder, then refreshes it', async () => {
    const user = userEvent.setup()
    vi.mocked(pickXmindFile).mockResolvedValue('/downloads/vieux-cours.xmind')
    vi.mocked(readBinaryFile).mockResolvedValue(new Uint8Array([1]))
    vi.mocked(readXmindFile).mockResolvedValue([
      { sheetTitle: 'Chapitre 1', cards: [{ id: 'r1', level: 1, title: 'R1', parentId: null, order: 0 }] },
      { sheetTitle: 'Chapitre 2', cards: [{ id: 'r2', level: 1, title: 'R2', parentId: null, order: 0 }] },
    ])
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'folder', name: 'cours', path: '/cours', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot />)

    openMenu(/cours/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Importer XMind' }))

    await waitFor(() => expect(saveMindMap).toHaveBeenCalledTimes(2))
    expect(saveMindMap).toHaveBeenCalledWith('/cours/Chapitre 1.zmap', [
      { id: 'r1', level: 1, title: 'R1', parentId: null, order: 0 },
    ])
    expect(saveMindMap).toHaveBeenCalledWith('/cours/Chapitre 2.zmap', [
      { id: 'r2', level: 1, title: 'R2', parentId: null, order: 0 },
    ])
    expect(scanFolder).toHaveBeenCalledWith('/cours')
  })

  it('does nothing when the XMind file picker is cancelled', async () => {
    const user = userEvent.setup()
    vi.mocked(pickXmindFile).mockResolvedValue(null)
    const node: FileTreeNode = { type: 'folder', name: 'cours', path: '/cours', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot />)

    openMenu(/cours/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Importer XMind' }))

    expect(saveMindMap).not.toHaveBeenCalled()
  })

  it('reports an XMind import failure through the workspace error channel', async () => {
    const user = userEvent.setup()
    vi.mocked(pickXmindFile).mockResolvedValue('/downloads/corrompu.xmind')
    vi.mocked(readBinaryFile).mockResolvedValue(new Uint8Array([1]))
    vi.mocked(readXmindFile).mockRejectedValue(new Error('archive corrompue'))
    const node: FileTreeNode = { type: 'folder', name: 'cours', path: '/cours', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot />)

    openMenu(/cours/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Importer XMind' }))

    await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/corrompu\.xmind.*archive corrompue/))
  })

  it('reports how many sheets were written before a mid-import failure, and still refreshes the folder', async () => {
    const user = userEvent.setup()
    vi.mocked(pickXmindFile).mockResolvedValue('/downloads/cours.xmind')
    vi.mocked(readBinaryFile).mockResolvedValue(new Uint8Array([1]))
    vi.mocked(readXmindFile).mockResolvedValue([
      { sheetTitle: 'Chapitre 1', cards: [{ id: 'r1', level: 1, title: 'R1', parentId: null, order: 0 }] },
      { sheetTitle: 'Chapitre 2', cards: [{ id: 'r2', level: 1, title: 'R2', parentId: null, order: 0 }] },
    ])
    vi.mocked(saveMindMap).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disque plein'))
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'folder', name: 'cours', path: '/cours', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot />)

    openMenu(/cours/i)
    await user.click(await screen.findByRole('menuitem', { name: 'Importer XMind' }))

    await waitFor(() => expect(useWorkspaceStore.getState().workspaceError).toMatch(/1 carte.*mentale.*déjà importée/))
    expect(scanFolder).toHaveBeenCalledWith('/cours')
  })
})
