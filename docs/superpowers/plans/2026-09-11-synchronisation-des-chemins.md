# Synchronisation des chemins — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire suivre au serveur les renommages et déplacements de fichiers et de dossiers — un renommage local devient un `path` distant à jour, un `path` distant modifié devient un déplacement local, au lieu du doublon d'aujourd'hui.

**Architecture:** L'état de synchronisation (`.sync-state.json`) passe en v2 : indexé par serveur, il mémorise `lastSyncedPath` et un hash de contenu par `file_id`, ce qui permet de détecter une divergence de chemin sans lire le réseau ni réécrire un seul `.zmap`. La boucle `sync()` gagne une passe de réconciliation qui tourne **avant** le push, le push se fait par champ (`content` pour l'auteur, `path` pour un prof), et le tirage relocalise le fichier local au lieu d'en écrire un second.

**Tech Stack:** TypeScript strict, React 18, Zustand, Tauri 2 (`@tauri-apps/plugin-fs`), PocketBase SDK, Vitest + Testing Library, Bun.

**Spec:** `docs/superpowers/specs/2026-09-11-deplacement-et-synchronisation-design.md`

**Périmètre de CE plan :** les trois premiers trous de l'audit (renommage non poussé, `path` non suivi, arborescence non répercutée). La suppression propagée et le glisser-déposer font l'objet de deux plans séparés ; le champ `tombstones` est posé ici pour que le format de fichier ne change qu'une fois.

## Global Constraints

