import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'
import type { ShortcutSettings } from '../types/shortcutSettings'
import { DEFAULT_SHORTCUT_SETTINGS } from '../types/shortcutSettings'
import { isCommandId } from '../types/commands'
import { normalizeBinding } from '../shortcuts/keys'

const SETTINGS_FILE_NAME = 'shortcuts.json'

async function settingsFilePath(): Promise<string> {
  return join(await appConfigDir(), SETTINGS_FILE_NAME)
}

/**
 * Keeps only entries this version can act on: a known command id, and either
 * `null` or a binding that parses.
 *
 * The file is plain JSON in the config folder, so it can be hand-edited and it
 * survives downgrades. An override for a command that no longer exists, or a
 * binding string a later version wrote and this one cannot parse, is dropped
 * rather than allowed to shadow a working default with something unusable.
 */
export function sanitizeShortcutSettings(raw: unknown): ShortcutSettings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SHORTCUT_SETTINGS
  const bindings = (raw as { bindings?: unknown }).bindings
  if (typeof bindings !== 'object' || bindings === null) return DEFAULT_SHORTCUT_SETTINGS

  const kept: Record<string, string | null> = {}
  for (const [id, value] of Object.entries(bindings as Record<string, unknown>)) {
    if (!isCommandId(id)) continue
    if (value === null) {
      kept[id] = null
      continue
    }
    if (typeof value !== 'string') continue
    const normalized = normalizeBinding(value)
    if (normalized !== null) kept[id] = normalized
  }
  return { bindings: kept }
}

export async function loadShortcutSettings(): Promise<ShortcutSettings> {
  const path = await settingsFilePath()
  if (!(await exists(path))) return DEFAULT_SHORTCUT_SETTINGS
  return sanitizeShortcutSettings(JSON.parse(await readTextFile(path)) as unknown)
}

export async function saveShortcutSettings(settings: ShortcutSettings): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const path = await settingsFilePath()
  await writeTextFile(path, JSON.stringify(settings, null, 2))
}
