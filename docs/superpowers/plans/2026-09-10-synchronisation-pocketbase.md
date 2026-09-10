# Synchronisation PocketBase (modèle fork) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let several users (each self-hosting their own PocketBase server) synchronize `.zmap` mind maps bidirectionally, under the rule "creator = sole editor" — a locked file can only be read or duplicated, never edited, by anyone but its author.

**Architecture:** Every `.zmap` file gains an optional `meta` envelope (`id`/`author`/`role`/`lastModified`). A manual "Synchroniser" action walks the chosen sync folder, pushes files the current user authored, and pulls files authored by someone else, using PocketBase's own `updated` timestamp and a small local cache to skip anything already up to date. No conflict resolution is needed: ownership already guarantees a file is writable in exactly one place. The sidebar shows a lock badge on non-authored files, and the canvas is covered by a blocking overlay (same technique as the existing drag-and-drop overlay) with a "Personnaliser / Faire ma copie" action that forks the file locally under the current user.

**Tech Stack:** React 19 + TypeScript, Zustand, Tauri v2 (`@tauri-apps/plugin-fs`, `@tauri-apps/plugin-dialog`), `pocketbase` JS SDK, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-10-synchronisation-pocketbase-design.md`

## Global Constraints

- All user-facing copy is in French, matching every existing string in the app.
- No new abstraction beyond what a task needs — no ports/adapters layer for local filesystem access; follow the existing convention of calling `@tauri-apps/plugin-fs` directly and mocking the whole module in tests (see `fileStore.test.ts`, `fileOps.test.ts`).
- Every persistence file (`appConfigDir()`-backed JSON) follows the exact `loadX`/`saveX` shape already used by `quizSettings.ts` / `mindMapFormatCache.ts`.
- Run tests for a single file with `bun run test -- <path>` (the `test` script is `vitest run`, which forwards a path argument).
- CSP is already `null` in `src-tauri/tauri.conf.json` — no Tauri capability or CSP change is needed to call an arbitrary PocketBase server URL from `fetch`; do not add `@tauri-apps/plugin-http`.
- The `.sync-state.json` cache lives under `appConfigDir()` (like every other app-internal cache), not inside the user's synced folder — this deviates from the spec's literal wording ("dans le dossier workspace") on purpose, to avoid writing an app-internal file into content the user syncs with other tools.
- `role` (`eleve`/`prof`) is a display label only, everywhere — it must never gate a permission or a UI action beyond what it says.

---

### Task 1: Format de fichier — enveloppe `meta` & migration

**Files:**
- Modify: `src/types/card.ts`
- Modify: `src/persistence/serialization.ts`
- Modify: `src/persistence/serialization.test.ts`
- Modify: `src/persistence/fileStore.ts`
- Modify: `src/persistence/fileStore.test.ts`
- Modify: `src/persistence/fileOps.ts`
- Modify: `src/persistence/fileOps.test.ts`

**Interfaces:**
- Produces: `UserRole = 'eleve' | 'prof'`, `MindMapMeta { id, author, role, lastModified }` (`src/types/card.ts`) — used by every later task.
- Produces: `serializeMindMap(meta: MindMapMeta | null, cards: Card[]): string`, `deserializeMindMap(json: string): { meta: MindMapMeta | null; cards: Card[] }` (`src/persistence/serialization.ts`).
- Produces: `loadMindMap(path): Promise<Card[] | null>` (unchanged signature), `loadMindMapMeta(path): Promise<MindMapMeta | null>` (new), `saveMindMap(path, cards): Promise<void>` (unchanged signature, now meta-preserving) (`src/persistence/fileStore.ts`).
- Produces: `duplicateMap(sourcePath: string, author: string, role: UserRole): Promise<string>` (`src/persistence/fileOps.ts`) — writes a new local `.zmap` stamped with a fresh id/author, used by Task 10.

- [ ] **Step 1: Write the failing tests for the envelope format**

Replace the contents of `src/persistence/serialization.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { serializeMindMap, deserializeMindMap } from './serialization'
import type { Card, MindMapMeta } from '../types/card'

const cards: Card[] = [{ id: 'root', level: 1, title: 'Chapitre', parentId: null, order: 0 }]
const meta: MindMapMeta = { id: 'abc-123', author: 'aife', role: 'prof', lastModified: '2026-09-10T12:00:00.000Z' }

describe('serializeMindMap', () => {
  it('writes a bare array when meta is null — byte-identical to the pre-sync format', () => {
    expect(serializeMindMap(null, cards)).toBe(JSON.stringify(cards, null, 2))
  })

  it('writes an enveloped object when meta is present', () => {
    expect(serializeMindMap(meta, cards)).toBe(JSON.stringify({ meta, cards }, null, 2))
  })
})

describe('deserializeMindMap', () => {
  it('reads a legacy bare array as meta: null', () => {
    expect(deserializeMindMap(JSON.stringify(cards))).toEqual({ meta: null, cards })
  })

  it('reads an enveloped object', () => {
    expect(deserializeMindMap(JSON.stringify({ meta, cards }))).toEqual({ meta, cards })
  })

  it('treats an enveloped object with no meta field as meta: null', () => {
    expect(deserializeMindMap(JSON.stringify({ cards }))).toEqual({ meta: null, cards })
  })

  it('throws on anything that is neither a bare array nor an object with cards', () => {
    expect(() => deserializeMindMap(JSON.stringify({ foo: 'bar' }))).toThrow()
    expect(() => deserializeMindMap('"just a string"')).toThrow()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- src/persistence/serialization.test.ts`
Expected: FAIL — `serializeMindMap`/`deserializeMindMap` are not exported yet.

- [ ] **Step 3: Add the types and rewrite serialization.ts**

In `src/types/card.ts`, add after the existing `CardKind` type (near the top, alongside the other type exports):

```ts
export type UserRole = 'eleve' | 'prof'

/**
 * Present only once a `.zmap` has been synced at least once. `null` (the
 * field is simply absent from the file) is the normal, permanent state for
 * anyone who never uses sync — the file stays a bare array on disk and stays
 * fully editable locally forever.
 */
export interface MindMapMeta {
  id: string
  author: string
  role: UserRole
  lastModified: string
}
```

Replace the full contents of `src/persistence/serialization.ts`:

```ts
import type { Card, MindMapMeta } from '../types/card'

interface MindMapEnvelope {
  meta: MindMapMeta
  cards: Card[]
}

/**
 * A bare array (today's format) when there is no meta — so a file that has
 * never been synced never changes shape. Only a file that has been synced at
 * least once gets the `{ meta, cards }` envelope.
 */
export function serializeMindMap(meta: MindMapMeta | null, cards: Card[]): string {
  return JSON.stringify(meta === null ? cards : { meta, cards }, null, 2)
}

export function deserializeMindMap(json: string): { meta: MindMapMeta | null; cards: Card[] } {
  const parsed: unknown = JSON.parse(json)
  if (Array.isArray(parsed)) return { meta: null, cards: parsed as Card[] }
  if (parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as MindMapEnvelope).cards)) {
    const envelope = parsed as Partial<MindMapEnvelope>
    return { meta: envelope.meta ?? null, cards: envelope.cards as Card[] }
  }
  throw new Error('deserializeMindMap: expected a JSON array of cards or { meta, cards }')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test -- src/persistence/serialization.test.ts`
Expected: PASS (4 tests, all green)

- [ ] **Step 5: Write the failing tests for fileStore's meta handling**

Add to `src/persistence/fileStore.test.ts` (the file already mocks `@tauri-apps/plugin-fs` with `exists`/`readTextFile`/`writeTextFile` — extend the existing `sample` fixture area and add these `describe` blocks; the existing `loadMindMap`/`saveMindMap` describe blocks stay as they are):

```ts
import type { MindMapMeta } from '../types/card'

const meta: MindMapMeta = { id: 'abc-123', author: 'aife', role: 'prof', lastModified: '2026-01-01T00:00:00.000Z' }

describe('loadMindMapMeta', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
  })

  it('returns null for a file that does not exist', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    expect(await loadMindMapMeta('/fake/path.zmap')).toBeNull()
  })

  it('returns null for a legacy bare-array file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(sample))
    expect(await loadMindMapMeta('/fake/path.zmap')).toBeNull()
  })

  it('returns the meta of an enveloped file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ meta, cards: sample }))
    expect(await loadMindMapMeta('/fake/path.zmap')).toEqual(meta)
  })
})

describe('saveMindMap meta preservation', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
    vi.mocked(writeTextFile).mockReset()
  })

  it('keeps writing a bare array when the file has no existing meta', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    await saveMindMap('/fake/path.zmap', sample)
    expect(writeTextFile).toHaveBeenCalledWith('/fake/path.zmap', JSON.stringify(sample, null, 2))
  })

  it('preserves author/id/role and bumps lastModified when the file already has meta', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ meta, cards: sample }))
    const before = Date.now()
    await saveMindMap('/fake/path.zmap', sample)
    const [, written] = vi.mocked(writeTextFile).mock.calls[0]
    const savedMeta = JSON.parse(written as string).meta as MindMapMeta
    expect(savedMeta.id).toBe(meta.id)
    expect(savedMeta.author).toBe(meta.author)
    expect(savedMeta.role).toBe(meta.role)
    expect(new Date(savedMeta.lastModified).getTime()).toBeGreaterThanOrEqual(before)
  })
})
```

Add `loadMindMapMeta` to the existing `import { loadMindMap, saveMindMap } from './fileStore'` line at the top of the file.

- [ ] **Step 6: Run the tests to verify they fail**

Run: `bun run test -- src/persistence/fileStore.test.ts`
Expected: FAIL — `loadMindMapMeta` is not exported yet, and `saveMindMap` does not yet read/preserve meta.

- [ ] **Step 7: Rewrite fileStore.ts**

Replace the full contents of `src/persistence/fileStore.ts`:

```ts
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import type { Card, MindMapMeta } from '../types/card'
import { serializeMindMap, deserializeMindMap } from './serialization'

/**
 * Returns `null` when there is no file at `path` yet — an expected first-run
 * state, safe to answer with an empty default map and to start autosaving.
 *
 * A REJECTION means the file exists but could not be read or parsed. That is a
 * real problem: the caller must NOT start autosaving, or the debounce would
 * overwrite the user's (recoverable) chapter with an empty default. The two
 * cases are distinguished with the filesystem's own `exists()` rather than by
 * pattern-matching an error message.
 */
export async function loadMindMap(path: string): Promise<Card[] | null> {
  if (!(await exists(path))) return null
  const json = await readTextFile(path)
  return deserializeMindMap(json).cards
}

/** The sync metadata of a `.zmap`, or `null` for a file that has never been synced (or does not exist). */
export async function loadMindMapMeta(path: string): Promise<MindMapMeta | null> {
  if (!(await exists(path))) return null
  const json = await readTextFile(path)
  return deserializeMindMap(json).meta
}

/**
 * Whether a mind map file is already there. Used before writing a repaired
 * copy: the repair flow's whole promise is that nothing existing is
 * overwritten, the broken original least of all.
 */
export async function mindMapExists(path: string): Promise<boolean> {
  return exists(path)
}

/**
 * Whatever `meta` the file already had is carried over, with `lastModified`
 * bumped to now — every autosave of a synced file updates the one field the
 * sync algorithm compares, with zero changes needed at any of this
 * function's call sites (autosave, XMind import, the repair flow, …). A file
 * that has never been synced (`meta === null`) keeps writing a bare array.
 */
