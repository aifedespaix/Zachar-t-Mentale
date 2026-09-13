# Correction du contenu d'un élève par le prof, et synchronisation à la fermeture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a prof correct the content of an élève's mind map (the élève stays owner), and make sync run automatically when a file closes, without ever silently dropping a card either side added.

**Architecture:** One new permission predicate (`canEditContent`) replaces three duplicated author-only checks; two one-line changes in `syncService.ts` open the push/pull paths that predicate now allows; a small pure function (`mergeCards`) turns any local card missing from an incoming pull into a floating card instead of deleting it; a `sync()` parameter protects whatever file is open in the canvas from being pulled into mid-edit; and the existing flush-before-close hook gains a fire-and-forget sync call.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Tauri (`@tauri-apps/plugin-fs`), PocketBase SDK.

**Spec:** `docs/superpowers/specs/2026-09-13-correction-contenu-prof-eleve-design.md`

## Global Constraints

- `meta.author` never changes when a prof edits an élève's map — ownership stays with the élève (spec, "Décisions de cadrage").
- No PocketBase server rule changes — the existing Update/Delete rule already allows a prof to write any field (spec, "Ce qui existe déjà").
- The content merge is a 2-way set-difference on card IDs, never a field-level 3-way merge: a card present on both sides always takes the remote (prof's) version whole (spec, "Décisions de cadrage" and Section 2).
- No new UI banner — a merge is reported through the existing sync-result label/log, not a dedicated dialog (spec, Section 3).
- The close-triggered sync is fire-and-forget — it must never block a file switch or the window closing (spec, Section 4).

---

### Task 1: `canEditContent` permission predicate

**Files:**
- Modify: `src/sync/permissions.ts`
- Test: `src/sync/permissions.test.ts`

**Interfaces:**
- Produces: `canEditContent(meta: MindMapMeta | null, user: SyncUser): boolean`, exported from `src/sync/permissions.ts` — consumed by Tasks 2 and 3.

- [ ] **Step 1: Write failing tests**

Add to `src/sync/permissions.test.ts`, alongside the existing `canReorder`/`canClassify` blocks:

```ts
import { canClassify, canEditContent, canReorder } from './permissions'

describe('canEditContent', () => {
  it('lets anyone edit a map with no sync identity — it belongs to nobody yet', () => {
    expect(canEditContent(null, ELEVE)).toBe(true)
  })

  it('lets an author edit their own map', () => {
    expect(canEditContent(ELEVE_MAP, ELEVE)).toBe(true)
    expect(canEditContent(AIFE_MAP, AIFE)).toBe(true)
  })

  it('lets a prof correct an eleve s map — the eleve stays the author', () => {
    expect(canEditContent(ELEVE_MAP, AIFE)).toBe(true)
  })

  it('refuses an eleve the content of a map they do not own', () => {
    expect(canEditContent(AIFE_MAP, ELEVE)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sync/permissions.test.ts`
Expected: FAIL with "canEditContent is not a function" (or a TypeScript import error).

- [ ] **Step 3: Implement `canEditContent`**

In `src/sync/permissions.ts`, add below `canClassify`:

```ts
/**
 * Whether `user` may change the CONTENT of a map — its cards.
 *
 * Même règle que `canReorder`/`canClassify` (auteur ou prof), mais celle-ci
 * décide du contenu lui-même : un prof peut corriger la carte d'un élève sans
 * jamais en devenir l'auteur — `meta.author` ne change pas, l'élève reste
 * propriétaire, seul son contenu diffère après correction.
 */
export function canEditContent(meta: MindMapMeta | null, user: SyncUser): boolean {
  if (meta === null) return true
  return meta.author === user.username || user.role === 'prof'
}
```

`canReorder`'s docstring above it says "Deliberately NOT about content: a prof rearranges an eleve's chapter without ever gaining the right to edit it — that is what keeps 'l'auteur est le seul éditeur' standing." and `canClassify`'s says "un prof classe la carte d'un élève sans gagner le droit d'en écrire le contenu." Both claims are now false — update them in the same edit:

```ts
// canReorder's docstring, last paragraph — replace
 * Deliberately NOT about content: a prof rearranges an eleve's chapter without
 * ever gaining the right to edit it — that is what keeps "l'auteur est le seul
 * éditeur" standing.
// with
 * Deliberately NOT about content: rearranging is allowed even where editing
 * content is not (an eleve's OWN unrelated files stay unreorderable to a
 * classmate). Content itself now follows `canEditContent`, the same author-or-
 * prof rule — see that function.
```

```ts
// canClassify's docstring, last paragraph — replace
 * Le contenu, lui, n'est jamais concerné : un prof classe la carte d'un élève
 * sans gagner le droit d'en écrire le contenu.
// with
 * Le contenu suit désormais la même règle, mais via `canEditContent` — les
 * deux fonctions restent séparées parce qu'elles décident de choses
 * différentes (le type vit dans `meta`, un brouillon local n'en a pas).
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sync/permissions.test.ts`
Expected: PASS, all `canEditContent` and pre-existing cases green.

- [ ] **Step 5: Commit**

```bash
git add src/sync/permissions.ts src/sync/permissions.test.ts
git commit -m "feat(sync): add canEditContent — auteur ou prof peut écrire le contenu"
```

---

### Task 2: Wire `canEditContent` into the three UI lock checks

**Files:**
- Modify: `src/App.tsx:196` (`handleDropImageOnCard`), `src/App.tsx:384` (`isReadOnly`)
- Modify: `src/components/sidebar/FileTreeRow.tsx:194` (`isLocked`)
- Test: `src/components/sidebar/FileTreeRow.test.tsx`

**Interfaces:**
- Consumes: `canEditContent(meta, user)` from Task 1.

Three call sites duplicate `meta.author !== currentUser?.username` today; App.tsx has no existing test for `isReadOnly` or the drop guard (both are wired straight into a large component with no isolated harness), so this task's own tests live entirely in `FileTreeRow.test.tsx`, which already has an `isLocked` suite.

- [ ] **Step 1: Write a failing test for the prof case**

Add to the `describe('FileTreeRow — verrouillage non-auteur', ...)` block in `src/components/sidebar/FileTreeRow.test.tsx`, after the existing `'shows a lock when the file is authored by someone else'` test:

```ts
  it('shows no lock for a prof correcting an eleve s map', () => {
    useSyncStore.setState({ currentUser: { username: 'aife', role: 'prof' } })
    vi.mocked(useMindMapAuthor).mockReturnValue({ id: 'f1', author: 'eleve1', role: 'eleve', lastModified: 'x' })
    render(<FileTreeRow node={node} depth={0} onOpenFile={() => {}} />)
    expect(screen.queryByLabelText(/lecture seule/)).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/sidebar/FileTreeRow.test.tsx -t "shows no lock for a prof"`
Expected: FAIL — the lock icon renders because today's check only compares usernames, and `aife` is not `eleve1`.

- [ ] **Step 3: Update the three call sites**

In `src/components/sidebar/FileTreeRow.tsx`, find the import from `../../sync/permissions` (already imports `canClassify`) and add `canEditContent`:

```ts
import { canClassify, canEditContent } from '../../sync/permissions'
```

Replace:

```ts
const isLocked = meta !== null && meta.author !== currentUser?.username
```

with:

```ts
const isLocked = meta !== null && (currentUser === null || !canEditContent(meta, currentUser))
```

In `src/App.tsx`, there is no existing import from `./sync/permissions` — add one, next to the existing `import { useSyncStore } from './state/useSyncStore'` on line 19:

```ts
import { canEditContent } from './sync/permissions'
```

Then replace the `isReadOnly` line:

```ts
const isReadOnly = loadedMeta !== null && loadedMeta.author !== currentUser?.username
```

with:

```ts
const isReadOnly = currentUser !== null && !canEditContent(loadedMeta, currentUser)
```

Then replace the guard inside `handleDropImageOnCard`:

```ts
if (meta !== null && meta.author !== useSyncStore.getState().currentUser?.username) return
```

with:

```ts
const dropUser = useSyncStore.getState().currentUser
if (meta !== null && (dropUser === null || !canEditContent(meta, dropUser))) return
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: PASS, including all pre-existing `verrouillage non-auteur` cases.

- [ ] **Step 5: Run the full test suite once to catch any other regression**

Run: `npx vitest run`
Expected: PASS. (Nothing else references these three lines.)

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/sidebar/FileTreeRow.tsx src/components/sidebar/FileTreeRow.test.tsx
git commit -m "feat(permissions): let a prof edit and drop images on an eleve s map"
```

---

### Task 3: `planPush` lets a prof push content

**Files:**
- Modify: `src/sync/syncService.ts` (the `content` line inside `planPush`, and its docstring)
- Test: `src/sync/syncService.test.ts` (`describe('planPush', ...)`)

**Interfaces:**
- Consumes: `canEditContent` from Task 1 (add to the existing `import { canClassify, canReorder } from './permissions'` line in `syncService.ts`).

- [ ] **Step 1: Write failing tests**

In `src/sync/syncService.test.ts`, inside `describe('planPush', ...)`, replace the existing test named `'never sends the CONTENT of a map we do not author, however new it looks'` (it encodes the invariant this task removes) with two tests — one keeping the eleve-side refusal, one adding the new prof-side allowance:

```ts
  it('refuses an eleve the content of a map they do not own', () => {
    const scan = planPush({
      meta: { ...AIFE, author: 'aife', lastModified: '2027-01-01T00:00:00.000Z' },
      relPath: 'a.zmap',
      currentUser: ELEVE_USER,
      entry: known,
    })
    expect(scan.content).toBe(false)
  })

  it('lets a prof push the CONTENT of an eleve s map — a correction', () => {
    const scan = planPush({
      meta: { ...AIFE, author: 'eleve1', lastModified: '2027-01-01T00:00:00.000Z' },
      relPath: 'a.zmap',
      currentUser: AIFE_USER,
      entry: known,
    })
    expect(scan.content).toBe(true)
  })
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `npx vitest run src/sync/syncService.test.ts -t "lets a prof push the CONTENT"`
Expected: FAIL — `scan.content` is `false` today because `meta.author` (`'eleve1'`) does not equal `currentUser.username` (`'aife'`).

- [ ] **Step 3: Implement**

In `src/sync/syncService.ts`, update the import:

```ts
import { canClassify, canEditContent, canReorder } from './permissions'
```

Replace, inside `planPush`:

```ts
  const content =
    meta.author === currentUser.username && (entry === undefined || entry.lastSyncedModified < meta.lastModified)
```

with:

```ts
  const content =
    canEditContent(meta, currentUser) && (entry === undefined || entry.lastSyncedModified < meta.lastModified)
```

Update the docstring line just above `planPush` that currently reads:

```
 * Le contenu n'appartient qu'à son auteur. Le chemin suit `canReorder` : son
 * auteur, ou un prof. Le type suit `canClassify` — la même règle, mais bornée
 * par ce que `lastSyncedType` permet de comparer.
```

to:

```
 * Le contenu suit `canEditContent` — son auteur, ou un prof, exactement comme
 * `canReorder` pour le chemin et `canClassify` pour le type : un prof peut
 * corriger le contenu d'un élève sans jamais en devenir l'auteur. Le chemin
 * suit `canReorder`. Le type suit `canClassify` — bornée par ce que
 * `lastSyncedType` permet de comparer.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sync/syncService.test.ts -t "planPush"`
Expected: PASS, every `planPush` case including the two from Step 1.

- [ ] **Step 5: Commit**

```bash
git add src/sync/syncService.ts src/sync/syncService.test.ts
git commit -m "feat(sync): planPush lets a prof push the content of an eleve s map"
```

---

### Task 4: `pullOne` accepts a correction pushed by someone else

**Files:**
- Modify: `src/sync/syncService.ts` (`pullOne`, its comment)
- Test: `src/sync/syncService.test.ts` (`describe('sync — pull', ...)`)

**Interfaces:**
- Produces: `pullOne` no longer skips a record solely because `record.author === currentUser` — later tasks (5, 6) build the merge behavior on top of what this task starts pulling.

- [ ] **Step 1: Update the existing test that encodes the old invariant**

In `src/sync/syncService.test.ts`, inside `describe('sync — pull', ...)`, replace:

```ts
  it('never pulls a record authored by the current user', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    const own = { ...record, author: 'eleve1' }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([own]) } as any })

    const result = await sync({ client, currentUser: 'eleve1', currentRole: 'eleve', serverUrl: 'https://pb.test', syncFolderPath: '/cours', state: emptySyncState() })

    expect(writeTextFile).not.toHaveBeenCalled()
    expect(result.pulled).toBe(0)
  })
