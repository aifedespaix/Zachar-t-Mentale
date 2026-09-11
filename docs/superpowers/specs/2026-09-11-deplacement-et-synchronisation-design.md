# Déplacement et renommage dans l'arbre, et synchronisation des chemins — Design

**Date** : 2026-09-11
**Statut** : Validé, en attente du plan d'implémentation
**Suite de** : `2026-09-10-synchronisation-pocketbase-design.md`

## Contexte

Deux besoins, exprimés ensemble parce qu'ils se répondent :

1. **Vérifier que le renommage des dossiers et des fichiers est réellement
   supporté par la synchronisation.** La crainte de départ était technique :
   « renommer un dossier implique souvent de réécrire tous les chemins
   enfants ». L'audit ci-dessous montre que le problème est réel, mais qu'il
   n'est pas là où on l'attendait.
2. **Permettre le glisser-déposer dans l'arborescence** pour déplacer les
   cartes mentales et les dossiers, avec une UX visible (survol, glissement,
   cible), dans le vocabulaire visuel déjà employé par les cartes du canevas.

L'audit a été fait avant toute écriture de code, et il conditionne le design :
le renommage n'est pas « partiellement supporté », il est **non supporté** par
la synchro — ça marche tant qu'on ne renomme rien.

## Audit : ce qui ne marche pas aujourd'hui

### Ce qui marche déjà

- `renamePath()` (`src/persistence/fileOps.ts`) fait le `fs.rename` et emporte
  le sidecar `.assets` en best-effort.
- L'app suit le fichier ouvert : renommer un fichier, ou un dossier contenant
  le fichier ouvert, réécrit `currentFilePath` (`FileTreeRow.tsx`, `submitRename`).
- Quand un push a lieu, il réécrit bien le `path` distant :
  `update(id, { content, path: relPath })` (`syncService.ts`).

### Les trois trous

1. **Renommer ne marque pas le fichier comme modifié.** `renamePath` ne touche
   jamais `meta.lastModified`, et `isPushPending` compare
   `meta.lastModified > lastSyncedModified`. Un fichier déjà synchronisé qu'on
   renomme n'est donc **jamais poussé** : le `path` distant garde l'ancien nom
   indéfiniment. Le compteur « à envoyer » reste à 0, donc rien ne signale
   l'écart.
2. **L'état de synchro ignore les chemins.** `.sync-state.json` ne contient que
   `{ lastSyncedModified, lastSyncedUpdated }` par `file_id` : il ne sait pas
   *où* était le fichier. Conséquence côté tirage : `pullOne` écrit au `path`
   serveur **sans jamais toucher l'ancien chemin**. Si l'autre machine a
   renommé puis poussé, celle qui tire obtient **deux fichiers locaux portant le
   même `meta.id`** — l'ancien, jamais supprimé, et le nouveau. Au push suivant,
   c'est exactement le cas que le garde `seenFileIds` rejette
   (« plusieurs fichiers locaux partagent le même identifiant de
   synchronisation »).
3. **Les dossiers n'existent pas côté serveur.** Une arborescence n'est que la
   concaténation des `path`. Renommer un dossier change N chemins locaux ; comme
   aucun n'est marqué modifié (trou 1), **aucun** `path` distant ne bouge.
   Ensuite, soit l'autre machine re-tire les enregistrements et recrée l'ancien
   dossier, soit le fichier part avec son nouveau chemin quand son auteur le
   modifie, et l'ancien dossier subsiste ailleurs. Rien ne réécrit les chemins
   enfants.

### Le cas limite que l'audit a mis au jour

Un fichier dont on n'est pas l'auteur (verrouillé, lecture seule) ne peut pas
voir son `path` distant réécrit : la règle PocketBase est
`Update: @request.auth.username = author`, et la spec de synchronisation
précise que `role` est une étiquette d'affichage qui ne change aucune
permission. Un renommage local d'un fichier d'autrui n'était donc pas
répercutable, et le prochain tirage d'une nouvelle version l'aurait réécrit à
son chemin canonique, produisant un doublon local.

## Décisions de cadrage

Ces choix ont été faits pendant la conception ; ils sont la loi du présent
document.

1. **Périmètre du glisser-déposer** : cartes mentales **et** dossiers entiers
   (sous-arbres).
2. **Permissions** : un **prof** peut déplacer, renommer et supprimer
   l'**agencement** de n'importe quel fichier ou dossier, y compris ceux d'un
   élève ; un **élève** ne le peut que pour ses propres fichiers et pour les
   brouillons locaux sans `meta`. Le prof **ne gagne pas** le droit d'éditer le
   contenu d'un élève : le contenu reste à son auteur, sans exception.