export async function saveMindMap(path: string, cards: Card[]): Promise<void> {
  const previousMeta = await loadMindMapMeta(path)
  const meta: MindMapMeta | null =
    previousMeta === null ? null : { ...previousMeta, lastModified: new Date().toISOString() }
  await writeTextFile(path, serializeMindMap(meta, cards))
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun run test -- src/persistence/fileStore.test.ts`
Expected: PASS (all `loadMindMap`/`saveMindMap`/`loadMindMapMeta` tests green)

- [ ] **Step 9: Write the failing test for duplicateMap**

Add to `src/persistence/fileOps.test.ts`. First extend the two `vi.mock` blocks at the top:

```ts
vi.mock('./fileStore', () => ({ mindMapExists: vi.fn(), loadMindMap: vi.fn() }))
```

(replacing the existing `vi.mock('./fileStore', () => ({ mindMapExists: vi.fn() }))` line), and add `loadMindMap` to the `import { mindMapExists } from './fileStore'` line. Then append:

```ts
import { duplicateMap } from './fileOps'
import { loadMindMap } from './fileStore'

describe('duplicateMap', () => {
  beforeEach(() => {
    vi.mocked(writeTextFile).mockReset()
    vi.mocked(exists).mockReset()
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(mindMapExists).mockReset().mockResolvedValue(false)
  })

  it('writes a new file stamped with a fresh id and the given author/role', async () => {
    const cards = [{ id: 'root', level: 1 as const, title: 'Chapitre', parentId: null, order: 0 }]
    vi.mocked(loadMindMap).mockResolvedValue(cards)
    vi.mocked(exists).mockResolvedValue(false) // no sidecar to copy

    const destPath = await duplicateMap('/cours/Chapitre 1.zmap', 'eleve1', 'eleve')

    expect(destPath).toBe('/cours/Chapitre 1 (copie).zmap')
    const [writtenPath, content] = vi.mocked(writeTextFile).mock.calls[0]
    expect(writtenPath).toBe(destPath)
    const written = JSON.parse(content as string)
    expect(written.cards).toEqual(cards)
    expect(written.meta.author).toBe('eleve1')
    expect(written.meta.role).toBe('eleve')
    expect(written.meta.id).toBeTruthy()
  })

  it('copies the asset sidecar when one exists', async () => {
    vi.mocked(loadMindMap).mockResolvedValue([])
    vi.mocked(exists).mockImplementation(async path => path === '/cours/Chapitre 1.assets')
    vi.mocked(readDir).mockResolvedValue([{ name: 'abc123.png', isDirectory: false, isFile: true, isSymlink: false }])

    await duplicateMap('/cours/Chapitre 1.zmap', 'eleve1', 'eleve')

    expect(mkdir).toHaveBeenCalledWith('/cours/Chapitre 1 (copie).assets')
    expect(copyFile).toHaveBeenCalledWith(
      '/cours/Chapitre 1.assets/abc123.png',
      '/cours/Chapitre 1 (copie).assets/abc123.png'
    )
  })

  it('throws a French error when the source file no longer exists', async () => {
    vi.mocked(loadMindMap).mockResolvedValue(null)
    await expect(duplicateMap('/cours/Gone.zmap', 'eleve1', 'eleve')).rejects.toThrow('Gone.zmap')
  })
})
```

- [ ] **Step 10: Run the tests to verify they fail**

Run: `bun run test -- src/persistence/fileOps.test.ts`
Expected: FAIL — `duplicateMap` is not exported yet.

- [ ] **Step 11: Implement duplicateMap and update createMindMapFile**

In `src/persistence/fileOps.ts`:

Change the imports at the top:

```ts
import { mkdir, remove, rename, writeTextFile, exists, readDir, copyFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { createRootCard } from '../state/cardsReducer'
import { serializeMindMap } from './serialization'
import { loadMindMap, mindMapExists } from './fileStore'
import { isMindMapPath, sanitizeFileName, withMindMapExtension, mindMapBaseName, parentDirOf, fileNameOf } from './paths'
import { sidecarDirOf } from './assets'
import type { MindMapMeta, UserRole } from '../types/card'
```

Change `createMindMapFile`'s body from `serializeCards([createRootCard('Nouveau chapitre')])` to:

```ts
export async function createMindMapFile(folderPath: string, fileName: string): Promise<string> {
  const path = await join(folderPath, withMindMapExtension(fileName))
  await writeTextFile(path, serializeMindMap(null, [createRootCard('Nouveau chapitre')]))
  return path
}
```

Add `duplicateMap` after the existing `duplicatePath` function:

```ts
/**
 * Forks a map: a full local copy, stamped as authored by `author` under a
 * fresh id, so the copy is immediately and exclusively editable by them —
 * this is the entire "Personnaliser / Faire ma copie" action.
 */
export async function duplicateMap(sourcePath: string, author: string, role: UserRole): Promise<string> {
  const cards = await loadMindMap(sourcePath)
  if (cards === null) throw new Error(`« ${fileNameOf(sourcePath)} » n’existe plus.`)

  const meta: MindMapMeta = { id: crypto.randomUUID(), author, role, lastModified: new Date().toISOString() }
  const destPath = await freeMindMapPath(parentDirOf(sourcePath), `${mindMapBaseName(sourcePath)} (copie)`)
  await writeTextFile(destPath, serializeMindMap(meta, cards))

  const sourceSidecar = sidecarDirOf(sourcePath)
  if (await exists(sourceSidecar)) await copyDirRecursive(sourceSidecar, sidecarDirOf(destPath))

  return destPath
}
```

- [ ] **Step 12: Run the tests to verify they pass**

Run: `bun run test -- src/persistence/fileOps.test.ts`
Expected: PASS (all `createMindMapFile`/`duplicateMap` tests green)

- [ ] **Step 13: Run the whole suite to catch anything relying on the old export names**

Run: `bun run test`
Expected: PASS — `serializeCards`/`deserializeCards` had exactly two callers (`fileStore.ts`, `fileOps.ts`), both updated above. `FileTreeRow.tsx`'s use of `loadMindMap`/`saveMindMap` keeps its existing signature untouched.

- [ ] **Step 14: Commit**

```bash
git add src/types/card.ts src/persistence/serialization.ts src/persistence/serialization.test.ts src/persistence/fileStore.ts src/persistence/fileStore.test.ts src/persistence/fileOps.ts src/persistence/fileOps.test.ts
git commit -m "feat(sync): add meta envelope to the mind map file format"
```

---

### Task 2: Cache local d'état de sync

**Files:**
- Create: `src/persistence/syncState.ts`
- Test: `src/persistence/syncState.test.ts`

**Interfaces:**
- Consumes: nothing beyond `@tauri-apps/plugin-fs` and `@tauri-apps/api/path`.
- Produces: `SyncStateEntry { lastSyncedModified: string; lastSyncedUpdated: string }`, `SyncState = Record<string, SyncStateEntry>`, `loadSyncState(): Promise<SyncState>`, `saveSyncState(state: SyncState): Promise<void>` — consumed by Task 4 (`syncService.ts`) and Task 7 (`useSyncStore.ts`).

- [ ] **Step 1: Write the failing test**

Create `src/persistence/syncState.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn().mockResolvedValue('/config'),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { loadSyncState, saveSyncState, type SyncState } from './syncState'

const sample: SyncState = { 'file-1': { lastSyncedModified: '2026-01-01T00:00:00.000Z', lastSyncedUpdated: '2026-01-01 00:00:00.000Z' } }

describe('loadSyncState', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
  })

  it('returns an empty object when no cache file exists yet', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    expect(await loadSyncState()).toEqual({})
  })

  it('reads and parses the cache file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(sample))
    expect(await loadSyncState()).toEqual(sample)
  })

  it('discards a corrupted cache rather than throwing — it is cheap to rebuild', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue('{ not json')
    expect(await loadSyncState()).toEqual({})
  })
})

describe('saveSyncState', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(writeTextFile).mockReset()
    vi.mocked(mkdir).mockReset()
  })

  it('creates the config dir if missing, then writes the formatted JSON', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    await saveSyncState(sample)
    expect(mkdir).toHaveBeenCalledWith('/config', { recursive: true })
    expect(writeTextFile).toHaveBeenCalledWith('/config/sync-state.json', JSON.stringify(sample, null, 2))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- src/persistence/syncState.test.ts`
Expected: FAIL — `./syncState` does not exist yet.

- [ ] **Step 3: Implement syncState.ts**

Create `src/persistence/syncState.ts`:

```ts
import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'

const STATE_FILE_NAME = 'sync-state.json'

export interface SyncStateEntry {
  lastSyncedModified: string
  lastSyncedUpdated: string
}

export type SyncState = Record<string, SyncStateEntry>

async function stateFilePath(): Promise<string> {
  return join(await appConfigDir(), STATE_FILE_NAME)
}

/**
 * Discarded rather than surfaced on corruption: like `mindMapFormatCache`,
 * this holds nothing the user authored — worst case, the next sync
 * re-compares every file instead of skipping the ones already up to date.
 */
export async function loadSyncState(): Promise<SyncState> {
  try {
    const path = await stateFilePath()
    if (!(await exists(path))) return {}
    const json = await readTextFile(path)
    return JSON.parse(json) as SyncState
  } catch {
    return {}
  }
}

export async function saveSyncState(state: SyncState): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const path = await stateFilePath()
  await writeTextFile(path, JSON.stringify(state, null, 2))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test -- src/persistence/syncState.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/persistence/syncState.ts src/persistence/syncState.test.ts
git commit -m "feat(sync): add local sync-state cache"
```

---

### Task 3: Réglages de sync & client PocketBase

**Files:**
- Create: `src/types/syncSettings.ts`
- Create: `src/persistence/syncSettings.ts`
- Test: `src/persistence/syncSettings.test.ts`
- Create: `src/persistence/pocketbaseClient.ts`
- Test: `src/persistence/pocketbaseClient.test.ts`
- Modify: `package.json` (add `pocketbase` dependency)

**Interfaces:**
- Produces: `SyncSettings { serverUrl: string; syncFolderPath: string | null }`, `DEFAULT_SYNC_SETTINGS` (`src/types/syncSettings.ts`).
- Produces: `loadSyncSettings(): Promise<SyncSettings>`, `saveSyncSettings(settings: SyncSettings): Promise<void>` (`src/persistence/syncSettings.ts`).
- Produces: `createPocketBaseClient(serverUrl: string): PocketBase` (`src/persistence/pocketbaseClient.ts`) — consumed by Task 7 (`useSyncStore.ts`).

- [ ] **Step 1: Install the PocketBase SDK**

```bash
bun add pocketbase
```

- [ ] **Step 2: Write the failing test for syncSettings**

Create `src/types/syncSettings.ts`:

```ts
export interface SyncSettings {
  serverUrl: string
  syncFolderPath: string | null
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = { serverUrl: '', syncFolderPath: null }
```

Create `src/persistence/syncSettings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn().mockResolvedValue('/config'),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { loadSyncSettings, saveSyncSettings } from './syncSettings'
import { DEFAULT_SYNC_SETTINGS } from '../types/syncSettings'

describe('loadSyncSettings', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
  })

  it('returns the defaults when no file exists yet', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    expect(await loadSyncSettings()).toEqual(DEFAULT_SYNC_SETTINGS)
  })

  it('merges a partial file onto the defaults', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ serverUrl: 'https://pi.local' }))
    expect(await loadSyncSettings()).toEqual({ serverUrl: 'https://pi.local', syncFolderPath: null })
  })
})

