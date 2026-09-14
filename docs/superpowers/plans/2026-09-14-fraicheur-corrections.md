# Fraîcheur des corrections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à la skill `transformer-cours-en-carte-mentale` un moyen de
détecter qu'un fichier `corrections` ne couvre plus fidèlement son exercice,
via deux champs de métadonnées qu'elle seule écrit et relit.

**Architecture:** Aucun nouveau module applicatif. Deux champs optionnels
ajoutés à l'interface `MindMapMeta` existante (survivent déjà aux
allers-retours de sérialisation sans code supplémentaire, vérifié dans
`src/persistence/serialization.ts`), plus une extension de la documentation
de la skill décrivant quand les lire/écrire.

**Tech Stack:** TypeScript (types uniquement, aucune logique runtime),
Markdown (doc de skill), Vitest pour le test de non-régression de
sérialisation.

**Spec:** `docs/superpowers/specs/2026-09-14-fraicheur-corrections-design.md`

## Global Constraints

- Aucun changement de comportement applicatif — vérifié dans la spec que
  `meta` traverse l'app sans reconstruction champ par champ.
- Pas d'UI, pas de badge, pas de scan automatique.
- `correctsSnapshot` réutilise le type `CardCounts` de
  `src/sync/cardCounts.ts` tel quel — ne pas en créer un nouveau.
- Les deux nouveaux champs sont optionnels (`?`) — aucun fichier `.zmap`
  existant ne doit devenir invalide.

---

### Task 1: Ajouter `correctsId` et `correctsSnapshot` à `MindMapMeta`

**Files:**
- Modify: `src/types/card.ts:1-37`
- Test: `src/persistence/serialization.test.ts`

**Interfaces:**
- Consumes: `CardCounts` (type déjà défini dans `src/sync/cardCounts.ts`,
  forme `{ total: number; byLevel: Record<CardLevel, number>; detached:
  number }`) — importer avec `import type` pour éviter tout cycle runtime
  avec `src/types/card.ts` (dont `cardCounts.ts` importe déjà `Card`,
  `CardLevel`, `ALL_CARD_LEVELS`).
