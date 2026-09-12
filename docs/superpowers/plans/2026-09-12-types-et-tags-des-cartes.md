# Types et tags des cartes — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à chaque FICHIER de carte mentale un type fermé (`cours`, `exo`, `prise de notes`, `corrections`, `default`), visible en pilule colorée dans l'arborescence, modifiable par son auteur ou par un prof, et synchronisé avec l'enregistrement distant — le type du serveur gagnant en cas de divergence.

**Architecture:** Le type est une métadonnée de fichier (`meta.type`) ET un champ texte optionnel de la collection `cartes_mentales`. Il suit exactement le modèle du `path` : une passe de réconciliation pure (`src/sync/typeReconciliation.ts`), un drapeau dans `planPush`, un champ dans le payload. Le champ serveur est la VÉRITÉ ; le type embarqué dans `content` n'est qu'un miroir local, réappliqué à chaque matérialisation d'un fichier depuis un enregistrement (adoption, tirage). Aucune règle PocketBase ne change.

**Tech Stack:** TypeScript strict, React 19, Zustand, Tauri 2 (`@tauri-apps/plugin-fs`), PocketBase SDK, Vitest + Testing Library (jsdom), Bun.

**Spec:** `docs/superpowers/specs/2026-09-12-types-et-tags-des-cartes-design.md`

**Périmètre de CE plan :** le type de fichier, sa pilule, son menu contextuel, sa réconciliation et sa synchronisation. Hors périmètre (déjà tranché par la spec) : type sur une carte-nœud, tags libres, « qui/quand », classer un brouillon, filtrer/trier par type.

## Global Constraints

- **Vocabulaire fermé, exactement** : `cours`, `exo`, `prise de notes`, `corrections`, plus `default`. Toute autre valeur est ramenée à `default` — jamais une exception.
- **Le type est par FICHIER**, jamais par carte-nœud. Un fichier = un type.
- **Côté serveur** : nouveau champ `type`, texte, **optionnel**, **max 64**. Chaîne vide et `default` se lisent pareil. **Aucune règle PocketBase ne change** (`author || prof` couvre déjà le champ).
- **Le contenu reste au seul auteur.** Un type seul part dans un `update(id, { type })` — **jamais** de `content` dans ce payload. Le prof ne gagne que sur le type.
- **Un brouillon local (`meta === null`) ne se classe pas** : ni dans l'interface (entrée visible mais désactivée), ni dans `canClassify`, ni dans `planPush`.
- **`setMindMapType` PRÉSERVE `meta.lastModified`** : une classification n'est pas une édition de contenu, sinon elle déclencherait un push de contenu chez l'auteur.
- **Le type ne crée JAMAIS de conflit** : `isConflict` ne change pas.
- **Une entrée de synchro inconnue (`lastSyncedType === undefined`) vaut `default`** : c'est le point d'accord implicite d'avant le champ, surtout pas le type local.
- **Langue** : prose et commentaires en français dans les fichiers neufs ; les fichiers existants gardent leur langue. Tout texte vu par l'utilisateur est en français.
- **TypeScript strict** (`noUnusedLocals`, `noUnusedParameters`) : ne jamais laisser un import ou une variable inutilisés.
- **TDD** : le test s'écrit d'abord, échoue explicitement, puis l'implémentation minimale le fait passer.
- **Un commit par tâche** à la fin de la tâche, avec les chemins exacts.
- **Commandes** : un fichier → `bunx vitest run <chemin>` ; suite complète → `bun run test` ; types → `bunx tsc --noEmit`.
- **Jamais** de `git add -f` sous `.cartes-mentales/` ni `.cours/` ; ne pas toucher à ces dossiers.
- **Les 17 `.cartes-mentales` sont déjà repris** (champ `type` injecté le 2026-09-12) : aucune tâche de reprise ici.

---

## Structure des fichiers

| Fichier | Créer / Modifier | Responsabilité |
|---|---|---|
| `src/types/mapType.ts` | **Créer** | Le vocabulaire fermé, `mapTypeOf`, les libellés et les descriptions |
| `src/types/mapType.test.ts` | **Créer** | Valeur connue, inconnue, absente, non-chaîne |
| `src/colors/mapTypeColors.ts` | **Créer** | Paires oklch clair/sombre par type, plus le neutre des valeurs inconnues |
| `src/colors/mapTypeColors.test.ts` | **Créer** | Une couleur par type, WCAG AA dans les deux thèmes, achromatique pour « prise de notes » |
| `src/types/card.ts` | Modifier | `MindMapMeta.type?: MapType` |
| `src/persistence/syncState.ts` | Modifier | `SyncStateEntry.lastSyncedType?: string` |
| `src/sync/typeReconciliation.ts` | **Créer** | `seedLastSyncedType` et `reconcileType` — les deux décisions pures |
| `src/sync/typeReconciliation.test.ts` | **Créer** | Les cinq lignes du tableau de la spec |
| `src/sync/permissions.ts` | Modifier | `canClassify(meta, user)`, source unique UI/sync |
| `src/sync/permissions.test.ts` | Modifier | Brouillon refusé, auteur accepté, prof accepté, élève sur autrui refusé |
| `src/persistence/fileStore.ts` | Modifier | `setMindMapType` et `type: 'default'` à la publication |
| `src/persistence/fileStore.test.ts` | Modifier | `setMindMapType`, type par défaut, type conservé par `saveMindMap` |
| `src/sync/syncService.ts` | Modifier | `record.type`, `planPush.type`, réconciliation de type, payload, tirage, `reclassified` |
| `src/sync/syncService.test.ts` | Modifier | `type: false` partout, classification prof/élève, adoption, tirage |
| `src/sync/pocketBaseAdapter.test.ts` | Modifier | `create` porte le champ `type` |
| `src/sync/syncResultLabel.ts` | Modifier | Le compte rendu dit « reclassé(s) » |
| `src/sync/syncResultLabel.test.ts` | Modifier | Un test pour la nouvelle ligne |
| `src/components/sidebar/MapTypeBadge.tsx` | **Créer** | La pilule colorée + le Tooltip ; rien pour `default` |
| `src/components/sidebar/MapTypeBadge.test.tsx` | **Créer** | Rien pour `default`, couleur et libellé, thème, valeur inconnue |
| `src/components/sidebar/FileTreeRow.tsx` | Modifier | Pilule sur la ligne + sous-menu « Type » (coche, désactivé sur brouillon) |
| `src/components/sidebar/FileTreeRow.test.tsx` | Modifier | Pilule, coche, activation auteur/prof, désactivation brouillon + tooltip |
| `infra/pocketbase-schema.mjs` | Modifier | Champ `type` optionnel max 64 |
| `infra/setup-pocketbase.test.mjs` | Modifier | Champ créé, ajouté à une collection qui le précède |
| `infra/README_INFRA.md` | Modifier | Tableau des champs + encadré de réapplication |
| `.claude/skills/transformer-cours-en-carte-mentale/SKILL.md` | Modifier | Émettre l'enveloppe `{ meta, cards }` avec `meta.type` |

> `src/persistence/serialization.ts` n'a pas besoin de changer : `meta` y est un objet opaque qui traverse tel quel. `src/state/useSyncStore.ts` n'a pas besoin de changer non plus : `reclassified` est **optionnel** dans `SyncResult`, et le store passe déjà le résultat à `syncResultLabel`.

---

### Task 1: `src/types/mapType.ts` — le vocabulaire fermé

**Files:**
- Create: `src/types/mapType.ts`
- Test: `src/types/mapType.test.ts`

**Interfaces:**
- Produces: `MAP_TYPES` (`readonly ['cours','exo','prise de notes','corrections']`), `MapType = (typeof MAP_TYPES)[number] | 'default'`, `DEFAULT_MAP_TYPE: MapType`, `mapTypeOf(value: unknown): MapType`, `isKnownMapType(value: unknown): value is MapType`, `MAP_TYPE_LABELS: Record<MapType, string>`, `MAP_TYPE_DESCRIPTIONS: Record<Exclude<MapType, 'default'>, string>`.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// src/types/mapType.test.ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MAP_TYPE,
  MAP_TYPES,
  MAP_TYPE_DESCRIPTIONS,
  MAP_TYPE_LABELS,
  isKnownMapType,
  mapTypeOf,
} from './mapType'

describe('mapTypeOf', () => {
  it('renders every value of the closed vocabulary', () => {
    for (const type of MAP_TYPES) expect(mapTypeOf(type)).toBe(type)
    expect(mapTypeOf('default')).toBe('default')
  })

  it('falls back to default for anything else, without throwing', () => {
    expect(mapTypeOf('examen')).toBe(DEFAULT_MAP_TYPE)
    expect(mapTypeOf('')).toBe(DEFAULT_MAP_TYPE)
    expect(mapTypeOf(42)).toBe(DEFAULT_MAP_TYPE)
    expect(mapTypeOf(null)).toBe(DEFAULT_MAP_TYPE)
    expect(mapTypeOf(undefined)).toBe(DEFAULT_MAP_TYPE)
    expect(mapTypeOf({ type: 'cours' })).toBe(DEFAULT_MAP_TYPE)
  })
})

describe('isKnownMapType', () => {
  it('accepts the four classified types and default', () => {
    for (const type of MAP_TYPES) expect(isKnownMapType(type)).toBe(true)
    expect(isKnownMapType('default')).toBe(true)
  })

  it('rejects an unknown string, the way a hand-edited file can produce one', () => {
    expect(isKnownMapType('examen')).toBe(false)
    expect(isKnownMapType(undefined)).toBe(false)
    expect(isKnownMapType(3)).toBe(false)
  })
})

describe('libellés et descriptions', () => {
  it('names every type and describes every classified one', () => {
    for (const type of MAP_TYPES) {
      expect(MAP_TYPE_LABELS[type]).toBeTruthy()
      expect(MAP_TYPE_DESCRIPTIONS[type]).toBeTruthy()
    }
    expect(MAP_TYPE_LABELS.default).toBe('Sans type')
  })
})
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `bunx vitest run src/types/mapType.test.ts`
Expected: FAIL — `Failed to resolve import "./mapType"`.

