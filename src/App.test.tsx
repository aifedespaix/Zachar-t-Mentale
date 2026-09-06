import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import App from './App'
import type { Card } from './types/card'
import { useQuizStore, createQuizStore } from './state/useQuizStore'

vi.mock('./persistence/fileStore', () => ({
  loadMindMap: vi.fn(),
  saveMindMap: vi.fn(),
}))
import { loadMindMap, saveMindMap } from './persistence/fileStore'

const savedCards: Card[] = [{ id: 'saved-root', level: 1, title: 'Chapitre enregistré', parentId: null, order: 0 }]

/** Flush the load promise, then let the autosave debounce elapse. */
async function settle() {
  await act(async () => {})
  await act(async () => {
    vi.advanceTimersByTime(600)
  })
  await act(async () => {})
}

describe('App autosave gating', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(saveMindMap).mockReset()
    vi.mocked(saveMindMap).mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does NOT autosave while the initial load is still pending', async () => {
    vi.mocked(loadMindMap).mockReturnValue(new Promise(() => {})) // never settles
    render(<App />)
    await settle()
    expect(saveMindMap).not.toHaveBeenCalled()
  })

  it('does NOT autosave when the load failed (file exists but is unreadable)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(loadMindMap).mockRejectedValue(new Error('corrupt'))
    render(<App />)
    await settle()
    expect(saveMindMap).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
  })

  it('autosaves once the load reports that no file exists yet', async () => {
    vi.mocked(loadMindMap).mockResolvedValue(null)
    render(<App />)
    await settle()
    expect(saveMindMap).toHaveBeenCalledTimes(1)
  })

  it('loads the saved cards and then autosaves them', async () => {
    vi.mocked(loadMindMap).mockResolvedValue(savedCards)
    render(<App />)
    await settle()
    expect(screen.getByRole('textbox', { name: /titre/i })).toHaveValue('Chapitre enregistré')
    expect(saveMindMap).toHaveBeenCalledWith('demo-chapitre.mmap.json', savedCards)
  })
})

describe('App save-error indicator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(saveMindMap).mockReset()
    vi.mocked(loadMindMap).mockResolvedValue(null)
  })
  afterEach(() => vi.useRealTimers())

  it('shows nothing while saves succeed', async () => {
    vi.mocked(saveMindMap).mockResolvedValue(undefined)
    render(<App />)
    await settle()
    expect(screen.queryByText(/erreur de sauvegarde/i)).not.toBeInTheDocument()
  })

  it('shows a visible warning when a save is rejected', async () => {
    vi.mocked(saveMindMap).mockRejectedValue(new Error('disk full'))
    render(<App />)
    await settle()
    expect(screen.getByText(/erreur de sauvegarde/i)).toBeInTheDocument()
  })
})

describe('App quiz wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(saveMindMap).mockReset()
    vi.mocked(loadMindMap).mockResolvedValue(null)
    vi.mocked(saveMindMap).mockResolvedValue(undefined)
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
