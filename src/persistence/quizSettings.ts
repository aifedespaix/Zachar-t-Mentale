import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'
import type { QuizSettings } from '../types/quizSettings'
import { DEFAULT_QUIZ_SETTINGS } from '../types/quizSettings'

const SETTINGS_FILE_NAME = 'quiz-settings.json'

async function settingsFilePath(): Promise<string> {
  return join(await appConfigDir(), SETTINGS_FILE_NAME)
}

export async function loadQuizSettings(): Promise<QuizSettings> {
  const path = await settingsFilePath()
  if (!(await exists(path))) return DEFAULT_QUIZ_SETTINGS
  const json = await readTextFile(path)
  return { ...DEFAULT_QUIZ_SETTINGS, ...(JSON.parse(json) as Partial<QuizSettings>) }
}

export async function saveQuizSettings(settings: QuizSettings): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const path = await settingsFilePath()
  await writeTextFile(path, JSON.stringify(settings, null, 2))
}