describe('saveSyncSettings', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(writeTextFile).mockReset()
    vi.mocked(mkdir).mockReset()
  })

  it('writes the formatted JSON, creating the config dir if needed', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const settings = { serverUrl: 'https://pi.local', syncFolderPath: '/cours' }
    await saveSyncSettings(settings)
    expect(mkdir).toHaveBeenCalledWith('/config', { recursive: true })
    expect(writeTextFile).toHaveBeenCalledWith('/config/sync-settings.json', JSON.stringify(settings, null, 2))
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun run test -- src/persistence/syncSettings.test.ts`
Expected: FAIL — `./syncSettings` does not exist yet.

- [ ] **Step 4: Implement syncSettings.ts**

Create `src/persistence/syncSettings.ts`:

```ts
import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'
import type { SyncSettings } from '../types/syncSettings'
import { DEFAULT_SYNC_SETTINGS } from '../types/syncSettings'

const SETTINGS_FILE_NAME = 'sync-settings.json'

async function settingsFilePath(): Promise<string> {
  return join(await appConfigDir(), SETTINGS_FILE_NAME)
}

export async function loadSyncSettings(): Promise<SyncSettings> {
  const path = await settingsFilePath()
  if (!(await exists(path))) return DEFAULT_SYNC_SETTINGS
  const json = await readTextFile(path)
  return { ...DEFAULT_SYNC_SETTINGS, ...(JSON.parse(json) as Partial<SyncSettings>) }
}

export async function saveSyncSettings(settings: SyncSettings): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const path = await settingsFilePath()
  await writeTextFile(path, JSON.stringify(settings, null, 2))
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run test -- src/persistence/syncSettings.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing test for the PocketBase client factory**

Create `src/persistence/pocketbaseClient.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(false),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  remove: vi.fn(),
  mkdir: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn().mockResolvedValue('/config'),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))

import { writeTextFile, exists } from '@tauri-apps/plugin-fs'
import { createPocketBaseClient } from './pocketbaseClient'

describe('createPocketBaseClient', () => {
  beforeEach(() => {
    vi.mocked(writeTextFile).mockReset()
    vi.mocked(exists).mockReset().mockResolvedValue(false)
  })

  it('creates a client pointed at the given server URL', () => {
    const pb = createPocketBaseClient('https://pi.local')
    // `buildURL` is the SDK's own documented way to read back the configured
    // base URL — an instance property name for it is not documented/stable.
    expect(pb.buildURL('/api/health')).toBe('https://pi.local/api/health')
  })

  it('persists auth changes to a file under appConfigDir', async () => {
    const pb = createPocketBaseClient('https://pi.local')
    pb.authStore.save('token-123', { id: 'u1', username: 'aife', role: 'prof' })
    // AsyncAuthStore's save is fire-and-forget internally; flush microtasks.
    await Promise.resolve()
    await Promise.resolve()
    expect(writeTextFile).toHaveBeenCalledWith('/config/sync-auth.json', expect.stringContaining('token-123'))
  })
})
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `bun run test -- src/persistence/pocketbaseClient.test.ts`
Expected: FAIL — `./pocketbaseClient` does not exist yet.

- [ ] **Step 8: Implement pocketbaseClient.ts**

Create `src/persistence/pocketbaseClient.ts`:

```ts
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
    return await readTextFile(path)
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
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `bun run test -- src/persistence/pocketbaseClient.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add package.json bun.lock src/types/syncSettings.ts src/persistence/syncSettings.ts src/persistence/syncSettings.test.ts src/persistence/pocketbaseClient.ts src/persistence/pocketbaseClient.test.ts
git commit -m "feat(sync): add sync settings persistence and PocketBase client factory"
```

---

### Task 4: Service de synchronisation — algorithme push/pull

**Files:**
- Create: `src/sync/syncService.ts`
- Test: `src/sync/syncService.test.ts`

**Interfaces:**
- Consumes: `MindMapMeta` (`src/types/card.ts`, Task 1), `SyncState`/`SyncStateEntry` (`src/persistence/syncState.ts`, Task 2), `loadMindMap`/`loadMindMapMeta` (`src/persistence/fileStore.ts`, Task 1), `scanFolder` (`src/persistence/fileTree.ts`), `readAssetBytes`/`writeAsset`/`sidecarDirOf` (`src/persistence/assets.ts`), `serializeMindMap`/`deserializeMindMap` (`src/persistence/serialization.ts`, Task 1).
- Produces: `SyncClient { mindMaps: MindMapsApi; assets: AssetsApi }`, `MindMapsApi`, `AssetsApi`, `RemoteMindMapRecord`, `RemoteAssetRecord`, `SyncResult { pushed, pulled, errors }`, `sync(params: { client: SyncClient; currentUser: string; syncFolderPath: string; state: SyncState }): Promise<SyncResult>` — consumed by Task 5 (`pocketBaseAdapter.ts` implements `SyncClient`) and Task 7 (`useSyncStore.ts` calls `sync`).

- [ ] **Step 1: Write the failing tests**

Create `src/sync/syncService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(false),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}))
vi.mock('../persistence/fileStore', () => ({ loadMindMap: vi.fn(), loadMindMapMeta: vi.fn() }))
vi.mock('../persistence/fileTree', () => ({ scanFolder: vi.fn() }))
vi.mock('../persistence/assets', () => ({
  readAssetBytes: vi.fn(),
  writeAsset: vi.fn(),
  sidecarDirOf: (path: string) => path.replace(/\.zmap$/, '.assets'),
}))

import { exists, writeTextFile, readDir } from '@tauri-apps/plugin-fs'
import { loadMindMap, loadMindMapMeta } from '../persistence/fileStore'
import { scanFolder } from '../persistence/fileTree'
import { readAssetBytes, writeAsset } from '../persistence/assets'
import { sync, type SyncClient, type RemoteMindMapRecord, type RemoteAssetRecord } from './syncService'
import type { SyncState } from '../persistence/syncState'
import type { MindMapMeta } from '../types/card'

function fakeClient(overrides: Partial<SyncClient> = {}): SyncClient {
  return {
    mindMaps: {
      getFullList: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(async data => ({ id: 'new-id', updated: '2026-01-02 00:00:00.000Z', ...data })),
      update: vi.fn().mockImplementation(async (id, data) => ({ id, file_id: 'unused', author: 'unused', updated: '2026-01-02 00:00:00.000Z', ...data })),
      ...overrides.mindMaps,
    },
    assets: {
      getFullList: vi.fn().mockResolvedValue([]),
      upload: vi.fn().mockResolvedValue(undefined),
      download: vi.fn(),
      ...overrides.assets,
    },
  }
}

const AIFE: MindMapMeta = { id: 'file-1', author: 'aife', role: 'prof', lastModified: '2026-01-01T00:00:00.000Z' }

beforeEach(() => {
  vi.mocked(exists).mockReset().mockResolvedValue(false)
  vi.mocked(writeTextFile).mockReset()
  vi.mocked(readDir).mockReset().mockResolvedValue([])
  vi.mocked(loadMindMap).mockReset()
  vi.mocked(loadMindMapMeta).mockReset()
  vi.mocked(scanFolder).mockReset()
  vi.mocked(readAssetBytes).mockReset()
  vi.mocked(writeAsset).mockReset()
})

describe('sync — push', () => {
  it('creates a remote record for a locally-authored file never synced before', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(loadMindMap).mockResolvedValue([])
    const client = fakeClient()
    const state: SyncState = {}

    const result = await sync({ client, currentUser: 'aife', syncFolderPath: '/cours', state })

    expect(client.mindMaps.create).toHaveBeenCalledWith(
      expect.objectContaining({ file_id: 'file-1', author: 'aife', path: 'a.zmap' })
    )
    expect(result.pushed).toBe(1)
    expect(state['file-1']).toEqual({ lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: '2026-01-02 00:00:00.000Z' })
  })

  it('updates the existing remote record when one already exists for that file_id', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(loadMindMap).mockResolvedValue([])
    const existing: RemoteMindMapRecord = { id: 'rec-1', file_id: 'file-1', author: 'aife', path: 'a.zmap', content: '[]', updated: '2025-01-01 00:00:00.000Z' }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([existing]) } as any })

    await sync({ client, currentUser: 'aife', syncFolderPath: '/cours', state: {} })

    expect(client.mindMaps.update).toHaveBeenCalledWith('rec-1', expect.objectContaining({ path: 'a.zmap' }))
    expect(client.mindMaps.create).not.toHaveBeenCalled()
  })

  it('skips a file already up to date in the cache', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    const client = fakeClient()
    const state: SyncState = { 'file-1': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x' } }

    const result = await sync({ client, currentUser: 'aife', syncFolderPath: '/cours', state })

    expect(client.mindMaps.create).not.toHaveBeenCalled()
    expect(client.mindMaps.update).not.toHaveBeenCalled()
    expect(result.pushed).toBe(0)
  })

  it('never pushes a file authored by someone else, or one never synced (meta: null)', async () => {
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' },
      { type: 'mindmap', name: 'b.zmap', path: '/cours/b.zmap' },
    ])
    vi.mocked(loadMindMapMeta).mockImplementation(async path =>
      path === '/cours/a.zmap' ? { ...AIFE, author: 'someone-else' } : null
    )
    const client = fakeClient()

    const result = await sync({ client, currentUser: 'aife', syncFolderPath: '/cours', state: {} })

    expect(client.mindMaps.create).not.toHaveBeenCalled()
    expect(result.pushed).toBe(0)
  })

  it('collects a per-file error without aborting the rest of the batch', async () => {
    vi.mocked(scanFolder).mockResolvedValue([
      { type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' },
      { type: 'mindmap', name: 'b.zmap', path: '/cours/b.zmap' },
    ])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(loadMindMap).mockResolvedValue([])
    const client = fakeClient({
      mindMaps: {
        getFullList: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockRejectedValueOnce(new Error('réseau coupé')).mockResolvedValue({ id: 'x', updated: 'u' }),
        update: vi.fn(),
      } as any,
    })

    const result = await sync({ client, currentUser: 'aife', syncFolderPath: '/cours', state: {} })

    expect(result.errors).toEqual([{ fileId: 'file-1', message: 'réseau coupé' }])
    expect(result.pushed).toBe(1)
  })
})

describe('sync — pull', () => {
  const record: RemoteMindMapRecord = {
    id: 'rec-2',
    file_id: 'file-2',
    author: 'prof',
    path: 'b.zmap',
    content: JSON.stringify({ meta: { id: 'file-2', author: 'prof', role: 'prof', lastModified: '2026-01-01T00:00:00.000Z' }, cards: [] }),
    updated: '2026-01-02 00:00:00.000Z',
  }

  it('writes a new local file for a record authored by someone else', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([record]) } as any })

    const result = await sync({ client, currentUser: 'eleve1', syncFolderPath: '/cours', state: {} })

    expect(writeTextFile).toHaveBeenCalledWith('/cours/b.zmap', record.content)
    expect(result.pulled).toBe(1)
  })

  it('never pulls a record authored by the current user', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    const own = { ...record, author: 'eleve1' }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([own]) } as any })

    const result = await sync({ client, currentUser: 'eleve1', syncFolderPath: '/cours', state: {} })

    expect(writeTextFile).not.toHaveBeenCalled()
    expect(result.pulled).toBe(0)
  })

  it('skips a record already up to date in the cache', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([record]) } as any })
    const state: SyncState = { 'file-2': { lastSyncedModified: 'x', lastSyncedUpdated: record.updated } }

    const result = await sync({ client, currentUser: 'eleve1', syncFolderPath: '/cours', state })

    expect(writeTextFile).not.toHaveBeenCalled()
    expect(result.pulled).toBe(0)
  })

  it('downloads only the assets referenced in the pulled content', async () => {
    const withAsset = {
      ...record,
      content: JSON.stringify({
        meta: { id: 'file-2', author: 'prof', role: 'prof', lastModified: '2026-01-01T00:00:00.000Z' },
        cards: [{ id: 'c1', level: 1, title: 'x', parentId: null, order: 0, content: [{ type: 'image', asset: 'hash1.png' }] }],
      }),
    }
    const asset: RemoteAssetRecord = { id: 'a1', hash: 'hash1', extension: 'png' }
    const download = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
    const client = fakeClient({
      mindMaps: { getFullList: vi.fn().mockResolvedValue([withAsset]) } as any,
      assets: { getFullList: vi.fn().mockResolvedValue([asset]), upload: vi.fn(), download } as any,
    })
    vi.mocked(scanFolder).mockResolvedValue([])

    await sync({ client, currentUser: 'eleve1', syncFolderPath: '/cours', state: {} })

    expect(download).toHaveBeenCalledWith(asset)
    expect(writeAsset).toHaveBeenCalledWith('/cours/b.zmap', new Uint8Array([1, 2, 3]), 'png')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- src/sync/syncService.test.ts`
Expected: FAIL — `./syncService` does not exist yet.

- [ ] **Step 3: Implement syncService.ts**

Create `src/sync/syncService.ts`:

```ts
import { exists, mkdir, readDir, writeTextFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { loadMindMap, loadMindMapMeta } from '../persistence/fileStore'
import { scanFolder } from '../persistence/fileTree'
import { readAssetBytes, writeAsset, sidecarDirOf } from '../persistence/assets'
import { serializeMindMap, deserializeMindMap } from '../persistence/serialization'
import { fileNameOf, parentDirOf, separatorOf } from '../persistence/paths'
import type { FileTreeNode } from '../types/workspace'
import type { MindMapMeta } from '../types/card'
import type { SyncState } from '../persistence/syncState'

export interface RemoteMindMapRecord {
  id: string
  file_id: string
  author: string
  path: string
  content: string
  updated: string
}

export interface RemoteAssetRecord {
  id: string
  hash: string
  extension: string
}

export interface MindMapsApi {
  getFullList(): Promise<RemoteMindMapRecord[]>
  create(data: { file_id: string; author: string; path: string; content: string }): Promise<RemoteMindMapRecord>
  update(id: string, data: { path: string; content: string }): Promise<RemoteMindMapRecord>
}

export interface AssetsApi {
  getFullList(): Promise<RemoteAssetRecord[]>
  upload(hash: string, extension: string, bytes: Uint8Array): Promise<void>
  download(record: RemoteAssetRecord): Promise<Uint8Array>
}

export interface SyncClient {
  mindMaps: MindMapsApi
  assets: AssetsApi
}

export interface SyncResult {
  pushed: number
  pulled: number
  errors: { fileId: string; message: string }[]
}

interface SyncParams {
  client: SyncClient
  currentUser: string
  syncFolderPath: string
  state: SyncState
}

function flattenMindMapPaths(nodes: FileTreeNode[]): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.type === 'mindmap') paths.push(node.path)
    else if (node.type === 'folder') paths.push(...flattenMindMapPaths(node.children))
  }
  return paths
}

function relativeTo(root: string, path: string): string {
  const separator = separatorOf(path)
  return path.startsWith(root + separator) ? path.slice(root.length + 1) : fileNameOf(path)
}

function describeSyncError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'erreur inconnue'
}

/** Every local `.assets` file the app wrote for this map — no need to parse card content, only content ever written is ever present. */
async function pushAssetsFor(client: SyncClient, mindMapPath: string, knownHashes: Set<string>): Promise<void> {
  const sidecar = sidecarDirOf(mindMapPath)
  if (!(await exists(sidecar))) return
  const entries = await readDir(sidecar)
  for (const entry of entries) {
    const dot = entry.name.lastIndexOf('.')
    if (dot <= 0) continue
    const hash = entry.name.slice(0, dot)
    const extension = entry.name.slice(dot + 1)
    if (knownHashes.has(hash)) continue
    const bytes = await readAssetBytes(mindMapPath, entry.name)
    await client.assets.upload(hash, extension, bytes)
    knownHashes.add(hash)
  }
}

/**
 * Only assets whose `<hash>.<ext>` name literally appears in the pulled
 * `content` string are downloaded — content-addressed names are unique
 * enough that a substring check is exact here, and it avoids depending on
 * the card-block schema to find image references.
 */
function referencedAssets(content: string, knownAssets: RemoteAssetRecord[]): RemoteAssetRecord[] {
  return knownAssets.filter(asset => content.includes(`${asset.hash}.${asset.extension}`))
}

async function pullAssetsFor(client: SyncClient, mindMapPath: string, assets: RemoteAssetRecord[]): Promise<void> {
  for (const asset of assets) {
    const bytes = await client.assets.download(asset)
    await writeAsset(mindMapPath, bytes, asset.extension)
  }
}

async function ensureLocalFolder(path: string): Promise<void> {
  const dir = parentDirOf(path)
  if (dir && !(await exists(dir))) await mkdir(dir, { recursive: true })
}

/**
 * Push then pull, one `.zmap` at a time. The fork model guarantees a given
 * file is writable server-side by exactly one author, so nothing here
 * resolves a conflict — the newer side (by `meta.lastModified` for a push,
 * by the server's `updated` for a pull) simply wins, and a per-file failure
 * is collected without aborting the rest of the batch.
 */
export async function sync({ client, currentUser, syncFolderPath, state }: SyncParams): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, errors: [] }

  const remoteRecords = await client.mindMaps.getFullList()
  const remoteAssets = await client.assets.getFullList()
  const knownHashes = new Set(remoteAssets.map(asset => asset.hash))
  const remoteByFileId = new Map(remoteRecords.map(record => [record.file_id, record]))

  const localTree = await scanFolder(syncFolderPath)
  const localPaths = flattenMindMapPaths(localTree)

  for (const path of localPaths) {
    let meta: MindMapMeta | null
    try {
      meta = await loadMindMapMeta(path)
    } catch (error) {
      result.errors.push({ fileId: path, message: describeSyncError(error) })
      continue
    }
    if (meta === null || meta.author !== currentUser) continue

    const known = state[meta.id]
    if (known && known.lastSyncedModified >= meta.lastModified) continue

    try {
      const cards = await loadMindMap(path)
      if (cards === null) continue
      const content = serializeMindMap(meta, cards)
      const relPath = relativeTo(syncFolderPath, path)
      const existing = remoteByFileId.get(meta.id)
      const savedRecord = existing
        ? await client.mindMaps.update(existing.id, { content, path: relPath })
        : await client.mindMaps.create({ file_id: meta.id, author: meta.author, path: relPath, content })
      await pushAssetsFor(client, path, knownHashes)
      state[meta.id] = { lastSyncedModified: meta.lastModified, lastSyncedUpdated: savedRecord.updated }
      result.pushed += 1
    } catch (error) {
      result.errors.push({ fileId: meta.id, message: describeSyncError(error) })
    }
  }

  for (const record of remoteRecords) {
    if (record.author === currentUser) continue
    const known = state[record.file_id]
    if (known && known.lastSyncedUpdated >= record.updated) continue

    try {
      const { meta, cards } = deserializeMindMap(record.content)
      const localPath = await join(syncFolderPath, record.path)
      await ensureLocalFolder(localPath)
      await writeTextFile(localPath, record.content)
      await pullAssetsFor(client, localPath, referencedAssets(record.content, remoteAssets))
      state[record.file_id] = { lastSyncedModified: meta?.lastModified ?? record.updated, lastSyncedUpdated: record.updated }
      result.pulled += 1
      void cards // validated by deserializeMindMap succeeding; the written file is the record's own content verbatim
    } catch (error) {
      result.errors.push({ fileId: record.file_id, message: describeSyncError(error) })
    }
  }

  return result
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test -- src/sync/syncService.test.ts`
Expected: PASS (all push/pull tests green)

- [ ] **Step 5: Commit**

```bash
git add src/sync/syncService.ts src/sync/syncService.test.ts
git commit -m "feat(sync): add the push/pull sync algorithm"
```

---

### Task 5: Adaptateur PocketBase réel

**Files:**
- Create: `src/sync/pocketBaseAdapter.ts`
- Test: `src/sync/pocketBaseAdapter.test.ts`

**Interfaces:**
- Consumes: `SyncClient`, `MindMapsApi`, `AssetsApi`, `RemoteMindMapRecord`, `RemoteAssetRecord` (`src/sync/syncService.ts`, Task 4).
- Produces: `createSyncClient(pb: PocketBase): SyncClient` — consumed by Task 7 (`useSyncStore.ts`).

- [ ] **Step 1: Write the failing test**

Create `src/sync/pocketBaseAdapter.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createSyncClient } from './pocketBaseAdapter'
import type PocketBase from 'pocketbase'

function fakePb(overrides: Record<string, any> = {}): PocketBase {
  const mindMaps = { getFullList: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), getOne: vi.fn() }
  const assets = { getFullList: vi.fn().mockResolvedValue([]), create: vi.fn(), getOne: vi.fn() }
  const collections: Record<string, unknown> = { cartes_mentales: mindMaps, assets, ...overrides }
  return {
    collection: (name: string) => collections[name],
    files: { getURL: vi.fn().mockReturnValue('https://pi.local/file.png') },
  } as unknown as PocketBase
}

describe('createSyncClient — mindMaps', () => {
  it('maps getFullList records to RemoteMindMapRecord', async () => {
    const raw = { id: 'r1', file_id: 'f1', author: 'aife', path: 'a.zmap', content: '[]', updated: 'u' }
    const pb = fakePb()
    vi.mocked(pb.collection('cartes_mentales').getFullList).mockResolvedValue([raw])

    const client = createSyncClient(pb)
    expect(await client.mindMaps.getFullList()).toEqual([raw])
  })

  it('create() calls the PocketBase collection create()', async () => {
    const pb = fakePb()
    const created = { id: 'r2', file_id: 'f2', author: 'aife', path: 'b.zmap', content: '[]', updated: 'u' }
    vi.mocked(pb.collection('cartes_mentales').create).mockResolvedValue(created)

    const client = createSyncClient(pb)
    const result = await client.mindMaps.create({ file_id: 'f2', author: 'aife', path: 'b.zmap', content: '[]' })

    expect(pb.collection('cartes_mentales').create).toHaveBeenCalledWith({
      file_id: 'f2',
      author: 'aife',
      path: 'b.zmap',
      content: '[]',
    })
    expect(result).toEqual(created)
  })
})

describe('createSyncClient — assets', () => {
  it('upload() sends a FormData with hash, extension and the file blob', async () => {
    const pb = fakePb()
    const client = createSyncClient(pb)

    await client.assets.upload('hash1', 'png', new Uint8Array([1, 2, 3]))

    expect(pb.collection('assets').create).toHaveBeenCalledWith(expect.any(FormData))
    const form = vi.mocked(pb.collection('assets').create).mock.calls[0][0] as FormData
    expect(form.get('hash')).toBe('hash1')
    expect(form.get('extension')).toBe('png')
  })

  it('download() fetches the file URL and returns its bytes', async () => {
    const pb = fakePb()
    vi.mocked(pb.collection('assets').getOne).mockResolvedValue({ id: 'a1', hash: 'hash1', extension: 'png', file: 'hash1.png' })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([9, 9]).buffer })

    const client = createSyncClient(pb)
    const bytes = await client.assets.download({ id: 'a1', hash: 'hash1', extension: 'png' })

    expect(pb.files.getURL).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), 'hash1.png')
    expect(bytes).toEqual(new Uint8Array([9, 9]))
  })

  it('download() throws a French error when the fetch response is not ok', async () => {
    const pb = fakePb()
    vi.mocked(pb.collection('assets').getOne).mockResolvedValue({ id: 'a1', hash: 'hash1', extension: 'png', file: 'hash1.png' })
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    const client = createSyncClient(pb)
    await expect(client.assets.download({ id: 'a1', hash: 'hash1', extension: 'png' })).rejects.toThrow('404')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- src/sync/pocketBaseAdapter.test.ts`
Expected: FAIL — `./pocketBaseAdapter` does not exist yet.

- [ ] **Step 3: Implement pocketBaseAdapter.ts**

Create `src/sync/pocketBaseAdapter.ts`:

```ts
import type PocketBase from 'pocketbase'
import type { AssetsApi, MindMapsApi, RemoteAssetRecord, RemoteMindMapRecord, SyncClient } from './syncService'

interface RawAssetRecord {
  id: string
  hash: string
  extension: string
  file: string
}

/** Adapts a real `pocketbase` client to the narrow `SyncClient` interface `syncService.sync()` depends on. */
export function createSyncClient(pb: PocketBase): SyncClient {
  const mindMapsCollection = pb.collection('cartes_mentales')
  const assetsCollection = pb.collection('assets')

  const mindMaps: MindMapsApi = {
    getFullList: () => mindMapsCollection.getFullList<RemoteMindMapRecord>(),
    create: data => mindMapsCollection.create<RemoteMindMapRecord>(data),
    update: (id, data) => mindMapsCollection.update<RemoteMindMapRecord>(id, data),
  }

  const assets: AssetsApi = {
    getFullList: () => assetsCollection.getFullList<RemoteAssetRecord>(),
    upload: async (hash, extension, bytes) => {
      const form = new FormData()
      form.append('hash', hash)
      form.append('extension', extension)
      form.append('file', new Blob([bytes]), `${hash}.${extension}`)
      await assetsCollection.create(form)
    },
    download: async record => {
      const raw = await assetsCollection.getOne<RawAssetRecord>(record.id)
      const url = pb.files.getURL(raw, raw.file)
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Téléchargement de l’image échoué (${response.status})`)
      return new Uint8Array(await response.arrayBuffer())
    },
  }

  return { mindMaps, assets }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test -- src/sync/pocketBaseAdapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sync/pocketBaseAdapter.ts src/sync/pocketBaseAdapter.test.ts