3. **Répercussion** : elle est dans ce chantier. Le prof déplace, l'élève suit,
   ce qui suppose la règle serveur et le push « chemin seul » décrits plus bas.
4. **Sortie du dossier de synchronisation** : l'enregistrement distant reste sur
   le serveur. Le fichier local sort du périmètre (plus poussé, jamais
   supprimé), et la ligne porte un badge discret « hors du dossier de
   synchronisation » qui explique pourquoi il ne part plus.
5. **Suppression** : une suppression dans l'app supprime aussi l'enregistrement
   distant. Suppression locale immédiate, suppression distante **différée**
   (tombstone locale si le serveur est injoignable), et **propagation** aux
   autres machines. À la propagation : copie locale intacte → supprimée ;
   copie locale modifiée depuis le dernier sync → `meta` retiré, conservée en
   brouillon local, et l'app le dit.
6. **Compléments d'UX** : menu « Déplacer vers… », couper/coller fichier au
   clavier, et fichiers non-cartes (PDF, images) déplaçables comme les autres.
7. **Modèle retenu** : l'état de synchro mémorise le chemin (voir « Approches
   écartées »).

## Modèle de données : état de synchronisation v2

`.sync-state.json` change de forme. Les chemins sont **relatifs à la racine de
synchronisation**, donc l'état est indexé par serveur **et** mémorise la racine
avec laquelle il a été construit.

```jsonc
{
  "version": 2,
  "servers": {
    "https://pb.exemple.fr": {
      "syncFolderPath": "C:\\Cours",
      "entries": {
        "<file_id>": {
          "lastSyncedModified": "2026-09-10T14:32:00.000Z",
          "lastSyncedUpdated": "2026-09-10T14:35:11.000Z",
          "lastSyncedPath": "Chimie/atomes.zmap",
          "lastSyncedContentHash": "3f9e2b1a4c8d0e77"
        }
      },
      "tombstones": ["<file_id>"]
    }
  }
}
```

```ts
export interface SyncStateEntry {
  lastSyncedModified: string
  lastSyncedUpdated: string
  /** Absent = inconnu (entrée migrée), pas « pas de chemin ». */
  lastSyncedPath?: string
  /** Absent = inconnu ; la comparaison de conflit retombe alors sur la révision. */
  lastSyncedContentHash?: string
}

export interface ServerSyncState {
  syncFolderPath: string | null
  entries: Record<string, SyncStateEntry>
  /** `file_id` dont la suppression distante reste à appliquer. */
  tombstones: string[]
}

export interface SyncState {
  version: 2
  servers: Record<string, ServerSyncState>
}
```

**Pourquoi une portée par serveur.** La propagation des suppressions repose sur
« un `file_id` que je connais et qui n'est plus dans la liste distante a été
supprimé ». Sans portée par serveur, **changer d'URL dans les réglages ferait
apparaître tous les `file_id` comme absents**, et l'app supprimerait toutes les
copies locales synchronisées sur un simple changement de champ. La portée par
serveur n'est pas un ornement : c'est ce qui rend l'inférence sûre.

**Pourquoi mémoriser la racine.** `lastSyncedPath` est relatif à la racine de
sync. Changer de dossier de synchronisation rendrait tous les chemins faux d'un
coup, et la lecture naïve en conclurait « tous les chemins ont bougé » → le sync
réécrirait **tous** les chemins distants pour suivre le nouveau rangement local.
Sur un changement de racine, on **réamorce `lastSyncedPath` depuis le chemin
local, sans rien pousser ni relocaliser**, et on le journalise. La comparaison
de contenu (`lastSyncedModified` / `lastSyncedUpdated`) reste valable : elle ne
dépend pas des chemins.

**Migration v1 → v2.** L'ancien format est plat
(`Record<file_id, { lastSyncedModified, lastSyncedUpdated }>`), détecté par
l'absence de `version`. `loadSyncState(serverUrl)` reçoit l'URL courante (le
module de persistance ne connaît pas les réglages) et attribue les entrées
migrées à ce serveur, avec `lastSyncedPath` et le hash **absents** = inconnus.
Si aucune URL n'est configurée, les entrées sont abandonnées : c'est un cache,
et le pire cas est une re-comparaison complète au prochain sync.

Au premier sync suivant la migration, pour chaque entrée dont `lastSyncedPath`
est inconnu : on l'amorce avec le `path` distant s'il existe un enregistrement,
sinon avec le chemin local, **sans rien déplacer**. Effet de bord voulu : les
fichiers renommés avant cette version, dont le chemin distant est resté périmé,
se réparent au premier sync — « mon chemin local diffère de `lastSyncedPath` »
devient vrai d'un coup. Tant que le hash est inconnu, la détection de conflit
retombe sur l'ancienne comparaison par révision.