- **Langue** : tout texte vu par l'utilisateur (messages d'erreur, libellés) est en **français** ; les identifiants, types et commentaires de code sont en **anglais**, comme le reste du dépôt.
- **TypeScript strict** avec `noUnusedLocals` et `noUnusedParameters` (`tsconfig.json`) : ne jamais laisser un binding ou un paramètre inutilisé — ne pas extraire une propriété du destructuring avant la tâche qui l'utilise.
- **TDD** : le test s'écrit d'abord et doit **échouer** (étape explicite), puis l'implémentation minimale le fait passer.
- **Un commit par tâche**, à la fin de la tâche, avec les chemins exacts ajoutés.
- **Commandes** : tests d'un fichier → `bunx vitest run <chemin>` ; suite complète → `bun run test` ; types → `bunx tsc --noEmit`.
- **Jamais** de `git add -f` sous `.cartes-mentales/` ni `.cours/` ; ne pas toucher à ces dossiers.
- **L'état de synchro est un cache** : un fichier corrompu se jette sans exception, et aucune opération par fichier ne doit interrompre le lot.
- **Format d'erreur existant** : l'échec d'un fichier s'ajoute à `SyncResult.errors` (`{ fileId, message }`) avec un message français, sans jamais rejeter `sync()`.
- **Ne pas supprimer** le comportement best-effort du sidecar `.assets` (`renamePath` s'en charge déjà) ni le garde anti-doublon `seenFileIds`.

---

## Structure des fichiers

| Fichier | Créer / Modifier | Responsabilité |
|---|---|---|
| `src/types/card.ts` | Modifier | Ajoute `SyncUser` (`username`, `role`) à côté de `MindMapMeta`/`UserRole`, pour que la permission ne dépende pas d'un store |
| `src/sync/permissions.ts` | **Créer** | `canReorder` : le seul prédicat « ai-je le droit de changer l'agencement de ce fichier » |
| `src/persistence/syncState.ts` | Modifier | Format v2, migration v1 → v2, compartiment par serveur |
| `src/sync/pathReconciliation.ts` | **Créer** | Les deux décisions pures du suivi de chemin : amorçage et action à mener |
| `src/sync/contentHash.ts` | **Créer** | Hash SHA-256 d'un contenu sérialisé, pour un conflit basé sur le contenu |
| `src/sync/syncService.ts` | Modifier | Scan local unique, réconciliation, push par champ, tirage qui relocalise, compteurs |
| `src/sync/syncResultLabel.ts` | Modifier | Le compte rendu dit les déplacements et les remarques |
| `src/state/useSyncStore.ts` | Modifier | Charge/écrit l'état v2, passe `serverUrl` + rôle, journalise les déplacements |
| `src/components/sidebar/FileSidebar.tsx` | Modifier | Rafraîchit l'arbre après un déplacement, et fait suivre le fichier ouvert |
| `src/components/sidebar/FileTreeRow.tsx` | Modifier | Badge « hors du dossier de synchronisation » |
| `README_INFRA.md` | Modifier | Règles PocketBase `Update`/`Delete` avec l'autorité du prof |

---

### Task 1: `canReorder` — le prédicat de permission partagé

**Files:**
- Modify: `src/types/card.ts`
- Create: `src/sync/permissions.ts`
- Create: `src/sync/permissions.test.ts`
- Modify: `src/state/useSyncStore.ts` (retire l'interface locale, la réexporte)

**Interfaces:**
- Consumes: `MindMapMeta`, `UserRole` (déjà dans `src/types/card.ts`)
- Produces: `SyncUser` (type, depuis `src/types/card.ts`) ; `canReorder(meta: MindMapMeta | null, user: SyncUser): boolean` depuis `src/sync/permissions.ts`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// src/sync/permissions.test.ts
import { describe, it, expect } from 'vitest'
import { canReorder } from './permissions'
import type { MindMapMeta, SyncUser } from '../types/card'

const AIFE: SyncUser = { username: 'aife', role: 'prof' }
const ELEVE: SyncUser = { username: 'eleve1', role: 'eleve' }

const AIFE_MAP: MindMapMeta = {
  id: 'file-1',
  author: 'aife',
  role: 'prof',
  lastModified: '2026-01-01T00:00:00.000Z',
}
const ELEVE_MAP: MindMapMeta = { ...AIFE_MAP, id: 'file-2', author: 'eleve1', role: 'eleve' }

describe('canReorder', () => {
  it('lets anyone rearrange a map with no sync identity — it belongs to nobody', () => {
    expect(canReorder(null, ELEVE)).toBe(true)
  })

  it('lets an author rearrange their own map', () => {
    expect(canReorder(ELEVE_MAP, ELEVE)).toBe(true)
    expect(canReorder(AIFE_MAP, AIFE)).toBe(true)
  })

  it('refuses an eleve on someone else s map', () => {
    expect(canReorder(AIFE_MAP, ELEVE)).toBe(false)
  })

  it('lets a prof rearrange anyone s map, which is how a class folder is reorganised', () => {
    expect(canReorder(ELEVE_MAP, AIFE)).toBe(true)
  })
})
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `bunx vitest run src/sync/permissions.test.ts`
Expected: FAIL — `Failed to resolve import "./permissions"`.

- [ ] **Step 3: Ajouter `SyncUser` à `src/types/card.ts`**

Juste après la déclaration de `MindMapMeta` :

```ts
/**
 * Who is signed in. `username` is what owns files (`meta.author`), `role` is
 * what decides who may rearrange them — a prof may move, rename and delete
 * anyone's map; an eleve only their own. The role never grants the right to
 * write someone else's CONTENT.
 */
export interface SyncUser {
  username: string
  role: UserRole
}
```

- [ ] **Step 4: Écrire `src/sync/permissions.ts`**

```ts
import type { MindMapMeta, SyncUser } from '../types/card'

/**
 * Whether `user` may change the LAYOUT of a map — its path, its name, and by
 * extension the `path` of its remote record.
 *
 * This is the ONE definition of that permission, shared by the interface (what
 * may be dragged, renamed, deleted) and by the sync (whose path change may be
 * pushed). Two definitions would let the tree offer a gesture the sync then
 * refuses to publish.
 *
 * A map with no `meta` belongs to nobody: it has never been published, has no
 * remote record, and rearranging it is a purely local act.
 *
 * Deliberately NOT about content: a prof rearranges an eleve's chapter without
 * ever gaining the right to edit it — that is what keeps "l'auteur est le seul
 * éditeur" standing.
 */
export function canReorder(meta: MindMapMeta | null, user: SyncUser): boolean {
  if (meta === null) return true
  return meta.author === user.username || user.role === 'prof'
}
```

- [ ] **Step 5: Lancer le test et vérifier qu'il passe**

Run: `bunx vitest run src/sync/permissions.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Faire pointer le store sur le type partagé**

Dans `src/state/useSyncStore.ts`, remplacer l'interface locale :

```ts
export interface SyncUser {
  username: string
  role: UserRole
}
```

par un import + réexport (la surface publique du store ne change pas) :

```ts
import type { SyncUser } from '../types/card'
// Réexporté : c'est ici que le reste de l'app l'importait, et le type vit
// désormais avec `MindMapMeta` pour que la permission ne dépende d'aucun store.
export type { SyncUser }
```

- [ ] **Step 7: Vérifier les types et committer**

Run: `bunx tsc --noEmit`
Expected: aucune erreur.

```bash
git add src/types/card.ts src/sync/permissions.ts src/sync/permissions.test.ts src/state/useSyncStore.ts
git commit -m "feat(sync): un seul predicat pour le droit de rearranger une carte"
```

---

### Task 2: L'état de synchronisation passe en v2, et ses consommateurs suivent

**Files:**
- Modify: `src/persistence/syncState.ts`
- Modify: `src/persistence/syncState.test.ts`
- Modify: `src/sync/syncService.ts` (signature de `sync` et `surveySyncFolder`, lecture du compartiment — **sans aucun changement de comportement**)
- Modify: `src/state/useSyncStore.ts`
- Modify: `src/state/useSyncStore.test.ts`
- Modify: `src/sync/syncService.test.ts` (fixtures)
- Modify: `src/components/sidebar/FileSidebar.test.tsx` (mock de module)

**Interfaces:**
- Consumes: rien des tâches précédentes.
- Produces:
  - `SyncStateEntry { lastSyncedModified: string; lastSyncedUpdated: string; lastSyncedPath?: string; lastSyncedContentHash?: string }`
  - `ServerSyncState { syncFolderPath: string | null; entries: Record<string, SyncStateEntry>; tombstones: string[] }`
  - `SyncState { version: 2; servers: Record<string, ServerSyncState> }`
  - `LegacySyncState = Record<string, SyncStateEntry>`, `LoadedSyncState`
  - `emptySyncState()`, `emptyServerState(root)`, `serverStateOf(state, serverUrl, root)`, `migrateLegacyState(entries, serverUrl, root)`, `resolveSyncState(loaded, serverUrl, root)`
  - `loadSyncState(): Promise<LoadedSyncState>`, `loadServerSyncState(serverUrl, root): Promise<SyncState>`, `saveSyncState(state: SyncState)`
  - `sync({ client, currentUser, currentRole, serverUrl, syncFolderPath, state, signal?, onProgress? })`
  - `surveySyncFolder({ syncFolderPath, currentUser, entries })`

- [ ] **Step 1: Réécrire `src/persistence/syncState.test.ts`**

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
import {
  emptySyncState,
  loadServerSyncState,
  loadSyncState,
  migrateLegacyState,
  resolveSyncState,
  saveSyncState,
  serverStateOf,
  type SyncState,
} from './syncState'

const V2: SyncState = {
  version: 2,
  servers: {
    'https://pb.test': {
      syncFolderPath: '/cours',
      entries: { 'file-1': { lastSyncedModified: 'm1', lastSyncedUpdated: 'u1', lastSyncedPath: 'a.zmap' } },
      tombstones: [],
    },
  },
}

describe('loadSyncState', () => {
  beforeEach(() => {
    vi.mocked(exists).mockReset()
    vi.mocked(readTextFile).mockReset()
  })

  it('reports nothing when no cache file exists yet', async () => {
    vi.mocked(exists).mockResolvedValue(false)
    expect(await loadSyncState()).toEqual({ kind: 'none' })
  })

  it('reads a v2 file as it stands', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(V2))
    expect(await loadSyncState()).toEqual({ kind: 'v2', state: V2 })
  })

  it('recognises the flat v1 format instead of throwing it away', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    const legacy = { 'file-1': { lastSyncedModified: 'm1', lastSyncedUpdated: 'u1' } }
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(legacy))
    expect(await loadSyncState()).toEqual({ kind: 'legacy', entries: legacy })
  })

  it('discards a corrupted cache rather than throwing — it is cheap to rebuild', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue('{ not json')
    expect(await loadSyncState()).toEqual({ kind: 'none' })
  })
})

describe('migrateLegacyState', () => {
  const entries = { 'file-1': { lastSyncedModified: 'm1', lastSyncedUpdated: 'u1' } }

  it('files the flat entries under the configured server, paths unknown', () => {
    expect(migrateLegacyState(entries, 'https://pb.test', '/cours')).toEqual({
      version: 2,
      servers: { 'https://pb.test': { syncFolderPath: '/cours', entries, tombstones: [] } },
    })
  })

  it('drops them when no server is configured — a cache with nowhere to be filed', () => {
    expect(migrateLegacyState(entries, null, '/cours')).toEqual({ version: 2, servers: {} })
  })
})

describe('resolveSyncState', () => {
  it('passes a v2 file through untouched', () => {
    expect(resolveSyncState({ kind: 'v2', state: V2 }, 'https://pb.test', '/cours')).toBe(V2)
  })

  it('starts empty when there was nothing to read', () => {
    expect(resolveSyncState({ kind: 'none' }, 'https://pb.test', '/cours')).toEqual(emptySyncState())
  })
})

describe('serverStateOf', () => {
  it('creates the compartment on first use, and returns the same one afterwards', () => {
    const state = emptySyncState()
    const first = serverStateOf(state, 'https://pb.test', '/cours')
    expect(first).toEqual({ syncFolderPath: '/cours', entries: {}, tombstones: [] })
    first.entries['file-1'] = { lastSyncedModified: 'm', lastSyncedUpdated: 'u' }
    expect(serverStateOf(state, 'https://pb.test', '/cours').entries).toHaveProperty('file-1')
  })
})

describe('loadServerSyncState', () => {
  it('resolves the file for one server and guarantees its compartment exists', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(V2))
    const state = await loadServerSyncState('https://autre.test', '/cours')
    // Le compartiment du serveur demandé est créé, et celui de l'autre serveur
    // du fichier n'est pas dupliqué sous une clé approximative.
    expect(Object.keys(state.servers)).toEqual(['https://pb.test', 'https://autre.test'])
    expect(state.servers['https://autre.test']).toEqual({ syncFolderPath: '/cours', entries: {}, tombstones: [] })
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
    await saveSyncState(V2)
    expect(mkdir).toHaveBeenCalledWith('/config', { recursive: true })
    expect(writeTextFile).toHaveBeenCalledWith('/config/sync-state.json', JSON.stringify(V2, null, 2))
  })
})
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `bunx vitest run src/persistence/syncState.test.ts`
Expected: FAIL — `loadSyncState` renvoie `{}` (format v1) et `serverStateOf` n'existe pas.

- [ ] **Step 3: Réécrire `src/persistence/syncState.ts`**

```ts
import { exists, readTextFile, writeTextFile, mkdir } from '@tauri-apps/plugin-fs'
import { appConfigDir, join } from '@tauri-apps/api/path'

const STATE_FILE_NAME = 'sync-state.json'

export interface SyncStateEntry {
  lastSyncedModified: string
  lastSyncedUpdated: string
  /**
   * Le chemin RELATIF à la racine de synchronisation au dernier push ou pull.
   * Absent = inconnu (entrée migrée depuis la v1), pas « pas de chemin » : la
   * distinction décide si un chemin distant périmé doit être réparé.
   */
  lastSyncedPath?: string
  /** Absent = inconnu ; la détection de conflit retombe alors sur la révision. */
  lastSyncedContentHash?: string
}

export interface ServerSyncState {
  /** La racine avec laquelle `lastSyncedPath` a été construit — voir `sync`. */
  syncFolderPath: string | null
  entries: Record<string, SyncStateEntry>
  /** `file_id` dont la suppression distante reste à appliquer (plan « suppression »). */
  tombstones: string[]
}

export interface SyncState {
  version: 2
  servers: Record<string, ServerSyncState>
}

/** Le format v1 : un simple index `file_id → entrée`, sans notion de serveur. */
export type LegacySyncState = Record<string, SyncStateEntry>

export type LoadedSyncState =
  | { kind: 'v2'; state: SyncState }
  | { kind: 'legacy'; entries: LegacySyncState }
  | { kind: 'none' }

export function emptySyncState(): SyncState {
  return { version: 2, servers: {} }
}

export function emptyServerState(syncFolderPath: string | null): ServerSyncState {
  return { syncFolderPath, entries: {}, tombstones: [] }
}

/**
 * Le compartiment d'un serveur, créé EN PLACE s'il n'existe pas encore.
 *
 * La portée par serveur n'est pas un ornement : la suppression propagée repose
 * sur « un `file_id` que je connais et qui n'est plus dans la liste distante a
 * été supprimé ». Sans elle, changer d'URL dans les réglages ferait passer tous
 * les `file_id` pour supprimés.
 */
export function serverStateOf(state: SyncState, serverUrl: string, syncFolderPath: string | null): ServerSyncState {
  const existing = state.servers[serverUrl]
  if (existing !== undefined) return existing
  const created = emptyServerState(syncFolderPath)
  state.servers[serverUrl] = created
  return created
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSyncState(value: unknown): value is SyncState {
  return isRecord(value) && value.version === 2 && isRecord(value.servers)
}

export function migrateLegacyState(
  entries: LegacySyncState,
  serverUrl: string | null,
  syncFolderPath: string | null
): SyncState {
  const state = emptySyncState()
  // Sans serveur configuré, les entrées migrées n'ont aucun compartiment où
  // aller : c'est un cache, et le pire cas est une re-comparaison complète.
  if (serverUrl !== null && serverUrl !== '') {
    state.servers[serverUrl] = { syncFolderPath, entries, tombstones: [] }
  }
  return state
}

export function resolveSyncState(
  loaded: LoadedSyncState,
  serverUrl: string | null,
  syncFolderPath: string | null
): SyncState {
  if (loaded.kind === 'v2') return loaded.state
  if (loaded.kind === 'legacy') return migrateLegacyState(loaded.entries, serverUrl, syncFolderPath)
  return emptySyncState()
}

export async function loadSyncState(): Promise<LoadedSyncState> {
  try {
    const path = await stateFilePath()
    if (!(await exists(path))) return { kind: 'none' }
    const parsed: unknown = JSON.parse(await readTextFile(path))
    if (isSyncState(parsed)) return { kind: 'v2', state: parsed }
    if (isRecord(parsed)) return { kind: 'legacy', entries: parsed as LegacySyncState }
    return { kind: 'none' }
  } catch {
    return { kind: 'none' }
  }
}

/** Le document complet, résolu pour un serveur, avec son compartiment garanti. */
export async function loadServerSyncState(serverUrl: string, syncFolderPath: string | null): Promise<SyncState> {
  const state = resolveSyncState(await loadSyncState(), serverUrl, syncFolderPath)
  if (serverUrl !== '') serverStateOf(state, serverUrl, syncFolderPath)
  return state
}

async function stateFilePath(): Promise<string> {
  return join(await appConfigDir(), STATE_FILE_NAME)
}

export async function saveSyncState(state: SyncState): Promise<void> {
  const dir = await appConfigDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const path = await stateFilePath()
  await writeTextFile(path, JSON.stringify(state, null, 2))
}
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `bunx vitest run src/persistence/syncState.test.ts`
Expected: PASS.

- [ ] **Step 5: Adapter `surveySyncFolder` et `sync` à la nouvelle forme (sans changer leur logique)**

Dans `src/sync/syncService.ts`, remplacer l'import `type { SyncState, SyncStateEntry }` par la même chose plus `serverStateOf`, et changer la signature de `surveySyncFolder` : elle reçoit les **entrées** du compartiment, pas le document entier.

```ts
export async function surveySyncFolder(params: {
  syncFolderPath: string
  currentUser: string
  entries: Record<string, SyncStateEntry>
}): Promise<SyncSurvey> {
  const tree = await scanFolder(params.syncFolderPath)
  const survey: SyncSurvey = { pending: [], localOnly: [] }
  for (const path of flattenMindMapPaths(tree)) {
    const meta = await loadMindMapMeta(path).catch(() => undefined)
    if (meta === undefined) continue
    if (meta === null) survey.localOnly.push(path)
    else if (isPushPending(meta, params.currentUser, params.entries[meta.id])) survey.pending.push(path)
  }
  return survey
}
```

`SyncParams` gagne `currentRole: UserRole` et `serverUrl: string` — ce qui suppose d'ajouter `UserRole` à l'import de type depuis `../types/card` (`import type { MindMapMeta, UserRole } from '../types/card'`). `sync()` ouvre ensuite le compartiment et remplace ses trois usages de `state[x]` :

```ts
export async function sync({
  client,
  currentUser,
  serverUrl,
  syncFolderPath,
  state,
  signal,
  onProgress,
}: SyncParams): Promise<SyncResult> {
  // …
  const remoteByFileId = new Map(remoteRecords.map(record => [record.file_id, record]))

  const server = serverStateOf(state, serverUrl, syncFolderPath)
  const entries = server.entries
```

puis, dans `pushOne` : `const known = entries[meta.id]`, et à la fin d'un push réussi :
`entries[meta.id] = { lastSyncedModified: meta.lastModified, lastSyncedUpdated: savedRecord.updated }`.

Dans `pullOne` : `const known = entries[record.file_id]` et
`entries[record.file_id] = { lastSyncedModified: meta?.lastModified ?? record.updated, lastSyncedUpdated: record.updated }`.

**Ne pas extraire `currentRole` du destructuring dans cette tâche** : il n'est pas encore utilisé, et `noUnusedLocals` refuserait la compilation. Il le sera en Task 7.

- [ ] **Step 6: Adapter `src/state/useSyncStore.ts`**

Remplacer l'import `loadSyncState` par `loadServerSyncState, serverStateOf`, et les deux appels.

Dans `refreshPendingCount` :

```ts
const state = await loadServerSyncState(get().serverUrl, syncFolderPath)
const survey = await surveySyncFolder({
  syncFolderPath,
  currentUser: currentUser.username,
  entries: serverStateOf(state, get().serverUrl, syncFolderPath).entries,
})
```

Dans `syncNow` :

```ts
const state = await loadServerSyncState(serverUrl, syncFolderPath)
let result: SyncResult
try {
  result = await sync({
    client: createSyncClient(pb),
    currentUser: currentUser.username,
    currentRole: currentUser.role,
    serverUrl,
    syncFolderPath,
    state,
    signal: controller.signal,
    onProgress: (done, total) => set({ progress: { done, total } }),
  })
} finally {
  await saveSyncState(state)
}
```

- [ ] **Step 7: Mettre à jour les fixtures des tests existants**

`src/sync/syncService.test.ts` — ajouter deux aides sous `fakeClient`, puis remplacer les appels :

```ts
import { emptySyncState, type SyncState, type SyncStateEntry } from '../persistence/syncState'

/** Un document v2 avec les entrées voulues pour le serveur de test. */
function memory(entries: Record<string, SyncStateEntry> = {}, syncFolderPath: string | null = '/cours'): SyncState {
  return { version: 2, servers: { 'https://pb.test': { syncFolderPath, entries, tombstones: [] } } }
}

/** `sync` avec tout ce qui ne varie pas d'un test à l'autre. */
function runSync(params: Omit<Parameters<typeof sync>[0], 'serverUrl' | 'currentRole' | 'syncFolderPath' | 'currentUser'>) {
  return sync({ currentUser: 'aife', currentRole: 'prof', serverUrl: 'https://pb.test', syncFolderPath: '/cours', ...params })
}
```

- `await sync({ client, currentUser: 'aife', syncFolderPath: '/cours', state: {} })` → `await runSync({ client, state: emptySyncState() })`
- `state: { b: { … } }` → `state: memory({ b: { … } })`
- `surveySyncFolder({ syncFolderPath: '/cours', currentUser: 'aife', state: {} })` → `surveySyncFolder({ syncFolderPath: '/cours', currentUser: 'aife', entries: {} })`

`src/state/useSyncStore.test.ts` — le mock de module et les valeurs résolues :

```ts
vi.mock('../persistence/syncState', () => ({
  loadServerSyncState: vi.fn(),
  serverStateOf: vi.fn(),
  saveSyncState: vi.fn().mockResolvedValue(undefined),
}))
```

```ts
vi.mocked(loadServerSyncState).mockReset().mockResolvedValue({ version: 2, servers: {} })
vi.mocked(serverStateOf).mockReturnValue({ syncFolderPath: '/cours', entries: {}, tombstones: [] })
```

et l'assertion sur l'appel de `surveySyncFolder` (ligne ~165) passe de `state` à `entries: {}`.

`src/components/sidebar/FileSidebar.test.tsx` — le mock doit fournir la nouvelle fonction, sinon l'appel échoue à l'exécution :

```ts
vi.mock('../../persistence/syncState', () => ({
  loadServerSyncState: vi.fn().mockResolvedValue({ version: 2, servers: {} }),
  serverStateOf: vi.fn(() => ({ syncFolderPath: null, entries: {}, tombstones: [] })),
}))
```

- [ ] **Step 8: Lancer la suite complète et vérifier les types**

Run: `bun run test`
Expected: PASS — les tests de synchro existants passent sans changement de comportement.

Run: `bunx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 9: Committer**

```bash
git add src/persistence/syncState.ts src/persistence/syncState.test.ts src/sync/syncService.ts src/sync/syncService.test.ts src/state/useSyncStore.ts src/state/useSyncStore.test.ts src/components/sidebar/FileSidebar.test.tsx
git commit -m "refactor(sync): etat de synchronisation v2, indexe par serveur"
```

---

### Task 3: Les deux décisions pures du suivi de chemin

**Files:**
- Create: `src/sync/pathReconciliation.ts`
- Create: `src/sync/pathReconciliation.test.ts`

**Interfaces:**
- Consumes: rien (module pur, aucune dépendance Tauri ni réseau).
- Produces:
  - `seedLastSyncedPath({ lastSyncedPath, rootChanged, relPath, remotePath }): string`
  - `type PathAction = { kind: 'none' } | { kind: 'push-path' } | { kind: 'relocate'; to: string; bothMoved: boolean }`
  - `reconcilePath({ relPath, lastSyncedPath, remotePath }): PathAction`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// src/sync/pathReconciliation.test.ts
import { describe, it, expect } from 'vitest'
import { reconcilePath, seedLastSyncedPath } from './pathReconciliation'

describe('seedLastSyncedPath', () => {
  it('leaves a known path alone', () => {
    expect(
      seedLastSyncedPath({ lastSyncedPath: 'a.zmap', rootChanged: false, relPath: 'b.zmap', remotePath: 'c.zmap' })
    ).toBe('a.zmap')
  })

  it('seeds from the REMOTE path when the root is merely unknown (a migrated entry)', () => {
    // Racine présumée inchangée : un chemin distant périmé doit être réparé,
    // donc « j'ai bougé » doit devenir vrai.
    expect(
      seedLastSyncedPath({ lastSyncedPath: undefined, rootChanged: false, relPath: 'b.zmap', remotePath: 'a.zmap' })
    ).toBe('a.zmap')
  })

  it('seeds from the LOCAL path when the root actually changed', () => {
    // Le rangement local a changé de sens : on ne réécrit pas l'agencement du
    // serveur pour le suivre.
    expect(
      seedLastSyncedPath({ lastSyncedPath: undefined, rootChanged: true, relPath: 'b.zmap', remotePath: 'a.zmap' })
    ).toBe('b.zmap')
  })

  it('falls back to the local path when there is no remote record at all', () => {
    expect(
      seedLastSyncedPath({ lastSyncedPath: undefined, rootChanged: false, relPath: 'b.zmap', remotePath: undefined })
    ).toBe('b.zmap')
  })
})

describe('reconcilePath', () => {
  const base = { relPath: 'Chimie/atomes.zmap', lastSyncedPath: 'Chimie/atomes.zmap' }

  it('does nothing when nothing moved', () => {
    expect(reconcilePath({ ...base, remotePath: 'Chimie/atomes.zmap' })).toEqual({ kind: 'none' })
  })

  it('does nothing when there is no remote record: creating one sends the local path anyway', () => {
    expect(reconcilePath({ ...base, remotePath: undefined })).toEqual({ kind: 'none' })
  })

  it('pushes my path when I am the one who moved', () => {
    expect(reconcilePath({ relPath: 'Chimie/atomes 2.zmap', lastSyncedPath: 'Chimie/atomes.zmap', remotePath: 'Chimie/atomes.zmap' }))
      .toEqual({ kind: 'push-path' })
  })

  it('relocates locally when the server is the one that moved', () => {
    expect(reconcilePath({ relPath: 'Chimie/atomes.zmap', lastSyncedPath: 'Chimie/atomes.zmap', remotePath: 'Chimie/atomes du carbone.zmap' }))
      .toEqual({ kind: 'relocate', to: 'Chimie/atomes du carbone.zmap', bothMoved: false })
  })

  it('says nothing when both sides moved to the SAME path', () => {
    expect(reconcilePath({ relPath: 'Chimie/atomes 2.zmap', lastSyncedPath: 'Chimie/atomes.zmap', remotePath: 'Chimie/atomes 2.zmap' }))
      .toEqual({ kind: 'none' })
  })

  it('lets the server win when both sides moved differently, and says so', () => {
    expect(reconcilePath({ relPath: 'Chimie/a.zmap', lastSyncedPath: 'Chimie/atomes.zmap', remotePath: 'Chimie/b.zmap' }))
      .toEqual({ kind: 'relocate', to: 'Chimie/b.zmap', bothMoved: true })
  })
})
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `bunx vitest run src/sync/pathReconciliation.test.ts`
Expected: FAIL — `Failed to resolve import "./pathReconciliation"`.

- [ ] **Step 3: Écrire `src/sync/pathReconciliation.ts`**

```ts
/**
 * Les deux décisions pures du suivi de chemin. Elles vivent ici, hors de
 * `syncService`, pour être testables sans réseau, sans système de fichiers et
 * sans mock — c'est la partie du chantier où une erreur coûte un fichier
 * déplacé au mauvais endroit.
 */

export interface SeedParams {
  /** Le chemin mémorisé, ou `undefined` pour une entrée migrée/inconnue. */
  lastSyncedPath: string | undefined
  /** La racine mémorisée diffère de la racine courante. */
  rootChanged: boolean
  /** Le chemin relatif actuel du fichier local. */
  relPath: string
  /** Le `path` de l'enregistrement distant, `undefined` s'il n'y en a pas. */
  remotePath: string | undefined
}

/**
 * Le chemin de référence d'une entrée dont on ne sait rien.
 *
 * Inconnu (migration) et changé ne sont PAS le même cas : une racine présumée
 * inchangée laisse le chemin distant périmé se faire réparer (« j'ai bougé »),
 * tandis qu'une racine réellement changée ne doit surtout pas réécrire
 * l'agencement du serveur pour suivre le rangement local.
 */
export function seedLastSyncedPath({ lastSyncedPath, rootChanged, relPath, remotePath }: SeedParams): string {
  if (lastSyncedPath !== undefined) return lastSyncedPath
  if (rootChanged) return relPath
  return remotePath ?? relPath
}

export type PathAction =
  | { kind: 'none' }
  | { kind: 'push-path' }
  | { kind: 'relocate'; to: string; bothMoved: boolean }

export interface ReconcileParams {
  relPath: string
  lastSyncedPath: string
  remotePath: string | undefined
}

/**
 * Qui a bougé, et ce qu'il faut en faire. « Premier arrivé gagne, égalité → le
 * serveur » : aucune branche ne dépend du rôle, ce qui rend la règle valable
 * aussi bien pour l'élève dont le prof déplace un fichier que pour le prof qui
 * vient de déplacer.
 */
export function reconcilePath({ relPath, lastSyncedPath, remotePath }: ReconcileParams): PathAction {
  // Aucun enregistrement distant : la création enverra le chemin local, il n'y
  // a rien à réconcilier.
  if (remotePath === undefined) return { kind: 'none' }

  const iMoved = relPath !== lastSyncedPath
  const serverMoved = remotePath !== lastSyncedPath

  if (!iMoved && !serverMoved) return { kind: 'none' }
  if (iMoved && !serverMoved) return { kind: 'push-path' }
  if (!iMoved && serverMoved) return { kind: 'relocate', to: remotePath, bothMoved: false }
  // Les deux ont bougé.
  if (relPath === remotePath) return { kind: 'none' }
  return { kind: 'relocate', to: remotePath, bothMoved: true }
}
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `bunx vitest run src/sync/pathReconciliation.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Committer**

```bash
git add src/sync/pathReconciliation.ts src/sync/pathReconciliation.test.ts
git commit -m "feat(sync): qui a bouge, et ce qu'on en fait"
```

---

### Task 4: `planPush` — le compteur et la boucle partagent la même vérité

**Files:**
- Modify: `src/sync/syncService.ts`
- Modify: `src/sync/syncService.test.ts`
- Modify: `src/state/useSyncStore.ts` (passe le rôle au survey)

**Interfaces:**
- Consumes: `canReorder` (Task 1) ; `SyncStateEntry` (Task 2).
- Produces: `planPush({ meta, relPath, currentUser, entry }): { content: boolean; path: boolean }` — remplace `isPushPending`, qui disparaît.

- [ ] **Step 1: Écrire le test qui échoue (remplace le `describe('isPushPending')` existant)**

```ts
// src/sync/syncService.test.ts
import { planPush } from './syncService'
import type { SyncUser } from '../types/card'

const AIFE_USER: SyncUser = { username: 'aife', role: 'prof' }
const ELEVE_USER: SyncUser = { username: 'eleve1', role: 'eleve' }

describe('planPush', () => {
  const known = { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x', lastSyncedPath: 'a.zmap' }

  it('sends the content of a map we authored and changed', () => {
    expect(planPush({ meta: { ...AIFE, lastModified: '2026-01-02T00:00:00.000Z' }, relPath: 'a.zmap', currentUser: AIFE_USER, entry: known }))
      .toEqual({ content: true, path: false })
  })

  it('sends a map we authored and never pushed, content and path together', () => {
    expect(planPush({ meta: AIFE, relPath: 'a.zmap', currentUser: AIFE_USER, entry: undefined }))
      .toEqual({ content: true, path: true })
  })

  it('sends a renamed map for its path alone, with no content change', () => {
    expect(planPush({ meta: AIFE, relPath: 'Chimie/a.zmap', currentUser: AIFE_USER, entry: known }))
      .toEqual({ content: false, path: true })
  })

  it('sends nothing when neither content nor path moved', () => {
    expect(planPush({ meta: AIFE, relPath: 'a.zmap', currentUser: AIFE_USER, entry: known }))
      .toEqual({ content: false, path: false })
  })

  it('never sends the CONTENT of a map we do not author, however new it looks', () => {
    const scan = planPush({ meta: { ...AIFE, author: 'eleve1', lastModified: '2027-01-01T00:00:00.000Z' }, relPath: 'a.zmap', currentUser: AIFE_USER, entry: known })
    expect(scan.content).toBe(false)
  })

  it('lets a prof push the PATH of an eleve s map — that is how a class folder follows', () => {
    expect(planPush({ meta: { ...AIFE, author: 'eleve1' }, relPath: 'Chimie/a.zmap', currentUser: AIFE_USER, entry: known }))
      .toEqual({ content: false, path: true })
  })

  it('refuses an eleve the path of a map they do not own', () => {
    expect(planPush({ meta: { ...AIFE, author: 'aife' }, relPath: 'Chimie/a.zmap', currentUser: ELEVE_USER, entry: known }))
      .toEqual({ content: false, path: false })
  })
})
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `bunx vitest run src/sync/syncService.test.ts -t planPush`
Expected: FAIL — `planPush` n'est pas exporté.

- [ ] **Step 3: Écrire `planPush` et supprimer `isPushPending`**

Dans `src/sync/syncService.ts`, remplacer entièrement `isPushPending`. Le fichier importe déjà `MindMapMeta` depuis `../types/card` : **compléter cette ligne** au lieu d'en ajouter une seconde.

```ts
import type { MindMapMeta, SyncUser } from '../types/card'
import { canReorder } from './permissions'

export interface PushPlan {
  content: boolean
  path: boolean
}

/**
 * Ce qu'un sync enverrait pour ce fichier — contenu et chemin séparément.
 *
 * LE point de vérité unique, partagé par la boucle d'envoi et par le compteur
 * « à envoyer » de l'interface : le nombre affiché ne peut donc pas contredire
 * ce qu'un sync ferait réellement. Il intègre désormais le CHEMIN, sans quoi un
 * fichier simplement renommé resterait invisible dans le compteur tout en
 * n'étant jamais envoyé — le trou exact que ce chantier répare.
 *
 * Le contenu n'appartient qu'à son auteur. Le chemin suit `canReorder` : son
 * auteur, ou un prof.
 */
export function planPush(params: {
  meta: MindMapMeta
  relPath: string
  currentUser: SyncUser
  entry: SyncStateEntry | undefined
}): PushPlan {
  const { meta, relPath, currentUser, entry } = params
  const content = meta.author === currentUser.username && (entry === undefined || entry.lastSyncedModified < meta.lastModified)
  // Entrée absente : l'enregistrement n'existe pas encore, donc le `create`
  // enverra le chemin de toute façon — inutile de le compter deux fois.
  const path = entry !== undefined && entry.lastSyncedPath !== relPath && canReorder(meta, currentUser)
  return { content, path }
}
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `bunx vitest run src/sync/syncService.test.ts -t planPush`
Expected: PASS — 7 tests.

- [ ] **Step 5: Brancher le compteur sur `planPush`, avec le rôle**

`surveySyncFolder` reçoit l'utilisateur complet :

```ts
export async function surveySyncFolder(params: {
  syncFolderPath: string
  currentUser: SyncUser
  entries: Record<string, SyncStateEntry>
}): Promise<SyncSurvey> {
  const tree = await scanFolder(params.syncFolderPath)
  const survey: SyncSurvey = { pending: [], localOnly: [] }
  for (const path of flattenMindMapPaths(tree)) {
    const meta = await loadMindMapMeta(path).catch(() => undefined)
    if (meta === undefined) continue
    if (meta === null) {
      survey.localOnly.push(path)
      continue
    }
    const plan = planPush({
      meta,
      relPath: relativeTo(params.syncFolderPath, path),
      currentUser: params.currentUser,
      entry: params.entries[meta.id],
    })
    if (plan.content || plan.path) survey.pending.push(path)
  }
  return survey
}
```

Dans `useSyncStore.refreshPendingCount`, passer l'utilisateur :

```ts
const survey = await surveySyncFolder({
  syncFolderPath,
  currentUser,
  entries: serverStateOf(state, get().serverUrl, syncFolderPath).entries,
})
```

- [ ] **Step 6: Mettre à jour les tests de `surveySyncFolder`**

Les deux tests existants passent `currentUser: 'aife'` : remplacer par l'objet, et ajouter un cas.

```ts
it('counts a renamed file as pending, which it never did before', async () => {
  vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a 2.zmap', path: '/cours/a 2.zmap' }])
  vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)

  const survey = await surveySyncFolder({
    syncFolderPath: '/cours',
    currentUser: AIFE_USER,
    entries: { 'file-1': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x', lastSyncedPath: 'a.zmap' } },
  })

  expect(survey.pending).toEqual(['/cours/a 2.zmap'])
})
```

- [ ] **Step 7: Lancer la suite complète et vérifier les types**

Run: `bun run test`
Expected: PASS — l'ancien `describe('isPushPending')` a été remplacé, aucun autre appelant ne subsiste (`grep -rn "isPushPending" src` ne renvoie rien).

Run: `bunx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 8: Committer**

```bash
git add src/sync/syncService.ts src/sync/syncService.test.ts src/state/useSyncStore.ts
git commit -m "feat(sync): le compteur a envoyer connait aussi les chemins"
```

---

### Task 5: Le conflit se juge sur le contenu

**Files:**
- Create: `src/sync/contentHash.ts`
- Create: `src/sync/contentHash.test.ts`
- Modify: `src/sync/syncService.ts`
- Modify: `src/sync/syncService.test.ts`

**Interfaces:**
- Consumes: `SyncStateEntry` (Task 2).
- Produces: `hashContent(content: string): Promise<string>` depuis `src/sync/contentHash.ts` ; `isConflict(meta, entry, remote, remoteContentHash)` — la signature gagne un quatrième paramètre.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// src/sync/contentHash.test.ts
import { describe, it, expect } from 'vitest'
import { hashContent } from './contentHash'

describe('hashContent', () => {
  it('is stable for the same content', async () => {
    expect(await hashContent('{"cards":[]}')).toBe(await hashContent('{"cards":[]}'))
  })

  it('changes as soon as the content does', async () => {
    expect(await hashContent('{"cards":[]}')).not.toBe(await hashContent('{"cards":[1]}'))
  })

  it('is a short hex digest, cheap to store per file', async () => {
    expect(await hashContent('x')).toMatch(/^[0-9a-f]{16}$/)
  })
})
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `bunx vitest run src/sync/contentHash.test.ts`
Expected: FAIL — `Failed to resolve import "./contentHash"`.

- [ ] **Step 3: Écrire `src/sync/contentHash.ts`**

```ts
/**
 * L'empreinte du contenu sérialisé d'une carte, telle qu'elle a été poussée ou
 * tirée. Elle sert à une seule chose, mais décisive : distinguer « le serveur a
 * bougé » de « le serveur a bougé SEULEMENT son chemin ». Un déplacement de prof
 * bumpe `updated` ; sans cette empreinte, l'élève resterait bloqué en conflit à
 * chaque sync, indéfiniment, pour un simple rangement.
 *
 * Même recette que les assets (`assets.ts`) : SHA-256, tronqué à 8 octets en
 * hexadécimal — assez pour détecter un changement, pas de quoi pavoiser
 * cryptographiquement.
 */
export async function hashContent(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest).slice(0, 8)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `bunx vitest run src/sync/contentHash.test.ts`
Expected: PASS.

- [ ] **Step 5: Écrire le test de `isConflict` (remplace le `describe('isConflict')` existant)**

```ts
describe('isConflict', () => {
  const entry = { lastSyncedModified: 'm1', lastSyncedUpdated: 'u1', lastSyncedContentHash: 'aaaa' }
  const remote = { id: 'r', file_id: 'file-1', author: 'aife', path: 'a.zmap', content: '{}', updated: 'u2' }

  it('is a conflict when the remote CONTENT changed and so did mine', () => {
    expect(isConflict({ ...AIFE, lastModified: 'm2' }, entry, remote, 'bbbb')).toBe(true)
  })

  it('is NOT a conflict when the remote content is the one I already have — a path-only change', () => {
    // Le prof a déplacé le fichier : `updated` a bougé, le contenu non.
    expect(isConflict({ ...AIFE, lastModified: 'm2' }, entry, remote, 'aaaa')).toBe(false)
  })

  it('is not a conflict when I did not touch my copy', () => {
    expect(isConflict(AIFE, entry, remote, 'bbbb')).toBe(false)
  })

  it('is not a conflict when there is nothing to disagree with', () => {
    expect(isConflict({ ...AIFE, lastModified: 'm2' }, undefined, remote, 'bbbb')).toBe(false)
    expect(isConflict({ ...AIFE, lastModified: 'm2' }, entry, undefined, 'bbbb')).toBe(false)
  })

  it('falls back to the revision when the hash is unknown, as in a migrated entry', () => {
    const migrated = { lastSyncedModified: 'm1', lastSyncedUpdated: 'u1' }
    expect(isConflict({ ...AIFE, lastModified: 'm2' }, migrated, remote, 'bbbb')).toBe(true)
    expect(isConflict({ ...AIFE, lastModified: 'm2' }, { ...migrated, lastSyncedUpdated: 'u9' }, remote, 'bbbb')).toBe(false)
  })
})
```

- [ ] **Step 6: Lancer le test et vérifier qu'il échoue**

Run: `bunx vitest run src/sync/syncService.test.ts -t isConflict`
Expected: FAIL — la fonction n'accepte que trois arguments / l'ancien test de révision échoue.

- [ ] **Step 7: Réécrire `isConflict`**

```ts
/**
 * Si les deux côtés se contredisent sur le CONTENU.
 *
 * La comparaison porte sur l'empreinte du contenu distant, pas sur la seule
 * révision : une écriture distante qui n'a touché que le `path` (un déplacement
 * de prof) bumpe `updated` sans rien changer au contenu, et une comparaison de
 * révisions bloquerait alors l'auteur en « conflit » à chaque sync, pour
 * toujours. L'égalité des empreintes dit exactement ce qu'on veut savoir :
 * personne n'a écrit de contenu que je n'aie pas vu.
 *
 * Une entrée migrée n'a pas d'empreinte : on retombe sur la comparaison de
 * révisions d'avant, qui reste juste, simplement plus bruyante.
 */
export function isConflict(
  meta: MindMapMeta,
  stateEntry: SyncStateEntry | undefined,
  remote: RemoteMindMapRecord | undefined,
  remoteContentHash: string
): remote is RemoteMindMapRecord {
  if (stateEntry === undefined || remote === undefined) return false
  if (meta.lastModified <= stateEntry.lastSyncedModified) return false
  if (stateEntry.lastSyncedContentHash === undefined) return remote.updated > stateEntry.lastSyncedUpdated
  return stateEntry.lastSyncedContentHash !== remoteContentHash
}
```

- [ ] **Step 8: Lancer la suite complète et vérifier les types**

Run: `bun run test`
Expected: PASS. L'appel de `isConflict` dans `pushOne` doit être adapté au quatrième paramètre. Tant que la Task 7 n'a pas posé le push par champ, l'empreinte du contenu distant se calcule à la volée — c'est exactement l'information que `isConflict` attend, et elle est déjà en mémoire puisqu'on est en train de comparer :

```ts
const remote = remoteByFileId.get(meta.id)
if (isConflict(meta, known, remote, remote === undefined ? '' : await hashContent(remote.content))) {
```

Run: `bunx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 9: Committer**

```bash
git add src/sync/contentHash.ts src/sync/contentHash.test.ts src/sync/syncService.ts src/sync/syncService.test.ts
git commit -m "fix(sync): un deplacement de prof ne bloque plus l'eleve en conflit"
```

---

### Task 6: Une seule lecture des `meta`, et la passe de réconciliation

**Files:**
- Modify: `src/sync/syncService.ts`
- Modify: `src/sync/syncService.test.ts`

**Interfaces:**
- Consumes: `seedLastSyncedPath`, `reconcilePath` (Task 3) ; `serverStateOf` (Task 2).
- Produces:
  - `type LocalMapScan` (union discriminée `map` / `local-only` / `not-a-map` / `unreadable`) et `type MapScan = Extract<LocalMapScan, { kind: 'map' }>`
  - `scanLocalMaps(syncFolderPath): Promise<LocalMapScan[]>` — un `loadMindMapMeta` par fichier pour tout le passage
  - `SyncResult.moved: { fileId: string; from: string; to: string }[]` (chemins **absolus**), `SyncResult.relocated: number`, `SyncResult.notices: { fileId: string; message: string }[]`

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
describe('sync — reconciliation des chemins', () => {
  it('relocates the local file when the server moved it, instead of leaving a duplicate behind', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(exists).mockResolvedValue(false)
    const remote: RemoteMindMapRecord = {
      id: 'rec-1', file_id: 'file-1', author: 'aife', path: 'Chimie/a du carbone.zmap',
      content: JSON.stringify({ cards: [] }), updated: 'u1',
    }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([remote]) } as any })

    const result = await runSync({
      client,
      state: memory({ 'file-1': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'u0', lastSyncedPath: 'a.zmap' } }),
    })

    expect(rename).toHaveBeenCalledWith('/cours/a.zmap', '/cours/Chimie/a du carbone.zmap')
    expect(result.relocated).toBe(1)
    expect(result.moved).toEqual([{ fileId: 'file-1', from: '/cours/a.zmap', to: '/cours/Chimie/a du carbone.zmap' }])
  })

  it('reports a relocation that would collide instead of destroying what is already there', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    vi.mocked(exists).mockResolvedValue(true)
    const remote: RemoteMindMapRecord = {
      id: 'rec-1', file_id: 'file-1', author: 'aife', path: 'Chimie/a.zmap',
      content: JSON.stringify({ cards: [] }), updated: 'u1',
    }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([remote]) } as any })

    const result = await runSync({
      client,
      state: memory({ 'file-1': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'u0', lastSyncedPath: 'a.zmap' } }),
    })

    expect(rename).not.toHaveBeenCalled()
    expect(result.relocated).toBe(0)
    expect(result.errors[0]?.message).toContain('existe déjà')
  })

  it('leaves everything alone when the sync folder itself changed', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/autre/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue(AIFE)
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([]) } as any })

    await runSync({
      client,
      syncFolderPath: '/autre',
      state: { version: 2, servers: { 'https://pb.test': { syncFolderPath: '/cours', entries: { 'file-1': { lastSyncedModified: 'm0', lastSyncedUpdated: 'u0', lastSyncedPath: 'a.zmap' } }, tombstones: [] } } },
    })

    expect(rename).not.toHaveBeenCalled()
  })

  it('repairs a path the pre-v2 versions left stale, on the first sync after the migration', async () => {
    // Entrée migrée : `lastSyncedPath` inconnu. La racine n'a pas bougé, donc
    // l'amarrage prend le chemin DISTANT — ce qui rend « j'ai bougé » vrai et
    // déclenche enfin l'envoi du chemin que le renommage n'avait jamais poussé.
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'Chapitre 2.zmap', path: '/cours/Chapitre 2.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue({ ...AIFE, lastModified: '2026-01-05T00:00:00.000Z' })
    vi.mocked(loadMindMap).mockResolvedValue([])
    const update = vi.fn().mockResolvedValue({ id: 'rec-1', file_id: 'file-1', author: 'aife', path: 'Chapitre 2.zmap', content: 'c', updated: 'u2' })
    const client = fakeClient({
      mindMaps: {
        getFullList: vi.fn().mockResolvedValue([{ id: 'rec-1', file_id: 'file-1', author: 'aife', path: 'Chapitre 1.zmap', content: 'vieux', updated: 'u1' }]),
        update,
      } as any,
    })

    await runSync({
      client,
      // Entrée SANS `lastSyncedPath` : c'est la signature d'une entrée migrée.
      state: memory({ 'file-1': { lastSyncedModified: '2026-01-01T00:00:00.000Z', lastSyncedUpdated: 'u1' } }),
    })

    expect(update).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `bunx vitest run src/sync/syncService.test.ts -t "reconciliation"`
Expected: FAIL — `rename` n'est jamais appelé, `result.relocated` est `undefined`.

Note : `rename` doit être ajouté au mock de `@tauri-apps/plugin-fs` en tête de fichier, et importé :

```ts
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(false),
  writeTextFile: vi.fn(),
  readTextFile: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  rename: vi.fn(),
}))
```

et dans le `beforeEach` : `vi.mocked(rename).mockReset().mockResolvedValue(undefined)`.

- [ ] **Step 3: Écrire `scanLocalMaps`**

Dans `src/sync/syncService.ts` :

```ts
export type LocalMapScan =
  | { path: string; kind: 'map'; meta: MindMapMeta }
  | { path: string; kind: 'local-only' }
  | { path: string; kind: 'not-a-map' }
  | { path: string; kind: 'unreadable'; error: unknown }

/**
 * L'entrée « carte lisible », extraite de l'union : `Extract` plutôt qu'une
 * intersection `LocalMapScan & { kind: 'map' }`, qui laisserait les autres
 * membres accessibles et ferait échouer l'accès à `.meta`.
 */
export type MapScan = Extract<LocalMapScan, { kind: 'map' }>

/**
 * Une seule lecture de `meta` par fichier, pour tout le passage.
 *
 * La réconciliation des chemins et la boucle d'envoi ont besoin de la même
 * information ; la lire deux fois doublerait les accès disque d'un dossier
 * entier à chaque sync. Les quatre cas sont distingués ici une fois pour
 * toutes — `.json` qui n'est pas une carte (silence, ce n'est pas à nous),
 * carte sans identité de sync (le compteur « à publier »), fichier illisible
 * (une vraie erreur, reportée).
 */
export async function scanLocalMaps(syncFolderPath: string): Promise<LocalMapScan[]> {
  const tree = await scanFolder(syncFolderPath)
  const scans: LocalMapScan[] = []
  for (const path of flattenMindMapPaths(tree)) {
    try {
      const meta = await loadMindMapMeta(path)
      scans.push(meta === null ? { path, kind: 'local-only' } : { path, kind: 'map', meta })
    } catch (error) {
      scans.push((await isNonMindMapFile(path)) ? { path, kind: 'not-a-map' } : { path, kind: 'unreadable', error })
    }
  }
  return scans
}
```

- [ ] **Step 4: Écrire la passe de réconciliation dans `sync()`**

```ts
import { renamePath } from '../persistence/fileOps'
import { seedLastSyncedPath, reconcilePath } from './pathReconciliation'

  // ── Passe 1 : réconciliation des chemins ────────────────────────────────
  //
  // Avant tout le reste, et pour TOUT LE MONDE : le tirage ignore les
  // enregistrements dont on est l'auteur, donc sans cette passe un fichier que
  // le serveur a déplacé ne serait jamais ramené à sa place.
  const rootChanged = server.syncFolderPath !== null && server.syncFolderPath !== syncFolderPath
  server.syncFolderPath = syncFolderPath

  const scans = await scanLocalMaps(syncFolderPath)

  async function reconcileOne(scan: MapScan): Promise<void> {
    const entry = entries[scan.meta.id]
    if (entry === undefined) return // jamais synchronisé : la création enverra le chemin
    const remote = remoteByFileId.get(scan.meta.id)
    const lastSyncedPath = seedLastSyncedPath({
      lastSyncedPath: entry.lastSyncedPath,
      rootChanged,
      relPath: relativeTo(syncFolderPath, scan.path),
      remotePath: remote?.path,
    })
    entry.lastSyncedPath = lastSyncedPath

    const action = reconcilePath({
      relPath: relativeTo(syncFolderPath, scan.path),
      lastSyncedPath,
      remotePath: remote?.path,
    })
    if (action.kind !== 'relocate') return

    const destination = await join(syncFolderPath, action.to)
    try {
      if (await exists(destination)) {
        result.errors.push({
          fileId: scan.meta.id,
          message: `impossible de replacer « ${relativeTo(syncFolderPath, scan.path)} » : « ${action.to} » existe déjà`,
        })
        return
      }
      await ensureLocalFolder(destination)
      await renamePath(scan.path, destination)
      const from = scan.path
      scan.path = destination
      entry.lastSyncedPath = action.to
      result.relocated += 1
      result.moved.push({ fileId: scan.meta.id, from, to: destination })
      if (action.bothMoved) {
        result.notices.push({ fileId: scan.meta.id, message: `« ${action.to} » a été déplacé des deux côtés : le chemin du serveur a été appliqué` })
      }
    } catch (error) {
      result.errors.push({ fileId: scan.meta.id, message: describeSyncError(error) })
    }
  }

  for (const scan of scans) {
    if (aborted()) {
      result.cancelled = true
      break
    }
    if (scan.kind === 'map') await reconcileOne(scan)
  }
```

`SyncResult` gagne donc :

```ts
export interface SyncResult {
  // …champs existants…
  /** Combien de fichiers locaux ont suivi un chemin décidé ailleurs. */
  relocated: number
  /** Le détail, en chemins ABSOLUS : l'interface en a besoin pour suivre le fichier ouvert. */
  moved: { fileId: string; from: string; to: string }[]
  /** Ce qui n'est ni un échec ni un transfert : « les deux côtés avaient bougé ». */
  notices: { fileId: string; message: string }[]
}
```

et l'initialisation de `result` dans `sync()` gagne `relocated: 0, moved: [], notices: []`.

- [ ] **Step 5: Faire consommer les scans par la boucle d'envoi**

Remplacer, dans `sync()` :

```ts
const localTree = await scanFolder(syncFolderPath)
const localPaths = flattenMindMapPaths(localTree)
```

par la réutilisation des scans (construits à l'étape précédente, **après** la réconciliation, donc avec les chemins à jour) :

```ts
  const total = scans.length + remoteRecords.length
```

et la boucle d'envoi devient :

```ts
  for (const scan of scans) {
    if (aborted()) {
      result.cancelled = true
      break
    }
    if (scan.kind === 'unreadable') {
      result.errors.push({ fileId: scan.path, message: describeSyncError(scan.error) })
    } else if (scan.kind === 'map') {
      await pushOne(scan)
    }
    report()
    if (result.cancelled) break
  }
```

`pushOne` prend désormais le scan au lieu d'un chemin, et ne relit plus `meta` :

```ts
  async function pushOne(scan: MapScan): Promise<void> {
    const meta = scan.meta
    if (meta.author !== currentUser) return

    if (seenFileIds.has(meta.id)) {
      result.errors.push({ fileId: meta.id, message: 'plusieurs fichiers locaux partagent le même identifiant de synchronisation' })
      return
    }
    seenFileIds.add(meta.id)

    const known = entries[meta.id]
    const remote = remoteByFileId.get(meta.id)
    const plan = planPush({ meta, relPath: relativeTo(syncFolderPath, scan.path), currentUser: viewer, entry: known })
    if (!plan.content && !plan.path) return

    // Le reste du corps est celui d'aujourd'hui, avec exactement trois
    // remplacements — plus aucun `loadMindMapMeta` ici, le scan l'a déjà fait :
    //   const cards = await loadMindMap(scan.path)
    //   const relPath = relativeTo(syncFolderPath, scan.path)
    //   await pushAssetsFor(client, scan.path, knownHashes, { signal })
    // (le conflit, lui, est déjà branché sur l'empreinte depuis la Task 5)
  }
```

où `viewer` est construit une fois au début de `sync()` — et `currentRole` doit donc **entrer dans le destructuring** de `sync()` à cette étape, puisqu'il devient enfin utilisé (il ne l'était pas en Task 2, où `noUnusedLocals` l'aurait refusé) :

```ts
export async function sync({
  client,
  currentUser,
  currentRole,
  serverUrl,
  syncFolderPath,
  state,
  signal,
  onProgress,
}: SyncParams): Promise<SyncResult> {
  // …
  const viewer: SyncUser = { username: currentUser, role: currentRole }
```

- [ ] **Step 6: Lancer les tests et vérifier qu'ils passent**

Run: `bunx vitest run src/sync/syncService.test.ts`
Expected: PASS, y compris les trois nouveaux tests de réconciliation et tous les anciens (progression, assets, doublon d'identifiant, journal des transferts).

- [ ] **Step 7: Vérifier les types et committer**

Run: `bunx tsc --noEmit`
Expected: aucune erreur.

```bash
git add src/sync/syncService.ts src/sync/syncService.test.ts
git commit -m "feat(sync): une passe de reconciliation des chemins avant le push"
```

---

### Task 7: Push par champ, et le chemin mémorisé partout où il change

**Files:**
- Modify: `src/sync/syncService.ts`
- Modify: `src/sync/syncService.test.ts`
- Modify: `src/state/useSyncStore.ts`
- Modify: `src/sync/pocketBaseAdapter.ts`

**Interfaces:**
- Consumes: `planPush` (Task 4), `hashContent` (Task 5), la passe de réconciliation (Task 6).
- Produces: `MindMapsApi.update(id, data: { path?: string; content?: string }, options?)`, `SyncResult` complété, `SyncStateEntry` écrit avec `lastSyncedPath` + `lastSyncedContentHash` à chaque push et à chaque pull.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
describe('sync — push par champ', () => {
  it('sends only the content when the author edited, leaving the path the prof set alone', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'Chimie/a.zmap', path: '/cours/Chimie/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue({ ...AIFE, lastModified: '2026-02-01T00:00:00.000Z' })
    vi.mocked(loadMindMap).mockResolvedValue([])
    const update = vi.fn().mockResolvedValue({ id: 'rec-1', file_id: 'file-1', author: 'aife', path: 'Chimie/a.zmap', content: 'c', updated: 'u2' })
    const client = fakeClient({
      mindMaps: {
        getFullList: vi.fn().mockResolvedValue([{ id: 'rec-1', file_id: 'file-1', author: 'aife', path: 'Chimie/a.zmap', content: 'vieux', updated: 'u1' }]),
        update,
      } as any,
    })

    await runSync({
      client,
      state: memory({ 'file-1': { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'u1', lastSyncedPath: 'Chimie/a.zmap' } }),
    })

    expect(update).toHaveBeenCalledWith('rec-1', { content: expect.any(String) }, expect.anything())
    expect(vi.mocked(update).mock.calls[0][1]).not.toHaveProperty('path')
  })

  it('sends only the path when a prof moved an eleve s map, and never rewrites its content revision', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'Chimie/b.zmap', path: '/cours/Chimie/b.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue({ ...AIFE, id: 'file-2', author: 'eleve1', role: 'eleve' })
    const update = vi.fn().mockResolvedValue({ id: 'rec-2', file_id: 'file-2', author: 'eleve1', path: 'Chimie/b.zmap', content: 'x', updated: 'u9' })
    const client = fakeClient({
      mindMaps: {
        getFullList: vi.fn().mockResolvedValue([{ id: 'rec-2', file_id: 'file-2', author: 'eleve1', path: 'b.zmap', content: 'x', updated: 'u1' }]),
        update,
      } as any,
    })
    const state = memory({ 'file-2': { lastSyncedModified: 'm-eleve', lastSyncedUpdated: 'u1', lastSyncedPath: 'b.zmap', lastSyncedContentHash: await hashContent('x') } })

    await runSync({ client, state })

    expect(update).toHaveBeenCalledWith('rec-2', { path: 'Chimie/b.zmap' }, expect.anything())
    // La révision de CONTENU vue par ce client ne doit pas bouger : un prof
    // n'écrit pas le contenu d'un élève.
    expect(state.servers['https://pb.test'].entries['file-2'].lastSyncedModified).toBe('m-eleve')
  })

  it('refuses to push the path of an eleve s map when the account is an eleve', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'Chimie/b.zmap', path: '/cours/Chimie/b.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue({ ...AIFE, id: 'file-2', author: 'aife' })
    const update = vi.fn()
    const client = fakeClient({ mindMaps: { update } as any })

    await runSync({
      client,
      currentUser: 'eleve1',
      currentRole: 'eleve',
      state: memory({ 'file-2': { lastSyncedModified: 'm', lastSyncedUpdated: 'u1', lastSyncedPath: 'b.zmap' } }),
    })

    expect(update).not.toHaveBeenCalled()
  })

  it('remembers the path and the content hash after a pull, so the next run compares like with like', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    vi.mocked(exists).mockResolvedValue(false)
    const content = JSON.stringify({ cards: [] })
    const client = fakeClient({
      mindMaps: {
        getFullList: vi.fn().mockResolvedValue([{ id: 'r', file_id: 'file-9', author: 'prof', path: 'sous/c.zmap', content, updated: 'u3' }]),
      } as any,
    })
    const state = memory()

    await runSync({ client, state })

    expect(state.servers['https://pb.test'].entries['file-9']).toEqual({
      lastSyncedModified: 'u3',
      lastSyncedUpdated: 'u3',
      lastSyncedPath: 'sous/c.zmap',
      lastSyncedContentHash: await hashContent(content),
    })
  })
})
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `bunx vitest run src/sync/syncService.test.ts -t "push par champ"`
Expected: FAIL — `update` reçoit `{ path, content }` dans tous les cas.