- [ ] **Step 3: Écrire `src/types/mapType.ts`**

```ts
/**
 * Le vocabulaire FERMÉ des types de carte, côté application. Le champ serveur
 * est un texte libre : c'est ici, et seulement ici, que la liste est close.
 */
export const MAP_TYPES = ['cours', 'exo', 'prise de notes', 'corrections'] as const

/** Un type réellement classé — jamais `default`, qui n'est pas un classement. */
export type CategorizedMapType = (typeof MAP_TYPES)[number]

/** `default` n'est pas dans `MAP_TYPES` : c'est l'ABSENCE de classement, pas un cinquième type. */
export type MapType = CategorizedMapType | 'default'

export const DEFAULT_MAP_TYPE: MapType = 'default'

/**
 * Ramène toute valeur inconnue à `default` : un type écrit par une version
 * future, une faute de frappe dans un fichier édité à la main, ou un
 * `undefined` de fichier jamais classé. On ne jette jamais.
 */
export function mapTypeOf(value: unknown): MapType {
  return typeof value === 'string' && (MAP_TYPES as readonly string[]).includes(value)
    ? (value as CategorizedMapType)
    : DEFAULT_MAP_TYPE
}

/**
 * Vrai pour les quatre types classés ET pour `default`. C'est la question
 * que la pilule pose pour distinguer « pas de type » (rien à afficher) d'« une
 * valeur que l'app ne connaît pas » (pilule neutre avec le libellé brut).
 */
export function isKnownMapType(value: unknown): value is MapType {
  return value === DEFAULT_MAP_TYPE || (typeof value === 'string' && (MAP_TYPES as readonly string[]).includes(value))
}

export const MAP_TYPE_LABELS: Record<MapType, string> = {
  cours: 'Cours',
  exo: 'Exercices',
  'prise de notes': 'Prise de notes',
  corrections: 'Corrections',
  default: 'Sans type',
}

export const MAP_TYPE_DESCRIPTIONS: Record<CategorizedMapType, string> = {
  cours: 'Le support de référence du chapitre.',
  exo: 'Des exercices d’entraînement.',
  'prise de notes': 'Des notes prises en vrac, sans structure de cours.',
  corrections: 'La correction d’un exercice ou d’une évaluation.',
}
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `bunx vitest run src/types/mapType.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/types/mapType.ts src/types/mapType.test.ts
git commit -m "feat(types): vocabulaire fermé des types de carte"
```

---

### Task 2: `src/colors/mapTypeColors.ts` — la palette

**Files:**
- Create: `src/colors/mapTypeColors.ts`
- Test: `src/colors/mapTypeColors.test.ts`

**Interfaces:**
- Consumes: `Oklch` (`src/colors/contrast.ts`), `MapType` (Task 1)
- Produces: `MapTypeColor`, `MapTypeColorPair`, `mapTypeColors: Record<Exclude<MapType, 'default'>, MapTypeColorPair>`, `neutralMapTypeColors: MapTypeColorPair`, `mapTypeColor(type: MapType, theme: 'light' | 'dark'): MapTypeColor | null`.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// src/colors/mapTypeColors.test.ts
import { describe, it, expect } from 'vitest'
import { oklchWcagContrast } from './contrast'
import { mapTypeColor, mapTypeColors, neutralMapTypeColors } from './mapTypeColors'

describe('mapTypeColors', () => {
  it.each(Object.entries(mapTypeColors))('%s light text meets WCAG AA (>= 4.5) against its background', (_type, pair) => {
    expect(oklchWcagContrast(pair.light.bg, pair.light.text)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(Object.entries(mapTypeColors))('%s dark text meets WCAG AA (>= 4.5) against its background', (_type, pair) => {
    expect(oklchWcagContrast(pair.dark.bg, pair.dark.text)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the same hue in light and dark for every type', () => {
    for (const pair of Object.values(mapTypeColors)) {
      expect(pair.dark.border.h).toBe(pair.light.border.h)
      expect(pair.dark.bg.h).toBe(pair.light.bg.h)
      expect(pair.dark.text.h).toBe(pair.light.text.h)
    }
  })

  it('covers exactly the four classified types — default has no colour', () => {
    expect(Object.keys(mapTypeColors)).toEqual(['cours', 'exo', 'prise de notes', 'corrections'])
  })

  it('reads « prise de notes » as achromatic: the draft has no colour of its own', () => {
    expect(mapTypeColors['prise de notes'].light.bg.c).toBe(0)
    expect(mapTypeColors['prise de notes'].light.border.c).toBe(0)
    expect(mapTypeColors['prise de notes'].dark.bg.c).toBe(0)
    expect(mapTypeColors['prise de notes'].dark.border.c).toBe(0)
  })

  it('returns no palette for default: it does not render', () => {
    expect(mapTypeColor('default', 'light')).toBeNull()
    expect(mapTypeColor('default', 'dark')).toBeNull()
  })

  it('returns the exact palette for every classified type, per theme', () => {
    for (const type of ['cours', 'exo', 'prise de notes', 'corrections'] as const) {
      expect(mapTypeColor(type, 'light')).toBe(mapTypeColors[type].light)
      expect(mapTypeColor(type, 'dark')).toBe(mapTypeColors[type].dark)
    }
  })

  it('the neutral palette (unknown value) is achromatic and meets WCAG AA in both themes', () => {
    expect(neutralMapTypeColors.light.bg.c).toBe(0)
    expect(neutralMapTypeColors.light.border.c).toBe(0)
    expect(neutralMapTypeColors.dark.bg.c).toBe(0)
    expect(neutralMapTypeColors.dark.border.c).toBe(0)
    expect(oklchWcagContrast(neutralMapTypeColors.light.bg, neutralMapTypeColors.light.text)).toBeGreaterThanOrEqual(4.5)
    expect(oklchWcagContrast(neutralMapTypeColors.dark.bg, neutralMapTypeColors.dark.text)).toBeGreaterThanOrEqual(4.5)
  })
})
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `bunx vitest run src/colors/mapTypeColors.test.ts`
Expected: FAIL — `Failed to resolve import "./mapTypeColors"`.

- [ ] **Step 3: Écrire `src/colors/mapTypeColors.ts`**

```ts
import type { Oklch } from './contrast'
import type { MapType } from '../types/mapType'

export interface MapTypeColor {
  bg: Oklch
  border: Oklch
  text: Oklch
}

export interface MapTypeColorPair {
  light: MapTypeColor
  dark: MapTypeColor
}

/**
 * Une couleur par type, sur le modèle exact de `levelColors` : fond très
 * désaturé, bordure et texte dans le hue du type. `prise de notes` est
 * volontairement achromatique — c'est le brouillon, il ne doit pas concurrencer
 * les trois autres au premier coup d'œil.
 */
export const mapTypeColors: Record<Exclude<MapType, 'default'>, MapTypeColorPair> = {
  cours: {
    // Bleu — la référence
    light: {
      bg: { l: 0.96, c: 0.03, h: 235 },
      border: { l: 0.55, c: 0.14, h: 235 },
      text: { l: 0.32, c: 0.13, h: 235 },
    },
    dark: {
      bg: { l: 0.2, c: 0.035, h: 235 },
      border: { l: 0.62, c: 0.13, h: 235 },
      text: { l: 0.88, c: 0.05, h: 235 },
    },
  },
  exo: {
    // Vert — l'entraînement
    light: {
      bg: { l: 0.96, c: 0.03, h: 150 },
      border: { l: 0.55, c: 0.14, h: 150 },
      text: { l: 0.32, c: 0.13, h: 150 },
    },
    dark: {
      bg: { l: 0.22, c: 0.035, h: 150 },
      border: { l: 0.62, c: 0.13, h: 150 },
      text: { l: 0.88, c: 0.05, h: 150 },
    },
  },
  'prise de notes': {
    // Achromatique — le brouillon
    light: {
      bg: { l: 0.96, c: 0, h: 0 },
      border: { l: 0.62, c: 0, h: 0 },
      text: { l: 0.38, c: 0, h: 0 },
    },
    dark: {
      bg: { l: 0.22, c: 0, h: 0 },
      border: { l: 0.6, c: 0, h: 0 },
      text: { l: 0.88, c: 0, h: 0 },
    },
  },
  corrections: {
    // Rouge-orangé — ce qui demande l'attention
    light: {
      bg: { l: 0.96, c: 0.03, h: 30 },
      border: { l: 0.55, c: 0.18, h: 30 },
      text: { l: 0.32, c: 0.15, h: 30 },
    },
    dark: {
      bg: { l: 0.22, c: 0.035, h: 30 },
      border: { l: 0.62, c: 0.16, h: 30 },
      text: { l: 0.88, c: 0.05, h: 30 },
    },
  },
}

/**
 * La pilule d'une valeur que l'app ne connaît pas : neutre, achromatique, mais
 * lisible. Elle dit « ce fichier est classé, je ne sais juste pas en quoi ».
 */
export const neutralMapTypeColors: MapTypeColorPair = {
  light: {
    bg: { l: 0.95, c: 0, h: 0 },
    border: { l: 0.7, c: 0, h: 0 },
    text: { l: 0.4, c: 0, h: 0 },
  },
  dark: {
    bg: { l: 0.24, c: 0, h: 0 },
    border: { l: 0.55, c: 0, h: 0 },
    text: { l: 0.85, c: 0, h: 0 },
  },
}

/** `null` pour `default` : il n'a pas de couleur, donc rien à rendre. */
export function mapTypeColor(type: MapType, theme: 'light' | 'dark'): MapTypeColor | null {
  if (type === 'default') return null
  return mapTypeColors[type][theme]
}
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `bunx vitest run src/colors/mapTypeColors.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/colors/mapTypeColors.ts src/colors/mapTypeColors.test.ts
git commit -m "feat(colors): palette des types de carte"
```

