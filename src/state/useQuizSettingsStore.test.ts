import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createQuizSettingsStore } from './useQuizSettingsStore'
import { DEFAULT_QUIZ_SETTINGS } from '../types/quizSettings'

vi.mock('../persistence/quizSettings', () => ({
  loadQuizSettings: vi.fn(),
  saveQuizSettings: vi.fn(),
}))

import { loadQuizSettings, saveQuizSettings } from '../persistence/quizSettings'

const remembered = { levels: [2, 4] as const, difficulty: 'difficile' as const, qcmMode: true }

describe('useQuizSettingsStore', () => {
  beforeEach(() => {
    vi.mocked(loadQuizSettings).mockReset()
    vi.mocked(saveQuizSettings).mockReset().mockResolvedValue(undefined)
  })

  it('starts with the defaults before init resolves', () => {
    const store = createQuizSettingsStore()
    expect(store.getState().similarityThreshold).toBe(100)
    expect(store.getState().lengthGuideEnabled).toBe(true)
    expect(store.getState().lastQuizConfig).toEqual(DEFAULT_QUIZ_SETTINGS.lastQuizConfig)
  })

  it('init loads persisted settings into the store', async () => {
    vi.mocked(loadQuizSettings).mockResolvedValue({
      similarityThreshold: 90,
      lengthGuideEnabled: false,
      liveLetterFeedback: false,
      lastQuizConfig: { levels: [2, 4], difficulty: 'difficile', qcmMode: true },
    })
    const store = createQuizSettingsStore()

    await store.getState().init()

    expect(store.getState().similarityThreshold).toBe(90)
    expect(store.getState().lengthGuideEnabled).toBe(false)
    expect(store.getState().lastQuizConfig).toEqual(remembered)
  })

  it('falls back to defaults if loading settings throws', async () => {
    vi.mocked(loadQuizSettings).mockRejectedValue(new Error('disk error'))
    const store = createQuizSettingsStore()

    await store.getState().init()

    expect(store.getState().similarityThreshold).toBe(100)
    expect(store.getState().lengthGuideEnabled).toBe(true)
    expect(store.getState().lastQuizConfig).toEqual(DEFAULT_QUIZ_SETTINGS.lastQuizConfig)
  })

  it('keeps the in-memory value even if persisting it fails', async () => {
    vi.mocked(saveQuizSettings).mockRejectedValue(new Error('disk error'))
    const store = createQuizSettingsStore()

    await store.getState().setSimilarityThreshold(80)
    await store.getState().setLengthGuideEnabled(false)

    expect(store.getState().similarityThreshold).toBe(80)
    expect(store.getState().lengthGuideEnabled).toBe(false)
  })

  it('setSimilarityThreshold updates the store and persists every field', async () => {
    const store = createQuizSettingsStore()

    await store.getState().setSimilarityThreshold(80)

    expect(store.getState().similarityThreshold).toBe(80)
    expect(saveQuizSettings).toHaveBeenCalledWith({
      ...DEFAULT_QUIZ_SETTINGS,
      similarityThreshold: 80,
    })
  })

  it('setLengthGuideEnabled updates the store and persists every field', async () => {
    const store = createQuizSettingsStore()

    await store.getState().setLengthGuideEnabled(false)

    expect(store.getState().lengthGuideEnabled).toBe(false)
    expect(saveQuizSettings).toHaveBeenCalledWith({
      ...DEFAULT_QUIZ_SETTINGS,
      lengthGuideEnabled: false,
    })
  })

  it('setLastQuizConfig remembers the modal configuration without touching the other fields', async () => {
    const store = createQuizSettingsStore()

    await store.getState().setLastQuizConfig({ levels: [1, 3], difficulty: 'facile', qcmMode: true })

    expect(store.getState().lastQuizConfig).toEqual({ levels: [1, 3], difficulty: 'facile', qcmMode: true })
    expect(store.getState().similarityThreshold).toBe(100)
    expect(store.getState().lengthGuideEnabled).toBe(true)
    expect(saveQuizSettings).toHaveBeenCalledWith({
      similarityThreshold: 100,
      lengthGuideEnabled: true,
      liveLetterFeedback: false,
      lastQuizConfig: { levels: [1, 3], difficulty: 'facile', qcmMode: true },
    })
  })
})