**Racine inconnue et racine changée ne sont pas le même cas**, et l'amarrage
diffère — c'est la seule ambiguïté que cette section pourrait laisser :

| `syncFolderPath` mémorisé | Amarrage de `lastSyncedPath` | Pourquoi |
|---|---|---|
| absent (`null`, entrée migrée) | le `path` distant s'il existe un enregistrement, sinon le chemin local | racine présumée inchangée : un chemin distant périmé doit être réparé, donc « j'ai bougé » doit être vrai |
| présent mais **différent** de la racine courante | le chemin local | le rangement local a changé de sens : on ne réécrit pas l'agencement du serveur pour le suivre |

Dans les deux cas la racine mémorisée est ensuite réécrite avec la racine
courante.

**Les tombstones.** Une tombstone est créée **uniquement par une suppression
explicite dans l'app**. Jamais déduite d'un fichier local disparu : un disque
externe non monté, un dossier réseau injoignable ou un scan en échec ne doivent
pas pouvoir supprimer les copies du serveur. Trois règles :

- elle est **annulée** si un fichier local portant ce `file_id` existe encore
  (suppression puis restauration d'une sauvegarde → on repousse, on ne détruit
  pas) ;
- elle est **appliquée avant le push** dans le même passage, pour qu'un
  `file_id` republié dans la foulée ne soit pas effacé par une intention
  périmée ;
- elle est **retirée après un DELETE réussi**. Un DELETE en échec la laisse en
  place et le signale ; la suppression locale, elle, a déjà eu lieu.

**Le hash de contenu** réutilise le motif de `assets.ts`
(`crypto.subtle.digest('SHA-256', …)`, tronqué en hex). Il sert à rendre le
conflit **basé sur le contenu** au lieu de la seule révision. Sans lui, un
déplacement de prof bumpe `updated` et l'élève reste bloqué en « conflit » à
chaque sync, indéfiniment, pour un simple rangement.

**Cycle de vie d'une entrée** : créée au premier push ou pull réussi ;
`lastSyncedPath` écrit à chaque push (`relPath`), à chaque pull (`record.path`)
et à chaque relocalisation ; retirée quand le DELETE distant réussit. Une entrée
dont le fichier local a disparu (suppression hors app) est ignorée par la
réconciliation — pas de nettoyage automatique, pas d'inférence.

## Algorithme de synchronisation

`sync()` passe de deux passes à six, dans cet ordre. L'ordre n'est pas
cosmétique : chaque passe prépare les suivantes.

### 0. Préparation

Liste distante, assets et scan local, comme aujourd'hui. Plus une nouveauté :
**une seule lecture de `meta` par fichier local**, dans une table indexée par
`file_id`, partagée par la réconciliation et le push (`pushOne` relit `meta`
fichier par fichier aujourd'hui, et la nouvelle passe en aurait besoin
séparément).

### 1. Réconciliation des chemins

La passe qui n'existe pas et qui règle les trois trous de l'audit. Elle traite
**aussi les fichiers dont on est l'auteur**, ce que ni le push ni le pull ne
savent faire : le pull ignore les enregistrements dont on est l'auteur.

Pour chaque fichier local connu (`meta !== null`, entrée existante) :

| Cas | `local` vs `lastSyncedPath` | `remote.path` vs `lastSyncedPath` | Qui a bougé | Action |
|---|---|---|---|---|
| a | égal | égal (ou pas d'enregistrement) | personne | rien |
| b | différent | égal | **moi** | je pousserai mon `path` (passe 4) |
| c | égal | différent | **autrui** | je me relocalise à `remote.path` |
| d | différent | différent, et `local ≠ remote` | les deux | **le serveur gagne** : relocalisation + signalement |
| e | différent | différent, mais `local == remote` | les deux pareil | `lastSyncedPath = remote.path`, rien à faire |

La préséance n'est donc **pas** fondée sur le rôle mais sur « qui a bougé » :
premier arrivé gagne, égalité → le serveur. C'est ce qui la rend valable aussi
bien pour l'élève dont le prof déplace un fichier (cas c) que pour le prof qui
vient de déplacer (cas b), sans code conditionnel par rôle.

Une relocalisation = `renamePath` (qui emporte le sidecar) + `ensureLocalFolder`
sur le dossier parent. **Collision** : si la cible existe déjà et n'est pas ce
fichier, on n'écrase rien — erreur reportée, `lastSyncedPath` inchangé, nouvelle
tentative au sync suivant. Le fichier ouvert suit (`currentFilePath`), comme au
renommage manuel.

### 2. Propagation des suppressions distantes

Pour chaque entrée de ce serveur dont le `file_id` n'est plus dans la liste
distante, en cherchant le fichier à `lastSyncedPath` :

- **intact** (`meta.lastModified <= entry.lastSyncedModified`) → suppression
  locale, retrait de l'entrée, ligne « retiré du serveur » ;
- **modifié** depuis le dernier sync → `stripMindMapSyncMeta` : le fichier
  devient un brouillon local que la synchro ne verra plus jamais, entrée
  retirée, et l'app le dit ;
- **fichier local introuvable** → on ne touche pas à l'entrée (elle appartient
  au chemin tombstone) ;