---

### Task 3: `MindMapMeta.type`, `SyncStateEntry.lastSyncedType` et la réconciliation de type

**Files:**
- Modify: `src/types/card.ts`
- Modify: `src/persistence/syncState.ts`
- Create: `src/sync/typeReconciliation.ts`
- Test: `src/sync/typeReconciliation.test.ts`

**Interfaces:**
- Consumes: `MapType`, `DEFAULT_MAP_TYPE`, `mapTypeOf` (Task 1)
- Produces: `MindMapMeta.type?: MapType` ; `SyncStateEntry.lastSyncedType?: string` ; `seedLastSyncedType(lastSyncedType: string | undefined): MapType` ; `TypeAction = { kind: 'none' } | { kind: 'push-type' } | { kind: 'adopt'; to: MapType; bothMoved: boolean }` ; `reconcileType(params: { localType: MapType; lastSyncedType: MapType; remoteType: string | undefined }): TypeAction`.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// src/sync/typeReconciliation.test.ts
import { describe, it, expect } from 'vitest'
import { reconcileType, seedLastSyncedType } from './typeReconciliation'

const LOCAL = 'cours' as const
const OTHER = 'exo' as const

describe('seedLastSyncedType', () => {
  it('anchors an unknown entry on default — never on the local type', () => {
    // Amarrer sur le type local ferait passer une classification de prof pour
    // « je n'ai pas bougé » et la laisserait écraser.
    expect(seedLastSyncedType(undefined)).toBe('default')
  })

  it('keeps a known agreement, and degrades a value from the future to default', () => {
    expect(seedLastSyncedType('exo')).toBe('exo')
    expect(seedLastSyncedType('default')).toBe('default')
    expect(seedLastSyncedType('examen')).toBe('default')
    expect(seedLastSyncedType('')).toBe('default')
  })
})

describe('reconcileType', () => {
  it('does nothing when nobody moved', () => {
    expect(reconcileType({ localType: LOCAL, lastSyncedType: LOCAL, remoteType: LOCAL })).toEqual({ kind: 'none' })
  })

  it('pushes when only I moved', () => {
    expect(reconcileType({ localType: LOCAL, lastSyncedType: 'default', remoteType: 'default' })).toEqual({
      kind: 'push-type',
    })
  })

  it('adopts when only the server moved — the prof classified my card', () => {
    expect(reconcileType({ localType: 'default', lastSyncedType: 'default', remoteType: LOCAL })).toEqual({
      kind: 'adopt',
      to: LOCAL,
      bothMoved: false,
    })
  })

  it('gives the server the win when both moved differently', () => {
    expect(reconcileType({ localType: OTHER, lastSyncedType: 'default', remoteType: LOCAL })).toEqual({
      kind: 'adopt',
      to: LOCAL,
      bothMoved: true,
    })
  })

  it('does nothing when both moved to the same type — the caller re-anchors on the server', () => {
    expect(reconcileType({ localType: LOCAL, lastSyncedType: 'default', remoteType: LOCAL })).toEqual({ kind: 'none' })
  })

  it('does nothing without a remote record', () => {
    expect(reconcileType({ localType: LOCAL, lastSyncedType: 'default', remoteType: undefined })).toEqual({
      kind: 'none',
    })
  })

  it('reads an empty remote type as default, exactly like an absent one', () => {
    expect(reconcileType({ localType: 'default', lastSyncedType: 'default', remoteType: '' })).toEqual({ kind: 'none' })
    expect(reconcileType({ localType: LOCAL, lastSyncedType: 'default', remoteType: '' })).toEqual({
      kind: 'push-type',
    })
  })
})
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `bunx vitest run src/sync/typeReconciliation.test.ts`
Expected: FAIL — `Failed to resolve import "./typeReconciliation"`.

- [ ] **Step 3: Ajouter `type` à `MindMapMeta`**

Dans `src/types/card.ts`, ajouter l'import en tête puis le champ à la fin de l'interface :

```ts
import type { MapType } from './mapType'
```

```ts
export interface MindMapMeta {
  id: string
  author: string
  role: UserRole
  lastModified: string
  /**
   * Le type de la carte, posé à la publication (`default`) puis modifiable
   * par l'auteur ou un prof. Absent = `default` : les fichiers écrits
   * avant ce champ restent lisibles tels quels, sans migration.
   */
  type?: MapType
}
```

- [ ] **Step 4: Ajouter `lastSyncedType` à `SyncStateEntry`**

Dans `src/persistence/syncState.ts` :

```ts
export interface SyncStateEntry {
  lastSyncedModified: string
  lastSyncedUpdated: string
  lastSyncedPath?: string
  lastSyncedContentHash?: string
  /**
   * Le type convenu au dernier push ou pull. Absent = inconnu (une entrée
   * migrée depuis avant le champ), et le point d'accord implicite est alors
   * `default` — jamais le type local.
   */
  lastSyncedType?: string
}
```

- [ ] **Step 5: Écrire `src/sync/typeReconciliation.ts`**

```ts
/**
 * Les deux décisions pures du suivi de type. Elles vivent ici, hors de
 * `syncService`, pour être testables sans réseau, sans système de fichiers
 * et sans mock — c'est la partie où une erreur coûte une classification de prof
 * silencieusement annulée.
 */

import { DEFAULT_MAP_TYPE, mapTypeOf, type MapType } from '../types/mapType'

/**
 * Le type de référence d'une entrée dont on ne sait rien.
 *
 * Une entrée migrée décrit un serveur qui n'avait AUCUN champ de type : le point
 * d'accord implicite est donc `default`. Surtout pas le type local, qui
 * ferait passer une classification de prof pour « je n'ai pas bougé » et la
 * laisserait écraser.
 */
export function seedLastSyncedType(lastSyncedType: string | undefined): MapType {
  if (lastSyncedType === undefined) return DEFAULT_MAP_TYPE
  return mapTypeOf(lastSyncedType)
}

export type TypeAction =
  | { kind: 'none' }
  | { kind: 'push-type' }
  | { kind: 'adopt'; to: MapType; bothMoved: boolean }

export interface ReconcileTypeParams {
  /** Le `meta.type` local, déjà ramené au vocabulaire par `mapTypeOf`. */
  localType: MapType
  /** Le type de référence, déjà amarré par `seedLastSyncedType`. */
  lastSyncedType: MapType
  /** Le `type` brut de l'enregistrement distant, `undefined` s'il n'y en a pas. */
  remoteType: string | undefined
}

/**
 * Qui a bougé, et ce qu'il faut en faire. « Premier arrivé gagne, égalité → le
 * serveur » : aucune branche ne dépend du rôle, ce qui rend la règle valable
 * aussi bien pour l'élève dont le prof classe une carte que pour le prof qui
 * vient de classer.
 *
 * Le cas « les deux ont bougé vers le MÊME type » rend `none` : l'appelant
 * réamarre l'accord sur la valeur distante, comme la réconciliation de chemins
 * le fait pour un chemin identique des deux côtés.
 */
export function reconcileType({ localType, lastSyncedType, remoteType }: ReconcileTypeParams): TypeAction {
  // Aucun enregistrement distant : la création enverra le type local, il n'y a
  // rien à réconcilier.
  if (remoteType === undefined) return { kind: 'none' }
  const remote = mapTypeOf(remoteType)

  const iMoved = localType !== lastSyncedType
  const serverMoved = remote !== lastSyncedType

  if (!iMoved && !serverMoved) return { kind: 'none' }
  if (iMoved && !serverMoved) return { kind: 'push-type' }
  if (!iMoved && serverMoved) return { kind: 'adopt', to: remote, bothMoved: false }
  // Les deux ont bougé.
  if (localType === remote) return { kind: 'none' }
  return { kind: 'adopt', to: remote, bothMoved: true }
}
```

- [ ] **Step 6: Lancer le test et vérifier qu'il passe**

Run: `bunx vitest run src/sync/typeReconciliation.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 7: Vérifier les types**

Run: `bunx tsc --noEmit`
Expected: aucune erreur. (`MindMapMeta.type` est optionnel : aucun littéral existant ne casse.)

- [ ] **Step 8: Commit**

```bash
git add src/types/card.ts src/persistence/syncState.ts src/sync/typeReconciliation.ts src/sync/typeReconciliation.test.ts
git commit -m "feat(sync): état et décisions pures du type de carte"
```

---

### Task 4: `canClassify` dans `src/sync/permissions.ts`

**Files:**
- Modify: `src/sync/permissions.ts`
- Test: `src/sync/permissions.test.ts`

**Interfaces:**
- Consumes: `MindMapMeta`, `SyncUser` (`src/types/card.ts`)
- Produces: `canClassify(meta: MindMapMeta | null, user: SyncUser): boolean` — `meta` non nul ET (auteur OU prof).

- [ ] **Step 1: Ajouter le test qui échoue**

Dans `src/sync/permissions.test.ts`, compléter l'import puis ajouter le bloc à la fin du fichier :

```ts
import { canClassify, canReorder } from './permissions'
```

```ts
describe('canClassify', () => {
  it('refuses a draft: there is no meta to write a type into', () => {
    // Décision de cadrage n°5 : créer → publier → classer. Le sync applique la
    // même règle que l'interface, donc il ne peut pas classer un brouillon.
    expect(canClassify(null, AIFE)).toBe(false)
    expect(canClassify(null, ELEVE)).toBe(false)
  })

  it('lets an author classify their own map', () => {
    expect(canClassify(AIFE_MAP, AIFE)).toBe(true)
    expect(canClassify(ELEVE_MAP, ELEVE)).toBe(true)
  })

  it('lets a prof classify an eleve s map, which is the shared use case', () => {
    expect(canClassify(ELEVE_MAP, AIFE)).toBe(true)
  })

  it('refuses an eleve the type of a map they do not own', () => {
    expect(canClassify(AIFE_MAP, ELEVE)).toBe(false)
  })
})
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `bunx vitest run src/sync/permissions.test.ts`
Expected: FAIL — `canClassify is not a function` (ou `undefined`).