- [ ] **Step 3: Rendre `update` partiel dans l'interface et l'adaptateur**

`src/sync/syncService.ts` :

```ts
export interface MindMapsApi {
  getFullList(options?: RequestOptions): Promise<RemoteMindMapRecord[]>
  create(
    data: { file_id: string; author: string; path: string; content: string },
    options?: RequestOptions
  ): Promise<RemoteMindMapRecord>
  /**
   * Un payload PARTIEL, et c'est le cœur du partage de l'agencement : PocketBase
   * fait un PATCH, donc un champ absent est laissé intact côté serveur. L'auteur
   * envoie `{ content }` et ne peut pas écraser le chemin choisi par un prof ; un
   * prof envoie `{ path }` sans jamais toucher au contenu.
   */
  update(
    id: string,
    data: { path?: string; content?: string },
    options?: RequestOptions
  ): Promise<RemoteMindMapRecord>
}
```

`src/sync/pocketBaseAdapter.ts` : aucun changement — `mindMapsCollection.update(id, data, options)` transmet déjà l'objet tel quel au SDK, qui le passe en corps de PATCH. **Vérifier** que le typage générique accepte un objet partiel ; si `tsc` proteste, typer le paramètre de l'adaptateur en `{ path?: string; content?: string }` plutôt que le type du SDK.

