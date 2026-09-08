import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import App from './App'
import type { Card } from './types/card'
import { useCardsStore, createCardsStore } from './state/useCardsStore'
import { useWorkspaceStore, createWorkspaceStore } from './state/useWorkspaceStore'
import { useQuizStore, createQuizStore } from './state/useQuizStore'

vi.mock('./persistence/fileStore', () => ({
  loadMindMap: vi.fn(),
  saveMindMap: vi.fn(),
  mindMapExists: vi.fn(),
}))
vi.mock('./persistence/workspaceConfig', () => ({
  loadWorkspaceConfig: vi.fn(),
  saveWorkspaceConfig: vi.fn(),
}))
vi.mock('./persistence/quizSettings', () => ({
  loadQuizSettings: vi.fn().mockResolvedValue({ similarityThreshold: 100, lengthGuideEnabled: true }),
  saveQuizSettings: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./persistence/appearanceSettings', async () => {
  const { DEFAULT_APPEARANCE_SETTINGS } = await import('./types/appearanceSettings')
  return {
    loadAppearanceSettings: vi.fn().mockResolvedValue(DEFAULT_APPEARANCE_SETTINGS),
    saveAppearanceSettings: vi.fn().mockResolvedValue(undefined),
  }
})
vi.mock('./persistence/fileTree', async importOriginal => {
  const actual = await importOriginal<typeof import('./persistence/fileTree')>()
  return { ...actual, scanFolder: vi.fn() }
})
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn().mockResolvedValue(null) }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))
vi.mock('./persistence/sessionState', () => ({
  loadSessionState: vi.fn(),
  saveSessionState: vi.fn(),
}))

import { loadMindMap, saveMindMap, mindMapExists } from './persistence/fileStore'
import { CORRUPTED_MAP_MESSAGE } from './components/CorruptedMapDialog'
import { loadWorkspaceConfig } from './persistence/workspaceConfig'
import { scanFolder } from './persistence/fileTree'
import { loadSessionState } from './persistence/sessionState'
import { check } from '@tauri-apps/plugin-updater'

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
    vi.mocked(loadSessionState).mockReset().mockReturnValue({ currentFilePath: null, expandedPaths: [] })
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

describe('App quiz wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(saveMindMap).mockReset()
    vi.mocked(loadMindMap).mockResolvedValue(null)
    vi.mocked(saveMindMap).mockResolvedValue(undefined)
    vi.mocked(loadSessionState).mockReset().mockReturnValue({ currentFilePath: null, expandedPaths: [] })
    const pristine = createQuizStore().getState()
    useQuizStore.setState({
      active: pristine.active,
      showSummary: pristine.showSummary,
      config: pristine.config,
      questions: pristine.questions,
      results: pristine.results,
      wasLockedBeforeQuiz: pristine.wasLockedBeforeQuiz,
    })
  })
  afterEach(() => vi.useRealTimers())

  it('shows the quiz launch button when no quiz is active', async () => {
    render(<App />)
    await settle()
    expect(screen.getByRole('button', { name: /lancer un quiz/i })).toBeInTheDocument()
  })

  it('hides the quiz launch button and shows the HUD while a quiz is active', async () => {
    useQuizStore.setState({ active: true, questions: [{ cardId: 'x', type: 'recall' }], results: { x: 'unanswered' } })
    render(<App />)
    await settle()

    expect(screen.queryByRole('button', { name: /lancer un quiz/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /terminer le quiz/i })).toBeInTheDocument() // proves the HUD rendered
  })

  it('hides the lock toggle while a quiz is active (quiz mode inherits locked mode for its whole duration)', async () => {
    useQuizStore.setState({ active: true, questions: [{ cardId: 'x', type: 'recall' }], results: { x: 'unanswered' } })
    render(<App />)
    await settle()

    expect(screen.queryByRole('button', { name: /verrouiller|déverrouiller/i })).not.toBeInTheDocument()
  })
})