- [ ] **Step 3: Écrire `canClassify`**

Dans `src/sync/permissions.ts`, à la fin :

```ts
/**
 * Whether `user` may change the TYPE of a map.
 *
 * Même règle que `canReorder` (auteur ou prof), PLUS une exigence de
 * `meta` non nul : le type vit dans `meta`, qu'un brouillon local n'a
 * pas encore. Nommée séparément parce qu'elle décide d'autre chose, et parce
 * que l'interface et la synchronisation doivent lire la MÊME définition — sans
 * quoi l'arborescence offrirait un geste que le sync refuserait.
 *
 * Le contenu, lui, n'est jamais concerné : un prof classe la carte d'un élève
 * sans gagner le droit d'en écrire le contenu.
 */
export function canClassify(meta: MindMapMeta | null, user: SyncUser): boolean {
  if (meta === null) return false
  return meta.author === user.username || user.role === 'prof'
}
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `bunx vitest run src/sync/permissions.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sync/permissions.ts src/sync/permissions.test.ts
git commit -m "feat(sync): canClassify, source unique du droit de classer"
```

### Task 5: `setMindMapType` et le type par défaut à la publication

**Files:**
- Modify: `src/persistence/fileStore.ts`
- Test: `src/persistence/fileStore.test.ts`

**Interfaces:**
- Consumes: `MapType`, `DEFAULT_MAP_TYPE` (Task 1) ; `MindMapMeta.type` (Task 3)
- Produces: `setMindMapType(path: string, type: MapType): Promise<void>` ; `stampMindMapSyncMeta` pose désormais `type: 'default'`.

- [ ] **Step 1: Ajouter les tests qui échouent**

Dans `src/persistence/fileStore.test.ts`, ajouter `setMindMapType` à l'import :

```ts
import {
  loadMindMap,
  saveMindMap,
  loadMindMapMeta,
  setMindMapType,
  stampMindMapSyncMeta,
  stripMindMapSyncMeta,
} from './fileStore'
```

Puis, à la fin du fichier :

```ts
describe('setMindMapType', () => {
  beforeEach(() => {
    vi.mocked(readTextFile).mockReset()
    vi.mocked(writeTextFile).mockReset()
  })

  it('writes the type and preserves everything else, lastModified included', async () => {
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ meta, cards: sample }))

    await setMindMapType('/cours/chapitre.zmap', 'cours')

    const [path, contents] = vi.mocked(writeTextFile).mock.calls[0]
    expect(path).toBe('/cours/chapitre.zmap')
    const written = JSON.parse(contents as string)
    expect(written.meta).toEqual({ ...meta, type: 'cours' })
    expect(written.cards).toEqual(sample)
    // Le point qui compte : classer n'est pas éditer. Sans ça, la classification
    // d'un prof déclencherait un push de contenu chez l'auteur.
    expect(written.meta.lastModified).toBe(meta.lastModified)
  })

  it('writes default explicitly rather than dropping the field', async () => {
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ meta: { ...meta, type: 'cours' }, cards: sample }))

    await setMindMapType('/cours/chapitre.zmap', 'default')

    expect(JSON.parse(vi.mocked(writeTextFile).mock.calls[0][1] as string).meta.type).toBe('default')
  })

  it('refuses a draft with no meta: there is nowhere to write a type', async () => {
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(sample))

    await expect(setMindMapType('/cours/brouillon.zmap', 'cours')).rejects.toThrow(/identité de synchronisation/)
    expect(writeTextFile).not.toHaveBeenCalled()
  })
})
```

Toujours dans le même fichier, dans le test qui verifie une publication, ajouter une ligne après le controle du role :

```ts
    expect(written.meta.type).toBe('default')
```

Et dans `describe('saveMindMap meta preservation')`, ajouter :

```ts
  it('keeps the type across an autosave, which is not a reclassification', async () => {
    vi.mocked(exists).mockResolvedValue(true)
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ meta: { ...meta, type: 'cours' }, cards: sample }))

    await saveMindMap('/fake/path.zmap', sample)

    expect(JSON.parse(vi.mocked(writeTextFile).mock.calls[0][1] as string).meta.type).toBe('cours')
  })
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

Run: `bunx vitest run src/persistence/fileStore.test.ts`
Expected: FAIL — `setMindMapType is not a function`, puis `expected undefined to be 'default'`.

- [ ] **Step 3: Écrire `setMindMapType`**

Dans `src/persistence/fileStore.ts`, compléter l'import :

```ts
import { DEFAULT_MAP_TYPE, type MapType } from '../types/mapType'
```

Puis ajouter, à la fin du fichier :

```ts
/**
 * Classe un fichier DÉJÀ publié. Le type vit dans meta : un brouillon local n'en
 * a pas, et le refus est explicite plutôt que silencieux, pour que l'appelant
 * puisse le dire.
 *
 * lastModified est PRÉSERVÉ : une classification n'est pas une édition de
 * contenu. Le bumper déclencherait un push de contenu chez l'auteur, alors que
 * seul le champ type a bougé.
 *
 * default est écrit explicitement plutôt que retiré : tous les producteurs
 * produisent la même forme, et le fichier reste lisible tel quel.
 */
export async function setMindMapType(path: string, type: MapType): Promise<void> {
  const { meta, cards } = deserializeMindMap(await readTextFile(path))
  if (meta === null) {
    throw new Error('setMindMapType : ce fichier n’a pas d’identité de synchronisation, impossible de le classer.')
  }
  await writeTextFile(path, serializeMindMap({ ...meta, type }, cards))
}
```

- [ ] **Step 4: Poser `type: 'default'` à la publication**

Dans `stampMindMapSyncMeta`, le littéral devient :

```ts
  const stamped: MindMapMeta = {
    id: crypto.randomUUID(),
    author,
    role,
    lastModified: new Date().toISOString(),
    type: DEFAULT_MAP_TYPE,
  }
```

> `createMindMapFile` n'est PAS touché : un brouillon n'a pas de `meta`. `stripMindMapSyncMeta` n'est pas touché non plus : il réécrit une carte locale en tableau nu, donc la copie repart sans type — c'est-à-dire `default`.

- [ ] **Step 5: Lancer les tests et vérifier qu'ils passent**

Run: `bunx vitest run src/persistence/fileStore.test.ts`
Expected: PASS — 22 tests.

- [ ] **Step 6: Commit**

```bash
git add src/persistence/fileStore.ts src/persistence/fileStore.test.ts
git commit -m "feat(persistence): setMindMapType, et type default à la publication"
```

---

### Task 6: `syncService` — `record.type`, `planPush.type`, compteur

**Files:**
- Modify: `src/sync/syncService.ts`
- Modify: `src/sync/syncService.test.ts`
- Modify: `src/sync/pocketBaseAdapter.test.ts`

**Interfaces:**
- Consumes: `mapTypeOf` (Task 1) ; `canClassify` (Task 4)
- Produces: `RemoteMindMapRecord.type?: string` ; `MindMapsApi.create(data: { file_id; author; path; content; type: string })` ; `MindMapsApi.update(id, data: { path?; content?; type? })` ; `PushPlan = { content: boolean; path: boolean; type: boolean }`.

- [ ] **Step 1: Réécrire le bloc `describe('planPush')` qui échoue**

Dans `src/sync/syncService.test.ts`, remplacer le bloc allant de `describe('planPush', () => {` à sa fermeture par :

```ts
describe('planPush', () => {
  const known = { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x', lastSyncedPath: 'a.zmap' }

  it('sends the content of a map we authored and changed', () => {
    expect(
      planPush({
        meta: { ...AIFE, lastModified: '2026-01-02T00:00:00.000Z' },
        relPath: 'a.zmap',
        currentUser: AIFE_USER,
        entry: known,
      })
    ).toEqual({ content: true, path: false, type: false })
  })

  it('sends the content of a map we never pushed, and lets the creation carry the path', () => {
    expect(planPush({ meta: AIFE, relPath: 'a.zmap', currentUser: AIFE_USER, entry: undefined })).toEqual({
      content: true,
      path: false,
      type: false,
    })
  })

  it('treats a v1-migrated entry as "no path change", not as a move of every file', () => {
    const migrated = { lastSyncedModified: AIFE.lastModified, lastSyncedUpdated: 'x' }
    expect(planPush({ meta: AIFE, relPath: 'a.zmap', currentUser: AIFE_USER, entry: migrated })).toEqual({
      content: false,
      path: false,
      type: false,
    })
  })

  it('sends a renamed map for its path alone, with no content change', () => {
    expect(planPush({ meta: AIFE, relPath: 'Chimie/a.zmap', currentUser: AIFE_USER, entry: known })).toEqual({
      content: false,
      path: true,
      type: false,
    })
  })

  it('sends nothing when neither content nor path moved', () => {
    expect(planPush({ meta: AIFE, relPath: 'a.zmap', currentUser: AIFE_USER, entry: known })).toEqual({
      content: false,
      path: false,
      type: false,
    })
  })

  it('never sends the CONTENT of a map we do not author, however new it looks', () => {
    const scan = planPush({
      meta: { ...AIFE, author: 'eleve1', lastModified: '2027-01-01T00:00:00.000Z' },
      relPath: 'a.zmap',
      currentUser: AIFE_USER,
      entry: known,
    })
    expect(scan.content).toBe(false)
  })

  it('lets a prof push the PATH of an eleve s map — that is how a class folder follows', () => {
    expect(
      planPush({ meta: { ...AIFE, author: 'eleve1' }, relPath: 'Chimie/a.zmap', currentUser: AIFE_USER, entry: known })
    ).toEqual({ content: false, path: true, type: false })
  })

  it('refuses an eleve the path of a map they do not own', () => {
    expect(
      planPush({ meta: { ...AIFE, author: 'aife' }, relPath: 'Chimie/a.zmap', currentUser: ELEVE_USER, entry: known })
    ).toEqual({ content: false, path: false, type: false })
  })

  it('treats a migrated entry as in agreement on default, so nothing is reclassified by surprise', () => {
    // lastSyncedType absent = inconnu, et l'accord implicite d'avant le champ est
    // default (voir seedLastSyncedType). Une carte restée default ne part donc
    // pas ; une carte reprise en cours — les 17 fichiers backfillés — part, elle.
    expect(planPush({ meta: AIFE, relPath: 'a.zmap', currentUser: AIFE_USER, entry: known })).toEqual({
      content: false,
      path: false,
      type: false,
    })
    expect(
      planPush({ meta: { ...AIFE, type: 'cours' }, relPath: 'a.zmap', currentUser: AIFE_USER, entry: known })
    ).toEqual({ content: false, path: false, type: true })
  })

  it('lets a prof classify an eleve s map, and only the type moves', () => {
    expect(
      planPush({
        meta: { ...AIFE, author: 'eleve1', type: 'cours' },
        relPath: 'a.zmap',
        currentUser: AIFE_USER,
        entry: { ...known, lastSyncedType: 'default' },
      })
    ).toEqual({ content: false, path: false, type: true })
  })

  it('refuses an eleve the type of a map they do not own', () => {
    expect(
      planPush({
        meta: { ...AIFE, author: 'aife', type: 'cours' },
        relPath: 'a.zmap',
        currentUser: ELEVE_USER,
        entry: { ...known, lastSyncedType: 'default' },
      })
    ).toEqual({ content: false, path: false, type: false })
  })

  it('does not send the type when the agreement already carries it', () => {
    expect(
      planPush({
        meta: { ...AIFE, type: 'exo' },
        relPath: 'a.zmap',
        currentUser: AIFE_USER,
        entry: { ...known, lastSyncedType: 'exo' },
      })
    ).toEqual({ content: false, path: false, type: false })
  })
})
```