- [ ] **Step 4: Envoyer par champ dans `pushOne`**

```ts
    try {
      const cards = await loadMindMap(scan.path)
      if (cards === null) return
      const content = serializeMindMap(meta, cards)
      const contentHash = await hashContent(content)
      const relPath = relativeTo(syncFolderPath, scan.path)
      const existing = remoteByFileId.get(meta.id)

      // Les assets AVANT l'enregistrement qui les référence — inchangé.
      await pushAssetsFor(client, scan.path, knownHashes, { signal })

      let saved: RemoteMindMapRecord
      if (existing === undefined) {
        saved = await client.mindMaps.create({ file_id: meta.id, author: meta.author, path: relPath, content }, { signal })
      } else {
        // Le champ qu'on a le droit d'écrire, et lui seul : le contenu à son
        // auteur, le chemin à qui peut réarranger. Envoyer les deux à chaque
        // fois laisserait l'élève annuler sans le savoir le rangement du prof.
        const payload: { path?: string; content?: string } = {}
        if (plan.content) payload.content = content
        if (plan.path) payload.path = relPath
        saved = await client.mindMaps.update(existing.id, payload, { signal })
      }

      entries[meta.id] = {
        // Un push de chemin SEUL ne réécrit pas la révision de contenu vue par
        // ce client : un prof n'écrit pas le contenu d'un élève.
        lastSyncedModified: plan.content ? meta.lastModified : (known?.lastSyncedModified ?? meta.lastModified),
        lastSyncedUpdated: saved.updated,
        lastSyncedPath: relPath,
        lastSyncedContentHash: plan.content ? contentHash : known?.lastSyncedContentHash,
      }
      result.pushed += 1
      result.transferred.push({ fileId: meta.id, path: relPath, direction: 'push' })
    } catch (error) {
      // …inchangé…
    }
```