- un dossier vidé par ces suppressions **n'est pas supprimé** : effacer une
  arborescence que l'utilisateur n'a pas demandé à effacer est plus surprenant
  qu'un dossier vide.

### 3. Tombstones

`client.mindMaps.delete(record.id)` — l'identifiant PocketBase est retrouvé via
la liste distante à partir du `file_id`. Tombstone annulée si un fichier local
porte encore ce `file_id`, effacée si l'enregistrement est déjà absent, retirée
après succès, conservée en cas d'échec.

### 4. Push

L'éligibilité se dédouble :

- **contenu** : `meta.author === currentUser` **et** (entrée absente ou
  `meta.lastModified > lastSyncedModified`) — inchangé ;
- **chemin** : `entry.lastSyncedPath !== relPath`, autorisé si
  `meta.author === currentUser` **ou** si le rôle courant est `prof`.

Le payload suit la même logique : `create({ file_id, author, path, content })`
pour un nouvel enregistrement, `update(id, { content })` pour un contenu seul,
`update(id, { path })` pour un chemin seul, `update(id, { content, path })` pour
un auteur dont les deux ont bougé. PocketBase fait un **PATCH** : les champs
absents du payload sont laissés intacts côté serveur (vérifié dans le SDK,
`RecordService.update` → `method: "PATCH", body: <l'objet fourni>`), donc le
`path` écrit par un prof survit au push de contenu de l'élève.

Dans un push « **chemin seul** », `lastSyncedModified` n'est **pas** réécrit :
ce champ reste la mémoire de la révision de *contenu* vue par ce client, et un
prof n'écrit pas le contenu d'un élève. Seuls `lastSyncedUpdated` et
`lastSyncedPath` bougent.

L'auteur pousse `content`, le prof pousse `path` : c'est cette séparation qui
empêche l'élève d'écraser sans le savoir le rangement décidé par le prof.

### 5. Pull

Inchangé sur le fond — saut des enregistrements dont on est l'auteur, saut si
`lastSyncedUpdated >= record.updated`, garde-fou sur un fichier local occupant
la cible — plus `lastSyncedPath` et le hash écrits. La relocalisation n'a plus à
se faire ici : la passe 1 s'en est occupée, le fichier est déjà à sa place.

### 6. Enregistrement et journal

Un seul `saveSyncState` à la fin, comme aujourd'hui. Le journal de debug
existant (`syncLog.ts`) reçoit une ligne en français par relocalisation,
suppression propagée et tombstone appliquée.

`SyncResult` gagne `relocated`, `remoteDeleted`, `localDeleted` et
`keptAsDraft`, pour que le compte rendu de l'écran de réglages puisse dire
« 2 déplacés, 1 supprimé » au lieu de seulement « 0 envoyé ».

`isPushPending` est remplacé par `planPush({ meta, relPath, currentUser, entry })`
renvoyant `{ content: boolean, path: boolean }` : un seul point de vérité,
partagé par la boucle de sync et par le compteur « à envoyer », pour que le
nombre affiché ne puisse pas contredire ce qu'un sync ferait réellement — y
compris pour un fichier simplement renommé. `surveySyncFolder` reste purement
local (aucune requête réseau en plus) mais reçoit le rôle en plus du nom
d'utilisateur.

### Interfaces touchées