- [ ] **Step 2: Ajouter le test de compteur qui échoue**

Dans `describe('surveySyncFolder')`, ajouter :

```ts
  it('counts a lone classification, which no counter saw before', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue({ ...AIFE, type: 'cours' })

    const survey = await surveySyncFolder({
      syncFolderPath: '/cours',
      currentUser: AIFE_USER,
      entries: {
        'file-1': {
          lastSyncedModified: AIFE.lastModified,
          lastSyncedUpdated: 'x',
          lastSyncedPath: 'a.zmap',
          lastSyncedType: 'default',
        },
      },
    })

    // Ni le contenu ni le chemin n'ont bougé : seul le type, et le compteur doit
    // le voir, sinon une classification seule resterait invisible.
    expect(survey.pending).toEqual(['/cours/a.zmap'])
  })
```

- [ ] **Step 3: Mettre à jour l'assertion du `create` et de l'entrée**

Dans le test de création d'un enregistrement distant, remplacer l'assertion du client par :

```ts
    expect(client.mindMaps.create).toHaveBeenCalledWith(
      expect.objectContaining({ file_id: 'file-1', author: 'aife', path: 'a.zmap', type: 'default' }),
      expect.anything()
    )
```

et l'assertion de l'entrée par :

```ts
    expect(state.servers['https://pb.test'].entries['file-1']).toEqual({
      lastSyncedModified: AIFE.lastModified,
      lastSyncedUpdated: '2026-01-02 00:00:00.000Z',
      lastSyncedPath: 'a.zmap',
      lastSyncedContentHash: expect.any(String),
      lastSyncedType: 'default',
    })
```

- [ ] **Step 4: Mettre à jour `pocketBaseAdapter.test.ts`**

`create` exige désormais le champ `type`. Trois endroits : l'appel du test de création, son assertion, et l'appel du test de transmission des options.

```ts
    const result = await client.mindMaps.create({ file_id: 'f2', author: 'aife', path: 'b.zmap', content: '[]', type: 'default' })
```

```ts
    expect(pb.collection('cartes_mentales').create).toHaveBeenCalledWith(
      {
        file_id: 'f2',
        author: 'aife',
        path: 'b.zmap',
        content: '[]',
        type: 'default',
      },
      undefined
    )
```

```ts
    await client.mindMaps.create(
      { file_id: 'f3', author: 'aife', path: 'c.zmap', content: '[]', type: 'default' },
      { signal: controller.signal }
    )
```

- [ ] **Step 5: Lancer les tests et vérifier qu'ils échouent**

Run: `bunx vitest run src/sync/syncService.test.ts src/sync/pocketBaseAdapter.test.ts`
Expected: FAIL — les plans rendent `{ content, path }` sans `type`, et `surveySyncFolder` ne compte pas la classification seule.

- [ ] **Step 6: Étendre les types de `syncService.ts`**

```ts
export interface RemoteMindMapRecord {
  id: string
  file_id: string
  author: string
  path: string
  content: string
  updated: string
  /** Le type décidé par l'app, optionnel côté serveur : absent vaut default. */
  type?: string
}
```

```ts
export interface MindMapsApi {
  getFullList(options?: RequestOptions): Promise<RemoteMindMapRecord[]>
  create(
    data: { file_id: string; author: string; path: string; content: string; type: string },
    options?: RequestOptions
  ): Promise<RemoteMindMapRecord>
  update(
    id: string,
    data: { path?: string; content?: string; type?: string },
    options?: RequestOptions
  ): Promise<RemoteMindMapRecord>
}
```

Compléter les imports :

```ts
import { canClassify, canReorder } from './permissions'
import { mapTypeOf } from '../types/mapType'
```

- [ ] **Step 7: Ajouter le drapeau à `PushPlan` et `planPush`**

```ts
export interface PushPlan {
  content: boolean
  path: boolean
  type: boolean
}
```

À la fin de `planPush`, avant le `return` :

```ts
  // Le type est un petit frère du chemin : il ne part que si l'entrée existe,
  // qu'il diffère de l'accord, et qu'on a le droit de classer. mapTypeOf
  // normalise les deux côtés, donc une entrée migrée (lastSyncedType absent)
  // s'accorde implicitement sur default — jamais sur le type local, qui ferait
  // passer un classement de prof pour un changement à moi.
  const type =
    entry !== undefined &&
    mapTypeOf(entry.lastSyncedType) !== mapTypeOf(meta.type) &&
    canClassify(meta, currentUser)
  return { content, path, type }
```

- [ ] **Step 8: Compter une classification seule dans `surveySyncFolder`**

Remplacer la condition de la boucle :

```ts
    if (plan.content || plan.path || plan.type) survey.pending.push(path)
```

- [ ] **Step 9: Faire porter `type` au `create` de la boucle d'envoi**

Dans `pushOne`, l'appel devient :

```ts
        savedRecord = await client.mindMaps.create(
          { file_id: meta.id, author: meta.author, path: relPath, content, type: mapTypeOf(meta.type) },
          { signal }
        )
```

- [ ] **Step 10: Lancer les tests et vérifier qu'ils passent**

Run: `bunx vitest run src/sync/syncService.test.ts src/sync/pocketBaseAdapter.test.ts`
Expected: PASS. Le drapeau `type` est calculé mais pas encore utilisé par la boucle d'envoi : c'est la tâche suivante.

- [ ] **Step 11: Vérifier les types**

Run: `bunx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 12: Commit**

```bash
git add src/sync/syncService.ts src/sync/syncService.test.ts src/sync/pocketBaseAdapter.test.ts
git commit -m "feat(sync): record.type, drapeau type de planPush et compteur"
```

---

### Task 7: `sync()` — réconciliation, push `{ type }` seul, tirage, `reclassified`

**Files:**
- Modify: `src/sync/syncService.ts`
- Modify: `src/sync/syncService.test.ts`

**Interfaces:**
- Consumes: `seedLastSyncedType`, `reconcileType` (Task 3) ; `setMindMapType` (Task 5) ; `planPush.type` (Task 6)
- Produces: `SyncResult.reclassified?: number` ; `sync()` adopte un type distant en appelant `setMindMapType`, envoie `update(id, { type })` seul, et réapplique `record.type` au fichier tiré.

- [ ] **Step 1: Préparer le mock et les tests qui échouent**

Dans `src/sync/syncService.test.ts`, le mock de `fileStore` gagne `setMindMapType` :

```ts
vi.mock('../persistence/fileStore', () => ({
  loadMindMap: vi.fn(),
  loadMindMapMeta: vi.fn(),
  setMindMapType: vi.fn(),
}))
```

puis l'import :

```ts
import { loadMindMap, loadMindMapMeta, setMindMapType } from '../persistence/fileStore'
```

et le `beforeEach` gagne :

```ts
  vi.mocked(setMindMapType).mockReset().mockResolvedValue(undefined)