Le `plan` est celui calculé à l'étape 5 de la Task 6, dans le même appel.

- [ ] **Step 5: Mémoriser chemin et empreinte au tirage**

Dans `pullOne`, à la fin :

```ts
      entries[record.file_id] = {
        lastSyncedModified: meta?.lastModified ?? record.updated,
        lastSyncedUpdated: record.updated,
        lastSyncedPath: record.path,
        lastSyncedContentHash: await hashContent(record.content),
      }
```

- [ ] **Step 6: Journaliser les déplacements dans le store**

Dans `useSyncStore.syncNow`, après la journalisation des transferts :

```ts
          if (get().verboseLog) {
            for (const moved of result.moved) {
              await logSyncEvent('debug', `déplacé « ${moved.from} » vers « ${moved.to} »`, { fileId: moved.fileId })
            }
          }
```

- [ ] **Step 7: Lancer la suite complète et vérifier les types**

Run: `bun run test`
Expected: PASS.

Run: `bunx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 8: Committer**

```bash
git add src/sync/syncService.ts src/sync/syncService.test.ts src/state/useSyncStore.ts src/sync/pocketBaseAdapter.ts
git commit -m "feat(sync): le contenu a son auteur, le chemin a qui peut rearranger"
```

---

### Task 8: Le compte rendu dit les déplacements

**Files:**
- Modify: `src/sync/syncResultLabel.ts`
- Modify: `src/sync/syncResultLabel.test.ts`

**Interfaces:**
- Consumes: `SyncResult.relocated`, `SyncResult.notices` (Tasks 6-7).
- Produces: rien de nouveau côté API — la fonction garde sa signature.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `src/sync/syncResultLabel.test.ts`, et compléter le helper `result()` avec les nouveaux champs :

```ts
function result(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    pushed: 0, pulled: 0, errors: [], cancelled: false, conflicts: [], transferred: [],
    relocated: 0, moved: [], notices: [],
    ...overrides,
  }
}

  it('says how many files followed a path decided elsewhere', () => {
    expect(syncResultLabel(result({ relocated: 2 }))).toBe('0 envoyé(s), 0 reçu(s), 2 déplacé(s)')
  })

  it('counts a both-sides move as a remark, not as a failure', () => {
    const notices = [{ fileId: 'file-1', message: 'déplacé des deux côtés' }]
    expect(syncResultLabel(result({ relocated: 1, notices }))).toBe('0 envoyé(s), 0 reçu(s), 1 déplacé(s), 1 remarque(s)')
  })
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `bunx vitest run src/sync/syncResultLabel.test.ts`
Expected: FAIL — la chaîne ne contient pas « déplacé ».

