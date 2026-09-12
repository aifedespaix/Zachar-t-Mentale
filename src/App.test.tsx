import { render, screen, act, waitFor } from '@testing-library/react'
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
  loadMindMapMeta: vi.fn().mockResolvedValue(null),
}))
vi.mock('./persistence/fileOps', () => ({ duplicateMap: vi.fn() }))
vi.mock('./persistence/workspaceConfig', () => ({
  loadWorkspaceConfig: vi.fn(),
  saveWorkspaceConfig: vi.fn(),
}))
vi.mock('./persistence/quizSettings', () => ({
  loadQuizSettings: vi.fn().mockResolvedValue({ similarityThreshold: 100, lengthGuideEnabled: true, liveLetterFeedback: false }),
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
vi.mock('./persistence/sessionState', () => ({
  loadSessionState: vi.fn(),
  saveSessionState: vi.fn(),
}))
vi.mock('./hooks/useMindMapFormatValid', () => ({ useMindMapFormatValid: vi.fn() }))
// `useSyncStore.init()` is now called from App's bootstrap effect on every
// render. Left unmocked, it would make real Tauri fs calls (via
// `loadSyncSettings`) on every single test in this file, regardless of
// whether that test cares about sync at all — this keeps it inert with a
// default-settings resolution, matching `init()`'s own "stay at defaults"
// behaviour for a load it can't make.
vi.mock('./persistence/syncSettings', () => ({
  loadSyncSettings: vi.fn().mockResolvedValue({ serverUrl: '', syncFolderPath: null }),
  saveSyncSettings: vi.fn().mockResolvedValue(undefined),
}))

import { loadMindMap, saveMindMap, mindMapExists, loadMindMapMeta } from './persistence/fileStore'
import { duplicateMap } from './persistence/fileOps'
import { useSyncStore } from './state/useSyncStore'
import { CORRUPTED_MAP_MESSAGE } from './components/CorruptedMapDialog'
import { loadWorkspaceConfig } from './persistence/workspaceConfig'
import { scanFolder } from './persistence/fileTree'
import { loadSessionState } from './persistence/sessionState'
import { check } from '@tauri-apps/plugin-updater'
import type { SyncResult } from './sync/syncService'

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
  useCardsStore.setState({ history: cards.history, locked: cards.locked, readOnly: cards.readOnly })
  // An active quiz now hides the file sidebar and frames the canvas, so a quiz
  // left running by one test would change what every later test can even see.
  const quiz = createQuizStore().getState()
  useQuizStore.setState({
    active: quiz.active,
    showSummary: quiz.showSummary,
    config: quiz.config,
    questions: quiz.questions,
    results: quiz.results,
    recallProgress: quiz.recallProgress,
    wasLockedBeforeQuiz: quiz.wasLockedBeforeQuiz,
  })
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

describe('App sync bootstrap', () => {
  beforeEach(() => {
    resetStores()
    vi.mocked(loadWorkspaceConfig).mockReset().mockResolvedValue({ rootFolders: [] })
    vi.mocked(loadSessionState).mockReset().mockReturnValue({ currentFilePath: null, expandedPaths: [] })
    vi.mocked(scanFolder).mockReset().mockResolvedValue([])
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('restores the persisted sync session by calling useSyncStore.init() on mount', async () => {
    const initSpy = vi.spyOn(useSyncStore.getState(), 'init').mockResolvedValue(undefined)

    render(<App />)
    await act(async () => {})

    expect(initSpy).toHaveBeenCalled()
  })
})

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

  it('gives the header’s file name an ellipsis instead of a horizontal scrollbar', async () => {
    vi.mocked(loadMindMap).mockResolvedValue(cardsA)
    render(<App />)
    await openFile(PATH_A)

    // Found by its `title` (the full path, which is what the ellipsis hides),
    // so the assertion does not depend on which name the header happens to
    // display. `minWidth: 0` is the load-bearing declaration: a flex item whose
    // floor is the whole string is what pushed the header past the window edge.
    // jsdom lays nothing out, so this pins the declaration, not the pixels.
    expect(screen.getByTitle(PATH_A)).toHaveStyle({
      minWidth: '0px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    })
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
    resetStores()
    vi.useFakeTimers()
    vi.mocked(loadMindMap).mockReset().mockResolvedValue(cardsA)
    vi.mocked(saveMindMap).mockReset().mockResolvedValue(undefined)
    vi.mocked(loadWorkspaceConfig).mockReset().mockResolvedValue({ rootFolders: [] })
    vi.mocked(loadSessionState).mockReset().mockReturnValue({ currentFilePath: null, expandedPaths: [] })
    vi.mocked(scanFolder).mockReset().mockResolvedValue([])
  })
  afterEach(() => vi.useRealTimers())

  function startQuiz() {
    useQuizStore.setState({
      active: true,
      questions: [{ cardId: 'a-root', type: 'recall' }],
      results: { 'a-root': 'unanswered' },
    })
  }

  it('shows the quiz launch button when no quiz is active', async () => {
    render(<App />)
    await settle()
    expect(screen.getByRole('button', { name: /lancer un quiz/i })).toBeInTheDocument()
  })

  it('frames the canvas and hides the launch button while a quiz is active', async () => {
    render(<App />)
    await openFile(PATH_A)
    await act(async () => startQuiz())

    expect(screen.queryByRole('button', { name: /lancer un quiz/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('quiz-frame')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /terminer le quiz/i })).toBeInTheDocument()
  })

  it('hides the lock toggle while a quiz is active (quiz mode inherits locked mode for its whole duration)', async () => {
    render(<App />)
    await openFile(PATH_A)
    await act(async () => startQuiz())

    expect(screen.queryByRole('button', { name: /verrouiller|déverrouiller/i })).not.toBeInTheDocument()
  })

  it('takes the file tree away during a quiz, so no one can switch maps mid-round', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours'] })
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'chapitre-a.json', path: PATH_A }])
    render(<App />)
    await openFile(PATH_A)
    expect(await screen.findByRole('button', { name: 'cours' })).toBeInTheDocument()

    await act(async () => startQuiz())

    expect(screen.queryByRole('button', { name: 'cours' })).not.toBeInTheDocument()
  })

  it('leaves the canvas unframed in the editor', async () => {
    render(<App />)
    await openFile(PATH_A)

    expect(screen.queryByTestId('quiz-frame')).not.toBeInTheDocument()
  })
})

const PATH_C = '/cours/chapitre-c.json'
const REPAIRED_PATH_C = '/cours/chapitre-c (Réparée).zmap'
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
    expect(dialog).toHaveTextContent('chapitre-c (Réparée).zmap')
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

    expect(saveMindMap).toHaveBeenCalledWith('/cours/chapitre-c (Réparée 2).zmap', expect.anything())
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
    await user.click(await screen.findByRole('button', { name: 'chapitre-a' }))
    await settle()
    const rootId = useCardsStore.getState().history.present[0].id
    await act(async () => {
      useCardsStore.getState().addChild(rootId)
    })
    vi.mocked(saveMindMap).mockClear()

    await user.click(screen.getByRole('button', { name: 'chapitre-b' }))
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
    await user.click(await screen.findByRole('button', { name: 'chapitre-a' }))
    await settle()
    const rootId = useCardsStore.getState().history.present[0].id
    await act(async () => {
      useCardsStore.getState().addChild(rootId)
    })
    vi.mocked(saveMindMap).mockReset().mockRejectedValue(new Error('disque plein'))

    await user.click(screen.getByRole('button', { name: 'chapitre-b' }))

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
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * An update the hook can find and download. `download`/`install` are split:
   * the hook must call the former on its own and NEVER the latter — on Windows
   * `install()` kills the running process, so only a user click may trigger it.
   */
  function mockAvailableUpdate() {
    const update = {
      download: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }
    vi.mocked(check).mockResolvedValue(update as never)
    return update
  }

  /** This block runs on real timers, so `settle()`'s timer advance is unusable. */
  async function flush() {
    await act(async () => {})
    await act(async () => {})
  }

  it('shows the update banner once the background download finishes', async () => {
    const update = mockAvailableUpdate()

    render(<App />)

    expect(await screen.findByText('Mise à jour prête')).toBeInTheDocument()
    expect(update.download).toHaveBeenCalled()
    // The download alone must never install: that would exit the app mid-session.
    expect(update.install).not.toHaveBeenCalled()
  })

  it('does not show the update banner when no update is available', async () => {
    vi.mocked(check).mockResolvedValue(null)

    render(<App />)
    await act(async () => {})

    expect(screen.queryByText('Mise à jour prête')).not.toBeInTheDocument()
  })

  it('never shows the update banner while a load error banner is visible', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const update = mockAvailableUpdate()
    vi.mocked(loadMindMap).mockRejectedValue(new Error('corrupt'))

    render(<App />)
    await act(async () => {
      useWorkspaceStore.getState().setCurrentFile(PATH_A)
    })
    await flush()

    // The update really is ready — it is the error banner that suppresses it,
    // not a download that never finished.
    expect(update.download).toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Mise à jour prête')).not.toBeInTheDocument()
  })

  it('keeps the banner dismissed even after an unrelated error banner appears and clears', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockAvailableUpdate()
    const user = userEvent.setup()

    render(<App />)
    await screen.findByText('Mise à jour prête')
    await user.click(screen.getByRole('button', { name: 'Masquer le message de mise à jour' }))
    expect(screen.queryByText('Mise à jour prête')).not.toBeInTheDocument()

    // Trigger an unrelated load error: it takes the update banner's slot, so
    // UpdateReadyBanner unmounts. Dismissal must not unmount with it.
    vi.mocked(loadMindMap).mockRejectedValue(new Error('corrupt'))
    await act(async () => {
      useWorkspaceStore.getState().setCurrentFile(PATH_A)
    })
    await flush()
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    // Clear it the way the user does — the update banner must not reappear.
    await user.click(screen.getByRole('button', { name: 'Masquer le message d’erreur' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    expect(screen.queryByText('Mise à jour prête')).not.toBeInTheDocument()
  })
})