```

with two tests — the corrected behavior, and the no-op case that replaces what the old test was actually protecting:

```ts
  it('pulls a record the current user authored when someone else changed it (a prof correction)', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    const own = { ...record, author: 'eleve1' }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([own]) } as any })

    const result = await sync({ client, currentUser: 'eleve1', currentRole: 'eleve', serverUrl: 'https://pb.test', syncFolderPath: '/cours', state: emptySyncState() })

    expect(writeTextFile).toHaveBeenCalledTimes(1)
    expect(result.pulled).toBe(1)
  })

  it('does not re-pull a record the current user authored when nothing changed since last sync', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    const own = { ...record, author: 'eleve1' }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([own]) } as any })
    const state = memory({ 'file-2': { lastSyncedModified: 'x', lastSyncedUpdated: own.updated } })

    const result = await sync({ client, currentUser: 'eleve1', currentRole: 'eleve', serverUrl: 'https://pb.test', syncFolderPath: '/cours', state })

    expect(writeTextFile).not.toHaveBeenCalled()
    expect(result.pulled).toBe(0)
  })
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `npx vitest run src/sync/syncService.test.ts -t "a prof correction"`
Expected: FAIL — `writeTextFile` is not called today because `pullOne` returns immediately on `record.author === currentUser`.

- [ ] **Step 3: Implement**