- [ ] **Step 3: Étendre `syncResultLabel`**

```ts
export function syncResultLabel(result: SyncResult): string {
  const parts = [`${result.pushed} envoyé(s)`, `${result.pulled} reçu(s)`]
  // Un déplacement n'est ni un envoi ni une réception : sans cette ligne, une
  // sync qui n'a fait que replacer des fichiers se lirait « 0 envoyé(s) », soit
  // exactement la confusion que le compteur « à envoyer » évite par ailleurs.
  if (result.relocated > 0) parts.push(`${result.relocated} déplacé(s)`)
  if (result.conflicts.length > 0) parts.push(`${result.conflicts.length} conflit(s)`)
  if (result.notices.length > 0) parts.push(`${result.notices.length} remarque(s)`)
  if (result.errors.length > 0) parts.push(`${result.errors.length} erreur(s)`)
  return `${parts.join(', ')}${result.cancelled ? ' (interrompue)' : ''}`
}
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `bunx vitest run src/sync/syncResultLabel.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Committer**

```bash
git add src/sync/syncResultLabel.ts src/sync/syncResultLabel.test.ts
git commit -m "feat(sync): le compte rendu dit les deplacements"
```

---

### Task 9: L'arbre suit un déplacement décidé par la synchro

**Files:**
- Modify: `src/components/sidebar/FileSidebar.tsx`
- Modify: `src/components/sidebar/FileSidebar.test.tsx`