```

- [ ] **Step 2: Ajouter les tests de bout en bout**

À la fin du fichier :

```ts
describe('sync — classification', () => {
  it('lets a prof send the type alone, never the content of an eleve s map', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'b.zmap', path: '/cours/b.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue({ ...AIFE, id: 'file-2', author: 'eleve1', role: 'eleve', type: 'cours' })
    const update = vi.fn().mockResolvedValue({
      id: 'rec-2',
      file_id: 'file-2',
      author: 'eleve1',
      path: 'b.zmap',
      content: 'x',
      updated: 'u9',
      type: 'cours',
    })
    const client = fakeClient({
      mindMaps: {
        getFullList: vi.fn().mockResolvedValue([
          { id: 'rec-2', file_id: 'file-2', author: 'eleve1', path: 'b.zmap', content: 'x', updated: 'u1' },
        ]),
        update,
      } as any,
    })
    const state = memory({
      'file-2': {
        lastSyncedModified: 'm-eleve',
        lastSyncedUpdated: 'u1',
        lastSyncedPath: 'b.zmap',
        lastSyncedContentHash: await hashContent('x'),
        lastSyncedType: 'default',
      },
    })

    const result = await runSync({ client, state, currentUser: 'aife', currentRole: 'prof' })

    expect(update).toHaveBeenCalledWith('rec-2', { type: 'cours' }, expect.anything())
    expect(loadMindMap).not.toHaveBeenCalled()
    expect(writeTextFile).not.toHaveBeenCalled()
    expect(result.pushed).toBe(1)
    expect(result.reclassified).toBe(0)
    expect(state.servers['https://pb.test'].entries['file-2'].lastSyncedType).toBe('cours')
  })

  it('adopts a type the prof set on the eleve s own map, without touching the content', async () => {
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue({ ...AIFE, author: 'eleve1', role: 'eleve', type: 'default' })
    vi.mocked(setMindMapType).mockResolvedValue(undefined)
    const client = fakeClient({
      mindMaps: {
        getFullList: vi.fn().mockResolvedValue([
          { id: 'rec-1', file_id: 'file-1', author: 'eleve1', path: 'a.zmap', content: '[]', updated: 'u2', type: 'cours' },
        ]),
      } as any,
    })
    const state = memory({
      'file-1': {
        lastSyncedModified: AIFE.lastModified,
        lastSyncedUpdated: 'u1',
        lastSyncedPath: 'a.zmap',
        lastSyncedContentHash: await hashContent('[]'),
        lastSyncedType: 'default',
      },
    })

    const result = await runSync({ client, state, currentUser: 'eleve1', currentRole: 'eleve' })

    expect(setMindMapType).toHaveBeenCalledWith('/cours/a.zmap', 'cours')
    expect(client.mindMaps.update).not.toHaveBeenCalled()
    expect(loadMindMap).not.toHaveBeenCalled()
    expect(writeTextFile).not.toHaveBeenCalled()
    expect(result.reclassified).toBe(1)
    expect(result.pulled).toBe(0)
    expect(state.servers['https://pb.test'].entries['file-1'].lastSyncedType).toBe('cours')
  })

  it('re-applies the record s type to the file it pulls, and remembers it as the agreement', async () => {
    vi.mocked(scanFolder).mockResolvedValue([])
    const embedded = JSON.stringify({
      meta: { id: 'file-7', author: 'prof', role: 'prof', lastModified: '2026-01-01T00:00:00.000Z', type: 'default' },
      cards: [],
    })
    const record = {
      id: 'r7',
      file_id: 'file-7',
      author: 'prof',
      path: 'c.zmap',
      content: embedded,
      type: 'corrections',
      updated: 'u3',
    }
    const client = fakeClient({ mindMaps: { getFullList: vi.fn().mockResolvedValue([record]) } as any })
    const state = memory()

    await runSync({ client, state, currentUser: 'eleve1', currentRole: 'eleve' })

    expect(writeTextFile).toHaveBeenCalledTimes(1)
    const [writtenPath, written] = vi.mocked(writeTextFile).mock.calls[0]
    expect(writtenPath).toBe('/cours/c.zmap')
    expect(JSON.parse(written as string).meta.type).toBe('corrections')
    expect(state.servers['https://pb.test'].entries['file-7'].lastSyncedType).toBe('corrections')
    expect(state.servers['https://pb.test'].entries['file-7'].lastSyncedContentHash).toBe(
      await hashContent(written as string)
    )
  })

  it('never turns a remote type change into a conflict for the author who edited', async () => {
    // Le type ne bumpe pas le contenu : l'empreinte reste égale, donc l'auteur
    // n'est pas bloqué en conflit par un simple classement du prof.
    vi.mocked(scanFolder).mockResolvedValue([{ type: 'mindmap', name: 'a.zmap', path: '/cours/a.zmap' }])
    vi.mocked(loadMindMapMeta).mockResolvedValue({
      ...AIFE,
      author: 'eleve1',
      role: 'eleve',
      type: 'default',
      lastModified: '2026-02-01T00:00:00.000Z',
    })
    vi.mocked(loadMindMap).mockResolvedValue([])
    const update = vi.fn().mockResolvedValue({
      id: 'rec-1',
      file_id: 'file-1',
      author: 'eleve1',
      path: 'a.zmap',
      content: 'neuf',
      updated: 'u2',
      type: 'cours',
    })
    const remoteContent = '[]'
    const client = fakeClient({
      mindMaps: {
        getFullList: vi.fn().mockResolvedValue([
          { id: 'rec-1', file_id: 'file-1', author: 'eleve1', path: 'a.zmap', content: remoteContent, updated: 'u1', type: 'cours' },
        ]),
        update,
      } as any,
    })
    const state = memory({
      'file-1': {
        lastSyncedModified: '2026-01-01T00:00:00.000Z',
        lastSyncedUpdated: 'u1',
        lastSyncedPath: 'a.zmap',
        lastSyncedContentHash: await hashContent(remoteContent),
        lastSyncedType: 'default',
      },
    })

    const result = await runSync({ client, state, currentUser: 'eleve1', currentRole: 'eleve' })

    expect(result.conflicts).toEqual([])
    expect(result.reclassified).toBe(1)
    expect(update).toHaveBeenCalledWith('rec-1', { content: expect.any(String) }, expect.anything())
  })
})
```

- [ ] **Step 3: Lancer et vérifier l'échec**

Run: `bunx vitest run src/sync/syncService.test.ts`
Expected: FAIL — `setMindMapType` n'est jamais appelé, `result.reclassified` vaut `undefined`, et le tirage écrit la chaîne reçue telle quelle.



- [ ] **Step 4: `SyncResult.reclassified` et l'alias interne**

Dans `src/sync/syncService.ts`, ajouter le champ au résultat public :

```ts
  /** Ce qui n'est ni un échec ni un transfert : « les deux côtés avaient bougé ». */
  notices?: { fileId: string; message: string }[]
  /** Combien de cartes ont adopté le type décidé ailleurs. */
  reclassified?: number
```

Puis élargir l'alias interne, pour que `sync()` ait le droit de l'incrémenter :

```ts
type SyncRunResult = SyncResult &
  Required<Pick<SyncResult, 'relocated' | 'moved' | 'notices' | 'reclassified'>>
```

Et initialiser `reclassified: 0` dans l'objet `result` construit au début de `sync()`.

- [ ] **Step 5: La passe de réconciliation adopte le type**

Dans `reconcileOne`, juste après `entry.lastSyncedPath = lastSyncedPath` et AVANT la décision de chemin :

```ts
    // ── Type ────────────────────────────────────────────────────────────
    // L'accord est amarré AVANT de décider : un type local non-default face à
    // un serveur sans type doit rester un changement à pousser, et planPush
    // exige un lastSyncedType connu.
    entry.lastSyncedType = seedLastSyncedType(entry.lastSyncedType)
    const typeAction = reconcileType({
      localType: mapTypeOf(scan.meta.type),
      lastSyncedType: entry.lastSyncedType,
      remoteType: remote?.type,
    })
    if (typeAction.kind === 'adopt') {
      try {
        await setMindMapType(scan.path, typeAction.to)
        entry.lastSyncedType = typeAction.to
        result.reclassified += 1
        if (typeAction.bothChanged) {
          result.notices.push({
            fileId: scan.meta.id,
            message: '« ' + relPath + ' » a été classé des deux côtés : le type du serveur a été appliqué',
          })
        }
      } catch (error) {
        result.errors.push({ fileId: scan.meta.id, message: describeSyncError(error) })
      }
    }
    // Les deux côtés portent déjà le même type : réamarrer l'accord dessus,
    // sinon le push suivant renverrait une valeur identique.
    if (remote !== undefined && mapTypeOf(remote.type) === mapTypeOf(scan.meta.type)) {
      entry.lastSyncedType = mapTypeOf(remote.type)
    }
```

Imports à ajouter : `reconcileType`, `seedLastSyncedType` (`./typeReconciliation`), `mapTypeOf` (`../types/mapType`), `setMindMapType` (`../persistence/fileStore`).

- [ ] **Step 6: Le push porte `{ type }` seul**

Dans `pushOne` :

```ts
        const payload: { path?: string; content?: string; type?: string } = {}
        if (plan.content) payload.content = content
        if (plan.path) payload.path = relPath
        if (plan.type) payload.type = mapTypeOf(meta.type)
        savedRecord = await client.mindMaps.update(remote.id, payload, { signal })
```

Et dans l'entrée enregistrée :

```ts
        lastSyncedType: plan.type || remote === undefined ? mapTypeOf(meta.type) : known?.lastSyncedType,
```

Le `create` porte le type :

```ts
        savedRecord = await client.mindMaps.create(
          { file_id: meta.id, author: meta.author, path: relPath, content, type: mapTypeOf(meta.type) },
          { signal }
        )
```

- [ ] **Step 7: Le tirage réapplique `record.type`**

Dans `pullOne`, remplacer l'écriture verbatim par la matérialisation qui applique le champ :

```ts
      const applied = meta === null ? null : { ...meta, type: mapTypeOf(record.type) }
      const serialized = serializeMindMap(applied, cards)
      await writeTextFile(localPath, serialized)
      await pullAssetsFor(client, localPath, referencedAssets(serialized, remoteAssets), { signal })
      entries[record.file_id] = {
        lastSyncedModified: meta?.lastModified ?? record.updated,
        lastSyncedUpdated: record.updated,
        lastSyncedPath: record.path,
        lastSyncedType: mapTypeOf(record.type),
        lastSyncedContentHash: await hashContent(serialized),
      }