git commit -m "feat(sync): add the real PocketBase adapter"
```

---

### Task 6: Collection PocketBase `users` — champ `role` (référence pour l'infra)

This task is documentation-only preparation folded into Task 11 (Infra) — no code. Skipped as a standalone task; see Task 11.

---

### Task 7: Store de session sync (`useSyncStore`)

**Files:**
- Create: `src/state/useSyncStore.ts`
- Test: `src/state/useSyncStore.test.ts`

**Interfaces:**
- Consumes: `UserRole` (`src/types/card.ts`, Task 1), `SyncSettings`/`DEFAULT_SYNC_SETTINGS` (`src/types/syncSettings.ts`, Task 3), `loadSyncSettings`/`saveSyncSettings` (Task 3), `loadSyncState`/`saveSyncState` (Task 2), `createPocketBaseClient` (Task 3), `createSyncClient` (Task 5), `sync`/`SyncResult` (Task 4).
- Produces: `SyncUser { username: string; role: UserRole }`, `createSyncStore(): SyncStore`, `useSyncStore` — consumed by Task 8 (UI panel), Task 9 (sidebar lock), Task 10 (canvas overlay).

- [ ] **Step 1: Write the failing tests**

Create `src/state/useSyncStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../persistence/syncSettings', () => ({ loadSyncSettings: vi.fn(), saveSyncSettings: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../persistence/syncState', () => ({ loadSyncState: vi.fn(), saveSyncState: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../persistence/pocketbaseClient', () => ({ createPocketBaseClient: vi.fn() }))
vi.mock('../sync/pocketBaseAdapter', () => ({ createSyncClient: vi.fn().mockReturnValue({}) }))
vi.mock('../sync/syncService', () => ({ sync: vi.fn() }))

import { loadSyncSettings, saveSyncSettings } from '../persistence/syncSettings'
import { loadSyncState, saveSyncState } from '../persistence/syncState'
import { createPocketBaseClient } from '../persistence/pocketbaseClient'
import { sync } from '../sync/syncService'
import { createSyncStore, type SyncStore } from './useSyncStore'

function fakePocketBase(authWithPassword: ReturnType<typeof vi.fn>) {
  let record: { username: string; role: string } | null = null
  return {
    collection: () => ({
      authWithPassword: async (username: string, password: string) => {
        const result = await authWithPassword(username, password)
        record = result.record
        return result
      },
    }),
    authStore: {
      get record() {
        return record
      },
      get isValid() {
        return record !== null
      },
      clear: () => {
        record = null
      },
    },
  }
}

describe('useSyncStore', () => {
  let store: SyncStore

  beforeEach(() => {
    vi.mocked(loadSyncSettings).mockReset().mockResolvedValue({ serverUrl: '', syncFolderPath: null })
    vi.mocked(saveSyncSettings).mockReset().mockResolvedValue(undefined)
    vi.mocked(loadSyncState).mockReset().mockResolvedValue({})
    vi.mocked(saveSyncState).mockReset().mockResolvedValue(undefined)
    vi.mocked(createPocketBaseClient).mockReset()
    vi.mocked(sync).mockReset()
    store = createSyncStore()
  })

  it('init() loads persisted settings', async () => {
    vi.mocked(loadSyncSettings).mockResolvedValue({ serverUrl: 'https://pi.local', syncFolderPath: '/cours' })
    await store.getState().init()
    expect(store.getState().serverUrl).toBe('https://pi.local')
    expect(store.getState().syncFolderPath).toBe('/cours')
  })

  it('login() sets currentUser on success', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    await store.getState().setServerUrl('https://pi.local')

    await store.getState().login('aife', 'secret')

    expect(store.getState().currentUser).toEqual({ username: 'aife', role: 'prof' })
    expect(store.getState().status).toBe('idle')
  })

  it('login() sets a French error and no user on failure', async () => {
    const authWithPassword = vi.fn().mockRejectedValue(new Error('mot de passe invalide'))
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    await store.getState().setServerUrl('https://pi.local')

    await store.getState().login('aife', 'wrong')

    expect(store.getState().currentUser).toBeNull()
    expect(store.getState().error).toBe('mot de passe invalide')
  })

  it('logout() clears currentUser', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().login('aife', 'secret')

    store.getState().logout()

    expect(store.getState().currentUser).toBeNull()
  })

  it('syncNow() refuses without a folder or a logged-in user, with a French message', async () => {
    await store.getState().syncNow()
    expect(store.getState().error).toContain('Connectez-vous')
    expect(sync).not.toHaveBeenCalled()
  })

  it('syncNow() runs the sync algorithm and stores the result', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    vi.mocked(sync).mockResolvedValue({ pushed: 2, pulled: 1, errors: [] })
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().setSyncFolderPath('/cours')
    await store.getState().login('aife', 'secret')

    await store.getState().syncNow()

    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({ currentUser: 'aife', syncFolderPath: '/cours' })
    )
    expect(store.getState().lastResult).toEqual({ pushed: 2, pulled: 1, errors: [] })
    expect(saveSyncState).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- src/state/useSyncStore.test.ts`
Expected: FAIL — `./useSyncStore` does not exist yet.

- [ ] **Step 3: Implement useSyncStore.ts**

Create `src/state/useSyncStore.ts`:

```ts
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type PocketBase from 'pocketbase'
import type { UserRole } from '../types/card'
import { DEFAULT_SYNC_SETTINGS } from '../types/syncSettings'
import { loadSyncSettings, saveSyncSettings } from '../persistence/syncSettings'
import { loadSyncState, saveSyncState } from '../persistence/syncState'
import { createPocketBaseClient } from '../persistence/pocketbaseClient'
import { createSyncClient } from '../sync/pocketBaseAdapter'
import { sync, type SyncResult } from '../sync/syncService'

export interface SyncUser {
  username: string
  role: UserRole
}

interface SyncStoreState {
  serverUrl: string
  syncFolderPath: string | null
  currentUser: SyncUser | null
  status: 'idle' | 'connecting' | 'syncing'
  error: string | null
  lastResult: SyncResult | null
  init: () => Promise<void>
  setServerUrl: (url: string) => Promise<void>
  setSyncFolderPath: (path: string | null) => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  syncNow: () => Promise<void>
}

export type SyncStore = UseBoundStore<StoreApi<SyncStoreState>>

interface RawUserRecord {
  username: string
  role: UserRole
}

function describeSyncStoreError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'erreur inconnue'
}

export function createSyncStore(): SyncStore {
  // Recreated only when the server URL actually changes — the auth session
  // is tied to one server, and switching servers must never carry a stale
  // one over. Tracked in a closure var rather than read off the client
  // instance, since the SDK does not guarantee a stable public property name
  // for it.
  let client: PocketBase | null = null
  let clientServerUrl: string | null = null

  return create<SyncStoreState>((set, get) => {
    function clientFor(serverUrl: string): PocketBase {
      if (client === null || clientServerUrl !== serverUrl) {
        client = createPocketBaseClient(serverUrl)
        clientServerUrl = serverUrl
      }
      return client
    }

    function userFromClient(pb: PocketBase): SyncUser | null {
      const record = pb.authStore.record as RawUserRecord | null
      if (record === null || !pb.authStore.isValid) return null
      return { username: record.username, role: record.role }
    }

    return {
      serverUrl: DEFAULT_SYNC_SETTINGS.serverUrl,
      syncFolderPath: DEFAULT_SYNC_SETTINGS.syncFolderPath,
      currentUser: null,
      status: 'idle',
      error: null,
      lastResult: null,

      init: async () => {
        const settings = await loadSyncSettings()
        set({ serverUrl: settings.serverUrl, syncFolderPath: settings.syncFolderPath })
        if (settings.serverUrl) set({ currentUser: userFromClient(clientFor(settings.serverUrl)) })
      },

      setServerUrl: async url => {
        set({ serverUrl: url, currentUser: null })
        await saveSyncSettings({ serverUrl: url, syncFolderPath: get().syncFolderPath })
      },

      setSyncFolderPath: async path => {
        set({ syncFolderPath: path })
        await saveSyncSettings({ serverUrl: get().serverUrl, syncFolderPath: path })
      },

      login: async (username, password) => {
        set({ status: 'connecting', error: null })
        try {
          const pb = clientFor(get().serverUrl)
          await pb.collection<RawUserRecord>('users').authWithPassword(username, password)
          set({ currentUser: userFromClient(pb), status: 'idle' })
        } catch (error) {
          set({ status: 'idle', error: describeSyncStoreError(error), currentUser: null })
        }
      },

      logout: () => {
        clientFor(get().serverUrl).authStore.clear()
        set({ currentUser: null })
      },

      syncNow: async () => {
        const { serverUrl, syncFolderPath, currentUser } = get()
        if (syncFolderPath === null || currentUser === null) {
          set({ error: 'Connectez-vous et choisissez un dossier de synchronisation avant de synchroniser.' })
          return
        }
        set({ status: 'syncing', error: null })
        try {
          const pb = clientFor(serverUrl)
          const state = await loadSyncState()
          const result = await sync({
            client: createSyncClient(pb),
            currentUser: currentUser.username,
            syncFolderPath,
            state,
          })
          await saveSyncState(state)
          set({ status: 'idle', lastResult: result })
        } catch (error) {
          set({ status: 'idle', error: describeSyncStoreError(error) })
        }
      },
    }
  })
}

export const useSyncStore = createSyncStore()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test -- src/state/useSyncStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/state/useSyncStore.ts src/state/useSyncStore.test.ts
git commit -m "feat(sync): add the sync session store"
```

---

### Task 8: UI réglages — onglet « Synchronisation »

**Files:**
- Create: `src/components/settings/SyncSettingsPanel.tsx`
- Test: `src/components/settings/SyncSettingsPanel.test.tsx`
- Modify: `src/components/settings/SettingsDialog.tsx`
- Modify: `src/components/settings/SettingsDialog.test.tsx`

**Interfaces:**
- Consumes: `useSyncStore` (`src/state/useSyncStore.ts`, Task 7), `SettingsSection` (`src/components/settings/SettingsSection.tsx`), `Button` (`src/components/ui/button.tsx`), `open` (`@tauri-apps/plugin-dialog`).
- Produces: `SyncSettingsPanel` component, rendered as the dialog's fourth tab.

- [ ] **Step 1: Write the failing test for the panel**

Create `src/components/settings/SyncSettingsPanel.test.tsx`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SyncSettingsPanel } from './SyncSettingsPanel'
import { useSyncStore } from '../../state/useSyncStore'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

function resetSyncStore() {
  useSyncStore.setState({
    serverUrl: '',
    syncFolderPath: null,
    currentUser: null,
    status: 'idle',
    error: null,
    lastResult: null,
  })
}

describe('SyncSettingsPanel', () => {
  beforeEach(() => {
    resetSyncStore()
  })

  it('shows the login form when nobody is connected', () => {
    render(<SyncSettingsPanel />)
    expect(screen.getByLabelText("Nom d'utilisateur")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /connexion/i })).toBeInTheDocument()
  })

  it('shows the connected username and role, with a logout button, once logged in', () => {
    useSyncStore.setState({ currentUser: { username: 'aife', role: 'prof' } })
    render(<SyncSettingsPanel />)
    expect(screen.getByText(/aife/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /déconnexion/i })).toBeInTheDocument()
  })

  it('calls login with the typed credentials', async () => {
    const user = userEvent.setup()
    const login = vi.fn().mockResolvedValue(undefined)
    useSyncStore.setState({ serverUrl: 'https://pi.local', login })
    render(<SyncSettingsPanel />)

    await user.type(screen.getByLabelText("Nom d'utilisateur"), 'aife')
    await user.type(screen.getByLabelText('Mot de passe'), 'secret')
    await user.click(screen.getByRole('button', { name: /connexion/i }))

    expect(login).toHaveBeenCalledWith('aife', 'secret')
  })

  it('disables Synchroniser until logged in with a folder chosen', () => {
    render(<SyncSettingsPanel />)
    expect(screen.getByRole('button', { name: /synchroniser/i })).toBeDisabled()
  })

  it('shows the last sync result summary', () => {
    useSyncStore.setState({
      currentUser: { username: 'aife', role: 'prof' },
      syncFolderPath: '/cours',
      lastResult: { pushed: 2, pulled: 1, errors: [] },
    })
    render(<SyncSettingsPanel />)
    expect(screen.getByText(/2 envoyé\(s\), 1 reçu\(s\)/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- src/components/settings/SyncSettingsPanel.test.tsx`
Expected: FAIL — `./SyncSettingsPanel` does not exist yet.

- [ ] **Step 3: Implement SyncSettingsPanel.tsx**

Create `src/components/settings/SyncSettingsPanel.tsx`:

```tsx
import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { RefreshCw, LogIn, LogOut } from 'lucide-react'
import { useSyncStore } from '../../state/useSyncStore'
import { SettingsSection } from './SettingsSection'
import { Button } from '../ui/button'

const inputStyle = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'inherit',
  fontSize: 13,
} as const

/**
 * Unlike the dialog's other tabs, nothing here goes through the draft/commit
 * flow: connecting, choosing a folder, and syncing are immediate actions with
 * real side effects (network calls), not a live preview to confirm or discard.
 */
export function SyncSettingsPanel() {
  const serverUrl = useSyncStore(s => s.serverUrl)
  const syncFolderPath = useSyncStore(s => s.syncFolderPath)
  const currentUser = useSyncStore(s => s.currentUser)
  const status = useSyncStore(s => s.status)
  const error = useSyncStore(s => s.error)
  const lastResult = useSyncStore(s => s.lastResult)
  const setServerUrl = useSyncStore(s => s.setServerUrl)
  const setSyncFolderPath = useSyncStore(s => s.setSyncFolderPath)
  const login = useSyncStore(s => s.login)
  const logout = useSyncStore(s => s.logout)
  const syncNow = useSyncStore(s => s.syncNow)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  async function pickSyncFolder() {
    const selected = await open({ directory: true })
    if (typeof selected === 'string') await setSyncFolderPath(selected)
  }

  return (
    <div>
      <SettingsSection title="Serveur" description="L’adresse de votre serveur PocketBase auto-hébergé.">
        <input
          aria-label="URL du serveur"
          value={serverUrl}
          onChange={e => void setServerUrl(e.target.value)}
          placeholder="https://cartes.mon-domaine.fr"
          style={{ ...inputStyle, width: '100%' }}
        />
      </SettingsSection>

      <SettingsSection title="Compte" description="Identifiant et mot de passe créés sur ce serveur.">
        {currentUser ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13 }}>
              Connecté en tant que <strong>{currentUser.username}</strong> (
              {currentUser.role === 'prof' ? 'prof' : 'élève'})
            </span>
            <Button variant="outline" onClick={logout}>
              <LogOut size={14} /> Déconnexion
            </Button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 280 }}>
            <label>
              <span className="sr-only">Nom d'utilisateur</span>
              <input
                aria-label="Nom d'utilisateur"
                value={username}
                onChange={e => setUsername(e.target.value)}
                style={{ ...inputStyle, width: '100%' }}
              />
            </label>
            <label>
              <span className="sr-only">Mot de passe</span>
              <input
                aria-label="Mot de passe"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ ...inputStyle, width: '100%' }}
              />
            </label>
            <Button
              onClick={() => void login(username, password)}
              disabled={status === 'connecting' || !serverUrl || !username || !password}
            >
              <LogIn size={14} /> Connexion
            </Button>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Dossier de synchronisation" description="Le dossier local dont le contenu est envoyé/reçu.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: syncFolderPath ? 'inherit' : 'var(--muted-foreground)' }}>
            {syncFolderPath ?? 'Aucun dossier choisi'}
          </span>
          <Button variant="outline" onClick={() => void pickSyncFolder()}>
            Choisir…
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title="Synchronisation">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button onClick={() => void syncNow()} disabled={status === 'syncing' || !currentUser || !syncFolderPath}>
            <RefreshCw size={14} /> {status === 'syncing' ? 'Synchronisation…' : 'Synchroniser'}
          </Button>
          {lastResult && (
            <span style={{ fontSize: 12.5, color: 'var(--muted-foreground)' }}>
              {lastResult.pushed} envoyé(s), {lastResult.pulled} reçu(s)
              {lastResult.errors.length > 0 ? `, ${lastResult.errors.length} erreur(s)` : ''}
            </span>
          )}
        </div>
        {error && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--warning-fg)', marginTop: 8 }}>
            ⚠ {error}
          </p>
        )}
      </SettingsSection>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test -- src/components/settings/SyncSettingsPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing assertions for the new tab in SettingsDialog**

In `src/components/settings/SettingsDialog.test.tsx`, change the tab-list assertion:

```ts
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      expect.stringContaining('Général'),
      expect.stringContaining('Apparence'),
      expect.stringContaining('Quiz'),
      expect.stringContaining('Synchronisation'),
    ])