**Interfaces:**
- Consumes: `SyncResult.relocated`, `SyncResult.moved` (Task 6).
- Produces: comportement d'interface seulement.

- [ ] **Step 1: Écrire le test qui échoue**

Dans `src/components/sidebar/FileSidebar.test.tsx` (suivre le style des tests de synchro déjà présents dans ce fichier) :

```tsx
it('re-points the open file and refreshes the folder after a relocation', async () => {
  vi.mocked(syncNow).mockImplementation(async () => {
    useSyncStore.setState({
      lastResult: {
        pushed: 0, pulled: 0, errors: [], cancelled: false, conflicts: [], transferred: [],
        relocated: 1,
        moved: [{ fileId: 'file-1', from: '/cours/a.zmap', to: '/cours/Chimie/a.zmap' }],
        notices: [],
      },
    })
  })
  useWorkspaceStore.setState({ currentFilePath: '/cours/a.zmap' })
  useSyncStore.setState({ syncFolderPath: '/cours' })

  await userEvent.click(screen.getByRole('button', { name: /synchroniser/i }))

  // Le fichier ouvert a été replacé : le chemin courant doit suivre, sinon
  // l'enregistrement automatique recréerait l'ancien fichier.
  await waitFor(() => expect(useWorkspaceStore.getState().currentFilePath).toBe('/cours/Chimie/a.zmap'))
  expect(refreshFolder).toHaveBeenCalledWith('/cours')
})
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `bunx vitest run src/components/sidebar/FileSidebar.test.tsx -t relocation`
Expected: FAIL — `currentFilePath` reste `/cours/a.zmap` et `refreshFolder` n'est pas appelé (la condition actuelle est `result.pulled > 0`).

- [ ] **Step 3: Étendre `handleSync`**

```ts
  async function handleSync() {
    await syncNow()
    // Un tirage écrit des fichiers, une réconciliation en DÉPLACE : dans les
    // deux cas l'arbre est en retard sur le disque, et sans ce rafraîchissement
    // le chapitre reçu (ou replacé) n'apparaîtrait qu'au prochain refresh manuel.
    const { lastResult: result, syncFolderPath } = useSyncStore.getState()
    if (syncFolderPath === null || result === null) return
    if (result.pulled === 0 && result.relocated === 0) return

    // AVANT le rafraîchissement : un `currentFilePath` périmé ferait recréer
    // l'ancien fichier par l'enregistrement automatique différé.
    const current = useWorkspaceStore.getState().currentFilePath
    const moved = current === null ? undefined : result.moved.find(entry => entry.from === current)
    if (moved !== undefined) setCurrentFile(moved.to)

    await refreshFolder(syncFolderPath)
  }