describe('App — verrouillage lecture seule', () => {
  const PATH = '/cours/chapitre-a.zmap'
  const cardsA: Card[] = [{ id: 'root', level: 1, title: 'Chapitre A', parentId: null, order: 0 }]
  const metaFromSomeoneElse = { id: 'f1', author: 'aife', role: 'prof' as const, lastModified: 'x' }

  beforeEach(() => {
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(loadMindMapMeta).mockReset()
    vi.mocked(saveMindMap).mockReset().mockResolvedValue(undefined)
    vi.mocked(duplicateMap).mockReset()
    useSyncStore.setState({ currentUser: { username: 'eleve1', role: 'eleve' } })
    useQuizStore.setState({ active: false })
  })
  afterEach(() => {
    useQuizStore.setState({ active: false })
  })

  it('opens a map authored by someone else with its lock engaged, and nothing in the way', async () => {
    vi.mocked(loadMindMap).mockResolvedValue(cardsA)
    vi.mocked(loadMindMapMeta).mockResolvedValue(metaFromSomeoneElse)
    render(<App />)
    await act(async () => {
      useWorkspaceStore.getState().setCurrentFile(PATH)
    })

    // The map is on screen like any other, shown locked: reading it asks nothing.
    expect(await screen.findByRole('button', { name: 'Déverrouiller la carte' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // And the editing block is real, not just visual.
    expect(useCardsStore.getState().readOnly).toBe(true)
  })

  it('offers to copy only when the user reaches for the lock, and refusing keeps it read-only', async () => {
    const user = userEvent.setup()
    vi.mocked(loadMindMap).mockResolvedValue(cardsA)
    vi.mocked(loadMindMapMeta).mockResolvedValue(metaFromSomeoneElse)
    render(<App />)
    useWorkspaceStore.getState().setCurrentFile(PATH)

    await user.click(await screen.findByRole('button', { name: 'Déverrouiller la carte' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Carte de aife — lecture seule')

    await user.click(screen.getByRole('button', { name: /continuer en lecture seule/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The lock never actually moved: still shown locked, still refusing edits.
    expect(screen.getByRole('button', { name: 'Déverrouiller la carte' })).toBeInTheDocument()
    expect(useCardsStore.getState().readOnly).toBe(true)
  })

  it('Personnaliser duplicates the map and opens the copy', async () => {
    const user = userEvent.setup()
    vi.mocked(loadMindMap).mockResolvedValue(cardsA)
    vi.mocked(loadMindMapMeta).mockResolvedValue(metaFromSomeoneElse)
    vi.mocked(duplicateMap).mockResolvedValue('/cours/chapitre-a (eleve1).zmap')
    render(<App />)
    useWorkspaceStore.getState().setCurrentFile(PATH)

    await user.click(await screen.findByRole('button', { name: 'Déverrouiller la carte' }))
    await user.click(await screen.findByRole('button', { name: 'Faire ma copie' }))

    expect(duplicateMap).toHaveBeenCalledWith(PATH, 'eleve1', 'eleve')
    await waitFor(() =>
      expect(useWorkspaceStore.getState().currentFilePath).toBe('/cours/chapitre-a (eleve1).zmap')
    )
  })

  it('shows the map unlocked for a file with no meta, or authored by the current user', async () => {
    vi.mocked(loadMindMap).mockResolvedValue(cardsA)
    vi.mocked(loadMindMapMeta).mockResolvedValue(null)
    render(<App />)
    await act(async () => {
      useWorkspaceStore.getState().setCurrentFile(PATH)
    })

    await waitFor(() => expect(loadMindMap).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Verrouiller la carte' })).toBeInTheDocument()
    expect(useCardsStore.getState().readOnly).toBe(false)
  })
})

describe('App — suite d’un déplacement fait par la synchronisation', () => {
  const SYNCED_PATH = '/cours/a.zmap'
  const MOVED_PATH = '/cours/Chimie/a.zmap'
  /** The report of a run whose ONLY effect was relocating the open file. */
  const relocation: SyncResult = {
    pushed: 0,
    pulled: 0,
    errors: [],
    cancelled: false,
    conflicts: [],
    transferred: [],
    relocated: 1,
    moved: [{ fileId: 'file-1', from: SYNCED_PATH, to: MOVED_PATH }],
    notices: [],
  }

  /** The report of a run whose only effect was ADOPTING a type classified elsewhere. */
  const reclassification: SyncResult = {
    pushed: 0,
    pulled: 0,
    errors: [],
    cancelled: false,
    conflicts: [],
    transferred: [],
    relocated: 0,
    moved: [],
    notices: [],
    reclassified: 1,
  }

  /**
   * The store ready for an AUTOMATIC run: nobody clicks the sidebar's button,
   * and `syncNow` is stubbed at the tail of a real run — all the network work
   * done, the report published into `lastResult`.
   */
  function armAutoSync(nextResult: () => SyncResult | null) {
    useSyncStore.setState({
      currentUser: { username: 'aife', role: 'prof' },
      syncFolderPath: '/cours',
      autoSyncOnLaunch: false,
      autoSyncIntervalMinutes: 5,
      lastResult: null,
      syncNow: async () => {
        const result = nextResult()
        if (result !== null) useSyncStore.setState({ lastResult: result })
      },
    })
  }

  beforeEach(() => {
    resetStores()
    vi.useFakeTimers()
    vi.mocked(loadMindMap).mockReset().mockResolvedValue(cardsA)
    vi.mocked(saveMindMap).mockReset().mockResolvedValue(undefined)
    vi.mocked(loadWorkspaceConfig).mockReset().mockResolvedValue({ rootFolders: [] })
    vi.mocked(loadSessionState).mockReset().mockReturnValue({ currentFilePath: null, expandedPaths: [] })
    vi.mocked(scanFolder).mockReset().mockResolvedValue([])
    // The real `init` would re-read the settings and set `syncFolderPath` back
    // to null: beside the point here, and it would replay what each test just
    // put in place.
    vi.spyOn(useSyncStore.getState(), 'init').mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('re-points the open file after an automatic run that only relocated it', async () => {
    let published: SyncResult | null = null
    armAutoSync(() => published)
    // Refreshing the tree is the other half of the reaction: a relocated file
    // leaves a ghost row behind that no longer opens anything.
    const refreshFolder = vi.spyOn(useWorkspaceStore.getState(), 'refreshFolder')
    render(<App />)
    await openFile(SYNCED_PATH)

    published = relocation
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000)
    })
    await settle()

    // With no reaction to the report, `currentFilePath` stayed on the old path:
    // the debounced autosave recreated the old file holding the newest edits,
    // and the map was split in two.
    expect(useWorkspaceStore.getState().currentFilePath).toBe(MOVED_PATH)
    expect(refreshFolder).toHaveBeenCalledWith('/cours')
    // The relocated file is the one being edited: the header follows it.
    expect(screen.getByText('a.zmap')).toBeInTheDocument()
  })

  it('rafraîchit les métadonnées de l’arbre après l’adoption d’un type', async () => {
    let published: SyncResult | null = null
    armAutoSync(() => published)
    // L’adoption réécrit le `.zmap` sur le disque sans changer son chemin :
    // `refreshFolder` rescanne l’arbre, mais seule la révision de `meta` fait
    // relire la pilule par `useMindMapAuthor`.
    const bumpFileMetaRevision = vi.spyOn(useWorkspaceStore.getState(), 'bumpFileMetaRevision')
    const refreshFolder = vi.spyOn(useWorkspaceStore.getState(), 'refreshFolder')
    render(<App />)
    await openFile(SYNCED_PATH)

    published = reclassification
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000)
    })
    await settle()

    expect(bumpFileMetaRevision).toHaveBeenCalled()
    expect(refreshFolder).toHaveBeenCalledWith('/cours')
  })

  it('flushes the pending save before moving the pointer', async () => {
    armAutoSync(() => null)
    render(<App />)
    await openFile(SYNCED_PATH)
    const rootId = useCardsStore.getState().history.present[0].id
    await act(async () => {
      useCardsStore.getState().addChild(rootId)
    })
    vi.mocked(saveMindMap).mockClear()

    // The report lands BEFORE the autosave debounce (500 ms) has fired: that is
    // the window the review flagged.
    await act(async () => {
      useSyncStore.setState({ lastResult: relocation })
    })
    await act(async () => {})

    // The pending edit reaches the disk instead of going down with the timer
    // the `loadedPath` change cancels.
    expect(vi.mocked(saveMindMap).mock.calls[0]?.[0]).toBe(SYNCED_PATH)
    expect(useWorkspaceStore.getState().currentFilePath).toBe(MOVED_PATH)
  })
})
