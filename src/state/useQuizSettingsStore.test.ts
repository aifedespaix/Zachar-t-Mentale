import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createQuizSettingsStore } from './useQuizSettingsStore'

vi.mock('../persistence/quizSettings', () => ({
  loadQuizSettings: vi.fn(),
  saveQuizSettings: vi.fn(),
}))

import { loadQuizSettings, saveQuizSettings } from '../persistence/quizSettings'

describe('useQuizSettingsStore', () => {
  beforeEach(() => {
    vi.mocked(loadQuizSettings).mockReset()
    vi.mocked(saveQuizSettings).mockReset().mockResolvedValue(undefined)
  })

  it('starts with the defaults before init resolves', () => {
    const store = createQuizSettingsStore()
    expect(store.getState().similarityThreshold).toBe(100)
    expect(store.getState().lengthGuideEnabled).toBe(true)
  })

  it('init loads persisted settings into the store', async () => {
    vi.mocked(loadQuizSettings).mockResolvedValue({ similarityThreshold: 90, lengthGuideEnabled: false, liveLetterFeedback: false })
    const store = createQuizSettingsStore()

    await store.getState().init()

    expect(store.getState().similarityThreshold).toBe(90)
    expect(store.getState().lengthGuideEnabled).toBe(false)
  })

  it('falls back to defaults if loading settings throws', async () => {
    vi.mocked(loadQuizSettings).mockRejectedValue(new Error('disk error'))
    const store = createQuizSettingsStore()

    await store.getState().init()

    expect(store.getState().similarityThreshold).toBe(100)
    expect(store.getState().lengthGuideEnabled).toBe(true)
  })

  it('keeps the in-memory value even if persisting it fails', async () => {
    vi.mocked(saveQuizSettings).mockRejectedValue(new Error('disk error'))
    const store = createQuizSettingsStore()

    await store.getState().setSimilarityThreshold(80)
    await store.getState().setLengthGuideEnabled(false)

    expect(store.getState().similarityThreshold).toBe(80)
    expect(store.getState().lengthGuideEnabled).toBe(false)
  })

  it('setSimilarityThreshold updates the store and persists both fields', async () => {
    const store = createQuizSettingsStore()

    await store.getState().setSimilarityThreshold(80)

    expect(store.getState().similarityThreshold).toBe(80)
    expect(saveQuizSettings).toHaveBeenCalledWith({ similarityThreshold: 80, lengthGuideEnabled: true, liveLetterFeedback: false })
  })

  it('setLengthGuideEnabled updates the store and persists both fields', async () => {
    const store = createQuizSettingsStore()

    await store.getState().setLengthGuideEnabled(false)

    expect(store.getState().lengthGuideEnabled).toBe(false)
    expect(saveQuizSettings).toHaveBeenCalledWith({ similarityThreshold: 100, lengthGuideEnabled: false, liveLetterFeedback: false })
  })
})