In `src/sync/syncService.ts`, inside `pullOne`, delete the first line and its comment:

```ts
  /** Everything the pull pass does for ONE remote record. */
  async function pullOne(record: RemoteMindMapRecord): Promise<void> {
    if (record.author === currentUser) return
    const known = entries[record.file_id]
```

becomes:

```ts
  /**
   * Everything the pull pass does for ONE remote record.
   *
   * No author guard here on purpose: `canEditContent` (see `planPush`) lets a
   * prof push a correction under the ELÈVE's own `author`, so authorship can
   * no longer stand in for "nobody else could have changed this". The check
   * right below already answers the right question — has the SERVER moved
   * since I last saw it — using the pre-push snapshot `remoteRecords` was
   * built from at the top of `sync()`, which is why a file I just pushed
   * myself, in this very run, is already caught by it.
   */
  async function pullOne(record: RemoteMindMapRecord): Promise<void> {
    const known = entries[record.file_id]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sync/syncService.test.ts -t "pull"`
Expected: PASS, including the two new tests and every other `sync — pull` case (the "writes a new local file for a record authored by someone else" and "skips a record already up to date in the cache" tests must still pass unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/sync/syncService.ts src/sync/syncService.test.ts
git commit -m "fix(sync): pull a correction even when I authored the file"
```

---

### Task 5: `mergeCards` — the floating-card set-difference

**Files:**
- Create: `src/sync/cardMerge.ts`
- Test: `src/sync/cardMerge.test.ts`

**Interfaces:**
- Produces: `mergeCards(local: Card[], remote: Card[]): { cards: Card[]; floatedCount: number }` — consumed by Task 6.

- [ ] **Step 1: Write failing tests**

Create `src/sync/cardMerge.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mergeCards } from './cardMerge'
import type { Card } from '../types/card'

