import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadQuizSettings, saveQuizSettings } from './quizSettings'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn().mockResolvedValue('/fake/config'),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'

describe('loadQuizSettings', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
  })

  it('returns the defaults when no settings file exists yet', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const settings = await loadQuizSettings()
    expect(settings).toEqual({ similarityThreshold: 100, lengthGuideEnabled: true, liveLetterFeedback: false })
  })

  it('reads and parses an existing settings file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ similarityThreshold: 85, lengthGuideEnabled: false }))
    const settings = await loadQuizSettings()
    expect(readTextFile).toHaveBeenCalledWith('/fake/config/quiz-settings.json')
    expect(settings).toEqual({ similarityThreshold: 85, lengthGuideEnabled: false, liveLetterFeedback: false })
  })

  it('fills in a default for a field missing from an older settings file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ similarityThreshold: 85 }))
    const settings = await loadQuizSettings()
    expect(settings).toEqual({ similarityThreshold: 85, lengthGuideEnabled: true, liveLetterFeedback: false })
  })
})

describe('saveQuizSettings', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(writeTextFile).mockReset()
    vi.mocked(mkdir).mockReset()
  })

  it('creates the app config directory if missing, then writes the settings file', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    await saveQuizSettings({ similarityThreshold: 90, lengthGuideEnabled: false, liveLetterFeedback: false })
    expect(mkdir).toHaveBeenCalledWith('/fake/config', { recursive: true })
    expect(writeTextFile).toHaveBeenCalledWith(
      '/fake/config/quiz-settings.json',
      JSON.stringify({ similarityThreshold: 90, lengthGuideEnabled: false, liveLetterFeedback: false }, null, 2)
    )
  })

  it('does not recreate the config directory when it already exists', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    await saveQuizSettings({ similarityThreshold: 100, lengthGuideEnabled: true, liveLetterFeedback: false })
    expect(mkdir).not.toHaveBeenCalled()
  })
})
