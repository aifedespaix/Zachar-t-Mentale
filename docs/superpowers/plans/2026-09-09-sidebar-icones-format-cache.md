# Sidebar Format Icon + Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mind-map row in the sidebar shows the app favicon once its content is confirmed well-formed, falling back to the generic JSON icon otherwise — backed by a disk-persisted, debounced-write, mtime+size cache so an unchanged file is never re-read.

**Architecture:** A pure I/O module (`mindMapFormatCache.ts`) handles loading/saving a small JSON cache file under `appConfigDir()`. A React hook (`useMindMapFormatValid`) coordinates a per-file freshness check (`stat` against the cache) and, on a miss, the exact same `loadMindMap` + `validateCards` path the app's open-file flow already uses — with a module-level singleton cache and a debounced batched save shared across every row. `FileTreeRow.tsx` consumes the hook to pick an icon, never blocking its own render.

**Tech Stack:** React + TypeScript, `@tauri-apps/plugin-fs` (`stat`), Vitest + `@testing-library/react` (`renderHook`).

**Spec:** `docs/superpowers/specs/2026-09-08-sidebar-icones-format-cache-design.md`

## Global Constraints

- No new npm dependency.
- Mirror the existing settings-file persistence convention (`quizSettings.ts`) for the cache module's load/save shape, EXCEPT: a corrupted cache file must fall back to an empty cache silently (no throw) — this cache is disposable, unlike user settings.
- The favicon is served at `/favicon.svg` (already referenced the same way by `index.html`) — works in dev and build, no import needed, just a literal `src="/favicon.svg"`.
- `tsconfig.json` has `noUnusedLocals`/`noUnusedParameters: true`.
- The format-validity check must reuse `loadMindMap` (`../persistence/fileStore`) and `validateCards` (`../validation/cardsValidation`) exactly as the app's existing open-file flow (`App.tsx`) uses them — no second definition of "valid".
- `fileTree.ts` and the `FileTreeNode` type are NOT touched by this plan.

---

### Task 1: `mindMapFormatCache.ts` — persisted cache load/save/freshness

**Files:**
- Create: `src/persistence/mindMapFormatCache.ts`
- Test: `src/persistence/mindMapFormatCache.test.ts`

**Interfaces:**
- Produces: `interface MindMapFormatCacheEntry { mtimeMs: number; size: number; valid: boolean }`, `type MindMapFormatCache = Record<string, MindMapFormatCacheEntry>`, `loadMindMapFormatCache(): Promise<MindMapFormatCache>`, `saveMindMapFormatCache(cache: MindMapFormatCache): Promise<void>`, `isCacheEntryFresh(entry: MindMapFormatCacheEntry | undefined, current: { mtimeMs: number | null; size: number }): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `src/persistence/mindMapFormatCache.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadMindMapFormatCache, saveMindMapFormatCache, isCacheEntryFresh } from './mindMapFormatCache'

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

describe('loadMindMapFormatCache', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
  })

  it('returns an empty cache when no cache file exists yet', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const cache = await loadMindMapFormatCache()
    expect(cache).toEqual({})
  })

  it('reads and parses an existing cache file', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify({ '/cours/chapitre1.zmap': { mtimeMs: 1000, size: 42, valid: true } })
    )
    const cache = await loadMindMapFormatCache()
    expect(readTextFile).toHaveBeenCalledWith('/fake/config/mindmap-format-cache.json')
    expect(cache).toEqual({ '/cours/chapitre1.zmap': { mtimeMs: 1000, size: 42, valid: true } })
  })

  it('returns an empty cache instead of throwing when the cache file is corrupted', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue('{not valid json')
    const cache = await loadMindMapFormatCache()
    expect(cache).toEqual({})
  })
})