function card(overrides: Partial<Card> = {}): Card {
  return { id: 'c1', level: 1, title: 't', parentId: null, order: 0, ...overrides }
}

describe('mergeCards', () => {
  it('keeps the remote list untouched when every local card is present remotely', () => {
    const remote = [card({ id: 'a' }), card({ id: 'b' })]
    const local = [card({ id: 'a', title: 'edited locally' }), card({ id: 'b' })]

    expect(mergeCards(local, remote)).toEqual({ cards: remote, floatedCount: 0 })
  })

  it('floats a local card missing from the remote version instead of dropping it', () => {
    const remote = [card({ id: 'a' })]
    const extra = card({ id: 'extra', parentId: 'a', level: 2 })
    const local = [card({ id: 'a' }), extra]

    const result = mergeCards(local, remote)

    expect(result.floatedCount).toBe(1)
    expect(result.cards).toEqual([remote[0], { ...extra, parentId: null, detached: true }])
  })

  it('leaves an already-detached local-only card detached', () => {
    const local = [card({ id: 'x', parentId: null, detached: true })]

    const result = mergeCards(local, [])

    expect(result.cards).toEqual([{ ...local[0], parentId: null, detached: true }])
    expect(result.floatedCount).toBe(1)
  })

  it('prefers the remote version of a card edited on both sides, with no field-level merge', () => {
    const remote = [card({ id: 'a', title: 'version du prof' })]
    const local = [card({ id: 'a', title: 'version de l’élève' })]

    expect(mergeCards(local, remote)).toEqual({ cards: remote, floatedCount: 0 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sync/cardMerge.test.ts`
Expected: FAIL — `src/sync/cardMerge.ts` does not exist yet.

- [ ] **Step 3: Implement**

Create `src/sync/cardMerge.ts`:

```ts
import type { Card } from '../types/card'

/**
 * Ce que `pullOne` écrit à la place d'un simple écrasement : toute carte
 * locale absente de la version reçue devient une carte volante au lieu
 * d'être perdue. Une différence d'ensembles à DEUX voies, pas une fusion à
 * trois — aucune version de référence commune n'est nécessaire : qu'une carte
 * ait été ajoutée par l'élève depuis la dernière synchro, ou supprimée par le
 * prof, le traitement est le même dans les deux cas — elle est mise de côté,
 * jamais perdue.
 *
 * Une carte présente des deux côtés (même `id`) n'est JAMAIS comparée champ à
 * champ : la version distante gagne intégralement — c'est la règle demandée
 * (« on écrit ce que le prof a voulu »), et ça évite un vrai moteur de fusion.
 */
export function mergeCards(local: Card[], remote: Card[]): { cards: Card[]; floatedCount: number } {
  const remoteIds = new Set(remote.map(card => card.id))
  const extra = local.filter(card => !remoteIds.has(card.id)).map(card => ({ ...card, parentId: null, detached: true }))
  return { cards: [...remote, ...extra], floatedCount: extra.length }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sync/cardMerge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync/cardMerge.ts src/sync/cardMerge.test.ts
git commit -m "feat(sync): add mergeCards — float local cards missing from a pull"
```

---

### Task 6: Wire `mergeCards` into `pullOne`, and report it on `SyncResult`

**Files:**
- Modify: `src/sync/syncService.ts` (`SyncResult`, `SyncRunResult`, the `sync()` result seed, `pullOne`)
- Test: `src/sync/syncService.test.ts` (`describe('sync — pull', ...)`)

**Interfaces:**
- Consumes: `mergeCards` from Task 5.
- Produces: `SyncResult.merged: { fileId: string; path: string; floatedCount: number }[]` (always populated by `sync()`, like `moved`/`notices`) — consumed by Task 7.

- [ ] **Step 1: Write failing tests**

In `src/sync/syncService.test.ts`, inside `describe('sync — pull', ...)`, add:

```ts
  it('floats a local card the incoming correction no longer has, instead of deleting it', async () => {
    const corrected = {
      ...record,
      author: 'eleve1',
      content: JSON.stringify({
        meta: { id: 'file-2', author: 'eleve1', role: 'eleve', lastModified: '2026-01-01T00:00:00.000Z' },
        cards: [{ id: 'root', level: 1, title: 'Racine', parentId: null, order: 0 }],
      }),
    }
    vi.mocked(scanFolder).mockResolvedValue([])
    vi.mocked(exists).mockImplementation(async path => path === '/cours/b.zmap')
    vi.mocked(loadMindMapMeta).mockResolvedValue({ id: 'file-2', author: 'eleve1', role: 'eleve', lastModified: 'x' })
    vi.mocked(loadMindMap).mockResolvedValue([
      { id: 'root', level: 1, title: 'Racine', parentId: null, order: 0 },
      { id: 'extra', level: 2, title: 'Ajoutée par l’élève', parentId: 'root', order: 0 },
    ])
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([corrected]) } as any })

    const result = await sync({ client, currentUser: 'eleve1', currentRole: 'eleve', serverUrl: 'https://pb.test', syncFolderPath: '/cours', state: emptySyncState() })

    const [, written] = vi.mocked(writeTextFile).mock.calls[0]
    const writtenCards = JSON.parse(written as string).cards
    expect(writtenCards).toEqual([
      { id: 'root', level: 1, title: 'Racine', parentId: null, order: 0 },
      { id: 'extra', level: 2, title: 'Ajoutée par l’élève', parentId: null, order: 0, detached: true },
    ])
    expect(result.merged).toEqual([{ fileId: 'file-2', path: 'b.zmap', floatedCount: 1 }])
  })

  it('reports no merge when the incoming correction already has every local card', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    vi.mocked(exists).mockImplementation(async path => path === '/cours/b.zmap')
    vi.mocked(loadMindMapMeta).mockResolvedValue({ id: 'file-2', author: 'prof', role: 'prof', lastModified: 'x' })
    vi.mocked(loadMindMap).mockResolvedValue([])
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([record]) } as any })

    const result = await sync({ client, currentUser: 'eleve1', currentRole: 'eleve', serverUrl: 'https://pb.test', syncFolderPath: '/cours', state: emptySyncState() })

    expect(result.merged).toEqual([])
  })
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `npx vitest run src/sync/syncService.test.ts -t "floats a local card"`
Expected: FAIL — `pullOne` overwrites with the remote cards unchanged today, so `writtenCards` has no `extra` entry, and `result.merged` does not exist.

