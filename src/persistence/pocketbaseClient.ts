import PocketBase, { AsyncAuthStore } from 'pocketbase'
import { exists, readTextFile, writeTextFile, remove, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'

const AUTH_FILE_NAME = 'sync-auth.json'

async function authFilePath(): Promise<string> {
  return join(await appConfigDir(), AUTH_FILE_NAME)
}

async function readPersistedAuth(): Promise<string> {
  try {
    const path = await authFilePath()
    if (!(await exists(path))) return ''
    return (await readTextFile(path)) || ''
  } catch {
    return ''
  }
}

async function writePersistedAuth(serialized: string): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  await writeTextFile(await authFilePath(), serialized)
}

async function clearPersistedAuth(): Promise<void> {
  const path = await authFilePath()
  if (await exists(path)) await remove(path)
}

/**
 * One client per server URL, with its session persisted to a file under
 * `appConfigDir()` via PocketBase's own `AsyncAuthStore` (built for exactly
 * this — an async, non-browser-storage backend) instead of the SDK's
 * `localStorage` default, which does not exist in this Tauri webview context.
 */
export function createPocketBaseClient(serverUrl: string): PocketBase {
  const authStore = new AsyncAuthStore({
    save: writePersistedAuth,
    clear: clearPersistedAuth,
    initial: readPersistedAuth(),
  })
  return new PocketBase(serverUrl, authStore)
}
