# Navigation fichiers — Design

**Date** : 2026-09-06
**Statut** : Validé par l'utilisateur en chat, prêt pour plan d'implémentation
**Lot** : 5/6 du projet "Zachar't Mentale"

## Contexte

Le lot 1 (éditeur de carte mentale) est terminé et mergé sur `main`. Le lot 2
(mode quiz) est en cours de développement en parallèle sur une autre machine.
Ce document couvre le lot 5 : la navigation fichiers, qui remplace le fichier
unique hardcodé (`demo-chapitre.mmap.json`) chargé au démarrage par une
sidebar dépliable listant les dossiers de cours de l'utilisateur, avec
arborescence de type explorateur de fichiers (à la VS Code).

Le lot 4 (Configuration complète — couleurs, colonnes, polices) n'existe pas
encore. Ce lot pose un fichier de config minimal, dédié à la liste de dossiers
racine, pensé pour être étendu par le lot 4 sans migration.

## État actuel du code (avant ce lot)

- `App.tsx` charge un unique chemin constant `DEMO_FILE_PATH` au démarrage via
  `loadMindMap`, et autosave dessus via `useAutosave`. Aucune notion de
  "changer de fichier" n'existe.
- Le scope de permissions Tauri (`src-tauri/capabilities/default.json`) est
  restreint au seul fichier demo : `fs:scope` → `allow: ["**/demo-chapitre.mmap.json"]`.
- Dépendances fs déjà présentes : `@tauri-apps/plugin-fs` (`exists`,
  `readTextFile`, `writeTextFile`). Pas de plugin `dialog`.

## Modèle de données

### Config workspace (nouveau fichier, séparé du futur fichier de config du lot 4)

Stocké via l'API `path` de Tauri (`appConfigDir()`), fichier `workspace.json` :

```ts
interface WorkspaceConfig {
  rootFolders: string[] // chemins absolus, dans l'ordre d'ajout
}
```

- Lu au démarrage de l'app ; absence de fichier = liste vide (premier lancement,
  aucun dossier configuré), pas une erreur — même logique que `loadMindMap`
  qui traite un fichier absent comme un état de départ valide.
- Écrit à chaque ajout/retrait d'un dossier racine.

### Arbre de fichiers (en mémoire, pas persisté)

```ts
type FileTreeNode =
  | { type: 'folder'; name: string; path: string; children: FileTreeNode[] }
  | { type: 'mindmap'; name: string; path: string }   // fichier .json
  | { type: 'other'; name: string; path: string }      // tout le reste

interface RootFolder {
  path: string
  tree: FileTreeNode[]   // enfants directs, scannés récursivement
}
```

- Un `FileTreeNode` de type `mindmap` n'est pas garanti valide — c'est une
  extension `.json`, pas un schéma vérifié. La validation réelle se fait à
  l'ouverture (voir Gestion d'erreurs).
- Tri à l'affichage : dossiers d'abord, puis fichiers, ordre alphabétique dans
  chaque groupe (comportement standard d'explorateur de fichiers, pas
  configurable dans ce lot).

## Store