- [ ] **Step 3: Implement**

In `src/sync/syncService.ts`, add the import:

```ts
import { mergeCards } from './cardMerge'
```

Extend `SyncResult`:

```ts
export interface SyncResult {
  pushed: number
  pulled: number
  errors: { fileId: string; message: string }[]
  ...
  reclassified?: number
  /** Un pull qui a mis des cartes locales de côté au lieu de les perdre. */
  merged?: { fileId: string; path: string; floatedCount: number }[]
}
```

Extend `SyncRunResult`:

```ts
type SyncRunResult = SyncResult &
  Required<Pick<SyncResult, 'relocated' | 'moved' | 'notices' | 'reclassified' | 'merged'>>
```

Seed it in `sync()`'s initial `result`:

```ts
  const result: SyncRunResult = {
    pushed: 0,
    pulled: 0,
    errors: [],
    cancelled: false,
    conflicts: [],
    transferred: [],
    relocated: 0,
    moved: [],
    notices: [],
    reclassified: 0,
    merged: [],
  }
```

In `pullOne`, replace the block that writes the file:

```ts
      await ensureLocalFolder(localPath)
      // Le champ `type` de l'enregistrement fait foi : la copie locale est
      // réécrite avec lui, sans toucher au reste du `meta`.
      const applied = meta === null ? null : { ...meta, type: mapTypeOf(record.type) }
      const serialized = serializeMindMap(applied, cards)
```

with:

```ts
      await ensureLocalFolder(localPath)
      // Toute carte locale absente de la version reçue devient volante au lieu
      // d'être perdue — voir `mergeCards`. Rien à fusionner pour un premier
      // pull (`localCards === null`, rien n'existait avant).
      const localCards = await loadMindMap(localPath)
      const { cards: mergedCards, floatedCount } =
        localCards === null ? { cards, floatedCount: 0 } : mergeCards(localCards, cards)
      if (floatedCount > 0) {
        result.merged.push({ fileId: record.file_id, path: record.path, floatedCount })
      }
      // Le champ `type` de l'enregistrement fait foi : la copie locale est
      // réécrite avec lui, sans toucher au reste du `meta`.
      const applied = meta === null ? null : { ...meta, type: mapTypeOf(record.type) }
      const serialized = serializeMindMap(applied, mergedCards)
```