```

`referencedAssets` lit la chaîne écrite (`serialized`), jamais la chaîne reçue : ce sont les mêmes références, mais une seule est le fichier réel.

- [ ] **Step 8: Lancer la suite et committer**

Run: `bunx vitest run src/sync/syncService.test.ts`
Expected: PASS.

```bash
git add src/sync/syncService.ts src/sync/syncService.test.ts src/sync/pocketBaseAdapter.test.ts
git commit -m "feat(sync): pousser, adopter et tirer le type"
```

---

### Task 8: `src/sync/syncResultLabel.ts` — « reclassé(s) »

**Files:**
- Modify: `src/sync/syncResultLabel.ts`
- Test: `src/sync/syncResultLabel.test.ts`

**Interfaces:**
- Consumes: `SyncResult.reclassified` (Task 7).
- Produces: le libellé mentionne « N reclassé(s) ».

- [ ] **Step 1: Write the failing test**

Ajouter à `src/sync/syncResultLabel.test.ts` :

```ts
it('mentionne les reclassements', () => {
  expect(
    syncResultLabel({
      pushed: 0,
      pulled: 0,
      errors: [],
      cancelled: false,
      transferred: [],
      conflicts: [],
      reclassified: 2,
    })
  ).toContain('2 reclassé(s)')
})
```

- [ ] **Step 2: Lancer le test et vérifier l'échec**

Run: `bunx vitest run src/sync/syncResultLabel.test.ts`
Expected: FAIL — la ligne « reclassé(s) » manque.

- [ ] **Step 3: Ajouter la ligne au compte rendu**

Dans `src/sync/syncResultLabel.ts`, juste après la ligne des déplacements :

```ts
  // Une adoption de type n'est ni un envoi ni une réception : comme un
  // déplacement, elle doit se lire même quand les deux compteurs sont à zéro.
  if ((result.reclassified ?? 0) > 0) parts.push(`${result.reclassified ?? 0} reclassé(s)`)
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `bunx vitest run src/sync/syncResultLabel.test.ts`
Expected: PASS.

> `src/state/useSyncStore.ts` reste inchangé : `reclassified` est optionnel, et le store appelle déjà `syncResultLabel(result)` pour le journal.

- [ ] **Step 5: Commit**

```bash
git add src/sync/syncResultLabel.ts src/sync/syncResultLabel.test.ts
git commit -m "feat(sync): le compte rendu dit les reclassements"
```

---

### Task 9: `src/components/sidebar/MapTypeBadge.tsx` — la pilule de type

**Files:**
- Create: `src/components/sidebar/MapTypeBadge.tsx`
- Test: `src/components/sidebar/MapTypeBadge.test.tsx`

**Interfaces:**
- Consumes: `MAP_TYPES`, `MAP_TYPE_LABELS`, `MAP_TYPE_DESCRIPTIONS`, `MapType` (Task 1) ; `mapTypeColor`, `neutralMapTypeColors` (Task 2) ; `toCss` (`src/colors/contrast.ts`) ; `useResolvedTheme()` ; `Tooltip`, `TooltipTrigger`, `TooltipContent` (`src/components/ui/tooltip.tsx`).
- Produces: `MapTypeBadge({ type }: { type: string | undefined })` ; rend `null` pour une valeur absente, `''` ou `default` ; rend une pilule NEUTRE avec le libellé BRUT pour une valeur inconnue (le spec : une valeur inconnue reste lisible).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TooltipProvider } from '../ui/tooltip'
import { MapTypeBadge } from './MapTypeBadge'

function show(type: string | undefined) {
  return render(
    <TooltipProvider>
      <MapTypeBadge type={type} />
    </TooltipProvider>
  )
}