```

And append a new test at the end of the `describe('SettingsDialog', ...)` block:

```ts
  it('shows the sync panel on the Synchronisation tab', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onOpenChange={() => {}} updateCheck={updateCheckStub} />)

    await user.click(screen.getByRole('tab', { name: /synchronisation/i }))

    expect(screen.getByLabelText('URL du serveur')).toBeInTheDocument()
  })
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `bun run test -- src/components/settings/SettingsDialog.test.tsx`
Expected: FAIL — no `sync` tab exists yet.

- [ ] **Step 7: Add the tab to SettingsDialog.tsx**

Change the lucide import line:

```ts
import { SlidersHorizontal, Palette, GraduationCap, RefreshCw, type LucideIcon } from 'lucide-react'
```

Add the panel import next to the others:

```ts
import { SyncSettingsPanel } from './SyncSettingsPanel'
```

Change the tab type and list:

```ts
type SettingsTab = 'general' | 'appearance' | 'quiz' | 'sync'

const TABS: { id: SettingsTab; label: string; icon: LucideIcon; hint: string }[] = [
  { id: 'general', label: 'Général', icon: SlidersHorizontal, hint: 'Thème et police' },
  { id: 'appearance', label: 'Apparence', icon: Palette, hint: 'Couleurs des niveaux' },
  { id: 'quiz', label: 'Quiz', icon: GraduationCap, hint: 'Correction et aides' },
  { id: 'sync', label: 'Synchronisation', icon: RefreshCw, hint: 'Compte et serveur' },
]
```