describe('saveMindMapFormatCache', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(writeTextFile).mockReset()
    vi.mocked(mkdir).mockReset()
  })

  it('creates the app config directory if missing, then writes the cache file', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    const cache = { '/cours/chapitre1.zmap': { mtimeMs: 1000, size: 42, valid: true } }
    await saveMindMapFormatCache(cache)
    expect(mkdir).toHaveBeenCalledWith('/fake/config', { recursive: true })
    expect(writeTextFile).toHaveBeenCalledWith(
      '/fake/config/mindmap-format-cache.json',
      JSON.stringify(cache, null, 2)
    )
  })

  it('does not recreate the config directory when it already exists', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    await saveMindMapFormatCache({})
    expect(mkdir).not.toHaveBeenCalled()
  })
})

describe('isCacheEntryFresh', () => {
  it('is fresh when mtime and size both match the cached entry', () => {
    const entry = { mtimeMs: 1000, size: 42, valid: true }
    expect(isCacheEntryFresh(entry, { mtimeMs: 1000, size: 42 })).toBe(true)
  })

  it('is stale when there is no cached entry', () => {
    expect(isCacheEntryFresh(undefined, { mtimeMs: 1000, size: 42 })).toBe(false)
  })

  it('is stale when the mtime differs', () => {
    const entry = { mtimeMs: 1000, size: 42, valid: true }
    expect(isCacheEntryFresh(entry, { mtimeMs: 2000, size: 42 })).toBe(false)
  })

  it('is stale when the size differs', () => {
    const entry = { mtimeMs: 1000, size: 42, valid: true }
    expect(isCacheEntryFresh(entry, { mtimeMs: 1000, size: 99 })).toBe(false)
  })

  it('is never fresh when the current mtime is null', () => {
    const entry = { mtimeMs: 1000, size: 42, valid: true }
    expect(isCacheEntryFresh(entry, { mtimeMs: null, size: 42 })).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/persistence/mindMapFormatCache.test.ts`
Expected: FAIL — `./mindMapFormatCache` module does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/persistence/mindMapFormatCache.ts`:

```ts
import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'

const CACHE_FILE_NAME = 'mindmap-format-cache.json'

export interface MindMapFormatCacheEntry {
  mtimeMs: number
  size: number
  valid: boolean
}

export type MindMapFormatCache = Record<string, MindMapFormatCacheEntry>

async function cacheFilePath(): Promise<string> {
  return join(await appConfigDir(), CACHE_FILE_NAME)
}

/**
 * A corrupted cache file is discarded rather than surfaced: unlike the
 * app's settings files, this cache holds nothing the user authored — it is
 * cheap to rebuild from scratch, so there is no reason to let a broken
 * cache file break startup.
 */
export async function loadMindMapFormatCache(): Promise<MindMapFormatCache> {
  const path = await cacheFilePath()
  if (!(await exists(path))) return {}
  try {
    const json = await readTextFile(path)
    return JSON.parse(json) as MindMapFormatCache
  } catch {
    return {}
  }
}

export async function saveMindMapFormatCache(cache: MindMapFormatCache): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const path = await cacheFilePath()
  await writeTextFile(path, JSON.stringify(cache, null, 2))
}

/**
 * Whether a cached entry still matches the file's current mtime/size. A
 * `null` current mtime (the type Tauri's `stat` allows, rarely seen in
 * practice) is never trusted enough to reuse a cached result.
 */
export function isCacheEntryFresh(
  entry: MindMapFormatCacheEntry | undefined,
  current: { mtimeMs: number | null; size: number }
): boolean {
  if (entry === undefined || current.mtimeMs === null) return false
  return entry.mtimeMs === current.mtimeMs && entry.size === current.size
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/persistence/mindMapFormatCache.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/persistence/mindMapFormatCache.ts src/persistence/mindMapFormatCache.test.ts
git commit -m "$(cat <<'EOF'
feat(persistence): add a disk-persisted mind-map format cache

Keyed by mtime+size so an unchanged file is never re-validated.
Unlike the app's settings files, a corrupted cache file is discarded
silently rather than surfaced — it holds nothing the user authored,
so there is no reason to let a broken cache break startup.
EOF
)"
```

---

### Task 2: `useMindMapFormatValid` — the coordinating hook

**Files:**
- Create: `src/hooks/useMindMapFormatValid.ts`
- Test: `src/hooks/useMindMapFormatValid.test.ts`

**Interfaces:**
- Consumes: `loadMindMapFormatCache`, `saveMindMapFormatCache`, `isCacheEntryFresh`, `type MindMapFormatCache` from `../persistence/mindMapFormatCache` (Task 1); `loadMindMap` from `../persistence/fileStore`; `validateCards` from `../validation/cardsValidation`; `stat` from `@tauri-apps/plugin-fs`.
- Produces: `useMindMapFormatValid(path: string): boolean | undefined` and a test-only `resetMindMapFormatCacheForTests(): void`.

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useMindMapFormatValid.test.ts`:

```ts
import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMindMapFormatValid, resetMindMapFormatCacheForTests } from './useMindMapFormatValid'

vi.mock('@tauri-apps/plugin-fs', () => ({ stat: vi.fn() }))
vi.mock('../persistence/fileStore', () => ({ loadMindMap: vi.fn() }))
vi.mock('../validation/cardsValidation', () => ({ validateCards: vi.fn() }))
vi.mock('../persistence/mindMapFormatCache', () => ({
  loadMindMapFormatCache: vi.fn(),
  saveMindMapFormatCache: vi.fn(),
  isCacheEntryFresh: vi.fn(),
}))

import { stat } from '@tauri-apps/plugin-fs'
import { loadMindMap } from '../persistence/fileStore'
import { validateCards } from '../validation/cardsValidation'
import { loadMindMapFormatCache, saveMindMapFormatCache, isCacheEntryFresh } from '../persistence/mindMapFormatCache'

describe('useMindMapFormatValid', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetMindMapFormatCacheForTests()
    vi.mocked(stat).mockReset()
    vi.mocked(loadMindMap).mockReset()
    vi.mocked(validateCards).mockReset()
    vi.mocked(loadMindMapFormatCache).mockReset().mockResolvedValue({})
    vi.mocked(saveMindMapFormatCache).mockReset().mockResolvedValue(undefined)
    vi.mocked(isCacheEntryFresh).mockReset().mockReturnValue(false)
  })
  afterEach(() => vi.useRealTimers())

  it('starts pending (undefined) before the check resolves', () => {
    vi.mocked(stat).mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useMindMapFormatValid('/cours/chapitre1.zmap'))
    expect(result.current).toBeUndefined()
  })

  it('resolves to true for a well-formed mind map not yet in the cache', async () => {
    vi.mocked(stat).mockResolvedValue({ mtime: new Date(1000), size: 42 } as never)
    vi.mocked(loadMindMap).mockResolvedValue([{ id: 'root', level: 1, title: 'R', parentId: null, order: 0 }])
    vi.mocked(validateCards).mockReturnValue({ valid: true, issues: [] })
    const { result } = renderHook(() => useMindMapFormatValid('/cours/chapitre1.zmap'))
    await vi.waitFor(() => expect(result.current).toBe(true))
  })

  it('resolves to false when the file fails structural validation', async () => {
    vi.mocked(stat).mockResolvedValue({ mtime: new Date(1000), size: 42 } as never)
    vi.mocked(loadMindMap).mockResolvedValue([{ id: 'a', level: 1, title: 'A', parentId: null, order: 0 }])
    vi.mocked(validateCards).mockReturnValue({ valid: false, issues: [] })
    const { result } = renderHook(() => useMindMapFormatValid('/cours/chapitre1.zmap'))
    await vi.waitFor(() => expect(result.current).toBe(false))
  })

  it('resolves to false when the file cannot even be parsed', async () => {
    vi.mocked(stat).mockResolvedValue({ mtime: new Date(1000), size: 42 } as never)
    vi.mocked(loadMindMap).mockRejectedValue(new Error('invalid JSON'))
    const { result } = renderHook(() => useMindMapFormatValid('/cours/chapitre1.zmap'))
    await vi.waitFor(() => expect(result.current).toBe(false))
    expect(validateCards).not.toHaveBeenCalled()
  })

  it('resolves to false without reading the file when stat() fails', async () => {
    vi.mocked(stat).mockRejectedValue(new Error('file vanished'))
    const { result } = renderHook(() => useMindMapFormatValid('/cours/chapitre1.zmap'))
    await vi.waitFor(() => expect(result.current).toBe(false))
    expect(loadMindMap).not.toHaveBeenCalled()
  })

  it('reuses a fresh cache entry without re-reading the file', async () => {
    vi.mocked(loadMindMapFormatCache).mockResolvedValue({
      '/cours/chapitre1.zmap': { mtimeMs: 1000, size: 42, valid: true },
    })
    vi.mocked(stat).mockResolvedValue({ mtime: new Date(1000), size: 42 } as never)
    vi.mocked(isCacheEntryFresh).mockReturnValue(true)
    const { result } = renderHook(() => useMindMapFormatValid('/cours/chapitre1.zmap'))
    await vi.waitFor(() => expect(result.current).toBe(true))
    expect(loadMindMap).not.toHaveBeenCalled()
  })

  it('does not schedule a cache save when stat reports a null mtime', async () => {
    vi.mocked(stat).mockResolvedValue({ mtime: null, size: 42 } as never)
    vi.mocked(loadMindMap).mockResolvedValue([{ id: 'root', level: 1, title: 'R', parentId: null, order: 0 }])
    vi.mocked(validateCards).mockReturnValue({ valid: true, issues: [] })
    const { result } = renderHook(() => useMindMapFormatValid('/cours/chapitre1.zmap'))
    await vi.waitFor(() => expect(result.current).toBe(true))
    expect(isCacheEntryFresh).toHaveBeenCalledWith(undefined, { mtimeMs: null, size: 42 })
    vi.advanceTimersByTime(500)
    expect(saveMindMapFormatCache).not.toHaveBeenCalled()
  })

  it('debounces the cache save across a burst of validations before writing once', async () => {
    vi.mocked(stat).mockResolvedValue({ mtime: new Date(1000), size: 42 } as never)
    vi.mocked(loadMindMap).mockResolvedValue([{ id: 'root', level: 1, title: 'R', parentId: null, order: 0 }])
    vi.mocked(validateCards).mockReturnValue({ valid: true, issues: [] })
    const { result: r1 } = renderHook(() => useMindMapFormatValid('/cours/a.zmap'))
    const { result: r2 } = renderHook(() => useMindMapFormatValid('/cours/b.zmap'))
    await vi.waitFor(() => expect(r1.current).toBe(true))
    await vi.waitFor(() => expect(r2.current).toBe(true))
    expect(saveMindMapFormatCache).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(saveMindMapFormatCache).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useMindMapFormatValid.test.ts`
Expected: FAIL — `./useMindMapFormatValid` module does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/hooks/useMindMapFormatValid.ts`:

```ts
import { useEffect, useState } from 'react'
import { stat } from '@tauri-apps/plugin-fs'
import { loadMindMap } from '../persistence/fileStore'
import { validateCards } from '../validation/cardsValidation'
import {
  loadMindMapFormatCache,
  saveMindMapFormatCache,
  isCacheEntryFresh,
  type MindMapFormatCache,
} from '../persistence/mindMapFormatCache'

const SAVE_DEBOUNCE_MS = 500

// Module-level singleton: every row's hook shares one in-memory cache and
// one debounced save, so a burst of rows validating at once (e.g. opening a
// folder with many mind maps) writes the cache file once, not once per row.
let cache: MindMapFormatCache | null = null
let cacheLoadPromise: Promise<MindMapFormatCache> | null = null
let saveTimeout: ReturnType<typeof setTimeout> | undefined

async function getCache(): Promise<MindMapFormatCache> {
  if (cache !== null) return cache
  cacheLoadPromise ??= loadMindMapFormatCache().then(loaded => {
    cache = loaded
    return loaded
  })
  return cacheLoadPromise
}

function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(() => {
    saveTimeout = undefined
    if (cache !== null) void saveMindMapFormatCache(cache)
  }, SAVE_DEBOUNCE_MS)
}

async function checkMindMapFormat(path: string): Promise<boolean> {
  const loaded = await getCache()

  let info: { mtime: Date | null; size: number }
  try {
    info = await stat(path)
  } catch {
    return false
  }
  const mtimeMs = info.mtime?.getTime() ?? null

  if (isCacheEntryFresh(loaded[path], { mtimeMs, size: info.size })) {
    return loaded[path]!.valid
  }

  let valid: boolean
  try {
    const cards = await loadMindMap(path)
    valid = cards !== null && validateCards(cards).valid
  } catch {
    valid = false
  }

  if (mtimeMs !== null) {
    loaded[path] = { mtimeMs, size: info.size, valid }
    scheduleSave()
  }
  return valid
}

/**
 * Whether `path` is a well-formed mind map — `undefined` while the check is
 * still pending, so a caller can show a neutral default and upgrade the
 * icon once this resolves, never blocking the row's first render.
 */
export function useMindMapFormatValid(path: string): boolean | undefined {
  const [valid, setValid] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setValid(undefined)
    checkMindMapFormat(path).then(result => {
      if (!cancelled) setValid(result)
    })
    return () => {
      cancelled = true
    }
  }, [path])

  return valid
}

/** Test-only: clears the shared in-memory cache and any pending debounced save. */
export function resetMindMapFormatCacheForTests(): void {
  cache = null
  cacheLoadPromise = null
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = undefined
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useMindMapFormatValid.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMindMapFormatValid.ts src/hooks/useMindMapFormatValid.test.ts
git commit -m "$(cat <<'EOF'
feat(hooks): add useMindMapFormatValid, backed by the format cache

Coordinates a per-file freshness check (stat vs. the cache) with the
exact loadMindMap + validateCards path the app's open-file flow
already uses. Returns undefined while pending so a caller never
blocks its own render waiting on this.
EOF
)"
```

---

### Task 3: Wire the icon into `FileTreeRow.tsx`

**Files:**
- Modify: `src/components/sidebar/FileTreeRow.tsx:1-27` (imports), `:389-390` (hook call), `:429` (icon)
- Modify: `src/components/sidebar/FileTreeRow.test.tsx` (add a mock block + 4 new tests)

**Interfaces:**
- Consumes: `useMindMapFormatValid(path: string): boolean | undefined` from `../../hooks/useMindMapFormatValid` (Task 2).

- [ ] **Step 1: Write the failing tests**

In `src/components/sidebar/FileTreeRow.test.tsx`, add this mock block right after the existing `vi.mock('../../xmind/importXmind', ...)` line:

```ts
vi.mock('../../hooks/useMindMapFormatValid', () => ({ useMindMapFormatValid: vi.fn() }))
```

Add `useMindMapFormatValid` to the imports right after the existing `import { readXmindFile } from '../../xmind/importXmind'` line:

```ts
import { useMindMapFormatValid } from '../../hooks/useMindMapFormatValid'
```

Add a reset for it inside the existing `beforeEach` block, alongside the other `vi.mocked(...).mockReset()` calls:

```ts
vi.mocked(useMindMapFormatValid).mockReset()
```

Then add these 4 new tests anywhere inside the `describe('FileTreeRow', ...)` block (e.g. right after the existing `'renders a mindmap file and opens it on click'` test):

```ts
it('shows the generic icon while the mind map format check has not resolved to valid', () => {
  vi.mocked(useMindMapFormatValid).mockReturnValue(undefined)
  const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
  const { container } = render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)
  expect(container.querySelector('img[src="/favicon.svg"]')).not.toBeInTheDocument()
})

it('shows the app favicon once the mind map format check resolves to valid', () => {
  vi.mocked(useMindMapFormatValid).mockReturnValue(true)
  const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
  const { container } = render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)
  expect(container.querySelector('img[src="/favicon.svg"]')).toBeInTheDocument()
})

it('keeps the generic icon when the mind map format check resolves to invalid', () => {
  vi.mocked(useMindMapFormatValid).mockReturnValue(false)
  const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
  const { container } = render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)
  expect(container.querySelector('img[src="/favicon.svg"]')).not.toBeInTheDocument()
})

it('passes the node path to the format-validity hook', () => {
  vi.mocked(useMindMapFormatValid).mockReturnValue(false)
  const node: FileTreeNode = { type: 'mindmap', name: 'chapitre1.json', path: '/cours/chapitre1.json' }
  render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)
  expect(useMindMapFormatValid).toHaveBeenCalledWith('/cours/chapitre1.json')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: FAIL on the 4 new tests — `useMindMapFormatValid` is not imported/used by `FileTreeRow.tsx` yet, and the module mock has nothing to intercept. (The pre-existing tests keep passing unaffected — none of them touch the icon.)

- [ ] **Step 3: Wire the hook and the icon**

In `src/components/sidebar/FileTreeRow.tsx`, add the import right after the existing `import { NameDialog } from './NameDialog'` line (line 26):

```ts
import { useMindMapFormatValid } from '../../hooks/useMindMapFormatValid'
```

Inside the `if (node.type === 'mindmap') {` block, add the hook call right after `const isActive = node.path === currentFilePath` (line 390):

```ts
    const isActive = node.path === currentFilePath
    const formatValid = useMindMapFormatValid(node.path)
```

Replace the icon line (currently `<FileJson size={16} />` at line 429):

```tsx
                  {formatValid ? (
                    <img src="/favicon.svg" width={16} height={16} alt="" />
                  ) : (
                    <FileJson size={16} />
                  )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: PASS, all tests (the pre-existing ones plus the 4 new ones).

Also run the full suite once, since this is the last task of the plan:

Run: `npx vitest run`
Expected: PASS, all test files.

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/FileTreeRow.tsx src/components/sidebar/FileTreeRow.test.tsx
git commit -m "$(cat <<'EOF'
feat(sidebar): show the app favicon for a well-formed mind map row

Falls back to the generic icon while the check is pending or resolves
invalid — never blocks the row's own render. The invalid case is
unchanged: opening it still goes through the existing repair flow.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** hook signature and pending/resolved states (Task 2), disk-persisted cache with mtime+size freshness and debounced batched writes (Tasks 1-2), corrupted-cache-file resilience (Task 1), icon rendering with no render-blocking (Task 3), reuse of `loadMindMap`/`validateCards` with no new validity definition (Task 2) — all covered. `fileTree.ts`/`FileTreeNode` left untouched, as required.
- **Type consistency:** `MindMapFormatCacheEntry`/`MindMapFormatCache` (Task 1) match the types imported and destructured in Task 2's `useMindMapFormatValid.ts` exactly. `useMindMapFormatValid`'s `boolean | undefined` return matches Task 3's `formatValid` usage (a truthy check in the ternary, which treats `undefined` the same as `false` — correct, since both mean "don't show the favicon yet").
- **Out of scope, confirmed correctly excluded:** the `.assets` sidecar folders showing up as ordinary folders (flagged in sub-project A's final review) is a `fileTree.ts` classification question, unrelated to content validation — not addressed here.