Nouveau store zustand **`useWorkspaceStore`**, séparé de `useCardsStore` —
la navigation fichiers et l'édition de cards sont deux responsabilités
distinctes qui ne doivent pas se marcher dessus (l'un ne doit pas avoir à
connaître les détails internes de l'autre) :

```ts
interface WorkspaceState {
  rootFolders: RootFolder[]
  expandedPaths: Set<string>       // état d'expansion, en mémoire seulement
  currentFilePath: string | null   // fichier actuellement ouvert dans l'éditeur

  addRootFolder(path: string): Promise<void>   // scan + persist config
  removeRootFolder(path: string): Promise<void>
  refreshFolder(path: string): Promise<void>   // re-scan ciblé après CRUD ou bouton refresh
  toggleExpanded(path: string): void
  setCurrentFile(path: string | null): void
}
```

## Scan

- **Eager et récursif** : à l'ajout d'un dossier racine et au démarrage de
  l'app (pour chaque dossier déjà configuré), tout l'arbre est lu d'un coup
  via `readDir` récursif du plugin fs.
- Pas de file-watching temps réel dans ce lot (hors périmètre, voir plus bas).
  Un bouton "rafraîchir" dans la sidebar relance un scan complet de tous les
  dossiers racine.
- Après une action CRUD initiée depuis la sidebar (création, suppression,
  renommage), seul le sous-dossier parent concerné est re-scanné — pas besoin
  de tout refaire.
- Le repli/dépli dans l'UI (`expandedPaths`) ne déclenche **pas** de nouveau
  scan — la donnée est déjà en mémoire, seul l'affichage change. Ça donne un
  rendu "à la VS Code" (dossiers repliés par défaut) sans la complexité d'un
  scan à la demande.

## Composants UI

### `FileSidebar`

- Panneau latéral dépliable/repliable (bouton toggle dans la barre du haut ou
  en bord de panneau — détail d'implémentation). État replié/déplié non
  persisté entre sessions dans ce lot.
- En haut : action "Ajouter un dossier" → ouvre le sélecteur de dossier natif
  OS (`@tauri-apps/plugin-dialog`, `open({ directory: true })`).
- Pour chaque dossier racine configuré : un nœud racine (nom du dossier,
  action retirer de la config — ne supprime rien sur le disque, retire juste
  le suivi) + son arbre en dessous, dépliable.
- Icônes (lucide-react, cohérent avec le reste de l'app) :
  - Dossier fermé / dossier ouvert.
  - Fichier carte mentale (`.json`) — cliquable.
  - Fichier "autre" — **visible mais grisé, non cliquable**. Jamais masqué :
    même principe que les boutons grisés du lot 1 (aucun état caché sans
    explication).
- **Fichier actif** : la ligne du fichier actuellement ouvert a un fond
  distinct dans l'arbre.
- **Actions contextuelles** par nœud (icônes au survol ou clic droit, avec
  tooltip — cohérent avec le style du footer de card) :
  - Sur un dossier (racine ou sous-dossier) : nouvelle carte mentale, nouveau
    sous-dossier.
  - Sur un sous-dossier créé dans l'arbre (pas un dossier racine) : renommer,
    supprimer.
  - Sur un fichier carte mentale : renommer, supprimer.
  - Les dossiers racine eux-mêmes ne se renomment/suppriment pas depuis
    l'arbre (ce sont des dossiers réels de l'utilisateur, potentiellement
    partagés avec XMind ou autre usage) — seul "retirer de la config" est
    proposé dessus.

### Barre du haut (`App.tsx` header, existant)

- Ajout du nom du fichier actuellement ouvert, à côté du `LockToggle`
  existant. Tooltip affichant le chemin complet. Si aucun fichier n'est
  ouvert (aucun dossier configuré, ou aucun fichier sélectionné), affichage
  d'un état explicite ("Aucun fichier ouvert") plutôt qu'un espace vide.

## Data flow

### Ouverture d'un fichier

1. Clic sur un nœud `mindmap` dans la sidebar.
2. `loadMindMap(path)` — réutilise la fonction existante.
3. Succès → `loadCards(result)` dans `useCardsStore`, `setCurrentFile(path)`
   dans `useWorkspaceStore`, l'autosave (`useAutosave`) bascule sur le nouveau
   chemin.
4. Échec (JSON invalide/corrompu) → message d'erreur explicite affiché à
   l'utilisateur (même distinction fichier-absent/fichier-corrompu que le
   code de persistance actuel), le fichier ouvert précédemment reste affiché
   et éditable, l'autosave ne bascule pas.

### Création d'une carte mentale

1. Action "nouvelle carte mentale" sur un dossier (racine ou sous-dossier).
2. Demande du nom de fichier (modale ou champ inline — détail d'implémentation).
3. Écrit un `.json` contenant une seule card racine par défaut (réutilise
   `serializeCards` + le schéma par défaut déjà utilisé par `useCardsStore`).
4. `refreshFolder` sur le dossier parent, puis ouverture automatique du
   nouveau fichier (même flow que "Ouverture d'un fichier" ci-dessus).

### Suppression

1. Action "supprimer" sur un fichier ou un sous-dossier.
2. Modale de confirmation — même pattern que la suppression de card avec
   enfants (lot 1) : liste explicitement ce qui va disparaître ("supprimer ce
   dossier et ses 3 fichiers ?" / "supprimer ce fichier ?").
3. Confirmé → suppression fs (récursive si dossier), `refreshFolder` sur le
   parent.
4. Si le fichier supprimé était le fichier actuellement ouvert :
   `setCurrentFile(null)`, l'éditeur se vide proprement (état "Aucun fichier
   ouvert"), pas de sauvegarde fantôme sur un chemin qui n'existe plus, pas de
   crash.

### Renommage

1. Action "renommer" sur un fichier ou un sous-dossier → champ inline
   (cohérent avec l'édition de titre de card, qui utilise déjà ce pattern).
2. `rename` fs, `refreshFolder` sur le parent.
3. Si le fichier renommé est celui actuellement ouvert, `currentFilePath` est
   mis à jour vers le nouveau chemin — l'autosave continue sans interruption
   ni rechargement visible.

## Gestion d'erreurs

- Tout fichier `.json` dans un dossier surveillé est une carte mentale
  potentielle, pas garantie valide — la validation réelle se fait à
  l'ouverture, pas au scan (le scan ne fait qu'un `readDir`, pas de lecture de
  contenu).
- Échec d'ouverture (JSON invalide) : message explicite, pas de silent
  failure, l'état précédent de l'éditeur est préservé.
- Échec d'une opération fs (création, suppression, renommage — ex. permissions
  disque, fichier verrouillé par un autre programme) : message d'erreur
  explicite, pas de mise à jour optimiste de l'arbre avant confirmation du
  succès de l'opération.

## Permissions Tauri

- Nouvelle dépendance : `@tauri-apps/plugin-dialog` (sélecteur de dossier
  natif).
- `src-tauri/capabilities/default.json` étendu avec les permissions fs
  manquantes : `fs:allow-read-dir`, `fs:allow-mkdir`, `fs:allow-remove`,
  `fs:allow-rename` (en plus de `exists`/`read-text-file`/`write-text-file`
  déjà présents).
- Le `fs:scope` actuel (limité au seul fichier demo) doit s'élargir pour
  couvrir des dossiers choisis par l'utilisateur n'importe où sur le disque.
  App mono-utilisateur, locale, sans contenu non fiable manipulé : scope large
  mais raisonnable proposé (ex. `$HOME/**`) plutôt que de dépendre d'un
  mécanisme d'extension de scope dynamique par dossier choisi (moins stable
  selon les versions de Tauri). À confirmer/ajuster en implémentation si un
  compromis plus étroit s'avère nécessaire ou souhaitable.

## Accessibilité & principes TSA

- Aucun état caché sans explication : fichiers "autre" grisés mais visibles,
  jamais retirés de l'arbre ; état "Aucun fichier ouvert" explicite plutôt
  qu'un vide ambigu.
- Aucune action destructive sans confirmation claire (suppression fichier/
  dossier), cohérent avec le pattern déjà établi pour la suppression de card.
- Retour d'état visuel explicite sur le fichier actif (dans l'arbre et dans la
  barre du haut) — jamais ambigu sur "qu'est-ce que j'édite en ce moment".
- Toutes les actions (ouvrir, créer, renommer, supprimer) en clic simple ou
  clic droit standard, jamais de geste complexe.

## Hors périmètre de ce lot

- File-watching temps réel des changements faits hors de l'app (seul un
  bouton "rafraîchir" manuel est fourni).
- Persistance de l'état d'expansion des dossiers entre sessions.
- Déplacer un fichier/dossier par drag & drop dans l'arbre.
- Renommer/supprimer un dossier racine lui-même depuis la sidebar (seul
  "retirer de la config" est possible ; le dossier réel sur le disque n'est
  jamais touché par cette action).
- Le reste de la configuration (couleurs OKLCH, nombre de colonnes, polices)
  — lot 4, qui étendra le même fichier de config workspace.
- Import/Export (lot 3) et packaging final (lot 6).