(`loadMindMap` already returns `null` when the path does not exist, so this one call covers both "first pull, nothing to merge" and "existing file, merge its cards" without a second `exists()` check.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sync/syncService.test.ts`
Expected: PASS, the whole file — this touches shared types, so re-run everything rather than a filtered `-t`.

- [ ] **Step 5: Commit**

```bash
git add src/sync/syncService.ts src/sync/syncService.test.ts
git commit -m "feat(sync): float local cards a pulled correction no longer has"
```

---

### Task 7: Surface the merge in the sync-result label and verbose log

**Files:**
- Modify: `src/sync/syncResultLabel.ts`
- Modify: `src/state/useSyncStore.ts` (the `verboseLog` block inside `syncNow`)
- Test: `src/sync/syncResultLabel.test.ts`
- Test: `src/state/useSyncStore.test.ts`

**Interfaces:**
- Consumes: `SyncResult.merged` from Task 6.

- [ ] **Step 1: Write failing tests**

Add to `src/sync/syncResultLabel.test.ts`:

```ts
  it('mentionne les cartes mises de côté par une fusion', () => {
    const merged = [{ fileId: 'f1', path: 'a.zmap', floatedCount: 2 }]
    expect(syncResultLabel(result({ merged }))).toContain('2 carte(s) mise(s) de côté')
  })
```

Add to `src/state/useSyncStore.test.ts`, after the `'lists every file that moved when the detailed journal is on...'` test:

```ts
  it('logs a merge s floated cards when the detailed journal is on', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'eleve1', role: 'eleve' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    vi.mocked(sync).mockResolvedValue({
      pushed: 0,
      pulled: 1,
      errors: [],
      cancelled: false,
      conflicts: [],
      transferred: [],
      merged: [{ fileId: 'file-2', path: 'b.zmap', floatedCount: 1 }],
    })
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().setSyncFolderPath('/cours')
    await store.getState().login('eleve1', 'secret')
    await store.getState().updateSettings({ verboseLog: true })

    await store.getState().syncNow()

    const debugLines = vi
      .mocked(logSyncEvent)
      .mock.calls.filter(call => call[0] === 'debug')
      .map(call => call[1])
    expect(debugLines).toEqual(['« b.zmap » : 1 carte(s) mise(s) de côté'])
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sync/syncResultLabel.test.ts src/state/useSyncStore.test.ts -t "carte"`
Expected: FAIL — neither `syncResultLabel` nor the verbose-log loop know about `merged` yet.

- [ ] **Step 3: Implement**

In `src/sync/syncResultLabel.ts`, add a line between the `reclassified` check and the `conflicts` check:

```ts
  if ((result.reclassified ?? 0) > 0) parts.push(`${result.reclassified ?? 0} reclassé(s)`)
  const floated = (result.merged ?? []).reduce((sum, entry) => sum + entry.floatedCount, 0)
  if (floated > 0) parts.push(`${floated} carte(s) mise(s) de côté`)
  if (result.conflicts.length > 0) parts.push(`${result.conflicts.length} conflit(s)`)
```

In `src/state/useSyncStore.ts`, inside `syncNow`'s `if (get().verboseLog)` block, add a third loop after the `notices`-driven `moved` one:

```ts
            for (const moved of result.moved ?? []) {
              await logSyncEvent('debug', `déplacé « ${moved.from} » vers « ${moved.to} »`, { fileId: moved.fileId })
            }
            for (const merge of result.merged ?? []) {
              await logSyncEvent('debug', `« ${merge.path} » : ${merge.floatedCount} carte(s) mise(s) de côté`, {
                fileId: merge.fileId,
              })
            }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sync/syncResultLabel.test.ts src/state/useSyncStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync/syncResultLabel.ts src/state/useSyncStore.ts src/sync/syncResultLabel.test.ts src/state/useSyncStore.test.ts
git commit -m "feat(sync): surface floated cards in the sync label and verbose log"
```

---

### Task 8: Protect the file open in the canvas from being pulled

**Files:**
- Modify: `src/sync/syncService.ts` (`SyncParams`, `pullOne`)
- Modify: `src/state/useSyncStore.ts` (`syncNow`, and the "not configured" branch)
- Test: `src/sync/syncService.test.ts`
- Test: `src/state/useSyncStore.test.ts`

**Interfaces:**
- Produces: `SyncParams.openFilePath?: string` — the absolute local path currently loaded in the canvas, or `undefined`/`''` when nothing is open.
- Consumes (Step 3): `useWorkspaceStore.getState().currentFilePath` from `src/state/useWorkspaceStore.ts` (already exists; no change to that file).

- [ ] **Step 1: Write failing tests**

In `src/sync/syncService.test.ts`, inside `describe('sync — pull', ...)`, add:

```ts
  it('never pulls into the file currently open in the canvas', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([record]) } as any })

    const result = await sync({
      client,
      currentUser: 'eleve1',
      currentRole: 'eleve',
      serverUrl: 'https://pb.test',
      syncFolderPath: '/cours',
      state: emptySyncState(),
      openFilePath: '/cours/b.zmap',
    })

    expect(writeTextFile).not.toHaveBeenCalled()
    expect(result.pulled).toBe(0)
  })

  it('pulls normally when the open file is a different one', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([record]) } as any })

    const result = await sync({
      client,
      currentUser: 'eleve1',
      currentRole: 'eleve',
      serverUrl: 'https://pb.test',
      syncFolderPath: '/cours',
      state: emptySyncState(),
      openFilePath: '/cours/autre.zmap',
    })

    expect(result.pulled).toBe(1)
  })
