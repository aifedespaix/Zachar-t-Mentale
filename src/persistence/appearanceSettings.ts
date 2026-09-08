import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'
import type { AppearanceSettings } from '../types/appearanceSettings'
import { mergeAppearanceSettings } from '../types/appearanceSettings'

const SETTINGS_FILE_NAME = 'appearance-settings.json'

async function settingsFilePath(): Promise<string> {
  return join(await appConfigDir(), SETTINGS_FILE_NAME)
}

export async function loadAppearanceSettings(): Promise<AppearanceSettings> {
  const path = await settingsFilePath()
  if (!(await exists(path))) return mergeAppearanceSettings(null)
  const json = await readTextFile(path)
  return mergeAppearanceSettings(JSON.parse(json))
}

export async function saveAppearanceSettings(settings: AppearanceSettings): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const path = await settingsFilePath()
  await writeTextFile(path, JSON.stringify(settings, null, 2))
}
