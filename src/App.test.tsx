import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import App from './App'
import type { Card } from './types/card'
import { useCardsStore, createCardsStore } from './state/useCardsStore'
import { useWorkspaceStore, createWorkspaceStore } from './state/useWorkspaceStore'

vi.mock('./persistence/fileStore', () => ({
  loadMindMap: vi.fn(),
  saveMindMap: vi.fn(),
}))
vi.mock('./persistence/workspaceConfig', () => ({
  loadWorkspaceConfig: vi.fn(),
  saveWorkspaceConfig: vi.fn(),
}))
vi.mock('./persistence/fileTree', async importOriginal => {
  const actual = await importOriginal<typeof import('./persistence/fileTree')>()
  return { ...actual, scanFolder: vi.fn() }
})
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

import { loadMindMap, saveMindMap } from './persistence/fileStore'
import { loadWorkspaceConfig } from './persistence/workspaceConfig'
import { scanFolder } from './persistence/fileTree'

const PATH_A = '/cours/chapitre-a.json'
const PATH_B = '/cours/chapitre-b.json'
const cardsA: Card[] = [{ id: 'a-root', level: 1, title: 'Chapitre A', parentId: null, order: 0 }]
const cardsB: Card[] = [{ id: 'b-root', level: 1, title: 'Chapitre B', parentId: null, order: 0 }]

function resetStores() {
  const workspace = createWorkspaceStore().getState()
  useWorkspaceStore.setState({
    rootFolders: workspace.rootFolders,
    expandedPaths: workspace.expandedPaths,
    currentFilePath: workspace.currentFilePath,
    workspaceError: workspace.workspaceError,
  })
  const cards = createCardsStore().getState()
  useCardsStore.setState({ history: cards.history, locked: cards.locked })
}

/** Flush the pending load promise, then let the autosave debounce elapse. */
async function settle() {
  await act(async () => {})
  await act(async () => {
    vi.advanceTimersByTime(600)
  })
  await act(async () => {})
}

async function openFile(path: string) {
  await act(async () => {
    useWorkspaceStore.getState().setCurrentFile(path)
  })
  await settle()
}

describe('App file switching', () => {
  beforeEach(() => {
    resetStores()
    vi.useFakeTimers()
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(saveMindMap).mockReset().mockResolvedValue(undefined)
    vi.mocked(loadWorkspaceConfig).mockReset().mockResolvedValue({ rootFolders: [] })
    vi.mocked(scanFolder).mockReset().mockResolvedValue([])
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('loads the newly-opened file, replacing the previous file entirely', async () => {
    vi.mocked(loadMindMap).mockImplementation(async path => (path === PATH_A ? cardsA : cardsB))
    render(<App />)

    await openFile(PATH_A)
    expect(useCardsStore.getState().history.present).toEqual(cardsA)

    await openFile(PATH_B)

    // B's cards only — no mix of A and B, and the header names B.
    expect(useCardsStore.getState().history.present).toEqual(cardsB)
    expect(screen.getByText('chapitre-b.json')).toBeInTheDocument()
    expect(saveMindMap).toHaveBeenLastCalledWith(PATH_B, cardsB)
  })

  it('reverts to the previously-open file and warns when the new file cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadMindMap).mockImplementation(async path => {
      if (path === PATH_A) return cardsA
      throw new Error('Unexpected token in JSON')
    })
    render(<App />)
    await openFile(PATH_A)
    vi.mocked(saveMindMap).mockClear()

    await openFile(PATH_B)

    // currentFilePath goes back to A: header, tree highlight and canvas all agree.
    expect(useWorkspaceStore.getState().currentFilePath).toBe(PATH_A)
    expect(useCardsStore.getState().history.present).toEqual(cardsA)
    expect(screen.getByRole('alert')).toHaveTextContent(/Impossible d’ouvrir chapitre-b\.json/)
    // Autosave never armed for the file that failed to load.
    expect(saveMindMap).not.toHaveBeenCalledWith(PATH_B, expect.anything())
  })

  it('treats a vanished file (null load result) as an error instead of adopting the current cards', async () => {
    vi.mocked(loadMindMap).mockImplementation(async path => (path === PATH_A ? cardsA : null))
    render(<App />)
    await openFile(PATH_A)
    vi.mocked(saveMindMap).mockClear()

    await openFile(PATH_B)

    expect(useWorkspaceStore.getState().currentFilePath).toBe(PATH_A)
    expect(useCardsStore.getState().history.present).toEqual(cardsA)
    expect(screen.getByRole('alert')).toHaveTextContent(/n’existe plus/)
    // The old behaviour wrote A's cards into B's path 500ms later.
    expect(saveMindMap).not.toHaveBeenCalledWith(PATH_B, expect.anything())
  })

  it('falls back to "Aucun fichier ouvert" when the very first file opened fails to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadMindMap).mockRejectedValue(new Error('corrupt'))
    render(<App />)

    await openFile(PATH_A)

    expect(useWorkspaceStore.getState().currentFilePath).toBeNull()
    expect(screen.getByText('Aucun fichier ouvert')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/illisible ou corrompu/)
    expect(saveMindMap).not.toHaveBeenCalled()
  })

  it('dismisses the load-error message on demand', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadMindMap).mockRejectedValue(new Error('corrupt'))
    render(<App />)
    await openFile(PATH_A)

    await act(async () => {
      screen.getByRole('button', { name: 'Masquer le message d’erreur' }).click()
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
