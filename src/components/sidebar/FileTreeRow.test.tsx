import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FileTreeRow } from './FileTreeRow'
import { useWorkspaceStore, createWorkspaceStore } from '../../state/useWorkspaceStore'
import type { FileTreeNode } from '../../types/workspace'

function resetWorkspaceStore() {
  const pristine = createWorkspaceStore().getState()
  useWorkspaceStore.setState({
    rootFolders: pristine.rootFolders,
    expandedPaths: pristine.expandedPaths,
    currentFilePath: pristine.currentFilePath,
  })
}

describe('FileTreeRow', () => {
  beforeEach(resetWorkspaceStore)

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
})