Add the panel render, next to the other `{tab === ... && ...}` lines:

```tsx
            {tab === 'sync' && <SyncSettingsPanel />}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun run test -- src/components/settings/SettingsDialog.test.tsx`
Expected: PASS

- [ ] **Step 9: Run the whole suite**

Run: `bun run test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/components/settings/SyncSettingsPanel.tsx src/components/settings/SyncSettingsPanel.test.tsx src/components/settings/SettingsDialog.tsx src/components/settings/SettingsDialog.test.tsx
git commit -m "feat(sync): add the Synchronisation settings tab"
```

---

### Task 9: Sidebar — cadenas sur un fichier non-auteur

**Files:**
- Create: `src/hooks/useMindMapAuthor.ts`
- Test: `src/hooks/useMindMapAuthor.test.ts`
- Modify: `src/components/sidebar/FileTreeRow.tsx`
- Modify: `src/components/sidebar/FileTreeRow.test.tsx`

**Interfaces:**
- Consumes: `loadMindMapMeta` (`src/persistence/fileStore.ts`, Task 1), `useSyncStore` (`src/state/useSyncStore.ts`, Task 7).
- Produces: `useMindMapAuthor(path: string | null): MindMapMeta | null` — consumed by `FileTreeRow.tsx` here, and available to Task 10 if needed.