```

In `src/state/useSyncStore.test.ts`, add:

```ts
  it('passes the file currently open in the canvas so the pull cannot clobber it', async () => {
    const authWithPassword = vi.fn().mockResolvedValue({ record: { username: 'aife', role: 'prof' } })
    vi.mocked(createPocketBaseClient).mockReturnValue(fakePocketBase(authWithPassword) as any)
    vi.mocked(sync).mockResolvedValue({ pushed: 0, pulled: 0, errors: [], cancelled: false, conflicts: [], transferred: [] })
    await store.getState().setServerUrl('https://pi.local')
    await store.getState().setSyncFolderPath('/cours')
    await store.getState().login('aife', 'secret')
    useWorkspaceStore.setState({ currentFilePath: '/cours/ouvert.zmap' })

    await store.getState().syncNow()

    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ openFilePath: '/cours/ouvert.zmap' }))
  })

  it('syncNow({trigger:"auto"}) stays silent when nothing is configured', async () => {
    await store.getState().syncNow({ trigger: 'auto' })

    expect(store.getState().error).toBeNull()
    expect(sync).not.toHaveBeenCalled()
  })
```

`useWorkspaceStore` needs importing at the top of `src/state/useSyncStore.test.ts`: `import { useWorkspaceStore } from './useWorkspaceStore'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sync/syncService.test.ts src/state/useSyncStore.test.ts -t "open"`
Expected: FAIL — `sync()` has no `openFilePath` param yet, and `syncNow` still sets `error` for an unconfigured `'auto'` call.

- [ ] **Step 3: Implement**

In `src/sync/syncService.ts`, add to `SyncParams`:

```ts
export interface SyncParams {
  client: SyncClient
  currentUser: string
  currentRole: UserRole
  serverUrl: string
  syncFolderPath: string
  state: SyncState
  /**
   * Le chemin ABSOLU du fichier actuellement chargé dans le canevas, s'il y en
   * a un. Un pull ne l'écrase jamais, quel que soit `lastSyncedUpdated` — le
   * réécrire sous une édition en cours romprait la garantie qu'une correction
   * ne fait jamais perdre le travail en train de se faire.
   */
  openFilePath?: string
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
}
```

Add it to `sync()`'s own destructured parameter list:

```ts
export async function sync({
  client,
  currentUser,
  currentRole,
  serverUrl,
  syncFolderPath,
  state,
  openFilePath,
  signal,
  onProgress,
}: SyncParams): Promise<SyncResult> {
```

Then use it in `pullOne` right after `localPath` is computed:

```ts
    try {
      const { meta, cards } = deserializeMindMap(record.content)
      const localPath = await join(syncFolderPath, record.path)
      if (isSameFilePath(localPath, openFilePath ?? '')) return
```

- [ ] **Step 4: Wire the caller and silence the unconfigured branch for `'auto'`**

In `src/state/useSyncStore.ts`, add the import:

```ts
import { useWorkspaceStore } from './useWorkspaceStore'
```

Replace the "not configured" early return inside `syncNow`:

```ts
        const { serverUrl, syncFolderPath, currentUser } = get()
        if (syncFolderPath === null || currentUser === null) {
          const message = 'Connectez-vous et choisissez un dossier de synchronisation avant de synchroniser.'
          reportFailure(message, trigger)
          // Logged rather than dropped: "I clicked and nothing happened" is the
          // report this line answers.
          await logSyncEvent('info', `synchronisation ignorée : ${message}`)
          return
        }
```

with:

```ts
        const { serverUrl, syncFolderPath, currentUser } = get()
        if (syncFolderPath === null || currentUser === null) {
          const message = 'Connectez-vous et choisissez un dossier de synchronisation avant de synchroniser.'
          // Un déclenchement MANUEL (le bouton) doit dire pourquoi rien ne se
          // passe. Un déclenchement AUTOMATIQUE ne doit pas afficher de bannière
          // pour un compte qui n'utilise simplement pas la synchro — c'est le
          // cas normal d'un appel qui, désormais, part aussi à la fermeture
          // d'un fichier, que la synchro soit configurée ou non.
          if (trigger === 'manual') reportFailure(message, trigger)
          await logSyncEvent('info', `synchronisation ignorée : ${message}`)
          return
        }
```

And add `openFilePath` to the `sync({...})` call further down:

```ts
          result = await sync({
            client: createSyncClient(pb),
            currentUser: currentUser.username,
            currentRole: currentUser.role,
            serverUrl,
            syncFolderPath,
            state,
            openFilePath: useWorkspaceStore.getState().currentFilePath ?? undefined,
            signal: controller.signal,
            onProgress: (done, total) => set({ progress: { done, total } }),
          })
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/sync/syncService.test.ts src/state/useSyncStore.test.ts`
Expected: PASS, including the pre-existing `'syncNow() refuses without a folder or a logged-in user, with a French message'` test (still manual, still reports).

- [ ] **Step 6: Commit**

```bash
git add src/sync/syncService.ts src/state/useSyncStore.ts src/sync/syncService.test.ts src/state/useSyncStore.test.ts
git commit -m "fix(sync): never pull into the file open in the canvas; auto-trigger stays silent"
```

---

### Task 9: Sync automatically when a file closes

**Files:**
- Modify: `src/hooks/useUnsavedChangesGuard.ts`
- Test: `src/hooks/useUnsavedChangesGuard.test.ts`

**Interfaces:**
- Consumes: `useSyncStore.getState().syncNow` from `src/state/useSyncStore.ts` (Task 8 already made it safe to call unconditionally with `trigger: 'auto'`).

- [ ] **Step 1: Write failing tests**

Add to `src/hooks/useUnsavedChangesGuard.test.ts`. First, mock and import the store at the top of the file (alongside the existing `@tauri-apps/api/window` mock):

```ts
vi.mock('../state/useSyncStore', () => ({ useSyncStore: { getState: vi.fn() } }))

import { useSyncStore } from '../state/useSyncStore'
```

Then, inside `describe('requestOpenFile', ...)`:

```ts
    it('triggers an automatic sync after a successful flush', async () => {
      const syncNow = vi.fn().mockResolvedValue(undefined)
      vi.mocked(useSyncStore.getState).mockReturnValue({ syncNow } as any)
      const flush = vi.fn().mockResolvedValue(undefined)
      const { result } = renderHook(() => useUnsavedChangesGuard(flush, vi.fn()))

      act(() => result.current.requestOpenFile('/cours/b.json'))
      await waitFor(() => expect(syncNow).toHaveBeenCalledWith({ trigger: 'auto' }))
    })

    it('does not trigger a sync when the flush fails', async () => {
      const syncNow = vi.fn().mockResolvedValue(undefined)
      vi.mocked(useSyncStore.getState).mockReturnValue({ syncNow } as any)
      const flush = vi.fn().mockRejectedValue(new Error('disque plein'))
      const { result } = renderHook(() => useUnsavedChangesGuard(flush, vi.fn()))

      act(() => result.current.requestOpenFile('/cours/b.json'))
      await waitFor(() => expect(result.current.prompt).not.toBeNull())

      expect(syncNow).not.toHaveBeenCalled()
    })
```

And inside `describe('window close', ...)`:

```ts
    it('triggers an automatic sync after a successful flush on close', async () => {
      const syncNow = vi.fn().mockResolvedValue(undefined)
      vi.mocked(useSyncStore.getState).mockReturnValue({ syncNow } as any)
      const flush = vi.fn().mockResolvedValue(undefined)
      renderHook(() => useUnsavedChangesGuard(flush, vi.fn()))
      await waitFor(() => expect(onCloseRequested).toHaveBeenCalled())

      await act(async () => closeHandler({ preventDefault: vi.fn() }))

      expect(syncNow).toHaveBeenCalledWith({ trigger: 'auto' })
    })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/useUnsavedChangesGuard.test.ts -t "automatic sync"`
Expected: FAIL — `syncNow` is never called today.

- [ ] **Step 3: Implement**

In `src/hooks/useUnsavedChangesGuard.ts`, add the import:

```ts
import { useSyncStore } from '../state/useSyncStore'
```

Replace the body of `requestOpenFile`:

```ts
  const requestOpenFile = useCallback(
    (path: string) => {
      flush()
        .then(() => setCurrentFile(path))
        .catch((error: unknown) => {
```

with:

```ts
  const requestOpenFile = useCallback(
    (path: string) => {
      flush()
        .then(() => {
          setCurrentFile(path)
          // Fire-and-forget: switching files must never wait on the network,
          // and the file we just left is no longer "open in the canvas" —
          // see `SyncParams.openFilePath` — so it is now safe to pull into.
          void useSyncStore.getState().syncNow({ trigger: 'auto' })
        })
        .catch((error: unknown) => {
```

And the success branch of `onCloseRequested`:

```ts
          try {
            await flush()
          } catch (error) {
            ...
            return
          }
          await closeNow()
```

with:

```ts
          try {
            await flush()
          } catch (error) {
            ...
            return
          }
          void useSyncStore.getState().syncNow({ trigger: 'auto' })
          await closeNow()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/useUnsavedChangesGuard.test.ts`
Expected: PASS, all cases including the pre-existing ones (they call `renderHook` without mocking `useSyncStore.getState` beyond the module-level mock, which defaults to returning `undefined` — check the mock factory returns a `syncNow: vi.fn()` by default so those tests do not throw):

Adjust the mock factory from Step 1 to avoid `undefined.syncNow` in tests that don't set it up explicitly:

```ts
vi.mock('../state/useSyncStore', () => ({
  useSyncStore: { getState: vi.fn(() => ({ syncNow: vi.fn() })) },
}))
```

Re-run: `npx vitest run src/hooks/useUnsavedChangesGuard.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useUnsavedChangesGuard.ts src/hooks/useUnsavedChangesGuard.test.ts
git commit -m "feat(sync): trigger an automatic sync when a mind map file closes"
```

---

## Manual verification (no automated test covers the whole flow)

After Task 9, run the app (`npm run tauri dev` or equivalent) with two accounts against a test PocketBase instance:

1. Sign in as the élève, create a card, publish the map, close it.
2. Sign in as the prof (same sync folder or a second machine pointed at the same server), open the élève's map, edit a card's text, add nothing new, close it.
3. Back as the élève: open the map (or wait for the interval sync) — the prof's edit should appear, `meta.author` should still read the élève's username, and the file should not be marked read-only for the élève.
4. Repeat, but this time have the élève add an extra child card BEFORE the prof's correction lands — after the correction is pulled, that extra card should appear as a floating card rather than vanish.
5. Confirm the élève can still edit their own map after a correction (canEditContent keeps them the author).
