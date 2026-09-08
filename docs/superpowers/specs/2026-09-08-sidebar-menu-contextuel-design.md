# Sidebar : menu contextuel — Design

**Date** : 2026-09-08
**Statut** : Validé, en attente du plan d'implémentation
**Sous-projet** : A (sur 4 — D fait, A en cours, B et C à suivre)

## Contexte

Amélioration de la sidebar demandée par l'utilisateur (4 sous-projets
indépendants décomposés en brainstorming, traités dans l'ordre D → A → B →
C) :

- **D** (fait) : titre de card sur deux lignes (`CardNode.tsx`).
- **A** (ce document) : menu contextuel de la sidebar.
- **B** (à suivre) : icônes de format (favicon si mind map valide, JSON
  sinon) + cache non-bloquant.
- **C** (à suivre) : menu contextuel sur le canvas du graph (carte volante,
  annuler/refaire, export en sous-menu).

Aujourd'hui, `FileTreeRow.tsx` affiche une rangée de boutons d'action
visibles en permanence à côté de chaque ligne (Renommer, Exporter, Supprimer
pour une carte mentale ; Nouvelle carte mentale, Nouveau sous-dossier,
Importer XMind, Renommer, Supprimer pour un dossier ; Retirer de la liste
pour un dossier racine). Aucun menu contextuel n'existe nulle part dans
l'app. L'objectif est de remplacer ces boutons par une interaction
clic-gauche (ouvrir / plier-déplier, inchangé) + double-clic (renommer) +
clic-droit (menu avec toutes les autres actions).

**Explicitement hors périmètre** : les icônes de fichier (item B) et le
menu du graph (item C) sont traités dans leurs propres cycles
brainstorming → plan → implémentation.

## Vue d'ensemble

1. Nouveau composant `src/components/ui/context-menu.tsx` : wrapper autour
   des primitives `radix-ui` `ContextMenu`, sur le même modèle que
   `dialog.tsx` déjà en place (`"use client"`, `cn`, styles Tailwind).
   Réutilisable tel quel pour le menu du graph (item C).
2. Nouveau composant `src/components/sidebar/NameDialog.tsx` : modale
   générique de saisie de nom, utilisée pour créer une carte mentale, créer
   un sous-dossier, et dupliquer.
3. `src/persistence/fileOps.ts` : ajout de `duplicatePath` et
   `freeSiblingPath` (généralisation de `freeMindMapPath`).
4. `src/components/sidebar/FileTreeRow.tsx` : retrait de la rangée de
   boutons visibles, ajout du menu contextuel et du double-clic pour
   renommer.

## Menus par type de nœud

Ordre haut → bas, `─` = séparateur. Icônes `lucide-react` déjà utilisées
dans le fichier, plus `Copy` (nouvelle) pour Dupliquer.

- **Dossier racine** (`isRoot`) : Nouvelle carte mentale · Nouveau
  sous-dossier · Importer XMind · ─ · Retirer de la liste.
  (Un dossier racine n'est jamais renommé/supprimé sur le disque — seulement
  retiré de la liste des dossiers suivis, comportement inchangé.)
- **Sous-dossier** : Nouvelle carte mentale · Nouveau sous-dossier ·
  Importer XMind · Dupliquer · ─ · Renommer · Supprimer.
- **Carte mentale** (nœud de type `mindmap`, y compris un `.json` mal
  formaté — même périmètre que les boutons actuels) : Dupliquer · Exporter ·
  ─ · Renommer · Supprimer.
- **Fichier `other`** (extension non reconnue) : pas de changement, pas de
  menu contextuel (déjà pas d'actions disponibles aujourd'hui).

## Interactions

- **Clic gauche** : inchangé — ouvre le fichier, ou plie/déplie le dossier.
- **Double-clic** : déclenche le renommage inline existant (même input en
  place que celui d'aujourd'hui, juste retriggé différemment). Pas de
  bouton visible pour ça.
- **Clic droit** : ouvre le menu contextuel radix-ui, positionné au
  curseur.
- **Décision assumée** : un double-clic fait aussi passer deux clics
  simples avant le `dblclick` (ouverture d'un fichier, ou pli/dépli d'un
  dossier). Pas de debounce ajouté pour l'éliminer : l'effet de bord est
  inoffensif (rouvrir le même fichier ou plier-déplier deux fois de suite
  ne change rien visuellement) et la réactivité du clic simple (l'action la
  plus fréquente) prime sur la propreté du double-clic.

## Modale de nommage (`NameDialog`)

Réutilisée pour trois actions : créer une carte mentale, créer un
sous-dossier, dupliquer (fichier ou dossier).

