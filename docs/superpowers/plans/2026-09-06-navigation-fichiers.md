# Navigation fichiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single hardcoded mind-map file with a collapsible, VS Code-like file-tree sidebar: configure one or more root folders, browse/open/create/rename/delete `.json` mind-map files and subfolders, and always show which file is currently open.

**Architecture:** A new `useWorkspaceStore` (zustand, separate from `useCardsStore`) holds the configured root folders, their eagerly-scanned file trees, folder-expansion state, and the currently open file path. Three new persistence modules back it: `workspaceConfig.ts` (load/save the root-folder list to a small dedicated JSON config file), `fileTree.ts` (recursive folder scan + sort + descendant count), and `fileOps.ts` (create/rename/delete files and folders). A single recursive `FileTreeRow` component renders both root folders and nested folders/files (a root is just a synthetic folder node with an extra "remove from list" action), and `FileSidebar` wraps it with the collapse toggle and the native folder picker. `App.tsx` is rewired to load whatever `currentFilePath` points to (instead of one constant path) and to show that file's name in the header.

**Tech Stack:** React 19 + TypeScript, Zustand 5, `@tauri-apps/plugin-fs` (extended), `@tauri-apps/plugin-dialog` (new), `@tauri-apps/api/path`, shadcn/ui (Radix) `Dialog`/`Button`/`Tooltip`, lucide-react icons, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-06-navigation-fichiers-design.md`

## Global Constraints

- Any `.json` file inside a configured folder is a mind-map *candidate* — validity is checked only on open, never during scan (spec: "Modèle de données", "Gestion d'erreurs").
- A non-`.json` file is always shown, never hidden — greyed out and inert, same "no state hidden without explanation" principle already used for disabled card buttons (spec: "Accessibilité & principes TSA").
- Any destructive action (file or folder deletion) requires an explicit confirmation dialog naming what will disappear — never silent, same pattern as card deletion with children (spec: "Suppression").
- `useWorkspaceStore` is a separate zustand store from `useCardsStore` — file navigation and card editing are distinct responsibilities that must not reach into each other's internals (spec: "Store").
- Folder expansion state and the scanned tree are in-memory only, never persisted to disk (spec: "Scan", "Composants UI").
- Use the latest stable version of any new dependency (`@tauri-apps/plugin-dialog`), matching the project-wide convention set in lot 1.

---

## Task 1: Tauri permissions, fs scope, and the dialog plugin

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Produces: `import { open } from '@tauri-apps/plugin-dialog'` becomes available to the frontend; `@tauri-apps/plugin-fs` gains `readDir`/`mkdir`/`remove`/`rename` permissions; the fs scope covers any folder under the user's home directory instead of only the demo file.
- Consumed by: Task 2 (`workspaceConfig.ts` writes outside the old single-file scope), Task 3 (`readDir`), Task 4 (`mkdir`/`remove`/`rename`), Task 7 (`open` dialog).

This task has no unit tests — it is dependency/config wiring, verified by a successful install and a successful Rust compile.

- [ ] **Step 1: Add the npm dependency**

Run: `bun add @tauri-apps/plugin-dialog`

This adds an entry like `"@tauri-apps/plugin-dialog": "^2.x.x"` to `package.json`'s `dependencies` — let bun pick the latest stable version rather than typing a version by hand.

- [ ] **Step 2: Add and register the Rust plugin**

In `src-tauri/Cargo.toml`, add to `[dependencies]` (alongside the existing `tauri-plugin-fs = "2"`):

```toml
tauri-plugin-dialog = "2"
```

In `src-tauri/src/lib.rs`, replace:

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
```

with:

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![greet])
```

- [ ] **Step 3: Extend the capability permissions and fs scope**

Replace the full contents of `src-tauri/capabilities/default.json` with:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": [
    "main"
  ],
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default",
    "fs:default",
    "fs:allow-exists",
    "fs:allow-read-text-file",
    "fs:allow-write-text-file",
    "fs:allow-read-dir",
    "fs:allow-mkdir",
    "fs:allow-remove",
    "fs:allow-rename",
    {
      "identifier": "fs:scope",
      "allow": ["$HOME/**"]
    }
  ]
}
```

The scope widens from the single demo file to anywhere under the user's home directory: this is a single-user local desktop app with no untrusted content, and the user picks folders explicitly through a native OS dialog (Task 7) — a per-folder dynamic scope grant is a less stable mechanism across Tauri versions than a static home-directory scope for this use case.

- [ ] **Step 4: Verify the install and the Rust build**

Run: `bun install`
Expected: completes without error, `@tauri-apps/plugin-dialog` present in `node_modules`.

Run: `cd src-tauri && cargo check`
Expected: compiles without error (downloads and compiles `tauri-plugin-dialog`).

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat: add the dialog plugin and widen fs permissions for workspace navigation"
```

---

## Task 2: Workspace types and config persistence

**Files:**
- Create: `src/types/workspace.ts`
- Create: `src/persistence/workspaceConfig.ts`
- Create: `src/persistence/workspaceConfig.test.ts`

**Interfaces:**
- Produces:
  - `FileTreeNode = { type: 'folder'; name: string; path: string; children: FileTreeNode[] } | { type: 'mindmap'; name: string; path: string } | { type: 'other'; name: string; path: string }`
  - `RootFolder { path: string; tree: FileTreeNode[] }`
  - `WorkspaceConfig { rootFolders: string[] }`
  - `loadWorkspaceConfig(): Promise<WorkspaceConfig>`, `saveWorkspaceConfig(config: WorkspaceConfig): Promise<void>`
- Consumed by: Task 3 (`FileTreeNode`), Task 4 (types), Task 5 (`useWorkspaceStore` calls both functions and uses all three types), Task 6/7/8 (`FileTreeNode`).

- [ ] **Step 1: Create the types file**

```ts
// src/types/workspace.ts
export type FileTreeNode =
  | { type: 'folder'; name: string; path: string; children: FileTreeNode[] }
  | { type: 'mindmap'; name: string; path: string }
  | { type: 'other'; name: string; path: string }

export interface RootFolder {
  path: string
  tree: FileTreeNode[]
}

export interface WorkspaceConfig {
  rootFolders: string[]
}
```

- [ ] **Step 2: Write the failing tests for `workspaceConfig.ts`**

```ts
// src/persistence/workspaceConfig.test.ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/persistence/workspaceConfig.test.ts`
Expected: FAIL — `src/persistence/workspaceConfig.ts` does not exist yet.

- [ ] **Step 4: Implement `workspaceConfig.ts`**

```ts
// src/persistence/workspaceConfig.ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/persistence/workspaceConfig.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/types/workspace.ts src/persistence/workspaceConfig.ts src/persistence/workspaceConfig.test.ts
git commit -m "feat: add workspace types and minimal root-folder config persistence"
```

---

## Task 3: Recursive folder scanning

**Files:**
- Create: `src/persistence/fileTree.ts`
- Create: `src/persistence/fileTree.test.ts`

**Interfaces:**
- Consumes: `FileTreeNode` (Task 2).
- Produces: `scanFolder(folderPath: string): Promise<FileTreeNode[]>`
- Consumed by: Task 5 (`useWorkspaceStore`), Task 8 (mocked in `FileTreeRow` tests).

- [ ] **Step 1: Write the failing tests**