```

`setCurrentFile` est déjà lu par le composant (`useWorkspaceStore(s => s.setCurrentFile)`) — le vérifier avant d'écrire la ligne ; sinon l'ajouter à côté des autres sélecteurs.

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `bunx vitest run src/components/sidebar/FileSidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Committer**

```bash
git add src/components/sidebar/FileSidebar.tsx src/components/sidebar/FileSidebar.test.tsx
git commit -m "fix(sidebar): suivre un fichier deplace par la synchronisation"
```

---

### Task 10: Le badge « hors du dossier de synchronisation »

**Files:**
- Modify: `src/components/sidebar/FileTreeRow.tsx`
- Modify: `src/components/sidebar/FileTreeRow.test.tsx`

**Interfaces:**
- Consumes: `useSyncStore.syncFolderPath`, `useMindMapAuthor` (existants), `isInsideFolder` (`src/persistence/paths.ts`).
- Produces: comportement d'interface seulement.

- [ ] **Step 1: Écrire le test qui échoue**

`FileTreeRow.test.tsx` mocke déjà les hooks de lecture de `meta` (dont `useMindMapAuthor`) en tête de fichier : réutiliser ce mock plutôt que d'en poser un second, et suivre le style des tests de badge/cadenas déjà présents dans le fichier.

```tsx
it('badges a synced map that sits outside the sync folder, and explains why it stopped being sent', async () => {
  vi.mocked(useMindMapAuthor).mockReturnValue({ id: 'file-1', author: 'aife', role: 'prof', lastModified: 'm' })
  useSyncStore.setState({ syncFolderPath: '/autre', currentUser: { username: 'aife', role: 'prof' } })

  render(<FileTreeRow node={{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }} depth={0} onOpenFile={vi.fn()} />)

  expect(screen.getByLabelText('Hors du dossier de synchronisation')).toBeInTheDocument()
})

it('shows no such badge inside the sync folder, nor for a map that was never published', async () => {
  vi.mocked(useMindMapAuthor).mockReturnValue(null)
  useSyncStore.setState({ syncFolderPath: '/cours' })

  render(<FileTreeRow node={{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }} depth={0} onOpenFile={vi.fn()} />)

  expect(screen.queryByLabelText('Hors du dossier de synchronisation')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `bunx vitest run src/components/sidebar/FileTreeRow.test.tsx -t "dossier de synchronisation"`
Expected: FAIL — l'élément n'existe pas.

- [ ] **Step 3: Ajouter le badge**

Dans `FileTreeRow`, à côté de `isLocked` :

```ts
  const syncFolderPath = useSyncStore(s => s.syncFolderPath)
  /**
   * Une carte publiée mais sortie du dossier de synchronisation : elle a un
   * enregistrement distant, et plus rien ne la poussera. Le badge est le seul
   * endroit qui l'explique — sinon le fichier disparaît du compteur sans un mot.
   */
  const outOfSyncFolder = meta !== null && syncFolderPath !== null && !isInsideFolder(node.path, syncFolderPath)
```

et, dans le `<button>` de la ligne `mindmap`, juste après le `<span>{displayName}</span>` :

```tsx
                  {outOfSyncFolder && (
                    <CloudOff size={13} aria-label="Hors du dossier de synchronisation" style={{ opacity: 0.7, flexShrink: 0 }}>
                      <title>Hors du dossier de synchronisation : cette carte ne sera plus envoyée.</title>
                    </CloudOff>
                  )}
```

Ajouter `CloudOff` à l'import lucide-react existant, et `isInsideFolder` à l'import de `../../persistence/paths`.

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `bunx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: PASS — les 2 nouveaux tests et tous les anciens.

- [ ] **Step 5: Committer**

```bash
git add src/components/sidebar/FileTreeRow.tsx src/components/sidebar/FileTreeRow.test.tsx
git commit -m "feat(sidebar): signaler une carte sortie du dossier de synchronisation"
```

---

### Task 11: Les règles PocketBase, et la note d'infra

**Files:**
- Modify: `README_INFRA.md`
- Modify: `docs/superpowers/specs/2026-09-10-synchronisation-pocketbase-design.md` (note de mise à jour)

**Interfaces:**
- Consumes: rien.
- Produces: rien de logiciel — **mais sans cette tâche le push de chemin d'un prof est refusé par le serveur (403)**, donc elle fait partie de la livraison, pas de la documentation d'agrément.

- [ ] **Step 1: Mettre à jour les règles dans `README_INFRA.md`**

Remplacer la ligne des règles de `cartes_mentales` par :

```
List/View : (vide)
Create    : @request.auth.id != ""
Update    : @request.auth.username = author || @request.auth.role = "prof"
Delete    : @request.auth.username = author || @request.auth.role = "prof"
```

Ajouter, juste en dessous, le paragraphe qui explique la portée exacte de la règle (repris de la spec, section « Infra ») :

```markdown
> Une règle PocketBase est *par enregistrement*, pas par champ : `author || prof`
> autorise donc un client prof à écrire n'importe quel champ, `content` compris.
> La séparation « l'auteur pousse `content`, le prof pousse `path` » est une
> discipline du CLIENT, pas une garantie du serveur. C'est acceptable ici : un
> serveur appartient à un prof, qui en est l'administrateur, et la propriété qui
> protège réellement les gens — un élève ne peut pas toucher l'enregistrement
> d'un autre élève — reste intacte.
```

- [ ] **Step 2: Ajouter la note de mise à jour dans la spec de synchronisation**

À la fin de `docs/superpowers/specs/2026-09-10-synchronisation-pocketbase-design.md`, section « Hors périmètre », ajouter :

```markdown
## Mise à jour du 2026-09-11

Les règles `Update`/`Delete` de `cartes_mentales` deviennent
`@request.auth.username = author || @request.auth.role = "prof"`, et `role`
cesse donc d'être une simple étiquette d'affichage : il autorise un prof à
réécrire le `path` (jamais le contenu) des cartes de ses élèves. Voir
`2026-09-11-deplacement-et-synchronisation-design.md`.
```

- [ ] **Step 3: Appliquer la règle dans l'admin PocketBase (action manuelle)**

Ouvrir l'admin du serveur, collection `cartes_mentales`, onglet API Rules, remplacer `Update` et `Delete`. Puis, dans l'app : se connecter en prof, renommer une carte d'élève dans le dossier de synchronisation, cliquer « Synchroniser », et vérifier dans le journal (`sync-debug.log`) la ligne de push de chemin. **Sans cette étape, l'étape de code précédente n'a aucun effet observable.**

- [ ] **Step 4: Committer**

```bash
git add README_INFRA.md docs/superpowers/specs/2026-09-10-synchronisation-pocketbase-design.md
git commit -m "docs(infra): le prof peut rearranger, le contenu reste a son auteur"
```

---

## Vérification finale (après la dernière tâche)

- [ ] `bun run test` — toute la suite passe.
- [ ] `bunx tsc --noEmit` — aucune erreur de type.
- [ ] **Scénario manuel 1 (le trou n°1)** : renommer une carte déjà synchronisée ; le compteur « à envoyer » passe à 1 ; synchroniser ; vérifier dans l'admin PocketBase que le `path` de l'enregistrement a suivi.
- [ ] **Scénario manuel 2 (le trou n°2)** : sur une deuxième machine (ou après avoir vidé l'état), renommer la même carte côté serveur (admin ou autre machine), puis synchroniser : le fichier local est **déplacé**, et il n'y a **pas** deux fichiers portant le même `meta.id`.
- [ ] **Scénario manuel 3 (le trou n°3)** : renommer un **dossier** contenant plusieurs cartes synchronisées ; synchroniser ; vérifier que chaque enregistrement a suivi, et qu'aucun n'est resté sur l'ancien chemin.
- [ ] **Scénario manuel 4 (le rôle)** : connecté en prof, déplacer une carte d'élève ; synchroniser ; vérifier dans le journal une ligne de push **de chemin seul**, et que le `content` distant n'a pas été réécrit.
- [ ] Vérifier qu'aucun `.zmap` n'a été réécrit par un simple renommage : `git status` sur le dossier de test ne doit montrer que des suppressions/ajouts de chemins, et les `mtime` des fichiers déplacés doivent être ceux du déplacement, pas une réécriture — le `meta.lastModified` d'une carte renommée doit être **inchangé**.

## Ce que ce plan ne fait pas

- **La suppression propagée** : `tombstones` est posé dans le format mais jamais lu ni écrit. C'est le plan suivant.
- **Le glisser-déposer** : rien dans `FileTreeRow`/`FileSidebar` pour déplacer une ligne ; `movePath` n'existe pas encore.
- **La restriction de renommage pour un élève** (« un élève ne peut plus renommer un fichier dont il n'est pas l'auteur », spec, *Comportements existants qui changent* n°1) : `canReorder` est prêt (Task 1), mais l'appliquer au menu contextuel de `FileTreeRow` et à la commande `file.rename` d'`AppToolbar` appartient au plan du glisser-déposer, qui traite toute la surface de permissions de l'arbre. **Sans ce plan-là, un élève peut encore renommer localement la carte d'un prof** — la synchro ne le poussera simplement plus (le push de chemin lui est refusé), donc le renommage restera local et sera annulé au prochain chemin décidé par le prof. C'est un état intermédiaire acceptable, pas un état final.
- **Le journal de déplacements** (`from → to`) : un enregistrement distant absent localement dont le dossier parent est renommé garde son ancien chemin. Limite documentée dans la spec, à rouvrir si elle se voit en pratique.
- **Le rafraîchissement de l'arbre après une synchro automatique** : `handleSync` couvre le bouton ; la synchro de fond ne rafraîchissait déjà pas l'arbre avant ce plan, et ce plan ne change pas ce comportement.