const PATH_C = '/cours/chapitre-c.json'
const REPAIRED_PATH_C = '/cours/chapitre-c (Réparée).json'
/** A ghost card: its parent no longer exists, so the map cannot be laid out. */
const corruptCards: Card[] = [
  { id: 'c-root', level: 1, title: 'Chapitre C', parentId: null, order: 0 },
  { id: 'c-ghost', level: 2, title: 'Fantôme', parentId: 'disparu', order: 0 },
]

describe('App corrupted-map guard', () => {
  beforeEach(() => {
    resetStores()
    vi.useFakeTimers()
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(saveMindMap).mockReset().mockResolvedValue(undefined)
    vi.mocked(mindMapExists).mockReset().mockResolvedValue(false)
    vi.mocked(loadWorkspaceConfig).mockReset().mockResolvedValue({ rootFolders: [] })
    vi.mocked(loadSessionState).mockReset().mockReturnValue({ currentFilePath: null, expandedPaths: [] })
    vi.mocked(scanFolder).mockReset().mockResolvedValue([])
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('blocks the render and asks before touching a structurally corrupt map', async () => {
    vi.mocked(loadMindMap).mockResolvedValue(corruptCards)
    render(<App />)

    await openFile(PATH_C)

    expect(screen.getByRole('dialog')).toHaveTextContent(CORRUPTED_MAP_MESSAGE)
    // Never handed to the canvas, and never written back to disk.
    expect(useCardsStore.getState().history.present).not.toEqual(corruptCards)
    expect(saveMindMap).not.toHaveBeenCalled()
  })

  it('names the corrupt file and lists what is wrong with it', async () => {
    vi.mocked(loadMindMap).mockResolvedValue(corruptCards)
    render(<App />)

    await openFile(PATH_C)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('chapitre-c.json')
    expect(dialog).toHaveTextContent('chapitre-c (Réparée).json')
    expect(dialog).toHaveTextContent('carte fantôme (parent introuvable)')
  })

  it('returns to the empty state on « Annuler »', async () => {
    vi.mocked(loadMindMap).mockResolvedValue(corruptCards)
    render(<App />)
    await openFile(PATH_C)

    await act(async () => {
      screen.getByRole('button', { name: 'Annuler' }).click()
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useWorkspaceStore.getState().currentFilePath).toBeNull()
    expect(screen.getByText('Aucun fichier ouvert')).toBeInTheDocument()
  })

  it('keeps the previously open map on screen when a corrupt one is clicked', async () => {
    vi.mocked(loadMindMap).mockImplementation(async path => (path === PATH_A ? cardsA : corruptCards))
    render(<App />)
    await openFile(PATH_A)

    await openFile(PATH_C)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(useWorkspaceStore.getState().currentFilePath).toBe(PATH_A)
    expect(useCardsStore.getState().history.present).toEqual(cardsA)
  })

  it('writes a repaired COPY, leaves the original alone, and opens the copy', async () => {
    const repairedCards: Card[] = [
      { id: 'c-root', level: 1, title: 'Chapitre C', parentId: null, order: 0 },
      { id: 'c-ghost', level: 2, title: 'Fantôme', parentId: null, order: 0, detached: true },
    ]
    vi.mocked(loadMindMap).mockImplementation(async path =>
      path === REPAIRED_PATH_C ? repairedCards : corruptCards
    )
    render(<App />)
    await openFile(PATH_C)

    await act(async () => {
      screen.getByRole('button', { name: 'Créer une copie réparée' }).click()
    })
    await settle()

    // The copy is written under « [Nom original] (Réparée) »...
    expect(saveMindMap).toHaveBeenCalledWith(REPAIRED_PATH_C, repairedCards)
    // ...and the corrupt original is never written to.
    expect(saveMindMap).not.toHaveBeenCalledWith(PATH_C, expect.anything())
    // ...then opened: it is the file on screen, and autosave is armed for it.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useWorkspaceStore.getState().currentFilePath).toBe(REPAIRED_PATH_C)
    expect(useCardsStore.getState().history.present).toEqual(repairedCards)
  })

  it('turns the broken cards into floating draft cards in the copy', async () => {
    vi.mocked(loadMindMap).mockResolvedValue(corruptCards)
    render(<App />)
    await openFile(PATH_C)

    await act(async () => {
      screen.getByRole('button', { name: 'Créer une copie réparée' }).click()
    })
    await settle()

    const [, written] = vi.mocked(saveMindMap).mock.calls[0]
    expect(written).toContainEqual({ id: 'c-root', level: 1, title: 'Chapitre C', parentId: null, order: 0 })
    expect(written).toContainEqual(
      expect.objectContaining({ id: 'c-ghost', parentId: null, detached: true, title: 'Fantôme' })
    )
  })

  it('numbers the copy instead of overwriting an existing repair', async () => {
    vi.mocked(loadMindMap).mockResolvedValue(corruptCards)
    vi.mocked(mindMapExists).mockImplementation(async path => path === REPAIRED_PATH_C)
    render(<App />)
    await openFile(PATH_C)

    await act(async () => {
      screen.getByRole('button', { name: 'Créer une copie réparée' }).click()
    })
    await settle()

    expect(saveMindMap).toHaveBeenCalledWith('/cours/chapitre-c (Réparée 2).json', expect.anything())
  })

  it('keeps the dialog open and explains itself when the copy cannot be written', async () => {
    vi.mocked(loadMindMap).mockResolvedValue(corruptCards)
    vi.mocked(saveMindMap).mockRejectedValue(new Error('disque plein'))
    render(<App />)
    await openFile(PATH_C)

    await act(async () => {
      screen.getByRole('button', { name: 'Créer une copie réparée' }).click()
    })

    expect(screen.getByRole('dialog')).toHaveTextContent(/La réparation a échoué : disque plein/)
    expect(useWorkspaceStore.getState().currentFilePath).toBeNull()
  })
})

describe('App canvas mounting', () => {
  beforeEach(() => {
    resetStores()
    vi.useFakeTimers()
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(saveMindMap).mockReset().mockResolvedValue(undefined)
    vi.mocked(mindMapExists).mockReset().mockResolvedValue(false)
    vi.mocked(loadWorkspaceConfig).mockReset().mockResolvedValue({ rootFolders: [] })
    vi.mocked(loadSessionState).mockReset().mockReturnValue({ currentFilePath: null, expandedPaths: [] })
    vi.mocked(scanFolder).mockReset().mockResolvedValue([])
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not mount the canvas before the file’s cards are in the store', async () => {
    let resolveLoad: (cards: Card[]) => void = () => {}
    vi.mocked(loadMindMap).mockImplementation(() => new Promise(resolve => (resolveLoad = resolve)))
    const { container } = render(<App />)

    await act(async () => {
      useWorkspaceStore.getState().setCurrentFile(PATH_A)
    })

    // Mounting here would let React Flow frame the store's transient default
    // card and keep that viewport once the real cards land.
    expect(container.querySelector('.react-flow')).toBeNull()
    expect(screen.getByText(/Ouverture de chapitre-a\.json/)).toBeInTheDocument()

    await act(async () => resolveLoad(cardsA))
    await settle()
    expect(container.querySelector('.react-flow')).not.toBeNull()
  })

  it('remounts the canvas on a file switch instead of reusing the previous one', async () => {
    vi.mocked(loadMindMap).mockImplementation(async path => (path === PATH_A ? cardsA : cardsB))
    const { container } = render(<App />)
    await openFile(PATH_A)
    const canvasForA = container.querySelector('.react-flow')

    await openFile(PATH_B)

    const canvasForB = container.querySelector('.react-flow')
    expect(canvasForB).not.toBeNull()
    // A different DOM node: the whole React Flow instance (viewport, node
    // measurements, `fitView`) is rebuilt for the new map rather than inheriting
    // the previous file's framing.
    expect(canvasForB).not.toBe(canvasForA)
  })
})

describe('App unsaved changes guard', () => {
  beforeEach(() => {
    resetStores()
    vi.useFakeTimers()
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(saveMindMap).mockReset().mockResolvedValue(undefined)
    vi.mocked(loadWorkspaceConfig)
      .mockReset()
      .mockResolvedValue({ rootFolders: ['/cours'] })
    vi.mocked(scanFolder)
      .mockReset()
      .mockResolvedValue([
        { type: 'mindmap', name: 'chapitre-a.json', path: PATH_A },
        { type: 'mindmap', name: 'chapitre-b.json', path: PATH_B },
      ])
    vi.mocked(loadSessionState).mockReset().mockReturnValue({ currentFilePath: null, expandedPaths: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('clicking another file flushes the pending edit before switching, with no prompt when it succeeds', async () => {
    vi.mocked(loadMindMap).mockImplementation(async path => (path === PATH_A ? cardsA : cardsB))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'cours' }))
    await user.click(await screen.findByRole('button', { name: 'chapitre-a.json' }))
    await settle()
    const rootId = useCardsStore.getState().history.present[0].id
    await act(async () => {
      useCardsStore.getState().addChild(rootId)
    })
    vi.mocked(saveMindMap).mockClear()

    await user.click(screen.getByRole('button', { name: 'chapitre-b.json' }))
    await settle()

    // The edit made just before switching was written under PATH_A, not lost.
    expect(saveMindMap).toHaveBeenCalledWith(PATH_A, expect.arrayContaining([expect.objectContaining({})]))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(useWorkspaceStore.getState().currentFilePath).toBe(PATH_B)
  })

  it('prompts instead of silently dropping the edit when the flush fails, and opens the new file on confirm', async () => {
    vi.mocked(loadMindMap).mockImplementation(async path => (path === PATH_A ? cardsA : cardsB))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'cours' }))
    await user.click(await screen.findByRole('button', { name: 'chapitre-a.json' }))
    await settle()
    const rootId = useCardsStore.getState().history.present[0].id
    await act(async () => {
      useCardsStore.getState().addChild(rootId)
    })
    vi.mocked(saveMindMap).mockReset().mockRejectedValue(new Error('disque plein'))

    await user.click(screen.getByRole('button', { name: 'chapitre-b.json' }))

    expect(await screen.findByText(/disque plein/)).toBeInTheDocument()
    // Still on A: the switch has not happened yet, pending the user's decision.
    expect(useWorkspaceStore.getState().currentFilePath).toBe(PATH_A)

    await user.click(screen.getByRole('button', { name: 'Ouvrir quand même' }))

    expect(useWorkspaceStore.getState().currentFilePath).toBe(PATH_B)
  })
})

describe('App update banner', () => {
  beforeEach(() => {
    resetStores()
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(saveMindMap).mockReset().mockResolvedValue(undefined)
    vi.mocked(loadWorkspaceConfig).mockReset().mockResolvedValue({ rootFolders: [] })
    vi.mocked(loadSessionState).mockReset().mockReturnValue({ currentFilePath: null, expandedPaths: [] })
    vi.mocked(scanFolder).mockReset().mockResolvedValue([])
    vi.mocked(check).mockReset()
  })

  it('shows the update banner once the background download finishes', async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined)
    vi.mocked(check).mockResolvedValue({ available: true, downloadAndInstall } as never)

    render(<App />)

    expect(await screen.findByText('Mise à jour prête')).toBeInTheDocument()
  })

  it('does not show the update banner when no update is available', async () => {
    vi.mocked(check).mockResolvedValue(null)

    render(<App />)
    await act(async () => {})

    expect(screen.queryByText('Mise à jour prête')).not.toBeInTheDocument()
  })
})