- [ ] **Step 1: Write the failing test for the hook**

Create `src/hooks/useMindMapAuthor.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('../persistence/fileStore', () => ({ loadMindMapMeta: vi.fn() }))
import { loadMindMapMeta } from '../persistence/fileStore'
import { useMindMapAuthor } from './useMindMapAuthor'

describe('useMindMapAuthor', () => {
  beforeEach(() => {
    vi.mocked(loadMindMapMeta).mockReset()
  })

  it('returns null while pending and for a null path', () => {
    const { result } = renderHook(() => useMindMapAuthor(null))
    expect(result.current).toBeNull()
    expect(loadMindMapMeta).not.toHaveBeenCalled()
  })

  it('resolves to the file’s meta once loaded', async () => {
    const meta = { id: 'f1', author: 'aife', role: 'prof' as const, lastModified: 'x' }
    vi.mocked(loadMindMapMeta).mockResolvedValue(meta)
    const { result } = renderHook(() => useMindMapAuthor('/cours/a.zmap'))
    await waitFor(() => expect(result.current).toEqual(meta))
  })

  it('resolves to null on a read failure rather than throwing', async () => {
    vi.mocked(loadMindMapMeta).mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useMindMapAuthor('/cours/a.zmap'))
    await waitFor(() => expect(loadMindMapMeta).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- src/hooks/useMindMapAuthor.test.ts`
Expected: FAIL — `./useMindMapAuthor` does not exist yet.

- [ ] **Step 3: Implement useMindMapAuthor.ts**

Create `src/hooks/useMindMapAuthor.ts`:

```ts
import { useEffect, useState } from 'react'
import { loadMindMapMeta } from '../persistence/fileStore'
import type { MindMapMeta } from '../types/card'

/**
 * The map's sync metadata, `null` while pending or for a file with none —
 * same "never blocks the row's first render" shape as `useMindMapFormatValid`,
 * without its persistent cache: a `meta` header is a cheap JSON parse, unlike
 * the full `validateCards` pass that cache exists to avoid repeating.
 */
export function useMindMapAuthor(path: string | null): MindMapMeta | null {
  const [meta, setMeta] = useState<MindMapMeta | null>(null)

  useEffect(() => {
    if (path === null) {
      setMeta(null)
      return
    }
    let cancelled = false
    loadMindMapMeta(path)
      .catch(() => null)
      .then(result => {
        if (!cancelled) setMeta(result)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  return meta
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test -- src/hooks/useMindMapAuthor.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for the lock badge**

In `src/components/sidebar/FileTreeRow.test.tsx`, add to the top-of-file mocks:

```ts
vi.mock('../../hooks/useMindMapAuthor', () => ({ useMindMapAuthor: vi.fn() }))
```

and to the imports:

```ts
import { useMindMapAuthor } from '../../hooks/useMindMapAuthor'
import { useSyncStore } from '../../state/useSyncStore'
```

Reset it alongside the other hook mock in `beforeEach`:

```ts
    vi.mocked(useMindMapAuthor).mockReset().mockReturnValue(null)
    useSyncStore.setState({ currentUser: null })