describe('MapTypeBadge', () => {
  it('n’affiche rien pour default, une valeur absente ou vide', () => {
    expect(show(undefined).container).toBeEmptyDOMElement()
    expect(show('').container).toBeEmptyDOMElement()
    expect(show('default').container).toBeEmptyDOMElement()
  })

  it('affiche le libellé du type connu', () => {
    show('cours')
    expect(screen.getByTestId('map-type-badge')).toHaveTextContent('Cours')
  })

  it('affiche une pilule neutre avec le libellé BRUT pour une valeur inconnue', () => {
    show('futur')
    expect(screen.getByTestId('map-type-badge')).toHaveTextContent('futur')
  })

  it('nomme la pilule pour les technologies d’assistance', () => {
    show('exo')
    expect(screen.getByTestId('map-type-badge')).toHaveAttribute('aria-label', 'Exercices')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/components/sidebar/MapTypeBadge.test.tsx`
Expected: FAIL — `Failed to resolve import "./MapTypeBadge"`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { toCss } from '../../colors/contrast'
import { mapTypeColor } from '../../colors/mapTypeColors'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'
import { MAP_TYPE_DESCRIPTIONS, MAP_TYPE_LABELS, MAP_TYPES, type MapType } from '../../types/mapType'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/**
 * Le tag coloré d’une carte, dans l’arborescence. `default` (ou absent) ne rend
 * rien du tout : l’absence de tag EST l’information « pas encore classée ».
 *
 * Une valeur INCONNUE (fichier écrit par une version future, main éditée) garde
 * sa pilule neutre et son libellé BRUT plutôt que de disparaître : `mapTypeColor`
 * rend le neutre pour ce cas, et le spec veut qu’elle reste lisible.
 *
 * Le détail au survol passe par le Tooltip de l’app, pas une popover Radix : un
 * libellé et une phrase tiennent dans un tooltip, et celui-ci est déjà monté par
 * FileSidebar.
 */
export function MapTypeBadge({ type }: { type: string | undefined }) {
  const theme = useResolvedTheme()
  const color = mapTypeColor(type, theme)
  if (color === null) return null

  const categorized = type !== undefined && (MAP_TYPES as readonly string[]).includes(type)
  const label = categorized ? MAP_TYPE_LABELS[type as MapType] : (type ?? '')
  const description = categorized ? MAP_TYPE_DESCRIPTIONS[type as MapType] : 'Type inconnu'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="map-type-badge"
          aria-label={label}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
            padding: '0 5px',
            borderRadius: 999,
            border: '1px solid ' + toCss(color.border),
            background: toCss(color.bg),
            color: toCss(color.text),
            fontSize: 9,
            fontWeight: 600,
            lineHeight: '14px',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ opacity: 0.8 }}>{description}</span>
      </TooltipContent>
    </Tooltip>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/components/sidebar/MapTypeBadge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/MapTypeBadge.tsx src/components/sidebar/MapTypeBadge.test.tsx
git commit -m "feat(sidebar): pilule de type avec tooltip"
```

### Task 10: `FileTreeRow` — la pilule sur la ligne et le sous-menu

**Files:**
- Modify: `src/components/sidebar/FileTreeRow.tsx`
- Test: `src/components/sidebar/FileTreeRow.test.tsx`

**Interfaces:**
- Consumes: `MapTypeBadge` (Task 9) ; `canClassify` (Task 4) ; `setMindMapType` (Task 5) ; `MAP_TYPES`, `MAP_TYPE_LABELS` (Task 1) ; `ContextMenuSub`, `ContextMenuSubTrigger`, `ContextMenuSubContent` (`src/components/ui/context-menu.tsx`, déjà importés en partie).
- Produces: rien pour les tâches suivantes ; c’est la surface utilisateur.

- [ ] **Step 1: Write the failing tests**

Ajouter au fichier de test (en réutilisant le montage de la ligne déjà présent dans ce fichier, et en ajoutant `setMindMapType: vi.fn()` au mock de `../../persistence/fileStore`) :

```tsx
it('affiche la pilule du type de la carte', async () => {
  vi.mocked(loadMindMapMeta).mockResolvedValue({ ...meta, type: 'exo' })
  renderRow()
  expect(await screen.findByTestId('map-type-badge')).toHaveTextContent('Exercices')
})

it('n’affiche aucune pilule pour une carte sans type', async () => {
  vi.mocked(loadMindMapMeta).mockResolvedValue(meta)
  renderRow()
  await screen.findByText('Chapitre')
  expect(screen.queryByTestId('map-type-badge')).toBeNull()
})

it('classe la carte depuis le sous-menu Type', async () => {
  vi.mocked(loadMindMapMeta).mockResolvedValue(meta)
  vi.mocked(setMindMapType).mockResolvedValue(undefined)
  renderRow()
  await screen.findByText('Chapitre')
  await openContextMenu()
  await userEvent.hover(screen.getByText('Type'))
  await userEvent.click(await screen.findByText('Exercices'))
  expect(setMindMapType).toHaveBeenCalledWith(PATH, 'exo')
})

it('montre « Type » désactivé pour un brouillon, avec la raison', async () => {
  vi.mocked(loadMindMapMeta).mockResolvedValue(null)
  renderRow()
  await openContextMenu()
  const label = await screen.findByText('Type')
  const item = label.closest('[data-slot="context-menu-item"]')
  expect(item).toHaveAttribute('aria-disabled', 'true')
  expect(item).toHaveAttribute('title', 'Publiez cette carte pour pouvoir la classer')
})
```

`renderRow` et `openContextMenu` sont les helpers déjà employés par les tests voisins de ce fichier : les réutiliser tels quels plutôt que d’en écrire de nouveaux.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: FAIL — aucune pilule, aucun sous-menu « Type ».

- [ ] **Step 3: Add the imports and the classification action**

Dans `FileTreeRow.tsx` :

```tsx
import { Check, Tag, CloudUpload, CloudOff /* …suivant l’existant… */ } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '../ui/context-menu'
import { MAP_TYPES, MAP_TYPE_LABELS } from '../../types/mapType'
import { setMindMapType } from '../../persistence/fileStore'
import { canClassify } from '../../sync/permissions'
import { MapTypeBadge } from './MapTypeBadge'
```

Puis, à côté de `meta` / `currentUser`, dériver les deux faits qui gouvernent le menu :

```tsx
  const classifyAllowed = currentUser !== null && canClassify(meta, currentUser)
  const classifyBlockedBecauseDraft = meta === null
```

Et l’action, qui rafraîchit l’arbre et le compteur exactement comme la publication :

```tsx
  async function classify(type: (typeof MAP_TYPES)[number]) {
    try {
      await setMindMapType(node.path, type)
      useWorkspaceStore.getState().bumpFileMetaRevision()
      await refreshFolder(parentDirOf(node.path))
      await useSyncStore.getState().refreshPendingCount()
    } catch (error) {
      setWorkspaceError('Impossible de classer « ' + node.name + ' » : ' + describeError(error))
    }
  }
```

- [ ] **Step 4: Render the badge on the row**

Dans la branche `node.type === 'mindmap'`, après le `<span>{displayName}</span>`, ajouter :

```tsx
                  <MapTypeBadge type={meta?.type} />
```

- [ ] **Step 5: Render the submenu, or the disabled entry**

Dans le `ContextMenuContent` de la carte, après `Exporter` et avant le séparateur des actions destructrices :

```tsx
            {classifyAllowed ? (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Tag size={14} /> Type
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {MAP_TYPES.map(type => (
                    <ContextMenuItem key={type} onSelect={() => void classify(type)}>
                      {meta?.type === type ? <Check size={14} /> : <span style={{ width: 14 }} />}
                      {MAP_TYPE_LABELS[type]}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            ) : (
              <ContextMenuItem
                disabled
                title={
                  classifyBlockedBecauseDraft
                    ? 'Publiez cette carte pour pouvoir la classer'
                    : 'Seul l’auteur ou un prof peut classer cette carte'
                }
              >
                <Tag size={14} /> Type
              </ContextMenuItem>
            )}
```

Un `ContextMenuItem disabled` porte déjà `data-disabled:pointer-events-none` et `data-disabled:opacity-50` : c’est ce qui le grise. Le `title` natif est utilisé plutôt qu’un Tooltip Radix parce qu’un item désactivé ne reçoit pas le survol dont un déclencheur Radix a besoin.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bunx vitest run src/components/sidebar/FileTreeRow.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/sidebar/FileTreeRow.tsx src/components/sidebar/FileTreeRow.test.tsx
git commit -m "feat(sidebar): tag de type et sous-menu de classement"
```

---

### Task 11: `infra` — le champ `type` et sa documentation

**Files:**
- Modify: `infra/pocketbase-schema.mjs` (`MIND_MAP_FIELDS`)
- Test: `infra/setup-pocketbase.test.mjs`
- Modify: `infra/README_INFRA.md`

**Interfaces:**
- Produces: le champ `type` dans le plan de collection `cartes_mentales`.

- [ ] **Step 1: Write the failing test**

Ajouter au fichier de test (en important `desiredCollections` et `MIND_MAPS_COLLECTION` depuis `./pocketbase-schema.mjs` si ce n’est pas déjà fait) :

```js
it('décrit le champ type de cartes_mentales', () => {
  const desired = desiredCollections().find(entry => entry.name === MIND_MAPS_COLLECTION)
  const field = desired.fields.find(entry => entry.name === 'type')
  expect(field).toEqual({
    name: 'type',
    type: 'text',
    required: false,
    max: 64,
    help: 'Type de la carte (cours, exo, prise de notes, corrections). Vide = non classée.',
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: la commande de test `infra` déjà employée par la suite existante (le fichier voisin est le modèle).
Expected: FAIL — `field` est `undefined`.

- [ ] **Step 3: Add the field**

Dans `MIND_MAP_FIELDS`, après `content` :

```js
  {
    name: 'type',
    type: 'text',
    required: false,
    max: 64,
    help: 'Type de la carte (cours, exo, prise de notes, corrections). Vide = non classée.',
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: la même commande de test `infra`.
Expected: PASS.

- [ ] **Step 5: Update the README**

Dans `infra/README_INFRA.md` :

- Le tableau des collections : la ligne `cartes_mentales` devient `file_id (unique), author, path, content, type` ; les règles API ne changent pas.
- L’encadré « Un serveur configuré AVANT l’arrivée du partage d’agencement doit être réappliqué » : ajouter le champ `type` aux raisons de réappliquer — sans le champ, un prof classant la carte d’un élève écrit dans une colonne qui n’existe pas.
- Préciser que « Les règles exactes de cartes_mentales » sont inchangées, pour qu’un lecteur ne cherche pas une règle nouvelle.

- [ ] **Step 6: Commit**

```bash
git add infra/pocketbase-schema.mjs infra/setup-pocketbase.test.mjs infra/README_INFRA.md
git commit -m "feat(infra): champ type sur cartes_mentales et README"
```

---

### Task 12: `transformer-cours-en-carte-mentale` — l’enveloppe avec le type

**Files:**
- Modify: `.claude/skills/transformer-cours-en-carte-mentale/SKILL.md`

**Interfaces:**
- Consumes: le vocabulaire de Task 1.
- Produces: le skill écrit une enveloppe `{ meta, cards }` complète, type compris.

- [ ] **Step 1: Replace the output contract**

Dans la section « Le schéma cible », remplacer la ligne « Sortie : JSON array de `Card`… » par le contrat d’enveloppe :

```md
- Sortie : l’ENVELOPPE `{ "meta": { … }, "cards": [ … ] }`, sérialisée
  `JSON.stringify({ meta, cards }, null, 2)`, un fichier par chapitre.
- `meta` = `{ "id": <uuid>, "author": <pseudo fourni>, "role": <"eleve" | "prof" fourni>, "lastModified": <ISO maintenant>, "type": <type> }`.
  Le pseudo et le rôle sont ceux de la personne pour qui le fichier est produit ;
  si l’invocation ne les donne pas, les DEMANDER avant d’écrire.
- `type` appartient à `"cours" | "exo" | "prise de notes" | "corrections" | "default"` :
  `cours` pour un contenu de référence, `exo` pour un entraînement,
  `prise de notes` pour des notes à compléter, `corrections` pour une correction,
  `default` si le document ne relève clairement d’aucun.
```

- [ ] **Step 2: Verify by hand**

Demander au skill de convertir un petit support en précisant `author: aife, role: prof, type: cours`, puis inspecter le fichier produit :

Run: `node -e "const fs=require('fs');const o=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(o.meta.author,o.meta.role,o.meta.type,Array.isArray(o.cards))" <chemin-du-fichier-produit>`
Expected: `aife prof cours true` — une enveloppe, pas un tableau nu.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/transformer-cours-en-carte-mentale/SKILL.md
git commit -m "docs(skill): la carte générée porte son type dans meta"
```

---

### Task 13: Vérification finale

**Files:** aucun.

- [ ] **Step 1: Toute la suite**

Run: `bun run test`
Expected: PASS, aucun test ignoré, aucun `.only` laissé.

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Vérifier les points de vigilance à la main**

- Ouvrir un fichier réel de `.cartes-mentales/` : la pilule affiche le type injecté par la reprise, et le survol sa description.
- Sur une carte publiée dont on est l’auteur, choisir un autre type : la pilule change, et « Synchroniser » doit le pousser.
- Sur un brouillon (fichier sans `meta`), l’entrée « Type » est grisée avec son `title`.
- Après un sync, rouvrir le fichier : `meta.type` correspond au champ serveur, et `meta.lastModified` n’a pas été touché par une adoption de type.

- [ ] **Step 4: Commit (si un ajustement a eu lieu)**

```bash
git add -A
git commit -m "chore: vérifications finales des types de carte"
```

---

## Self-Review

**Couverture de la spec :** chaque section de la spec a une tâche — vocabulaire (1), palette (2), modèles + réconciliation + amorçage (3), permission (4), écriture locale + publication (5), champ et payload (6-7), compte rendu (8), pilule + popover (9), sous-menu + gating brouillon (10), RBAC/README et schéma serveur (11), skill (12), vérifications (13). La reprise des 17 fichiers de `.cartes-mentales/` est déjà faite et documentée dans la spec, donc volontairement hors plan.

**Chasse aux placeholders :** aucun TODO/TBD. Les seules zones laissées à l’exécutant sont des montages de test à reprendre des fichiers voisins (`renderRow`, `openContextMenu`, commande de test `infra`), pas des trous de contenu.

**Cohérence des types :** `MapType` et `mapTypeOf` (1) sont les seuls à nommer les valeurs ; `canClassify` (4) est la seule porte du menu (10) et du plan de push (6) ; `setMindMapType` (5) est appelé par la réconciliation (7) et le menu (10) ; `reclassified` est produit par 7 et lu par 8 ; `lastSyncedType` est nommé identiquement dans 3, 6 et 7.

---

## Handoff d’exécution

Plan complet, enregistré dans `docs/superpowers/plans/2026-09-12-types-et-tags-des-cartes.md`. Deux options d’exécution.

**1. Subagent-Driven (recommandé)** — un sous-agent frais par tâche, revue entre les tâches, itération rapide.
**2. Inline Execution** — exécution dans cette session avec des points de contrôle.

---

### Task 14: `src/validation/cardsValidation.test.ts` — déballer l'enveloppe

**Files:**
- Modify: `src/validation/cardsValidation.test.ts`

**Contexte (ruling du contrôleur) :** le test « the mind maps present in the working copy » passe le module JSON entier à `validateCards`. Depuis que l'app écrit des enveloppes `{ meta, cards }` pour les cartes synchronisées, les `.json` de `.cartes-mentales/` sont des enveloppes, et `validateCards` les voit comme « malformed ». Vérifié : une fois `.cards` extrait, les cinq fichiers valident. C'est un test périmé, pas une donnée cassée.

- [ ] **Step 1: Modifier le test pour déballer l'enveloppe**

Dans le `it.each`, remplacer l'assertion :

```ts
  it.runIf(paths.length > 0).each(paths)('%s passes validation untouched', path => {
    const raw = files[path] as unknown
    const cards = Array.isArray(raw) ? raw : (raw as { cards: unknown }).cards
    expect(validateCards(cards)).toEqual({ valid: true, issues: [] })
  })
```

- [ ] **Step 2: Vérifier**

Run: `bunx vitest run src/validation/cardsValidation.test.ts`
Expected: PASS — 40/40, dont les cinq `.cartes-mentales/**/*.json`.

- [ ] **Step 3: Commit**

```bash
git add src/validation/cardsValidation.test.ts
git commit -m "fix(tests): valider les cartes, pas l'enveloppe, des .json locaux"
```
