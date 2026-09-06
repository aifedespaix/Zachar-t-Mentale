import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadWorkspaceConfig, saveWorkspaceConfig } from './workspaceConfig'

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

describe('loadWorkspaceConfig', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
  })

  it('returns an empty root folder list when no config file exists yet', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const config = await loadWorkspaceConfig()
    expect(config).toEqual({ rootFolders: [] })
  })

  it('reads and parses an existing config file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ rootFolders: ['/a', '/b'] }))
    const config = await loadWorkspaceConfig()
    expect(readTextFile).toHaveBeenCalledWith('/fake/config/workspace.json')
    expect(config).toEqual({ rootFolders: ['/a', '/b'] })
  })
})

describe('saveWorkspaceConfig', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(writeTextFile).mockReset()
    vi.mocked(mkdir).mockReset()
  })

  it('creates the app config directory if missing, then writes the config file', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    await saveWorkspaceConfig({ rootFolders: ['/a'] })
    expect(mkdir).toHaveBeenCalledWith('/fake/config', { recursive: true })
    expect(writeTextFile).toHaveBeenCalledWith(
      '/fake/config/workspace.json',
      JSON.stringify({ rootFolders: ['/a'] }, null, 2)
    )
  })

  it('does not recreate the config directory when it already exists', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    await saveWorkspaceConfig({ rootFolders: [] })
    expect(mkdir).not.toHaveBeenCalled()
  })
})
