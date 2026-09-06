import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'
import type { WorkspaceConfig } from '../types/workspace'

const CONFIG_FILE_NAME = 'workspace.json'

async function configFilePath(): Promise<string> {
  return join(await appConfigDir(), CONFIG_FILE_NAME)
}

export async function loadWorkspaceConfig(): Promise<WorkspaceConfig> {
  const path = await configFilePath()
  if (!(await exists(path))) return { rootFolders: [] }
  const json = await readTextFile(path)
  return JSON.parse(json) as WorkspaceConfig
}

export async function saveWorkspaceConfig(config: WorkspaceConfig): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const path = await configFilePath()
  await writeTextFile(path, JSON.stringify(config, null, 2))
}