```ts
// src/persistence/fileTree.test.ts
import { describe, it, expect, vi } from 'vitest'
import { scanFolder } from './fileTree'

vi.mock('@tauri-apps/plugin-fs', () => ({ readDir: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

import { readDir } from '@tauri-apps/plugin-fs'

function entry(name: string, isDirectory = false) {
  return { name, isDirectory, isFile: !isDirectory, isSymlink: false }
}

describe('scanFolder', () => {
  it('classifies .json files as mindmap nodes and other files as other nodes', async () => {
    vi.mocked(readDir).mockResolvedValueOnce([entry('chapitre.json'), entry('notes.pdf')])
    const tree = await scanFolder('/cours')
    expect(tree).toEqual([
      { type: 'mindmap', name: 'chapitre.json', path: '/cours/chapitre.json' },
      { type: 'other', name: 'notes.pdf', path: '/cours/notes.pdf' },
    ])
  })

  it('recurses into subfolders', async () => {
    vi.mocked(readDir).mockImplementation(async (path: unknown) => {
      if (path === '/cours') return [entry('chapitre1', true)]
      if (path === '/cours/chapitre1') return [entry('intro.json')]
      return []
    })
    const tree = await scanFolder('/cours')
    expect(tree).toEqual([
      {
        type: 'folder',
        name: 'chapitre1',
        path: '/cours/chapitre1',
        children: [{ type: 'mindmap', name: 'intro.json', path: '/cours/chapitre1/intro.json' }],
      },
    ])
  })

  it('sorts folders before files, alphabetically within each group', async () => {
    vi.mocked(readDir).mockResolvedValueOnce([entry('zeta.json'), entry('alpha-folder', true), entry('alpha.json')])
    const tree = await scanFolder('/cours')
    expect(tree.map(n => n.name)).toEqual(['alpha-folder', 'alpha.json', 'zeta.json'])
  })

  it('treats file extensions case-insensitively', async () => {
    vi.mocked(readDir).mockResolvedValueOnce([entry('Chapitre.JSON')])
    const tree = await scanFolder('/cours')
    expect(tree[0].type).toBe('mindmap')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/persistence/fileTree.test.ts`
Expected: FAIL — `src/persistence/fileTree.ts` does not exist yet.

- [ ] **Step 3: Implement `scanFolder`**

```ts
// src/persistence/fileTree.ts
import { readDir } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import type { FileTreeNode } from '../types/workspace'

export async function scanFolder(folderPath: string): Promise<FileTreeNode[]> {
  const entries = await readDir(folderPath)
  const nodes = await Promise.all(
    entries.map(async (entry): Promise<FileTreeNode> => {
      const path = await join(folderPath, entry.name)
      if (entry.isDirectory) {
        return { type: 'folder', name: entry.name, path, children: await scanFolder(path) }
      }
      if (entry.name.toLowerCase().endsWith('.json')) {
        return { type: 'mindmap', name: entry.name, path }
      }
      return { type: 'other', name: entry.name, path }
    })
  )
  return sortTree(nodes)
}

function sortTree(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type === 'folder' && b.type !== 'folder') return -1
    if (a.type !== 'folder' && b.type === 'folder') return 1
    return a.name.localeCompare(b.name)
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/persistence/fileTree.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/persistence/fileTree.ts src/persistence/fileTree.test.ts
git commit -m "feat: add recursive folder scanning with folders-first alphabetical sort"
```

---

## Task 4: File and folder operations (create/rename/delete)

**Files:**
- Create: `src/persistence/fileOps.ts`
- Create: `src/persistence/fileOps.test.ts`

**Interfaces:**
- Consumes: `createRootCard` (`../state/cardsReducer`, already exists), `serializeCards` (`./serialization`, already exists).
- Produces:
  - `createMindMapFile(folderPath: string, fileName: string): Promise<string>` — returns the full path written.
  - `createSubfolder(folderPath: string, folderName: string): Promise<string>` — returns the full path created.
  - `renamePath(oldPath: string, newPath: string): Promise<void>`
  - `deletePath(path: string, recursive: boolean): Promise<void>`