```ts
// src/sync/syncService.ts
interface MindMapsApi {
  getFullList(options?: RequestOptions): Promise<RemoteMindMapRecord[]>
  create(data: { file_id: string; author: string; path: string; content: string }, options?): Promise<RemoteMindMapRecord>
  /** Payload partiel désormais : `{ content }` seul, ou `{ path }` seul. */
  update(id: string, data: { path?: string; content?: string }, options?): Promise<RemoteMindMapRecord>
  delete(id: string, options?: RequestOptions): Promise<void>
}

interface SyncParams {
  client: SyncClient
  currentUser: string
  /** Nouveau : « prof » autorise le push de chemin sur le fichier d'autrui. */
  currentRole: UserRole
  /** Nouveau : clé de l'état par serveur. */
  serverUrl: string
  syncFolderPath: string
  state: SyncState
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
}

interface SyncResult {
  // …inchangé…
  relocated: number
  remoteDeleted: number
  localDeleted: number
  keptAsDraft: number
}

/** Remplace `isPushPending` : un seul point de vérité, contenu ET chemin. */
export function planPush(params: {
  meta: MindMapMeta
  relPath: string
  currentUser: { username: string; role: UserRole }
  entry: SyncStateEntry | undefined
}): { content: boolean; path: boolean }

export function isConflict(
  meta: MindMapMeta,
  entry: SyncStateEntry | undefined,
  remote: RemoteMindMapRecord | undefined,
  remoteContentHash: string
): remote is RemoteMindMapRecord

// src/persistence/fileOps.ts
export async function movePath(
  sourcePath: string,
  destFolderPath: string,
  user: { username: string; role: UserRole }
): Promise<string> // le chemin de destination

// src/sync/permissions.ts (nouveau)
export function canReorder(meta: MindMapMeta | null, user: { username: string; role: UserRole }): boolean

// src/state/useCommandRegistry.ts
interface CommandRegistration {
  run: () => void
  enabled: boolean
  label?: string
  /** Nouveau : ce composant est-il celui que le focus désigne ? */
  isApplicable?: () => boolean
}
registrations: Partial<Record<CommandId, CommandRegistration[]>>
```

`useCommand` gagne le paramètre optionnel correspondant, et `useShortcutSettingsStore`
n'a pas à changer : un identifiant reste un identifiant, seule la résolution du
handler devient contextuelle.

### Infra : les règles PocketBase changent

Les règles `Update` et `Delete` de `cartes_mentales` deviennent :

```
Update/Delete : @request.auth.username = author || @request.auth.role = "prof"
```

C'est une modification **manuelle dans l'admin PocketBase**, à répercuter dans
`README_INFRA.md` avec les règles copiables, comme pour les règles existantes.
Les règles de `assets` ne changent pas.

**Ce que la règle garantit encore, et ce qu'elle ne garantit plus.** Une règle
PocketBase est *par enregistrement*, pas par champ : `author || prof` autorise
donc un client prof à écrire n'importe quel champ, `content` compris. La
séparation « l'auteur pousse `content`, le prof pousse `path` » est une
**discipline du client**, pas une garantie du serveur. C'est acceptable ici et
il faut le dire plutôt que de le laisser croire : le déploiement est un serveur
par prof (spec de synchronisation), et un prof est l'administrateur de son
serveur — il peut de toute façon tout y faire. La propriété qui protège
réellement les gens, « un élève ne peut pas toucher l'enregistrement d'un autre
élève », reste intacte.

## Opérations de fichiers et permissions

### `movePath()`

Un seul chemin de code pour les trois entrées (glisser-déposer, « Déplacer
vers… », coller). Signature : `movePath(sourcePath, destFolderPath, user)` —
l'utilisateur est passé en paramètre pour que `fileOps.ts` reste sans accès aux
stores, comme `duplicateMap(sourcePath, author, role)`.

1. **Validation géométrique**, dans un prédicat pur et testable : la cible est
   un dossier existant ; ce n'est pas le dossier d'origine ; ce n'est pas le
   sous-arbre source (`isInsideFolder(cible, source)`) ; aucune collision de nom
   — un déplacement explicite qui renommerait en douce en `(2)` est plus
   surprenant qu'un refus clair.
2. **Validation de permission** : lecture des `meta` du contenu (tout le
   sous-arbre pour un dossier) et refus si un fichier échappe à `canReorder`.
3. **Exécution** : `renamePath` (qui emporte le sidecar), et **repli si le
   `rename` échoue en inter-périphérique** — déplacer entre deux racines sur
   deux disques est un cas normal ici. Le repli est copie puis suppression, avec
   deux exigences : la copie se fait **sans** `stripMindMapSyncMeta`
   (contrairement à `duplicatePath`, dont c'est le rôle assumé — un déplacement
   qui retire le `meta` transformerait un fichier synchronisé en brouillon
   local, c'est-à-dire en perte d'identité silencieuse), et **la source n'est
   supprimée qu'après une copie réussie**. Un échec en cours de route laisse un
   doublon : toujours préférable à un fichier perdu.

**Collision et casse** : sous Windows, renommer `chapitre.zmap` en
`Chapitre.zmap` vise le même fichier et la cible « existe déjà ». La détection
de collision compare donc **sans tenir compte de la casse sous Windows** et ne
considère jamais la source elle-même comme une collision — le réflexe que
`paths.ts` applique déjà dans `isInsideFolder`.

Après un déplacement : `currentFilePath` suit (le fichier lui-même, ou n'importe
quel fichier ouvert sous le dossier déplacé), les deux dossiers sont
rafraîchis, et la cible est **dépliée** — un fichier déplacé dans un dossier
replié qui disparaît de l'écran, c'est un déplacement qu'on croit raté.