- Produces: `MindMapMeta.correctsId?: string`,
  `MindMapMeta.correctsSnapshot?: CardCounts` — utilisés par la
  documentation de skill mise à jour dans la Task 2 (aucun code TS ne les
  lit encore, c'est voulu).

- [ ] **Step 1: Write failing test**

  Dans `src/persistence/serialization.test.ts`, ajouter un test qui prouve
  qu'un `meta` portant les deux nouveaux champs survit à un aller-retour
  sérialisation/désérialisation — le comportement réel que toute cette
  fonctionnalité présuppose :

  ```ts
  it('round-trips correctsId and correctsSnapshot through serialize/deserialize', () => {
    const metaWithFreshness: MindMapMeta = {
      ...meta,
      correctsId: 'exo-abc-123',
      correctsSnapshot: { total: 5, byLevel: { 1: 1, 2: 2, 3: 1, 4: 1 }, detached: 0 },
    }
    const json = serializeMindMap(metaWithFreshness, cards)
    expect(deserializeMindMap(json)).toEqual({ meta: metaWithFreshness, cards })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `bun run test src/persistence/serialization.test.ts`
  Expected: FAIL — erreur de compilation TypeScript, `correctsId` et
  `correctsSnapshot` n'existent pas sur le type `MindMapMeta`.

- [ ] **Step 3: Write minimal implementation**

  Dans `src/types/card.ts`, ajouter l'import et les deux champs :

  ```ts
  import type { CardBlock } from './cardBlock'
  import type { MapType } from './mapType'
  import type { CopyLink } from '../sync/copyLink'
  import type { CardCounts } from '../sync/cardCounts'
  ```

  Puis, dans `MindMapMeta`, juste après `copyLink?: CopyLink`:

  ```ts
  export interface MindMapMeta {
    id: string
    author: string
    role: UserRole
    lastModified: string
    type?: MapType
    copyLink?: CopyLink
    /**
     * Le `meta.id` de l'exo corrigé par ce fichier `corrections` — posé et lu
     * uniquement par la skill `transformer-cours-en-carte-mentale`, jamais par
     * l'app. Absent sur tout fichier qui n'est pas une correction.
     */
    correctsId?: string
    /**
     * Le compte de cartes de l'exo lié au moment où la correction a été
     * écrite/vérifiée pour la dernière fois — sert à la skill à détecter
     * qu'une correction est devenue obsolète. Voir
     * `docs/superpowers/specs/2026-09-14-fraicheur-corrections-design.md`.
     */
    correctsSnapshot?: CardCounts
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  Run: `bun run test src/persistence/serialization.test.ts`
  Expected: PASS — tous les tests du fichier, y compris le nouveau.

- [ ] **Step 5: Run full test suite to check for regressions**

  Run: `bun run test`
  Expected: PASS — aucune régression ailleurs (le champ est optionnel,
  aucun autre fichier ne le référence encore).

- [ ] **Step 6: Commit**

  ```bash
  git add src/types/card.ts src/persistence/serialization.test.ts
  git commit -m "feat(types): ajouter correctsId/correctsSnapshot à MindMapMeta

  Champs optionnels réservés à la skill transformer-cours-en-carte-mentale
  pour détecter la fraîcheur d'un fichier corrections. Aucun effet
  applicatif — voir docs/superpowers/specs/2026-09-14-fraicheur-corrections-design.md.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 2: Documenter le mécanisme dans la skill

**Files:**
- Modify: `.claude/skills/transformer-cours-en-carte-mentale/SKILL.md:95-97` (insérer une nouvelle section entre « Où écrire le fichier » et « Définition ou média »)

**Interfaces:**
- Consumes: `correctsId`, `correctsSnapshot` produits par la Task 1 (mêmes
  noms exacts, mêmes types).
- Produces: rien consommé par une tâche ultérieure — ceci est la dernière
  tâche du plan.

- [ ] **Step 1: Insérer la nouvelle section**

  Dans `.claude/skills/transformer-cours-en-carte-mentale/SKILL.md`, juste
  après la ligne 96 (`  bloc image » plus bas).`) et avant la ligne 97
  (`## Définition ou média : la carte est l'un OU l'autre`), insérer :

  ```markdown
  ## Fraîcheur d'un fichier `corrections`

  Un fichier `corrections` (voir l'exception de nommage ci-dessus) peut
  devenir incomplet si l'exercice qu'il corrige gagne ou perd des cartes
  après coup. Deux champs de `meta`, réservés à cette skill (l'app ne les
  affiche ni ne les modifie jamais), permettent de le détecter :

  ```ts
  correctsId?: string             // meta.id de l'exo corrigé
  correctsSnapshot?: CardCounts   // compte de cartes de l'exo, capturé ici
  ```

  `CardCounts` est le type de `src/sync/cardCounts.ts` :
  `{ total, byLevel, detached }`. Le compter à la main sur les `cards` de
  l'exo lié (un objet, incrémenté par carte, séparant les cartes volantes
  — `detached: true` — du reste) plutôt que d'en approximer un.

  ### À la création ou régénération d'un fichier `corrections`

  Lire le `meta.id` de l'exo corrigé (déjà identifié par son nom de
  fichier/dossier : `influences.zmap` → `influences-corrections.zmap`),
  compter ses cartes, et écrire les deux champs dans le `meta` de la
  correction :

  ```json
  "meta": {
    "id": "…",
    "author": "aife",
    "role": "prof",
    "lastModified": "…",
    "type": "corrections",
    "correctsId": "<meta.id de influences.zmap>",
    "correctsSnapshot": { "total": 5, "byLevel": { "1": 1, "2": 2, "3": 1, "4": 1 }, "detached": 0 }
  }
  ```

  ### En reprenant un chantier de maintenance

  Quand on demande à cette skill de vérifier ou mettre à jour des
  corrections existantes, pour chaque fichier `corrections` portant un
  `correctsId` : relire l'exo correspondant (le retrouver par son
  `meta.id`, pas par son nom — un renommage ne casse pas le lien),
  recompter ses cartes, comparer à `correctsSnapshot`. Tout écart sur
  `total` — à la hausse comme à la baisse — signale que la correction est
  à revoir avant d'être considérée à jour ; ne comparer que le nombre de
  cartes, pas leur contenu.

  **Backfill** : un fichier `corrections` déjà existant sans `correctsId`
  n'est pas une erreur. Chercher `<même nom sans le suffixe
  -corrections>.zmap` dans le même dossier de chapitre ; si trouvé, poser
  `correctsId` et amorcer `correctsSnapshot` avec le compte actuel avant de
  continuer la vérification. Si rien n'est trouvé (correction orpheline),
  laisser le fichier tel quel — pas de lien à forcer.
  ```

- [ ] **Step 2: Vérifier que la section s'insère au bon endroit**

  Run: `grep -n "^## " ".claude/skills/transformer-cours-en-carte-mentale/SKILL.md"`
  Expected: `## Fraîcheur d'un fichier \`corrections\`` apparaît entre `##
  Où écrire le fichier` et `## Définition ou média : la carte est l'un OU
  l'autre`, dans cet ordre.

- [ ] **Step 3: Commit**

  ```bash
  git add ".claude/skills/transformer-cours-en-carte-mentale/SKILL.md"
  git commit -m "docs(skill): documenter la fraîcheur des fichiers corrections

  Décrit quand la skill transformer-cours-en-carte-mentale doit écrire et
  relire correctsId/correctsSnapshot (ajoutés à MindMapMeta dans la tâche
  précédente) — création, vérification lors d'une reprise de chantier, et
  backfill des fichiers existants.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

## Self-Review Notes

- **Spec coverage** : modèle de données (Task 1), écriture à la création,
  vérification en reprise de chantier, backfill (tous dans Task 2) — tous
  couverts. La spec dit explicitement « aucun changement applicatif requis
  » et « pas de test automatisé requis » ; le test ajouté en Task 1 est un
  test de non-régression sur un comportement déjà existant
  (sérialisation), pas un nouveau comportement testé isolément — cohérent
  avec la spec.
- **Placeholder scan** : aucun TBD/TODO, chaque step contient le code
  exact à écrire.
- **Type consistency** : `correctsId`/`correctsSnapshot` utilisés à
  l'identique dans les deux tâches ; `CardCounts` importé du même module
  dans les deux.