- Consumed by: Task 8 (`FileTreeRow`'s create/rename/delete actions).

- [ ] **Step 1: Write the failing tests**

```ts
// src/persistence/fileOps.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMindMapFile, createSubfolder, renamePath, deletePath } from './fileOps'

vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  writeTextFile: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

import { mkdir, remove, rename, writeTextFile } from '@tauri-apps/plugin-fs'

describe('createMindMapFile', () => {
  beforeEach(() => vi.mocked(writeTextFile).mockReset())

  it('writes a new .json file with a single default root card', async () => {
    const path = await createMindMapFile('/cours', 'Chapitre 3')
    expect(path).toBe('/cours/Chapitre 3.json')

    const [writtenPath, content] = vi.mocked(writeTextFile).mock.calls[0]
    expect(writtenPath).toBe('/cours/Chapitre 3.json')
    const cards = JSON.parse(content as string)
    expect(cards).toEqual([
      expect.objectContaining({ level: 1, title: 'Nouveau chapitre', parentId: null, order: 0 }),
    ])
  })

  it('does not double-append .json when the given name already has it', async () => {
    const path = await createMindMapFile('/cours', 'Chapitre 3.json')
    expect(path).toBe('/cours/Chapitre 3.json')
  })
})

describe('createSubfolder', () => {
  beforeEach(() => vi.mocked(mkdir).mockReset())

  it('creates a subfolder at the given path', async () => {
    const path = await createSubfolder('/cours', 'Chimie')
    expect(mkdir).toHaveBeenCalledWith('/cours/Chimie')
    expect(path).toBe('/cours/Chimie')
  })
})

describe('renamePath', () => {
  beforeEach(() => vi.mocked(rename).mockReset())

  it('renames a file or folder', async () => {
    await renamePath('/cours/old.json', '/cours/new.json')
    expect(rename).toHaveBeenCalledWith('/cours/old.json', '/cours/new.json')
  })
})

describe('deletePath', () => {
  beforeEach(() => vi.mocked(remove).mockReset())

  it('deletes a single file non-recursively', async () => {
    await deletePath('/cours/chapitre.json', false)
    expect(remove).toHaveBeenCalledWith('/cours/chapitre.json', { recursive: false })
  })

  it('deletes a folder recursively', async () => {
    await deletePath('/cours/chimie', true)
    expect(remove).toHaveBeenCalledWith('/cours/chimie', { recursive: true })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/persistence/fileOps.test.ts`
Expected: FAIL — `src/persistence/fileOps.ts` does not exist yet.

- [ ] **Step 3: Implement `fileOps.ts`**

```ts
// src/persistence/fileOps.ts
import { mkdir, remove, rename, writeTextFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { createRootCard } from '../state/cardsReducer'
import { serializeCards } from './serialization'

function withJsonExtension(name: string): string {
  return name.toLowerCase().endsWith('.json') ? name : `${name}.json`
}

export async function createMindMapFile(folderPath: string, fileName: string): Promise<string> {
  const path = await join(folderPath, withJsonExtension(fileName))
  await writeTextFile(path, serializeCards([createRootCard('Nouveau chapitre')]))
  return path
}

export async function createSubfolder(folderPath: string, folderName: string): Promise<string> {
  const path = await join(folderPath, folderName)
  await mkdir(path)
  return path
}

export async function renamePath(oldPath: string, newPath: string): Promise<void> {
  await rename(oldPath, newPath)
}

export async function deletePath(path: string, recursive: boolean): Promise<void> {
  await remove(path, { recursive })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/persistence/fileOps.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/persistence/fileOps.ts src/persistence/fileOps.test.ts
git commit -m "feat: add create/rename/delete file operations for the workspace"
```

---

## Task 5: `useWorkspaceStore` — workspace session state

**Files:**
- Create: `src/state/useWorkspaceStore.ts`
- Create: `src/state/useWorkspaceStore.test.ts`

**Interfaces:**
- Consumes: `loadWorkspaceConfig`, `saveWorkspaceConfig` (`../persistence/workspaceConfig`, Task 2), `scanFolder` (`../persistence/fileTree`, Task 3), `RootFolder`/`FileTreeNode` (`../types/workspace`, Task 2).
- Produces:
  - `createWorkspaceStore(): WorkspaceStore` and singleton `useWorkspaceStore`
  - State: `{ rootFolders: RootFolder[]; expandedPaths: Set<string>; currentFilePath: string | null }`
  - Actions: `init(): Promise<void>`, `addRootFolder(path: string): Promise<void>`, `removeRootFolder(path: string): Promise<void>`, `refreshFolder(folderPath: string): Promise<void>`, `toggleExpanded(path: string): void`, `setCurrentFile(path: string | null): void`
- Consumed by: Tasks 6-9 (every sidebar component and `App.tsx`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/state/useWorkspaceStore.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWorkspaceStore } from './useWorkspaceStore'

vi.mock('../persistence/workspaceConfig', () => ({
  loadWorkspaceConfig: vi.fn(),
  saveWorkspaceConfig: vi.fn(),
}))
vi.mock('../persistence/fileTree', () => ({ scanFolder: vi.fn() }))

import { loadWorkspaceConfig, saveWorkspaceConfig } from '../persistence/workspaceConfig'
import { scanFolder } from '../persistence/fileTree'

describe('useWorkspaceStore', () => {
  beforeEach(() => {
    vi.mocked(loadWorkspaceConfig).mockReset()
    vi.mocked(saveWorkspaceConfig).mockReset().mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockReset()
  })

  it('init loads configured root folders and scans each one', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours-svt', '/cours-maths'] })
    vi.mocked(scanFolder).mockImplementation(async (path: string) => [
      { type: 'mindmap', name: 'a.json', path: `${path}/a.json` },
    ])
    const store = createWorkspaceStore()

    await store.getState().init()

    expect(store.getState().rootFolders).toEqual([
      { path: '/cours-svt', tree: [{ type: 'mindmap', name: 'a.json', path: '/cours-svt/a.json' }] },
      { path: '/cours-maths', tree: [{ type: 'mindmap', name: 'a.json', path: '/cours-maths/a.json' }] },
    ])
  })

  it('addRootFolder scans the folder, adds it, and persists the config', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: [] })
    vi.mocked(scanFolder).mockResolvedValue([])
    const store = createWorkspaceStore()
    await store.getState().init()

    await store.getState().addRootFolder('/cours-histoire')

    expect(store.getState().rootFolders).toEqual([{ path: '/cours-histoire', tree: [] }])
    expect(saveWorkspaceConfig).toHaveBeenCalledWith({ rootFolders: ['/cours-histoire'] })
  })

  it('addRootFolder does not add the same folder twice', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours'] })
    vi.mocked(scanFolder).mockResolvedValue([])
    const store = createWorkspaceStore()
    await store.getState().init()

    await store.getState().addRootFolder('/cours')

    expect(store.getState().rootFolders).toHaveLength(1)
  })

  it('removeRootFolder drops the folder and persists the config', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/a', '/b'] })
    vi.mocked(scanFolder).mockResolvedValue([])
    const store = createWorkspaceStore()
    await store.getState().init()

    await store.getState().removeRootFolder('/a')

    expect(store.getState().rootFolders).toEqual([{ path: '/b', tree: [] }])
    expect(saveWorkspaceConfig).toHaveBeenCalledWith({ rootFolders: ['/b'] })
  })

  it('refreshFolder rescans a root folder and replaces its tree', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours'] })
    vi.mocked(scanFolder).mockResolvedValueOnce([])
    const store = createWorkspaceStore()
    await store.getState().init()

    vi.mocked(scanFolder).mockResolvedValueOnce([{ type: 'mindmap', name: 'new.json', path: '/cours/new.json' }])
    await store.getState().refreshFolder('/cours')

    expect(store.getState().rootFolders).toEqual([
      { path: '/cours', tree: [{ type: 'mindmap', name: 'new.json', path: '/cours/new.json' }] },
    ])
  })

  it('refreshFolder rescans a nested subfolder and splices its new children into place', async () => {
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours'] })
    vi.mocked(scanFolder).mockResolvedValueOnce([
      { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] },
    ])
    const store = createWorkspaceStore()
    await store.getState().init()

    vi.mocked(scanFolder).mockResolvedValueOnce([
      { type: 'mindmap', name: 'atomes.json', path: '/cours/chimie/atomes.json' },
    ])
    await store.getState().refreshFolder('/cours/chimie')

    expect(store.getState().rootFolders).toEqual([
      {
        path: '/cours',
        tree: [
          {
            type: 'folder',
            name: 'chimie',
            path: '/cours/chimie',
            children: [{ type: 'mindmap', name: 'atomes.json', path: '/cours/chimie/atomes.json' }],
          },
        ],
      },
    ])
  })

  it('toggleExpanded adds then removes a path from the expanded set', () => {
    const store = createWorkspaceStore()
    store.getState().toggleExpanded('/cours/chimie')
    expect(store.getState().expandedPaths.has('/cours/chimie')).toBe(true)

    store.getState().toggleExpanded('/cours/chimie')
    expect(store.getState().expandedPaths.has('/cours/chimie')).toBe(false)
  })

  it('setCurrentFile updates the currently open file path', () => {
    const store = createWorkspaceStore()
    store.getState().setCurrentFile('/cours/chapitre1.json')
    expect(store.getState().currentFilePath).toBe('/cours/chapitre1.json')

    store.getState().setCurrentFile(null)
    expect(store.getState().currentFilePath).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/state/useWorkspaceStore.test.ts`
Expected: FAIL — `src/state/useWorkspaceStore.ts` does not exist yet.

- [ ] **Step 3: Implement `useWorkspaceStore`**

```ts
// src/state/useWorkspaceStore.ts
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { FileTreeNode, RootFolder } from '../types/workspace'
import { loadWorkspaceConfig, saveWorkspaceConfig } from '../persistence/workspaceConfig'
import { scanFolder } from '../persistence/fileTree'

interface WorkspaceState {
  rootFolders: RootFolder[]
  expandedPaths: Set<string>
  currentFilePath: string | null
  init: () => Promise<void>
  addRootFolder: (path: string) => Promise<void>
  removeRootFolder: (path: string) => Promise<void>
  refreshFolder: (folderPath: string) => Promise<void>
  toggleExpanded: (path: string) => void
  setCurrentFile: (path: string | null) => void
}

export type WorkspaceStore = UseBoundStore<StoreApi<WorkspaceState>>

/**
 * Splices freshly-scanned children into whichever folder node (root or
 * nested) matches `folderPath`, leaving the rest of the tree untouched — a
 * refresh only ever re-scans the one directory that just changed, never the
 * whole workspace.
 */
function replaceChildren(nodes: FileTreeNode[], folderPath: string, newChildren: FileTreeNode[]): FileTreeNode[] {
  return nodes.map(node => {
    if (node.type !== 'folder') return node
    if (node.path === folderPath) return { ...node, children: newChildren }
    return { ...node, children: replaceChildren(node.children, folderPath, newChildren) }
  })
}

export function createWorkspaceStore(): WorkspaceStore {
  return create<WorkspaceState>((set, get) => ({
    rootFolders: [],
    expandedPaths: new Set(),
    currentFilePath: null,
    init: async () => {
      const config = await loadWorkspaceConfig()
      const rootFolders = await Promise.all(
        config.rootFolders.map(async path => ({ path, tree: await scanFolder(path) }))
      )
      set({ rootFolders })
    },
    addRootFolder: async path => {
      if (get().rootFolders.some(f => f.path === path)) return
      const tree = await scanFolder(path)
      const rootFolders = [...get().rootFolders, { path, tree }]
      set({ rootFolders })
      await saveWorkspaceConfig({ rootFolders: rootFolders.map(f => f.path) })
    },
    removeRootFolder: async path => {
      const rootFolders = get().rootFolders.filter(f => f.path !== path)
      set({ rootFolders })
      await saveWorkspaceConfig({ rootFolders: rootFolders.map(f => f.path) })
    },
    refreshFolder: async folderPath => {
      const newChildren = await scanFolder(folderPath)
      set(state => ({
        rootFolders: state.rootFolders.map(f =>
          f.path === folderPath ? { ...f, tree: newChildren } : { ...f, tree: replaceChildren(f.tree, folderPath, newChildren) }
        ),
      }))
    },
    toggleExpanded: path =>
      set(state => {
        const next = new Set(state.expandedPaths)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return { expandedPaths: next }
      }),
    setCurrentFile: path => set({ currentFilePath: path }),
  }))
}

export const useWorkspaceStore = createWorkspaceStore()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/state/useWorkspaceStore.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/state/useWorkspaceStore.ts src/state/useWorkspaceStore.test.ts
git commit -m "feat: add useWorkspaceStore for root folders, file tree, and current file"
```

---

## Task 6: `FileTreeRow` — read-only navigation

**Files:**
- Create: `src/components/sidebar/FileTreeRow.tsx`
- Create: `src/components/sidebar/FileTreeRow.test.tsx`

**Interfaces:**
- Consumes: `FileTreeNode` (Task 2), `useWorkspaceStore` (`expandedPaths`, `currentFilePath`, `toggleExpanded`, `createWorkspaceStore` for test resets — Task 5).
- Produces: `FileTreeRow({ node: FileTreeNode; depth: number; onOpenFile: (path: string) => void })` — recursive: a folder renders its own row plus, when expanded, a `FileTreeRow` per child.
- Consumed by: Task 7 (`FileSidebar`, plus this task's own recursive children), Task 8 (extends this component in place), Task 9 (`App.tsx` indirectly, via `FileSidebar`).

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/sidebar/FileTreeRow.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FileTreeRow } from './FileTreeRow'
import { useWorkspaceStore, createWorkspaceStore } from '../../state/useWorkspaceStore'
import type { FileTreeNode } from '../../types/workspace'

function resetWorkspaceStore() {
  const pristine = createWorkspaceStore().getState()
  useWorkspaceStore.setState({
    rootFolders: pristine.rootFolders,
    expandedPaths: pristine.expandedPaths,
    currentFilePath: pristine.currentFilePath,
  })
}

describe('FileTreeRow', () => {
  beforeEach(resetWorkspaceStore)

  it('renders a mindmap file and opens it on click', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={onOpenFile} />)

    await user.click(screen.getByText('chapitre1.json'))

    expect(onOpenFile).toHaveBeenCalledWith('/cours/chapitre1.json')
  })

  it('highlights the row matching the currently open file', () => {
    useWorkspaceStore.setState({ currentFilePath: '/cours/chapitre1.json' })
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    expect(screen.getByRole('button', { name: 'chapitre1.json' })).toHaveStyle({ background: 'var(--muted)' })
  })

  it('renders an "other" file as visually inert and never calls onOpenFile', async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    const node: FileTreeNode = { type: 'other', name: 'notes.pdf', path: '/cours/notes.pdf' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={onOpenFile} />)

    expect(screen.getByText('notes.pdf').closest('[aria-disabled]')).toBeInTheDocument()
    await user.click(screen.getByText('notes.pdf'))
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('toggles a folder open/closed and shows/hides its children', async () => {
    const user = userEvent.setup()
    const node: FileTreeNode = {
      type: 'folder',
      name: 'chimie',
      path: '/cours/chimie',
      children: [{ type: 'mindmap', name: 'atomes.json', path: '/cours/chimie/atomes.json' }],
    }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    expect(screen.queryByText('atomes.json')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /chimie/i }))
    expect(screen.getByText('atomes.json')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /chimie/i }))
    expect(screen.queryByText('atomes.json')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: FAIL — `src/components/sidebar/FileTreeRow.tsx` does not exist yet.

- [ ] **Step 3: Implement read-only `FileTreeRow`**

```tsx
// src/components/sidebar/FileTreeRow.tsx
import { Folder, FolderOpen, FileJson, File, ChevronRight, ChevronDown } from 'lucide-react'
import type { FileTreeNode } from '../../types/workspace'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'

interface FileTreeRowProps {
  node: FileTreeNode
  depth: number
  onOpenFile: (path: string) => void
}

export function FileTreeRow({ node, depth, onOpenFile }: FileTreeRowProps) {
  const expandedPaths = useWorkspaceStore(s => s.expandedPaths)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const toggleExpanded = useWorkspaceStore(s => s.toggleExpanded)

  const indent = { paddingLeft: 8 + depth * 16 }

  if (node.type === 'folder') {
    const isExpanded = expandedPaths.has(node.path)
    return (
      <div>
        <button
          type="button"
          onClick={() => toggleExpanded(node.path)}
          aria-expanded={isExpanded}
          style={{
            ...indent,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            background: 'transparent',
            border: 'none',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          <span>{node.name}</span>
        </button>
        {isExpanded &&
          node.children.map(child => <FileTreeRow key={child.path} node={child} depth={depth + 1} onOpenFile={onOpenFile} />)}
      </div>
    )
  }

  if (node.type === 'mindmap') {
    const isActive = node.path === currentFilePath
    return (
      <button
        type="button"
        onClick={() => onOpenFile(node.path)}
        style={{
          ...indent,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          background: isActive ? 'var(--muted)' : 'transparent',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <FileJson size={16} />
        <span>{node.name}</span>
      </button>
    )
  }

  return (
    <div aria-disabled style={{ ...indent, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted-foreground)' }}>
      <File size={16} />
      <span>{node.name}</span>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/FileTreeRow.tsx src/components/sidebar/FileTreeRow.test.tsx
git commit -m "feat: add read-only recursive file tree navigation row"
```

---

## Task 7: `FileSidebar` — root folder list, collapse toggle, native folder picker

**Files:**
- Modify: `src/components/sidebar/FileTreeRow.tsx`
- Modify: `src/components/sidebar/FileTreeRow.test.tsx`
- Create: `src/components/sidebar/FileSidebar.tsx`
- Create: `src/components/sidebar/FileSidebar.test.tsx`

**Interfaces:**
- Consumes: `FileTreeRow` (extended in this task), `useWorkspaceStore` (`rootFolders`, `init`, `addRootFolder`, `removeRootFolder` — Task 5), `open` from `@tauri-apps/plugin-dialog` (Task 1), `Button` (`../ui/button`).
- Produces:
  - `FileTreeRow` gains optional props `isRoot?: boolean` and `onRemoveRoot?: (path: string) => void` — when `isRoot` is true on a folder node, an extra "remove from list" action replaces nothing (it is additive) and no rename/delete actions appear (those arrive in Task 8, root-excluded from the start).
  - `FileSidebar({ onOpenFile: (path: string) => void })` — a root folder is represented as a synthetic `FileTreeNode` of type `'folder'` (`{ path: root.path, name: <last path segment>, children: root.tree }`) rendered through `FileTreeRow` with `isRoot` set.
- Consumed by: Task 8 (extends `FileTreeRow` further), Task 9 (`App.tsx` renders `FileSidebar`).

- [ ] **Step 1: Write the failing tests for the root-row addition to `FileTreeRow`**

Append to `src/components/sidebar/FileTreeRow.test.tsx` (inside the existing `describe('FileTreeRow', ...)` block):

```tsx
  it('shows a "retirer de la liste" action on a root folder row, and calls onRemoveRoot with its path', async () => {
    const user = userEvent.setup()
    const onRemoveRoot = vi.fn()
    const node: FileTreeNode = { type: 'folder', name: 'cours-svt', path: '/cours-svt', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot onRemoveRoot={onRemoveRoot} />)

    await user.click(screen.getByRole('button', { name: 'Retirer cours-svt de la liste' }))

    expect(onRemoveRoot).toHaveBeenCalledWith('/cours-svt')
  })

  it('does not show a "retirer" action on a non-root folder row', () => {
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours-svt/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    expect(screen.queryByRole('button', { name: /retirer/i })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/sidebar/FileTreeRow.test.tsx -t "retirer"`
Expected: FAIL — `FileTreeRow` does not accept `isRoot`/`onRemoveRoot` yet, no such button renders.

- [ ] **Step 3: Add the root-row action to `FileTreeRow`**

Replace the props interface and the folder branch in `FileTreeRow.tsx`:

```tsx
import { Folder, FolderOpen, FileJson, File, ChevronRight, ChevronDown, X } from 'lucide-react'
import type { FileTreeNode } from '../../types/workspace'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { Button } from '../ui/button'

interface FileTreeRowProps {
  node: FileTreeNode
  depth: number
  onOpenFile: (path: string) => void
  isRoot?: boolean
  onRemoveRoot?: (path: string) => void
}

export function FileTreeRow({ node, depth, onOpenFile, isRoot = false, onRemoveRoot }: FileTreeRowProps) {
```

Replace the folder branch's `return`:

```tsx
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => toggleExpanded(node.path)}
            aria-expanded={isExpanded}
            style={{
              ...indent,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flex: 1,
              background: 'transparent',
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
            <span>{node.name}</span>
          </button>
          {isRoot && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Retirer ${node.name} de la liste`}
              onClick={() => onRemoveRoot?.(node.path)}
            >
              <X size={14} />
            </Button>
          )}
        </div>
        {isExpanded &&
          node.children.map(child => <FileTreeRow key={child.path} node={child} depth={depth + 1} onOpenFile={onOpenFile} />)}
      </div>
    )
```

- [ ] **Step 4: Run the `FileTreeRow` tests to verify they pass**

Run: `npx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Write the failing tests for `FileSidebar`**

```tsx
// src/components/sidebar/FileSidebar.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FileSidebar } from './FileSidebar'
import { useWorkspaceStore, createWorkspaceStore } from '../../state/useWorkspaceStore'

vi.mock('../../persistence/workspaceConfig', () => ({
  loadWorkspaceConfig: vi.fn(),
  saveWorkspaceConfig: vi.fn(),
}))
vi.mock('../../persistence/fileTree', () => ({ scanFolder: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

import { loadWorkspaceConfig, saveWorkspaceConfig } from '../../persistence/workspaceConfig'
import { scanFolder } from '../../persistence/fileTree'
import { open } from '@tauri-apps/plugin-dialog'

function resetWorkspaceStore() {
  const pristine = createWorkspaceStore().getState()
  useWorkspaceStore.setState({
    rootFolders: pristine.rootFolders,
    expandedPaths: pristine.expandedPaths,
    currentFilePath: pristine.currentFilePath,
  })
}

describe('FileSidebar', () => {
  beforeEach(() => {
    resetWorkspaceStore()
    vi.mocked(loadWorkspaceConfig).mockReset().mockResolvedValue({ rootFolders: [] })
    vi.mocked(saveWorkspaceConfig).mockReset().mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockReset().mockResolvedValue([])
    vi.mocked(open).mockReset()
  })

  it('loads the configured workspace on mount and shows an empty state with no root folders', async () => {
    render(<FileSidebar onOpenFile={() => {}} />)

    await waitFor(() => expect(loadWorkspaceConfig).toHaveBeenCalled())
    expect(await screen.findByText('Aucun dossier configuré.')).toBeInTheDocument()
  })

  it('adds a folder chosen from the native picker and lists it', async () => {
    const user = userEvent.setup()
    vi.mocked(open).mockResolvedValue('/cours-svt')
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Aucun dossier configuré.')

    await user.click(screen.getByRole('button', { name: 'Ajouter un dossier' }))

    expect(await screen.findByText('cours-svt')).toBeInTheDocument()
    expect(saveWorkspaceConfig).toHaveBeenCalledWith({ rootFolders: ['/cours-svt'] })
  })

  it('does not add a folder when the picker is cancelled', async () => {
    const user = userEvent.setup()
    vi.mocked(open).mockResolvedValue(null)
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Aucun dossier configuré.')

    await user.click(screen.getByRole('button', { name: 'Ajouter un dossier' }))

    expect(saveWorkspaceConfig).not.toHaveBeenCalled()
  })

  it('expands a root folder to reveal its files, and opens a mindmap file on click', async () => {
    const user = userEvent.setup()
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours-svt'] })
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'chapitre1.json', path: '/cours-svt/chapitre1.json' },
    ])
    const onOpenFile = vi.fn()
    render(<FileSidebar onOpenFile={onOpenFile} />)
    await screen.findByText('cours-svt')

    expect(screen.queryByText('chapitre1.json')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /cours-svt/i }))
    await user.click(await screen.findByText('chapitre1.json'))

    expect(onOpenFile).toHaveBeenCalledWith('/cours-svt/chapitre1.json')
  })

  it('removes a root folder from the list and persists the config', async () => {
    const user = userEvent.setup()
    vi.mocked(loadWorkspaceConfig).mockResolvedValue({ rootFolders: ['/cours-svt'] })
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('cours-svt')

    await user.click(screen.getByRole('button', { name: 'Retirer cours-svt de la liste' }))

    await waitFor(() => expect(screen.queryByText('cours-svt')).not.toBeInTheDocument())
    expect(saveWorkspaceConfig).toHaveBeenCalledWith({ rootFolders: [] })
  })

  it('collapses the panel, hiding its content, and expands it back', async () => {
    const user = userEvent.setup()
    render(<FileSidebar onOpenFile={() => {}} />)
    await screen.findByText('Cartes mentales')

    await user.click(screen.getByRole('button', { name: 'Replier la barre latérale' }))
    expect(screen.queryByText('Cartes mentales')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Déplier la barre latérale' }))
    expect(screen.getByText('Cartes mentales')).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run src/components/sidebar/FileSidebar.test.tsx`
Expected: FAIL — `src/components/sidebar/FileSidebar.tsx` does not exist yet.

- [ ] **Step 7: Implement `FileSidebar`**

```tsx
// src/components/sidebar/FileSidebar.tsx
import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderPlus, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from '../ui/button'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { FileTreeRow } from './FileTreeRow'
import type { FileTreeNode } from '../../types/workspace'

function folderDisplayName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? path
}

interface FileSidebarProps {
  onOpenFile: (path: string) => void
}

export function FileSidebar({ onOpenFile }: FileSidebarProps) {
  const rootFolders = useWorkspaceStore(s => s.rootFolders)
  const init = useWorkspaceStore(s => s.init)
  const addRootFolder = useWorkspaceStore(s => s.addRootFolder)
  const removeRootFolder = useWorkspaceStore(s => s.removeRootFolder)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    init()
  }, [init])

  async function handleAddFolder() {
    const selected = await open({ directory: true })
    if (typeof selected === 'string') await addRootFolder(selected)
  }

  if (collapsed) {
    return (
      <div style={{ width: 32, borderRight: '1px solid var(--border)', display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
        <Button variant="ghost" size="icon-sm" aria-label="Déplier la barre latérale" onClick={() => setCollapsed(false)}>
          <PanelLeftOpen size={16} />
        </Button>
      </div>
    )
  }

  return (
    <div style={{ width: 240, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Cartes mentales</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button variant="ghost" size="icon-sm" aria-label="Ajouter un dossier" onClick={handleAddFolder}>
            <FolderPlus size={16} />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Replier la barre latérale" onClick={() => setCollapsed(true)}>
            <PanelLeftClose size={16} />
          </Button>
        </div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {rootFolders.length === 0 && (
          <p style={{ padding: 8, fontSize: 13, color: 'var(--muted-foreground)' }}>Aucun dossier configuré.</p>
        )}
        {rootFolders.map(root => {
          const rootNode: FileTreeNode = {
            type: 'folder',
            name: folderDisplayName(root.path),
            path: root.path,
            children: root.tree,
          }
          return (
            <FileTreeRow
              key={root.path}
              node={rootNode}
              depth={0}
              onOpenFile={onOpenFile}
              isRoot
              onRemoveRoot={removeRootFolder}
            />
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Run the `FileSidebar` tests to verify they pass**

Run: `npx vitest run src/components/sidebar/FileSidebar.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 9: Commit**

```bash
git add src/components/sidebar/FileTreeRow.tsx src/components/sidebar/FileTreeRow.test.tsx src/components/sidebar/FileSidebar.tsx src/components/sidebar/FileSidebar.test.tsx
git commit -m "feat: add FileSidebar with root folder management and a native folder picker"
```

---

## Task 8: Create, rename, and delete from the sidebar

**Files:**
- Modify: `src/persistence/fileTree.ts`
- Modify: `src/persistence/fileTree.test.ts`
- Modify: `src/components/sidebar/FileTreeRow.tsx`
- Modify: `src/components/sidebar/FileTreeRow.test.tsx`

**Interfaces:**
- Consumes: `createMindMapFile`, `createSubfolder`, `renamePath`, `deletePath` (`../../persistence/fileOps`, Task 4), `refreshFolder`/`setCurrentFile` (`useWorkspaceStore`, Task 5).
- Produces: `countDescendants(node: FileTreeNode): number` (`../../persistence/fileTree`). `FileTreeRow` gains, per node type: a folder (root or not) shows "Nouvelle carte mentale" and "Nouveau sous-dossier"; a non-root folder additionally shows "Renommer"/"Supprimer"; a mindmap file shows "Renommer"/"Supprimer"; an "other" file shows no actions.
- Consumed by: Task 9 (no new consumers beyond the already-wired `FileSidebar`/`App.tsx`).

- [ ] **Step 1: Write the failing test for `countDescendants`**

Append to `src/persistence/fileTree.test.ts`:

```ts
import { countDescendants } from './fileTree'

describe('countDescendants', () => {
  it('returns 0 for a file node', () => {
    expect(countDescendants({ type: 'mindmap', name: 'a.json', path: '/a.json' })).toBe(0)
  })

  it('counts every nested file and folder, not just direct children', () => {
    const tree = {
      type: 'folder' as const,
      name: 'chimie',
      path: '/chimie',
      children: [
        { type: 'mindmap' as const, name: 'atomes.json', path: '/chimie/atomes.json' },
        {
          type: 'folder' as const,
          name: 'td',
          path: '/chimie/td',
          children: [{ type: 'mindmap' as const, name: 'td1.json', path: '/chimie/td/td1.json' }],
        },
      ],
    }
    expect(countDescendants(tree)).toBe(3)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/persistence/fileTree.test.ts -t "countDescendants"`
Expected: FAIL — `countDescendants` is not exported yet.

- [ ] **Step 3: Implement `countDescendants`**

Append to `src/persistence/fileTree.ts`:

```ts
export function countDescendants(node: FileTreeNode): number {
  if (node.type !== 'folder') return 0
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0)
}
```

- [ ] **Step 4: Run the `fileTree` tests to verify they pass**

Run: `npx vitest run src/persistence/fileTree.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Write the failing tests for CRUD in `FileTreeRow`**

Add these `vi.mock` calls near the top of `FileTreeRow.test.tsx`, right after the existing imports (`vi.mock` is hoisted by Vitest regardless of position, but keep them grouped with the file's other mocks for readability):

```tsx
vi.mock('../../persistence/fileOps', () => ({
  createMindMapFile: vi.fn(),
  createSubfolder: vi.fn(),
  renamePath: vi.fn(),
  deletePath: vi.fn(),
}))
vi.mock('../../persistence/fileTree', async importOriginal => {
  const actual = await importOriginal<typeof import('../../persistence/fileTree')>()
  return { ...actual, scanFolder: vi.fn() }
})

import { createMindMapFile, createSubfolder, renamePath, deletePath } from '../../persistence/fileOps'
import { scanFolder } from '../../persistence/fileTree'
```

Replace the `beforeEach(resetWorkspaceStore)` line with:

```tsx
beforeEach(() => {
  resetWorkspaceStore()
  vi.mocked(createMindMapFile).mockReset()
  vi.mocked(createSubfolder).mockReset()
  vi.mocked(renamePath).mockReset()
  vi.mocked(deletePath).mockReset()
  vi.mocked(scanFolder).mockReset()
})
```

Add these tests inside the `describe('FileTreeRow', ...)` block:

```tsx
  it('creates a new mind map file inside a folder and opens it', async () => {
    const user = userEvent.setup()
    vi.mocked(createMindMapFile).mockResolvedValue('/cours/chimie/nouveau.json')
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'nouveau.json', path: '/cours/chimie/nouveau.json' },
    ])
    const onOpenFile = vi.fn()
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={onOpenFile} />)

    await user.click(screen.getByRole('button', { name: 'Nouvelle carte mentale' }))
    await user.type(screen.getByRole('textbox', { name: /nom de la nouvelle carte mentale/i }), 'nouveau{Enter}')

    expect(createMindMapFile).toHaveBeenCalledWith('/cours/chimie', 'nouveau')
    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith('/cours/chimie/nouveau.json'))
  })

  it('creates a new subfolder', async () => {
    const user = userEvent.setup()
    vi.mocked(createSubfolder).mockResolvedValue('/cours/chimie/atomes')
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'folder', name: 'chimie', path: '/cours/chimie', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Nouveau sous-dossier' }))
    await user.type(screen.getByRole('textbox', { name: /nom du nouveau dossier/i }), 'atomes{Enter}')

    expect(createSubfolder).toHaveBeenCalledWith('/cours/chimie', 'atomes')
  })

  it('renames a mind map file', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Renommer' }))
    const input = screen.getByRole('textbox', { name: /renommer chapitre1.json/i })
    await user.clear(input)
    await user.type(input, 'chapitre1-v2.json{Enter}')

    expect(renamePath).toHaveBeenCalledWith('/cours/chapitre1.json', '/cours/chapitre1-v2.json')
  })

  it('updates the current file path when renaming the file that is currently open', async () => {
    const user = userEvent.setup()
    vi.mocked(renamePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    useWorkspaceStore.setState({ currentFilePath: '/cours/chapitre1.json' })
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Renommer' }))
    const input = screen.getByRole('textbox', { name: /renommer chapitre1.json/i })
    await user.clear(input)
    await user.type(input, 'chapitre1-v2.json{Enter}')

    await waitFor(() => expect(useWorkspaceStore.getState().currentFilePath).toBe('/cours/chapitre1-v2.json'))
  })

  it('deletes a mind map file after confirmation', async () => {
    const user = userEvent.setup()
    vi.mocked(deletePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Supprimer' }))
    expect(screen.getByRole('heading', { name: /supprimer le fichier « chapitre1.json » ?/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmer' }))

    expect(deletePath).toHaveBeenCalledWith('/cours/chapitre1.json', false)
  })

  it('clears the current file when deleting the file that is currently open', async () => {
    const user = userEvent.setup()
    vi.mocked(deletePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    useWorkspaceStore.setState({ currentFilePath: '/cours/chapitre1.json' })
    const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Supprimer' }))
    await user.click(screen.getByRole('button', { name: 'Confirmer' }))

    await waitFor(() => expect(useWorkspaceStore.getState().currentFilePath).toBeNull())
  })

  it('deletes a folder and its contents after confirmation, showing the descendant count', async () => {
    const user = userEvent.setup()
    vi.mocked(deletePath).mockResolvedValue(undefined)
    vi.mocked(scanFolder).mockResolvedValue([])
    const node: FileTreeNode = {
      type: 'folder',
      name: 'chimie',
      path: '/cours/chimie',
      children: [
        { type: 'mindmap', name: 'atomes.json', path: '/cours/chimie/atomes.json' },
        { type: 'mindmap', name: 'liaisons.json', path: '/cours/chimie/liaisons.json' },
      ],
    }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Supprimer' }))
    expect(
      screen.getByRole('heading', { name: /supprimer le dossier « chimie » et son contenu \(2 éléments\)/i })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmer' }))

    expect(deletePath).toHaveBeenCalledWith('/cours/chimie', true)
  })

  it('does not show rename/delete on a root folder row, only creation and "retirer"', () => {
    const node: FileTreeNode = { type: 'folder', name: 'cours-svt', path: '/cours-svt', children: [] }
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} isRoot onRemoveRoot={() => {}} />)

    expect(screen.queryByRole('button', { name: 'Renommer' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nouvelle carte mentale' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nouveau sous-dossier' })).toBeInTheDocument()
  })
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: FAIL — no create/rename/delete actions render yet.

- [ ] **Step 7: Implement CRUD in `FileTreeRow`**

Replace the full contents of `src/components/sidebar/FileTreeRow.tsx`:

```tsx
// src/components/sidebar/FileTreeRow.tsx
import { useState } from 'react'
import {
  Folder,
  FolderOpen,
  FolderPlus,
  FileJson,
  FilePlus,
  File,
  ChevronRight,
  ChevronDown,
  Pencil,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { FileTreeNode } from '../../types/workspace'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { createMindMapFile, createSubfolder, renamePath, deletePath } from '../../persistence/fileOps'
import { countDescendants } from '../../persistence/fileTree'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'

interface FileTreeRowProps {
  node: FileTreeNode
  depth: number
  onOpenFile: (path: string) => void
  isRoot?: boolean
  onRemoveRoot?: (path: string) => void
}

function ActionButton({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
          <Icon size={14} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** `node.path` is always `<parent>/<node.name>` (built that way by `scanFolder`/`fileOps`), so the parent directory can be recovered without threading an extra prop through every level of recursion. */
function parentFolderPath(node: FileTreeNode): string {
  const withoutName = node.path.slice(0, node.path.length - node.name.length)
  return withoutName.replace(/[\\/]+$/, '')
}

export function FileTreeRow({ node, depth, onOpenFile, isRoot = false, onRemoveRoot }: FileTreeRowProps) {
  const expandedPaths = useWorkspaceStore(s => s.expandedPaths)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const toggleExpanded = useWorkspaceStore(s => s.toggleExpanded)
  const refreshFolder = useWorkspaceStore(s => s.refreshFolder)
  const setCurrentFile = useWorkspaceStore(s => s.setCurrentFile)

  const [creatingKind, setCreatingKind] = useState<'mindmap' | 'folder' | null>(null)
  const [draftCreateName, setDraftCreateName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [draftRenameName, setDraftRenameName] = useState(node.name)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  const indent = { paddingLeft: 8 + depth * 16 }

  async function submitCreate() {
    const name = draftCreateName.trim()
    setCreatingKind(null)
    if (!name) return
    if (creatingKind === 'mindmap') {
      const path = await createMindMapFile(node.path, name)
      await refreshFolder(node.path)
      onOpenFile(path)
    } else if (creatingKind === 'folder') {
      await createSubfolder(node.path, name)
      await refreshFolder(node.path)
    }
    setDraftCreateName('')
  }

  async function submitRename() {
    const name = draftRenameName.trim()
    setRenaming(false)
    if (!name || name === node.name) return
    const parentPath = parentFolderPath(node)
    const separator = node.path.includes('\\') ? '\\' : '/'
    const newPath = `${parentPath}${separator}${name}`
    await renamePath(node.path, newPath)
    if (node.path === currentFilePath) setCurrentFile(newPath)
    await refreshFolder(parentPath)
  }

  async function confirmDelete() {
    setConfirmDeleteOpen(false)
    const parentPath = parentFolderPath(node)
    const separator = node.path.includes('\\') ? '\\' : '/'
    await deletePath(node.path, node.type === 'folder')
    if (currentFilePath === node.path || currentFilePath?.startsWith(node.path + separator)) setCurrentFile(null)
    await refreshFolder(parentPath)
  }

  if (node.type === 'folder') {
    const isExpanded = expandedPaths.has(node.path)
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => toggleExpanded(node.path)}
            aria-expanded={isExpanded}
            style={{
              ...indent,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flex: 1,
              background: 'transparent',
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
            <span>{node.name}</span>
          </button>
          <TooltipProvider>
            <ActionButton
              label="Nouvelle carte mentale"
              icon={FilePlus}
              onClick={() => {
                setCreatingKind('mindmap')
                setDraftCreateName('')
              }}
            />
            <ActionButton
              label="Nouveau sous-dossier"
              icon={FolderPlus}
              onClick={() => {
                setCreatingKind('folder')
                setDraftCreateName('')
              }}
            />
            {!isRoot && <ActionButton label="Renommer" icon={Pencil} onClick={() => setRenaming(true)} />}
            {!isRoot && <ActionButton label="Supprimer" icon={Trash2} onClick={() => setConfirmDeleteOpen(true)} />}
            {isRoot && (
              <ActionButton
                label={`Retirer ${node.name} de la liste`}
                icon={X}
                onClick={() => onRemoveRoot?.(node.path)}
              />
            )}
          </TooltipProvider>
        </div>

        {renaming && (
          <input
            autoFocus
            aria-label={`Renommer ${node.name}`}
            value={draftRenameName}
            onChange={e => setDraftRenameName(e.target.value)}
            onBlur={submitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setDraftRenameName(node.name)
                setRenaming(false)
              }
            }}
            style={{ ...indent, display: 'block', width: '100%' }}
          />
        )}

        {creatingKind && (
          <input
            autoFocus
            aria-label={creatingKind === 'mindmap' ? 'Nom de la nouvelle carte mentale' : 'Nom du nouveau dossier'}
            value={draftCreateName}
            onChange={e => setDraftCreateName(e.target.value)}
            onBlur={submitCreate}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setCreatingKind(null)
            }}
            style={{ paddingLeft: 8 + (depth + 1) * 16, display: 'block', width: '100%' }}
          />
        )}

        {confirmDeleteOpen && (
          <Dialog open onOpenChange={setConfirmDeleteOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  Supprimer le dossier « {node.name} » et son contenu ({countDescendants(node)} éléments) ?
                </DialogTitle>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)}>
                  Annuler
                </Button>
                <Button variant="destructive" onClick={confirmDelete}>
                  Confirmer
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {isExpanded &&
          node.children.map(child => <FileTreeRow key={child.path} node={child} depth={depth + 1} onOpenFile={onOpenFile} />)}
      </div>
    )
  }

  if (node.type === 'mindmap') {
    const isActive = node.path === currentFilePath
    return (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {renaming ? (
          <input
            autoFocus
            aria-label={`Renommer ${node.name}`}
            value={draftRenameName}
            onChange={e => setDraftRenameName(e.target.value)}
            onBlur={submitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setDraftRenameName(node.name)
                setRenaming(false)
              }
            }}
            style={{ ...indent, display: 'block', flex: 1 }}
          />
        ) : (
          <button
            type="button"
            onClick={() => onOpenFile(node.path)}
            style={{
              ...indent,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flex: 1,
              background: isActive ? 'var(--muted)' : 'transparent',
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <FileJson size={16} />
            <span>{node.name}</span>
          </button>
        )}
        <TooltipProvider>
          <ActionButton label="Renommer" icon={Pencil} onClick={() => setRenaming(true)} />
          <ActionButton label="Supprimer" icon={Trash2} onClick={() => setConfirmDeleteOpen(true)} />
        </TooltipProvider>

        {confirmDeleteOpen && (
          <Dialog open onOpenChange={setConfirmDeleteOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Supprimer le fichier « {node.name} » ?</DialogTitle>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)}>
                  Annuler
                </Button>
                <Button variant="destructive" onClick={confirmDelete}>
                  Confirmer
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    )
  }

  return (
    <div aria-disabled style={{ ...indent, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted-foreground)' }}>
      <File size={16} />
      <span>{node.name}</span>
    </div>
  )
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: PASS (14 tests)

- [ ] **Step 9: Commit**

```bash
git add src/persistence/fileTree.ts src/persistence/fileTree.test.ts src/components/sidebar/FileTreeRow.tsx src/components/sidebar/FileTreeRow.test.tsx
git commit -m "feat: add create/rename/delete actions to the file tree sidebar"
```

---

## Task 9: Wire the sidebar into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `FileSidebar` (Task 7), `useWorkspaceStore` (`currentFilePath`, `setCurrentFile` — Task 5), `loadMindMap` (`./persistence/fileStore`, already exists), `useCardsStore`/`useAutosave` (already exist).
- Produces: no new exports — this is the final integration point. There is no dedicated `App.test.tsx` in this codebase (none existed before this lot either — `App.tsx` is verified manually via `tauri dev`, since it exercises the real Tauri fs/dialog plugins that unit tests already cover individually in Tasks 1-8).

This task has no new automated tests of its own (following the existing precedent — `App.tsx` has never had a test file, since its role is to wire together already-tested pieces against the real Tauri runtime). It is verified by the full test suite still passing, a clean typecheck, and a manual pass in `tauri dev` per Step 4.

- [ ] **Step 1: Confirm the full suite still passes before touching `App.tsx`**

Run: `npx vitest run`
Expected: PASS (every test from Tasks 1-8, plus the pre-existing lot 1/2 tests)

- [ ] **Step 2: Replace `App.tsx`**

Replace the full contents of `src/App.tsx`:

```tsx
// src/App.tsx
import { useEffect, useState } from 'react'
import { MindMapCanvas } from './components/MindMapCanvas'
import { LockToggle } from './components/LockToggle'
import { FileSidebar } from './components/sidebar/FileSidebar'
import { useCardsStore } from './state/useCardsStore'
import { useWorkspaceStore } from './state/useWorkspaceStore'
import { useAutosave } from './persistence/useAutosave'
import { loadMindMap } from './persistence/fileStore'
import { useUndoRedoShortcuts } from './hooks/useUndoRedoShortcuts'

function App() {
  const cards = useCardsStore(s => s.history.present)
  const loadCards = useCardsStore(s => s.loadCards)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const setCurrentFile = useWorkspaceStore(s => s.setCurrentFile)
  const [loaded, setLoaded] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  useUndoRedoShortcuts()
  useAutosave(currentFilePath ?? '', cards, 500, loaded && currentFilePath !== null, () => setSaveFailed(true))

  // Re-runs on every file switch (open a different file, or a rename that
  // moves the current file to a new path): each switch starts a fresh
  // load -> enable-autosave cycle, exactly like the original mount-only
  // effect did for the one hardcoded demo file.
  useEffect(() => {
    if (!currentFilePath) {
      setLoaded(false)
      return
    }
    setLoaded(false)
    setSaveFailed(false)
    loadMindMap(currentFilePath)
      .then(result => {
        if (result !== null) loadCards(result)
        setLoaded(true)
      })
      .catch(err => {
        console.error(
          'Échec du chargement de la carte mentale (le fichier existe mais est illisible ou corrompu) — autosave désactivée pour ne pas l’écraser :',
          err
        )
      })
  }, [currentFilePath, loadCards])

  const currentFileName = currentFilePath ? currentFilePath.split(/[\\/]/).pop() : null

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <FileSidebar onOpenFile={setCurrentFile} />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <header style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <LockToggle />
          <span title={currentFilePath ?? undefined} style={{ fontSize: 13, fontWeight: 500 }}>
            {currentFileName ?? 'Aucun fichier ouvert'}
          </span>
          {saveFailed && (
            <span role="status" style={{ color: '#b45309', fontSize: 13 }}>
              ⚠ Erreur de sauvegarde
            </span>
          )}
        </header>
        <main style={{ flex: 1 }}>
          {currentFilePath ? (
            <MindMapCanvas />
          ) : (
            <div style={{ padding: 24, color: 'var(--muted-foreground)' }}>
              Aucun fichier ouvert. Sélectionnez ou créez une carte mentale dans la barre latérale.
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
```

Note what this removes from the old `App.tsx`: the `DEMO_FILE_PATH` constant and the mount-only load effect. The app now starts with no file open — the user picks one from the sidebar (or the demo file remains on disk and can be added back by pointing a root folder at its directory, but it is no longer auto-loaded).

- [ ] **Step 3: Run the full suite and the typecheck**

Run: `npx vitest run`
Expected: PASS (all tests, including any pre-existing ones exercising `MindMapCanvas`/`LockToggle` in isolation — `App.tsx` itself has no test file to run)

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual verification in the real Tauri runtime**

Unit tests mock every Tauri plugin call; the only way to see the sidebar, the native folder picker, and real filesystem reads/writes work together is to run the actual app.

Run: `bun run tauri dev`

Walk through:
1. The window opens with the sidebar showing "Aucun dossier configuré." and the header showing "Aucun fichier ouvert."
2. Click "Ajouter un dossier", pick a real folder containing at least one `.json` file (or an empty test folder) — it appears in the sidebar.
3. Click "Nouvelle carte mentale" on that root folder, type a name, press Enter — a new file is created, opens automatically, and its name appears in the header.
4. Edit the card, wait ~1s, close and reopen the app (or switch to another file and back) — the edit persisted.
5. Rename the open file from the sidebar — the header updates to the new name without reloading the canvas content.
6. Create a subfolder, move a mental note that it has no drag-and-drop yet (out of scope), create a second mind map inside the subfolder, confirm both nest visually under their folder with correct indentation and icons.
7. Delete the open file with confirmation — the canvas is replaced by the "Aucun fichier ouvert" message and the header clears.
8. Collapse and expand the sidebar with the toggle button.

If any step fails, fix the underlying code (not the test mocks) and re-run the affected unit tests plus this manual pass before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire the file sidebar into App, replacing the hardcoded demo file path"
```

---

## Self-Review Notes

- **Spec coverage:** config persistence (Task 2), eager recursive scan + sort (Task 3), create/rename/delete (Tasks 4 & 8), separate `useWorkspaceStore` (Task 5), icons for folder/mindmap/other + active-file highlight (Tasks 6-8), root-folder management + native picker + collapse toggle (Task 7), header showing the open file (Task 9), confirmation dialogs before destructive actions (Task 8), Tauri permissions/scope/dialog plugin (Task 1). Every section of the spec maps to a task.
- **Placeholder scan:** no TBD/TODO; every step has runnable code or an exact command.
- **Type consistency:** `FileTreeNode`/`RootFolder`/`WorkspaceConfig` (Task 2) are used with the same shape throughout Tasks 3-9; `useWorkspaceStore`'s action names (`init`, `addRootFolder`, `removeRootFolder`, `refreshFolder`, `toggleExpanded`, `setCurrentFile`) match between Task 5's implementation and every later consumer.
- Out-of-scope items from the spec (real-time file watching, persisted expansion state, drag-and-drop moves, renaming/deleting a root folder itself) are intentionally not tasked — they are explicitly deferred in the spec's "Hors périmètre" section.