### Permissions

Un seul prédicat partagé :

```ts
canReorder(meta: MindMapMeta | null, user: { username: string; role: UserRole }): boolean
// meta === null || meta.author === user.username || user.role === 'prof'
```

Il est utilisé par l'interface (glisser, menu), par l'éligibilité du push
« chemin seul » et par la pose des tombstones — et il correspond exactement à la
règle serveur `author || prof`. L'interface ne peut donc pas autoriser un
déplacement que la synchro refuserait de pousser : il n'y a qu'une définition.

Le prof **ne gagne pas** le droit d'éditer le contenu d'un élève : le fichier
reste en lecture seule au canevas. Seul l'agencement lui appartient, et c'est ce
qui garde le modèle fork debout.

### Suppression

`deletePath` reste l'opération locale. Une action de suppression partagée
(du type de `usePublishMindMap`) l'orchestre pour les deux surfaces existantes
(menu d'une ligne, commande `file.delete`), afin que la pose des tombstones ne
diverge pas :

1. pour un **dossier**, lire les `meta` de tout le contenu **avant**
   `deletePath` (après, ils n'existent plus) ;
2. poser une tombstone pour chaque fichier qui a un `meta` **et** pour lequel
   `canReorder` répond oui ;
3. `deletePath` ;
4. mettre à jour l'état de sync.

Chez un élève, supprimer un dossier contenant les cartes du prof supprime les
fichiers localement et ne touche pas aux enregistrements distants.

## UX de l'arbre

### Glisser-déposer en pointer events

Le HTML5 drag & drop **n'est pas utilisable ici** : la fenêtre Tauri ne
désactive pas le drag-drop natif (rien dans `src-tauri/tauri.conf.json`, donc
actif par défaut), et la documentation du crate est explicite —
`tauri-utils-2.9.3/src/config.rs` : « Disabling it is required to use HTML5 drag
and drop on the frontend on Windows ». Or l'app **dépend** de ce drag-drop
natif (`useFileDropZone.ts`, `getCurrentWebview().onDragDropEvent`) : c'est lui
qui ouvre un `.zmap` déposé sur la fenêtre et qui reçoit une image déposée sur
une carte. Désactiver le natif pour récupérer HTML5 casserait deux
fonctionnalités existantes pour en gagner une.

Donc pointer events, comme React Flow le fait déjà pour les cartes :

- `pointerdown` sur une ligne déplaçable : point de départ noté, rien capturé ;
- au-delà de ~5 px de déplacement, le glissement démarre : capture du pointeur,
  classe `dragging`, ghost affiché. En dessous du seuil, **rien ne change** — le
  clic ouvre le fichier, le double-clic renomme ;
- la fin d'un glissement **supprime le `click` qui suit** : la ligne est un
  `<button>` qui porte déjà `onClick` et `onDoubleClick`, et sans cela un
  fichier s'ouvrirait à chaque dépose ;
- cible détectée par `elementFromPoint` + `closest('[data-tree-row]')` sur des
  attributs `data-path` / `data-kind` / `data-locked` : pas de géométrie à
  maintenir ;
- le ghost suit le pointeur par **écriture DOM directe**
  (`ref.style.transform`), pas par re-render React : soixante rendus par seconde
  d'un composant qui contient un arbre récursif serait le vrai coût du geste ;
- auto-scroll quand le pointeur approche du bord haut ou bas du panneau ;
- `Escape` et `pointercancel` annulent.

### Vocabulaire visuel, repris des cartes

| Élément | Traitement |
|---|---|
| ligne source | `opacity: 0.6` + `cursor: grabbing` — la règle des cartes est `.react-flow__node.dragging .card-node { opacity: .6 }` |
| dossier cible valide | halo pulsé accent, en réutilisant les keyframes `reparent-target-pulse` de `index.css` |
| cible interdite | `cursor: not-allowed`, aucun halo, raison affichée dans le ghost |
| ghost | icône + nom, « N éléments » pour un dossier, `pointer-events: none` |
| ligne d'insertion bleue | **absente** : l'arbre est trié alphabétiquement, une position choisie à la main n'existe pas |

### Validation d'un dossier à la dépose

Savoir si un élève peut déplacer un dossier exige de lire le `meta` de tout son
contenu, sous-dossiers repliés compris — donc invisibles et non lus. Scanner un
sous-arbre entier à chaque `pointerdown` pour colorer un anneau serait payer
cher un détail cosmétique. L'anneau reste donc neutre pendant le survol, et un
refus à la dépose dit précisément pourquoi (« Ce dossier contient 2 fichiers de
aife — tu ne peux pas les déplacer »). Pour un prof, aucun scan n'est nécessaire.

### Cibles et interdits

- Cibles : les lignes de dossiers, **racines comprises**. Une racine n'est pas
  déplaçable elle-même : c'est une ancre du workspace, sa sortie passe par
  « Retirer de la liste ».
- Interdits : le dossier d'origine (non-événement, aucun commit), son propre
  sous-arbre, un fichier verrouillé pour un élève, une collision de nom (refus
  au commit).

### « Déplacer vers… »

Un item de menu contextuel sur chaque ligne déplaçable, ouvrant un dialogue qui
liste les dossiers candidats (racines comprises, sous-arbre source exclu,
dossier d'origine marqué). C'est le repli clavier du glisser-déposer, et il
permet de viser un dossier replié ou hors écran.

### Couper / coller et le registre de commandes

`Ctrl+X` / `Ctrl+V` au niveau fichier entrent en collision avec `edit.cut` /
`edit.paste`, les cartes du canevas : le registre ne tient **qu'un seul handler
par identifiant** (`useCommandRegistry.ts`) et le lookup n'associe **qu'un seul
identifiant par raccourci** (`useShortcutSettingsStore.ts`, premier arrivé dans
l'ordre du catalogue). Deux commandes sur les mêmes touches produiraient une
liaison morte et silencieuse, et un conflit affiché dans l'écran des raccourcis.

Le registre évolue donc :

- `registrations` devient `Partial<Record<CommandId, CommandRegistration[]>>` ;
- chaque enregistrement porte un prédicat d'applicabilité optionnel
  (`isApplicable?: () => boolean`, par défaut toujours vrai) ;
- `run(id)` exécute le premier enregistrement à la fois actif et applicable ;
- `isEnabled(id)` est vrai si au moins un l'est — menus et palette gardent leur
  sémantique.

Le canevas enregistre « le canevas a le focus », l'arbre enregistre « l'arbre a
le focus » : `Ctrl+X` coupe la carte quand le canevas a le focus, le fichier
quand l'arbre l'a. Effet de bord bienvenu : ça répare un écrasement silencieux
latent entre deux composants qui enregistreraient le même identifiant.

**Destination d'un collage** : la ligne qui a le focus clavier — un dossier →
on colle dedans, un fichier → on colle dans son dossier parent (la convention
des explorateurs), rien de focalisé → le dialogue « Déplacer vers… » s'ouvre.

### Fichiers non-cartes et badge hors périmètre

Les fichiers non-cartes (PDF, images, visibles quand « afficher les fichiers
illisibles » est actif) sont déplaçables comme les autres : ils n'ont pas de
`meta`, donc `canReorder` répond oui et la synchro n'en sait rien.

Une carte qui a un `meta` mais se trouve **hors du dossier de synchronisation**
porte un badge discret avec l'explication : elle a un enregistrement distant,
elle ne sera plus poussée.

### Où vit l'état du glissement

Un petit store (`useTreeDragStore` : source, cible survolée, raison
d'interdiction) plutôt que des props à travers chaque niveau de la récursion, et
un unique composant ghost rendu au niveau de la barre latérale — cohérent avec
`useCardSelectionStore` déjà en place.

## Comportements existants qui changent

1. **Un élève ne peut plus renommer un fichier dont il n'est pas l'auteur.**
   Aujourd'hui le menu l'offre sans condition (`FileTreeRow.tsx`) et la commande
   `file.rename` du fichier ouvert aussi (`AppToolbar.tsx`). Les deux passent
   derrière `canReorder` ; l'item disparaît, la raison est dite par le cadenas
   et son infobulle.
2. **Supprimer un fichier synchronisé le supprime aussi du serveur**, à la
   prochaine synchro. La confirmation devient : « Supprimer « X » ? Il sera
   aussi retiré du serveur à la prochaine synchronisation. », et pour un dossier,
   avec le nombre de cartes synchronisées concernées.
3. **La détection de conflit devient basée sur le contenu.** Le conflit n'est
   plus « la révision distante a bougé » mais « le contenu distant a changé
   depuis ce que j'ai poussé ou tiré ». Les libellés de l'écran de réglages qui
   parlent de conflit restent valables, mais un déplacement de prof n'en produit
   plus.
4. **Le format de `.sync-state.json` change** (v2, portée par serveur) et
   l'API `MindMapsApi` gagne `delete`, `update` acceptant un payload partiel.

## Erreurs et cas limites

| Cas | Comportement |
|---|---|
| Serveur injoignable | aucun état local modifié ; tombstones et déplacements en attente survivent ; message inchangé |
| Déplacement impossible (collision, permission, disque) | bannière ; rien n'a bougé sur le disque |
| Relocalisation qui entre en collision | erreur reportée, `lastSyncedPath` intact, nouvel essai au sync suivant |
| DELETE distant en échec | tombstone conservée et reportée ; la suppression locale a déjà eu lieu |
| Changement de dossier de synchronisation | `lastSyncedPath` réamorcé depuis le chemin local, rien n'est poussé ni relocalisé, journalisé |
| Renommage changeant seulement la casse | traité comme le même fichier, pas comme une collision |
| Fichier supprimé dans l'explorateur | ne supprime rien à distance : l'entrée reste, est ignorée, l'enregistrement reste |
| Fichier ouvert déplacé pendant le debounce d'autosave | `currentFilePath` est mis à jour avant que le minuteur ne parte, pour que l'autosave ne recrée pas l'ancien chemin |
| Déposer dans le dossier d'origine | non-événement : aucun commit, aucune bannière |
| Deux machines du même compte | comportement inchangé (le trou connu du modèle fork), simplement moins bruyant grâce au conflit basé sur le contenu |

## Tests

- `movePath` : nominal ; dossier ; collision casse-insensible ; cible dans son
  propre sous-arbre ; dossier d'origine ; repli inter-périphérique (copie +
  suppression, `meta` **préservé**, source supprimée seulement après copie
  réussie) ; échec du repli → source intacte.
- `syncState` : migration v1 → v2 ; portée par serveur ; changement de racine
  de synchronisation ; tombstones (pose, annulation, conservation en échec).
- `syncService` : les cinq cas de la matrice ; push « chemin seul » d'un prof sur
  le fichier d'un élève (`lastSyncedModified` non réécrit) ; pull qui relocalise
  au lieu de dupliquer ; propagation intact → supprimé / modifié → brouillon ;
  conflit basé sur le hash — **un déplacement de prof ne crée plus de conflit** ;
  migration (les chemins périmés se réparent au premier sync).
- `useCommandRegistry` : deux enregistrements pour un même identifiant ;
  dispatch par applicabilité ; `isEnabled` cohérent.
- UI : le glissement appelle `movePath` avec les bons chemins, déplie la cible,
  fait suivre `currentFilePath`, rafraîchit les deux dossiers ; **aucun `click`
  ne suit un glissement** ; élève sur fichier verrouillé → pas de glissement ;
  prof sur le fichier d'un élève → oui ; `Escape` annule ; « Déplacer vers… »
  exclut le sous-arbre source ; `Ctrl+X` / `Ctrl+V` ciblent la ligne focalisée.

## Approches écartées

- **Réécrire les fichiers au déplacement** (bumper `meta.lastModified` sur
  chaque `.zmap` affecté). Peu de code et format d'état inchangé, mais I/O sur N
  fichiers à chaque renommage de dossier, coupure possible en plein milieu,
  mensonge sur le contenu — et trois des quatre trous de l'audit restent
  ouverts : le doublon au tirage, l'autorité du prof, la détection d'un chemin
  modifié par autrui.
- **Faire de l'agencement une collection PocketBase séparée** (`agencement` :
  `file_id` → `path`), pour que le `updated` du contenu reste pur. La plus
  propre conceptuellement, mais elle paie une collection, ses règles, la
  documentation d'infra et une fusion de deux listes dans `syncService` — et
  elle ne supprime pas le besoin de `lastSyncedPath`, puisque le tirage doit de
  toute façon savoir où était le fichier local. À garder comme évolution
  possible si le croisement des `updated` devient pénible.
- **Interdire au prof de déplacer les fichiers d'élèves** en attendant un
  chantier de synchronisation dédié : aucun trou, mais la fonctionnalité
  demandée n'est pas livrée.

## Hors périmètre

- **Le journal de déplacements** (`from → to`). Sa conséquence est documentée :
  un enregistrement distant **absent localement** (poussé par un élève après le
  dernier sync) dont le dossier parent est renommé chez le prof garde son ancien
  chemin, et le tirage recrée l'ancien dossier une fois. À rouvrir si la limite
  se voit en pratique.
- Supprimer un fichier dans l'explorateur ne supprime rien à distance.
- Pas de corbeille, pas de soft delete, pas de purge des assets orphelins (déjà
  hors périmètre de la spec de synchronisation).
- Pas d'annulation d'un déplacement : le geste inverse est un autre déplacement.
- Pas de réordonnancement manuel de l'arbre (tri alphabétique conservé) ni de
  déplacement des racines du workspace.
- Aucune nouvelle permission au-delà de « prof déplace, renomme et supprime
  l'agencement des autres » : le contenu reste à son auteur, sans exception.
- Le glisser-déposer est portable par construction, mais il n'est testé que sous
  Windows.