Props : `open`, `title` (contextuel, ex. « Nouvelle carte mentale »,
« Dupliquer « Chapitre 3 » »), `initialName` (pré-rempli, **texte
entièrement sélectionné**), `confirmLabel`, `onConfirm(name)`, `onCancel`.
Entrée valide, Échap annule — même convention que `ConfirmDeleteDialog`
déjà en place dans `FileTreeRow.tsx`.

**Nom par défaut toujours déjà libre dans le dossier**, calculé par
`freeSiblingPath` (généralisation de `freeMindMapPath`) :

- Créer une carte mentale → `Nouvelle carte mentale` (ou
  `Nouvelle carte mentale (2)` si déjà pris, etc.).
- Créer un sous-dossier → `Nouveau dossier` (même logique).
- Dupliquer → `<nom actuel> (copie)` (ou `(copie 2)`, etc. si déjà pris).

Ce choix s'écarte volontairement de la formulation initiale (« pré-rempli
par le nom actuel ») : un nom par défaut *déjà libre* évite qu'une
validation sans édition (Entrée un peu rapide) échoue par collision ou
écrase un fichier existant — validé avec l'utilisateur pendant le
brainstorming. Le champ reste entièrement éditable, le texte pré-sélectionné
permet de taper par-dessus immédiatement si besoin.

## `duplicatePath` (fichiers ET dossiers)

Nouvelle fonction dans `fileOps.ts`, symétrique de `renamePath`/`deletePath` :

```ts
export async function duplicatePath(sourcePath: string, destPath: string, isFolder: boolean): Promise<void>
```

- Carte mentale : `copyFile` du `.json`, puis copie best-effort du sidecar
  d'assets s'il existe (même logique best-effort que `renamePath` — le
  fichier principal est déjà dupliqué avec succès, une erreur sur le
  sidecar ne doit pas faire échouer toute l'opération).
- Dossier : copie récursive (nouveau petit helper interne `copyDirRecursive`
  basé sur `readDir`/`mkdir`/`copyFile`, même schéma de parcours que
  `scanFolder` dans `fileTree.ts`) de tout le contenu, sous-dossiers et
  sidecars d'assets inclus.

```ts
export async function freeSiblingPath(folderPath: string, baseName: string, isFolder: boolean): Promise<string>
```

Généralise `freeMindMapPath` : même algorithme de suffixe numéroté
(`(2)`, `(3)`...) mais sans forcer l'extension `.json`, pour couvrir aussi
les dossiers et les noms `(copie)`.

## Gestion d'erreurs

Même pattern que l'existant : `setWorkspaceError` avec un message
utilisateur explicite (nom du fichier/dossier concerné + cause). Pour la
duplication d'un dossier interrompue en cours de copie (erreur disque à
mi-parcours), même style de message partiel que `handleImportXmind`
aujourd'hui (« ... (N élément(s) déjà dupliqué(s) avant l'échec) »).

## Tests

- `fileOps.test.ts` : nouveaux cas pour `duplicatePath` (fichier avec/sans
  sidecar, dossier avec sous-contenu, échec partiel) et `freeSiblingPath`
  (nom libre, collision simple, collisions multiples).
- `FileTreeRow.test.tsx` : réécriture des tests d'action (actuellement basés
  sur des boutons visibles) pour déclencher le menu via clic-droit
  (`fireEvent.contextMenu`) et sélectionner un item de menu ; nouveaux tests
  pour le double-clic → renommage, le contenu du menu par type de nœud
  (racine / sous-dossier / carte mentale), et le flux de duplication
  (modale pré-remplie, confirmation, résultat dans l'arbre).
- Nouveau : tests pour `NameDialog.tsx` (pré-remplissage, sélection du
  texte, Entrée/Échap) et `context-menu.tsx` si un comportement spécifique
  y est ajouté au-delà du wrapping des primitives radix-ui.

## Suggestions annexes (hors scope de ce lot, à considérer plus tard)

- Raccourci clavier `F2` pour renommer la ligne sélectionnée/focus, en
  complément du double-clic et du menu — cohérent avec les conventions
  desktop (Explorateur Windows, VS Code).
- Un clic droit sur une zone vide de la sidebar (en dessous de tous les
  dossiers) pourrait proposer « Ajouter un dossier » — actuellement
  seulement accessible via l'icône `FolderPlus` du header.

Ces deux idées ne sont pas demandées explicitement et ne sont pas
implémentées dans ce lot ; elles sont notées ici pour une itération future
si l'utilisateur les souhaite.