```

Append a new `describe` block:

```ts
describe('FileTreeRow — verrouillage non-auteur', () => {
  beforeEach(() => {
    resetWorkspaceStore()
    vi.mocked(useMindMapFormatValid).mockReturnValue(true)
  })

  const node: FileTreeNode = { type: 'mindmap', name: 'Chapitre 1.zmap', path: '/cours/Chapitre 1.zmap' }

  it('shows no lock when the file has no meta', () => {
    vi.mocked(useMindMapAuthor).mockReturnValue(null)
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)
    expect(screen.queryByLabelText(/lecture seule/)).not.toBeInTheDocument()
  })

  it('shows no lock when the current user is the author', () => {
    useSyncStore.setState({ currentUser: { username: 'aife', role: 'prof' } })
    vi.mocked(useMindMapAuthor).mockReturnValue({ id: 'f1', author: 'aife', role: 'prof', lastModified: 'x' })
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)
    expect(screen.queryByLabelText(/lecture seule/)).not.toBeInTheDocument()
  })

  it('shows a lock when the file is authored by someone else', () => {
    useSyncStore.setState({ currentUser: { username: 'eleve1', role: 'eleve' } })
    vi.mocked(useMindMapAuthor).mockReturnValue({ id: 'f1', author: 'aife', role: 'prof', lastModified: 'x' })
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)
    expect(screen.getByLabelText(/aife.*lecture seule/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `bun run test -- src/components/sidebar/FileTreeRow.test.tsx`
Expected: FAIL — no lock badge is rendered yet.

- [ ] **Step 7: Add the lock badge to FileTreeRow.tsx**

Add to the imports at the top:

```ts
import { Folder, FolderOpen, FolderPlus, FileJson, FilePlus, File, ChevronRight, ChevronDown, Pencil, Trash2, X, Download, FileUp, Copy, Lock } from 'lucide-react'
import { useMindMapAuthor } from '../../hooks/useMindMapAuthor'
import { useSyncStore } from '../../state/useSyncStore'
```

Inside the component body, alongside the other hook calls near the top:

```ts
  const currentUser = useSyncStore(s => s.currentUser)
  const meta = useMindMapAuthor(node.type === 'mindmap' ? node.path : null)
  const isLocked = meta !== null && meta.author !== currentUser?.username
```

In the `mindmap` branch, change the button's `style.background` from:

```ts
                    background: isActive ? 'var(--muted)' : 'transparent',
```

to:

```ts
                    background: isLocked
                      ? 'color-mix(in oklch, var(--primary), transparent 92%)'
                      : isActive
                        ? 'var(--muted)'
                        : 'transparent',
```

And change the icon block from:

```tsx
                  {formatValid ? (
                    <img src="/favicon.svg" width={16} height={16} alt="" />
                  ) : (
                    <FileJson size={16} />
                  )}
```

to:

```tsx
                  {isLocked ? (
                    <Lock size={16} aria-label={`Fichier de ${meta?.author}, lecture seule`} />
                  ) : formatValid ? (
                    <img src="/favicon.svg" width={16} height={16} alt="" />
                  ) : (
                    <FileJson size={16} />
                  )}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun run test -- src/components/sidebar/FileTreeRow.test.tsx`
Expected: PASS (all rows tests, including the new ones, green)

- [ ] **Step 9: Run the whole suite**

Run: `bun run test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/hooks/useMindMapAuthor.ts src/hooks/useMindMapAuthor.test.ts src/components/sidebar/FileTreeRow.tsx src/components/sidebar/FileTreeRow.test.tsx
git commit -m "feat(sync): lock badge for non-authored files in the sidebar"
```

---

### Task 10: Canevas en lecture seule & « Personnaliser / Faire ma copie »

**Files:**
- Create: `src/components/ReadOnlyMapOverlay.tsx`
- Test: `src/components/ReadOnlyMapOverlay.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `duplicateMap` (`src/persistence/fileOps.ts`, Task 1), `loadMindMapMeta` (`src/persistence/fileStore.ts`, Task 1), `useSyncStore` (`src/state/useSyncStore.ts`, Task 7).
- Produces: `ReadOnlyMapOverlay` component.

- [ ] **Step 1: Write the failing test for the overlay**

Create `src/components/ReadOnlyMapOverlay.test.tsx`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReadOnlyMapOverlay } from './ReadOnlyMapOverlay'

describe('ReadOnlyMapOverlay', () => {
  it('shows the author and a Personnaliser button when onDuplicate is provided', () => {
    render(<ReadOnlyMapOverlay author="aife" onDuplicate={vi.fn()} />)
    expect(screen.getByText(/Fichier de aife — lecture seule/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /personnaliser/i })).toBeInTheDocument()
  })

  it('shows a login hint instead of the button when onDuplicate is null', () => {
    render(<ReadOnlyMapOverlay author="aife" onDuplicate={null} />)
    expect(screen.queryByRole('button', { name: /personnaliser/i })).not.toBeInTheDocument()
    expect(screen.getByText(/connectez-vous/i)).toBeInTheDocument()
  })

  it('calls onDuplicate on click and shows an error if it rejects', async () => {
    const user = userEvent.setup()
    const onDuplicate = vi.fn().mockRejectedValue(new Error('disque plein'))
    render(<ReadOnlyMapOverlay author="aife" onDuplicate={onDuplicate} />)

    await user.click(screen.getByRole('button', { name: /personnaliser/i }))

    expect(onDuplicate).toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('disque plein')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- src/components/ReadOnlyMapOverlay.test.tsx`
Expected: FAIL — `./ReadOnlyMapOverlay` does not exist yet.

- [ ] **Step 3: Implement ReadOnlyMapOverlay.tsx**

Create `src/components/ReadOnlyMapOverlay.tsx`:

```tsx
import { useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from './ui/button'

interface ReadOnlyMapOverlayProps {
  author: string
  /** `null` when nobody is logged in — there is no identity to duplicate the map as. */
  onDuplicate: (() => Promise<void>) | null
}

/**
 * Sits on top of the canvas, the same technique as `App.tsx`'s drag-and-drop
 * overlay: blocking every pointer interaction with the map underneath is
 * what makes it "read-only" — nothing inside `MindMapCanvas` needs to know
 * about ownership.
 */
export function ReadOnlyMapOverlay({ author, onDuplicate }: ReadOnlyMapOverlayProps) {
  const [duplicating, setDuplicating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDuplicate() {
    if (!onDuplicate) return
    setDuplicating(true)
    setError(null)
    try {
      await onDuplicate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La copie a échoué.')
    } finally {
      setDuplicating(false)
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 8,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background: 'color-mix(in oklch, var(--background), transparent 15%)',
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--card)',
          fontSize: 14,
        }}
      >
        <Lock size={16} aria-hidden />
        <span>Fichier de {author} — lecture seule</span>
      </div>
      {onDuplicate ? (
        <Button onClick={() => void handleDuplicate()} disabled={duplicating}>
          {duplicating ? 'Copie en cours…' : 'Personnaliser / Faire ma copie'}
        </Button>
      ) : (
        <span style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
          Connectez-vous dans les réglages pour personnaliser cette carte.
        </span>
      )}
      {error && (
        <span role="alert" style={{ fontSize: 13, color: 'var(--warning-fg)' }}>
          ⚠ {error}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test -- src/components/ReadOnlyMapOverlay.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing tests for App.tsx wiring**

`src/App.test.tsx`'s top import is `import { render, screen, act } from '@testing-library/react'` — it does not import `waitFor` yet (grepped: zero existing uses). Change it to:

```ts
import { render, screen, act, waitFor } from '@testing-library/react'
```

Add to the mock block near the top of `src/App.test.tsx` — extend the existing `vi.mock('./persistence/fileStore', () => ({ loadMindMap: vi.fn(), saveMindMap: vi.fn() }))` to:

```ts
vi.mock('./persistence/fileStore', () => ({ loadMindMap: vi.fn(), saveMindMap: vi.fn(), mindMapExists: vi.fn(), loadMindMapMeta: vi.fn() }))
vi.mock('./persistence/fileOps', () => ({ duplicateMap: vi.fn() }))
```

and add `loadMindMapMeta` to the existing `import { loadMindMap, saveMindMap, mindMapExists } from './persistence/fileStore'` line, plus a new `import { duplicateMap } from './persistence/fileOps'` and `import { useSyncStore } from './state/useSyncStore'`.

Append a new `describe` block at the end of the file:

```ts
describe('App — verrouillage lecture seule', () => {
  const PATH = '/cours/chapitre-a.zmap'
  const cardsA: Card[] = [{ id: 'root', level: 1, title: 'Chapitre A', parentId: null, order: 0 }]
  const metaFromSomeoneElse = { id: 'f1', author: 'aife', role: 'prof' as const, lastModified: 'x' }

  beforeEach(() => {
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(loadMindMapMeta).mockReset()
    vi.mocked(saveMindMap).mockReset().mockResolvedValue(undefined)
    vi.mocked(duplicateMap).mockReset()
    useSyncStore.setState({ currentUser: { username: 'eleve1', role: 'eleve' } })
  })

  it('shows the read-only overlay when the open file is authored by someone else', async () => {
    vi.mocked(loadMindMap).mockResolvedValue(cardsA)
    vi.mocked(loadMindMapMeta).mockResolvedValue(metaFromSomeoneElse)
    render(<App />)
    useWorkspaceStore.getState().setCurrentFile(PATH)

    expect(await screen.findByText(/Fichier de aife — lecture seule/)).toBeInTheDocument()
  })

  it('shows no overlay for a file with no meta, or authored by the current user', async () => {
    vi.mocked(loadMindMap).mockResolvedValue(cardsA)
    vi.mocked(loadMindMapMeta).mockResolvedValue(null)
    render(<App />)
    useWorkspaceStore.getState().setCurrentFile(PATH)

    await waitFor(() => expect(loadMindMap).toHaveBeenCalled())
    expect(screen.queryByText(/lecture seule/)).not.toBeInTheDocument()
  })

  it('Personnaliser duplicates the map and opens the copy', async () => {
    const user = userEvent.setup()
    vi.mocked(loadMindMap).mockResolvedValue(cardsA)
    vi.mocked(loadMindMapMeta).mockResolvedValue(metaFromSomeoneElse)
    vi.mocked(duplicateMap).mockResolvedValue('/cours/chapitre-a (copie).zmap')
    render(<App />)
    useWorkspaceStore.getState().setCurrentFile(PATH)
    await screen.findByText(/lecture seule/)

    await user.click(screen.getByRole('button', { name: /personnaliser/i }))

    expect(duplicateMap).toHaveBeenCalledWith(PATH, 'eleve1', 'eleve')
    await waitFor(() => expect(useWorkspaceStore.getState().currentFilePath).toBe('/cours/chapitre-a (copie).zmap'))
  })
})
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `bun run test -- src/App.test.tsx`
Expected: FAIL — `App.tsx` does not load meta or render an overlay yet.

- [ ] **Step 7: Wire meta loading and the overlay into App.tsx**

Update the imports:

```ts
import { loadMindMap, saveMindMap, mindMapExists, loadMindMapMeta } from './persistence/fileStore'
import { duplicateMap } from './persistence/fileOps'
import { useSyncStore } from './state/useSyncStore'
import { ReadOnlyMapOverlay } from './components/ReadOnlyMapOverlay'
import type { Card, MindMapMeta } from './types/card'
```

Add state next to `loadedPath`:

```ts
  const [loadedMeta, setLoadedMeta] = useState<MindMapMeta | null>(null)
  const currentUser = useSyncStore(s => s.currentUser)
```

In the load effect, change the `!currentFilePath` early return to also clear meta:

```ts
    if (!currentFilePath) {
      setLoadedPath(null)
      setLoadedMeta(null)
      return
    }
```

Change the load call from:

```ts
    loadMindMap(currentFilePath)
      .then(result => {
        if (cancelled) return
        if (result === null) {
          failSwitch(`Impossible d’ouvrir ${attemptedName} : ce fichier n’existe plus.`)
          return
        }
        const report = validateCards(result)
        if (!report.valid) {
          setRepairError(null)
          setPendingRepair({ path: currentFilePath, fileName: attemptedName, cards: result, issues: report.issues })
          failSwitch(null)
          return
        }
        loadCards(result)
        setLoadedPath(currentFilePath)
      })
```

to:

```ts
    Promise.all([loadMindMap(currentFilePath), loadMindMapMeta(currentFilePath)])
      .then(([result, meta]) => {
        if (cancelled) return
        if (result === null) {
          failSwitch(`Impossible d’ouvrir ${attemptedName} : ce fichier n’existe plus.`)
          return
        }
        const report = validateCards(result)
        if (!report.valid) {
          setRepairError(null)
          setPendingRepair({ path: currentFilePath, fileName: attemptedName, cards: result, issues: report.issues })
          failSwitch(null)
          return
        }
        loadCards(result)
        setLoadedMeta(meta)
        setLoadedPath(currentFilePath)
      })
```

In `handleDropImageOnCard`, guard against dropping onto a locked file — add right after the existing `if (mapPath === null) return` line:

```ts
      const meta = await loadMindMapMeta(mapPath).catch(() => null)
      if (meta !== null && meta.author !== useSyncStore.getState().currentUser?.username) return
```

Compute `isReadOnly` next to `currentFileName`:

```ts
  const isReadOnly = loadedMeta !== null && loadedMeta.author !== currentUser?.username
```

Finally, render the overlay inside `<main>`, right after the `loadedPath ? (...) : ...` block and before `<QuizSummaryModal />`:

```tsx
          {isReadOnly && loadedPath && loadedMeta && (
            <ReadOnlyMapOverlay
              author={loadedMeta.author}
              onDuplicate={
                currentUser === null
                  ? null
                  : async () => {
                      const newPath = await duplicateMap(loadedPath, currentUser.username, currentUser.role)
                      await refreshFolder(parentDirOf(loadedPath))
                      setCurrentFile(newPath)
                    }
              }
            />
          )}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun run test -- src/App.test.tsx`
Expected: PASS (all existing App tests remain green, plus the three new ones)

- [ ] **Step 9: Run the whole suite**

Run: `bun run test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/components/ReadOnlyMapOverlay.tsx src/components/ReadOnlyMapOverlay.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat(sync): read-only canvas overlay with Personnaliser action"
```

---

### Task 11: Infra PocketBase (Docker + doc)

**Files:**
- Create: `infra/docker-compose.yml`
- Create: `infra/README_INFRA.md`

No test cycle — these are deployment artifacts, not application code.

- [ ] **Step 1: Write docker-compose.yml**

Create `infra/docker-compose.yml`:

```yaml
services:
  pocketbase:
    image: ghcr.io/muchobien/pocketbase:latest
    restart: unless-stopped
    ports:
      - "8090:8090"
    volumes:
      - pb_data:/pb_data
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8090/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  pb_data:
```

- [ ] **Step 2: Write README_INFRA.md**

Create `infra/README_INFRA.md`:

```markdown
# Déployer PocketBase pour la synchronisation

Une seule image, ARM64 compatible (Raspberry Pi), SQLite embarqué — pas de
base de données séparée.

## 1. Déploiement (Dokploy)

Dans Dokploy, créez une nouvelle application "Docker Compose" pointant sur
`infra/docker-compose.yml` de ce dépôt. Exposez le port `8090` derrière votre
tunnel Cloudflare existant, sur le sous-domaine de votre choix
(ex. `cartes.mon-domaine.fr`).

Au premier démarrage, PocketBase vous demande de créer le compte
administrateur via `https://cartes.mon-domaine.fr/_/`.

## 2. Collection `users` (déjà fournie par PocketBase — à ajuster)

Dans `Settings` de la collection `users` :

- Activez l'authentification par mot de passe avec l'identifiant `username`
  plutôt que l'email (`Options` → `Identity/Password` → champ d'identité :
  `username`).
- Ajoutez un champ `role` : type `select`, valeurs `eleve` / `prof`, requis.

## 3. Collection `cartes_mentales`

Créez une collection de type **Base**, nommée `cartes_mentales`, avec les
champs :

| Champ | Type | Options |
|---|---|---|
| `file_id` | Plain text | Requis, unique |
| `author` | Plain text | Requis |
| `path` | Plain text | Requis |
| `content` | Plain text | Requis (le JSON de la carte mentale) |

(`updated` existe déjà nativement sur toute collection PocketBase.)

**API Rules** (onglet "API Rules" de la collection) — copiez-collez tel quel :

- **List/Search rule**: *(laisser vide — public)*
- **View rule**: *(laisser vide — public)*
- **Create rule**: `@request.auth.id != ""`
- **Update rule**: `@request.auth.username = author`
- **Delete rule**: `@request.auth.username = author`

## 4. Collection `assets`

Créez une collection de type **Base**, nommée `assets`, avec les champs :

| Champ | Type | Options |
|---|---|---|
| `hash` | Plain text | Requis, unique |
| `extension` | Plain text | Requis |
| `file` | File | Requis, un seul fichier |

**API Rules** :

- **List/Search rule**: *(laisser vide — public)*
- **View rule**: *(laisser vide — public)*
- **Create rule**: `@request.auth.id != ""`
- **Update rule**: *(laisser sur "Superusers only" — un asset content-adressé n'est jamais modifié)*
- **Delete rule**: *(laisser sur "Superusers only" — pas de nettoyage automatisé en v1)*

## 5. Dans l'application

Dans Réglages → Synchronisation, entrez l'URL de votre serveur
(`https://cartes.mon-domaine.fr`), créez un compte élève ou prof, choisissez
le dossier local à synchroniser, puis cliquez sur « Synchroniser ».
```

- [ ] **Step 3: Commit**

```bash
git add infra/docker-compose.yml infra/README_INFRA.md
git commit -m "docs(sync): add PocketBase deployment infra and setup guide"
```

---

## Self-Review Notes

- **Spec coverage:** every spec section maps to a task — file format/migration (Task 1), sync-state cache (Task 2), PocketBase collections/backend (Task 11, with the client side in Tasks 3/5), sync algorithm (Task 4), placement of pulled files (Task 4's `relativeTo`/`join`), UI settings screen (Task 8), sidebar lock (Task 9), canvas read-only + duplicateMap (Task 1 + Task 10), error handling (per-file try/catch in Task 4, French error surfaces throughout), infra (Task 11).
- **Type consistency checked:** `MindMapMeta`/`UserRole` (Task 1) are the only source of truth, reused verbatim in Tasks 4, 5, 7, 9, 10. `SyncClient`/`MindMapsApi`/`AssetsApi`/`RemoteMindMapRecord`/`RemoteAssetRecord` (Task 4) are consumed unchanged by Task 5's adapter. `SyncState`/`SyncStateEntry` (Task 2) flow into Task 4's `sync()` params and Task 7's store unchanged. `SyncResult` (Task 4) is what Task 7 stores as `lastResult` and Task 8 renders — same shape throughout.
- **No placeholders:** every step above contains complete, runnable code; no task references a type or function not defined in an earlier task.
