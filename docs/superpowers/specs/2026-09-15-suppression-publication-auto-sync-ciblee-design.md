# Suppression propagée, publication automatique, synchronisation ciblée — Design

**Date** : 2026-09-15
**Statut** : Implémenté
**Suite de** : `2026-09-15-autorite-prof-conflits-design.md`,
`2026-09-14-suppression-bidirectionnelle-design.md` (reprend l'ossature,
remplace la résolution par dialogue par une résolution automatique par rôle)

## Contexte

Trois questions posées ensemble parce qu'elles décrivent le même objectif —
« tous les fichiers sont sync, pas de fichier pas sync », sans ralentir l'app :

1. **Suppression.** Aujourd'hui, RIEN ne propage une suppression, ni celle
   faite dans l'app (`deletePath` ne touche que le disque), ni a fortiori une
   suppression faite hors de l'app (explorateur, script). Le champ
   `tombstones` de `ServerSyncState` existe depuis 2026-09-11 mais n'est lu
   nulle part — vérifié par recherche exhaustive. `2026-09-14-suppression-
   bidirectionnelle-design.md` avait conçu l'algorithme complet mais ne l'a
   jamais fait passer en code.
2. **Publication.** Un fichier nouvellement créé (`createMindMapFile`) n'a pas
   de `meta` : il reste invisible à `sync()` tant que quelqu'un ne clique pas
   « Publier » (`usePublishMindMap.ts`). Rien ne le fait automatiquement.
3. **Performance.** `sync()` n'a qu'un seul mode : parcourir TOUT le dossier
   local (`scanFolder`) et rapatrier TOUS les enregistrements distants
   (`getFullList`), à chaque exécution — lancement, intervalle, ET fermeture
   d'un seul fichier. Avec des centaines ou milliers de fichiers, fermer une
   carte pour en ouvrir une autre paierait le prix d'un sync complet.

## Décisions de cadrage

1. **La suppression suit la même autorité que le reste : le prof gagne,
   automatiquement, sans dialogue.** `2026-09-14-suppression-bidirectionnelle-
   design.md` prévoyait un dialogue à deux boutons par type de désaccord ;
   remplacé par la même résolution automatique que les conflits de contenu
   (`2026-09-15-autorite-prof-conflits-design.md`) : la version qui cède est
   archivée en copie liée quand il y a quelque chose à archiver, jamais de
   décision demandée.
2. **Portée réduite : cartes seulement, pas les dossiers.** Le plan d'origine
   ajoutait une symétrie complète pour la collection `dossiers`
   (`folderTombstones`, `knownFolders`, création ET suppression). L'app ne
   crée ni ne supprime aujourd'hui aucun enregistrement `dossiers` — seule la
   lecture existe (`pullEmptyFolders`). Étendre cette collection est un
   chantier à part ; celui-ci ne régresse rien en la laissant de côté.
3. **Publication automatique, sans exception, dès qu'un sync rencontre un
   fichier « local-only » dans le dossier de synchronisation.** Pas seulement
   à la création : un fichier dupliqué, importé, restauré, ou déposé
   directement dans le dossier (le flux du prof via un LLM, par exemple) est
   publié au prochain passage. Le geste manuel « Publier »
   (`usePublishMindMap.ts`) reste disponible — il devient simplement
   redondant avec ce que `sync()` fait déjà tout seul, jamais faux.
4. **Un sync « ferme ce fichier » ne regarde QUE ce fichier.** Il ne fait pas
   la réconciliation de chemin/type, la propagation de suppression ni la
   publication automatique DES AUTRES fichiers — ces passes ont besoin de la
   liste complète, et c'est précisément ce qu'un sync ciblé évite de payer.
   Il gère par contre la publication de CE fichier s'il n'a pas encore de
   `meta` : c'est le cas le plus courant d'un fichier qu'on vient de créer
   puis de refermer. Le lancement et l'intervalle restent des syncs complets,
   sans changement — c'est là qu'une suppression ou un nouveau fichier
   ailleurs dans l'arbre finissent par être vus.

## Section 1 — Suppression propagée

### Modèle de données

Inchangé : `ServerSyncState.tombstones: string[]` existe déjà. Aucune
migration.

### `SyncConflict` — un nouveau `kind`

```ts
export type SyncConflictKind = 'content' | 'deleted-remote' | 'deleted-local'

export interface SyncConflict {
  kind: SyncConflictKind
  // ... inchangé par ailleurs
}
```

- `content` : les deux ont changé le contenu (cas déjà couvert, inchangé).
- `deleted-remote` : l'enregistrement distant a disparu, ET le fichier local
  a été modifié depuis le dernier sync connu — la version qui a changé
  localement n'est peut-être pas celle qui a été supprimée en connaissance de
  cause.
- `deleted-local` : une tombstone locale existe pour ce `file_id`, ET le
  contenu distant a changé depuis le dernier sync connu — l'intention de
  supprimer date peut-être d'avant cette modification.

### Passe 2 — propagation des suppressions distantes (avant le push)

Pour chaque entrée connue de ce serveur dont le `file_id` n'est plus dans la
liste distante :

- fichier local introuvable au chemin mémorisé → entrée retirée, rien
  d'autre (rien à supprimer, rien à regretter) ;
- fichier trouvé mais `meta.id` différent (un autre fichier occupe la
  place) → entrée retirée sans toucher au fichier ;
- fichier intact (`meta.lastModified <= entry.lastSyncedModified`) →
  suppression locale (`deletePath`), entrée retirée, `localDeleted` ;
- fichier modifié depuis, OU fichier actuellement ouvert dans le canevas
  (`openFilePath`, jamais réécrit ni supprimé sous les pieds de qui édite) →
  conflit `deleted-remote`, tranché sur place :
  - **je suis prof** : ma version locale l'emporte — elle est RE-POUSSÉE
    (recréée côté serveur, comme un nouveau `create`), l'entrée mise à jour
    normalement ;
  - **je suis élève** : la suppression l'emporte — le fichier local est
    d'abord archivé en copie liée (`createLinkedCopy`, rien perdu), puis
    supprimé, l'entrée retirée.

### Passe 3 — application des tombstones (avant le push)

Pour chaque `file_id` de `tombstones` :

- un fichier local porte encore ce `file_id` → l'utilisateur l'a recréé :
  tombstone annulée, rien d'autre ;
- enregistrement distant déjà absent → tombstone et entrée retirées
  (déjà fait, succès) ;
- enregistrement présent, empreinte de contenu inchangée depuis le dernier
  sync connu (ou entrée sans empreinte, retombant sur la comparaison de
  révision comme `isConflict`) → `mindMaps.delete(id)`, tombstone et entrée
  retirées, `remoteDeleted` ; un 404 compte comme un succès ;
- enregistrement présent, contenu CHANGÉ depuis (quelqu'un a modifié ce
  qu'on s'apprêtait à supprimer) → conflit `deleted-local`, tranché :
  - **je suis prof** : ma suppression l'emporte — `mindMaps.delete(id)`
    quand même, tombstone et entrée retirées ;
  - **je suis élève** : la modification l'emporte — tombstone annulée, RIEN
    retiré de `entries` (l'entrée reste en retard sur la révision distante),
    ce qui fait que la passe de tirage, plus loin dans ce même passage,
    retélécharge normalement la version plus récente.

Les deux passes réutilisent le raisonnement de `isConflict` : un déplacement
ou un reclassement seuls ne bloquent jamais une suppression, seul un
changement de CONTENU compte.

### Suppression locale — l'action partagée

Nouveau hook `src/hooks/useDeleteMindMap.ts`, sur le modèle de
`usePublishMindMap.ts`, remplaçant les deux appels directs à `deletePath`
(`FileTreeRow.confirmDelete`, `AppToolbar.confirmDelete`) :

1. Planifie sur le sous-arbre : une carte est « tombstonable » si elle a un
   `meta` et que `canReorder(meta, user)` est vrai (auteur ou prof) — la même
   règle qui décide déjà qui peut déplacer. Une carte sans `meta` (brouillon)
   ou hors du dossier de synchronisation n'a pas de tombstone à poser : rien
   à propager, c'était déjà purement local.
2. Pose les tombstones (un `file_id` par carte tombstonable) dans l'état de
   sync courant, PUIS supprime sur le disque (`deletePath`) — ordre choisi
   pour qu'un échec de l'écriture de l'état laisse le disque intact plutôt
   que l'inverse.
3. `saveSyncState`.
4. Inchangé : déliage du lien de copie si le fichier en portait un, fichier
   ouvert remis à zéro s'il était visé, rafraîchissement du dossier.

Une suppression locale n'écrit rien sur le réseau — elle pose une intention,
que le prochain sync applique (auto, manuel, ou déclenché à la fermeture).

### Compte rendu

`SyncResult` gagne `remoteDeleted` et `localDeleted` (comptés comme
`relocated`). `syncResultLabel.ts` les affiche. Un conflit de suppression
tranché automatiquement rejoint `result.notices`, comme un conflit de
contenu.

### Réseau

`MindMapsApi` gagne `delete(id, options): Promise<void>`, implémenté par
`pocketBaseAdapter.ts` via `mindMapsCollection.delete(id, options)`. Un 404
est avalé au point d'appel (déjà le cas partout ailleurs dans `sync()`).

## Section 2 — Publication automatique

### `sync()` — une passe avant tout le reste

Avant la réconciliation des chemins, `scanLocalMaps` a déjà distingué les
scans `'local-only'` (fichier lisible comme carte mentale, `meta === null`)
des scans `'map'`. Une nouvelle passe transforme chaque `'local-only'` en
`'map'` :

```ts
async function autoPublish(scan: LocalMapScan, viewer: SyncUser): Promise<LocalMapScan> {
  if (scan.kind !== 'local-only') return scan
  try {
    await stampMindMapSyncMeta(scan.path, viewer.username, viewer.role)
    const meta = await loadMindMapMeta(scan.path)
    if (meta === null) return scan // ne devrait pas arriver ; laissé tel quel
    return { path: scan.path, kind: 'map', meta }
  } catch {
    return scan // échec de l'écriture : reste local-only, retenté au prochain sync
  }
}
```

Le fichier ainsi transformé traverse ensuite EXACTEMENT le même chemin que
n'importe quel fichier déjà publié : `reconcileOne` (rien à faire, pas
d'entrée connue) puis `pushOne` (`entry === undefined` → `create`). Aucune
passe existante n'a besoin de savoir que ce fichier vient d'être publié à
l'instant.

`SyncResult` gagne `published: number` (le compte des fichiers ainsi
transformés) pour que le compte rendu puisse le dire — distinct de `pushed`,
qui compte les push de contenu/chemin/type, publiés ou non.

### Ce qui ne change pas

- Un fichier hors du dossier de synchronisation n'est jamais vu par
  `scanLocalMaps` : rien ne le publie.
- Un fichier qui n'est pas une carte mentale (`'not-a-map'`) n'est
  évidemment pas concerné.
- `usePublishMindMap.ts` et son bouton restent : publier à la main reste
  possible, pour ne pas attendre le prochain sync.

## Section 3 — Synchronisation ciblée à la fermeture

### Nouvelle fonction : `syncOneFile`

`src/sync/syncService.ts` gagne `syncOneFile(params): Promise<SyncResult>`,
appelée par `useUnsavedChangesGuard.ts` à la place de `syncNow()` (sync
complet) quand ce qui se ferme est UN fichier précis. Elle partage tout le
raisonnement pur déjà écrit pour un fichier — `planPush`, `isConflict`,
`reconcilePath`, `reconcileType`, `conflictDetailOf`, l'archivage en copie
liée — via une extraction commune, mais ne paie que le coût d'UN fichier :

- **réseau** : au lieu de `mindMaps.getFullList()` (tous les enregistrements,
  tout leur contenu), un seul enregistrement est demandé, filtré par
  `file_id` (`MindMapsApi.getOne`, nouveau, implémenté par
  `getFirstListItem` avec un filtre PocketBase — absent renvoyé comme
  `undefined`, pas une erreur). `assets.getFullList()` n'est pas appelé : les
  images poussées le sont depuis le dossier `.assets` du fichier lui-même
  (déjà le cas), et les images tirées le sont depuis les références trouvées
  dans le contenu reçu — les deux chemins existants, inchangés, qui n'ont
  jamais eu besoin de la liste complète pour UN fichier ;
- **disque** : pas de `scanFolder` — le chemin est connu (c'est celui qu'on
  ferme). Le fichier est lu, sa `meta` relue, publié s'il ne l'était pas
  (voir Section 2, même fonction `autoPublish` réutilisée pour ce seul
  fichier) ;
- **ce qui est délibérément absent** : réconciliation de chemin/type des
  AUTRES fichiers, propagation de suppression, application des tombstones,
  publication automatique des autres fichiers, dossiers vides. Toutes ces
  passes ont besoin de la vue d'ensemble ; le sync complet du lancement et de
  l'intervalle continue de s'en charger — c'est le compromis assumé par la
  décision de cadrage n°4.

`SyncParams`/le nouveau `SyncOneFileParams` partagent le plus gros de leur
forme ; `syncOneFile` retourne un `SyncResult` de la même forme que `sync()`
(un seul fichier concerné, `pushed`/`pulled`/`conflicts`/`notices` à 0 ou 1),
pour que `syncResultLabel` et le journal restent les mêmes lecteurs.

### `useUnsavedChangesGuard.ts`

`requestOpenFile` (changement de fichier) et `onCloseRequested` (fermeture de
fenêtre) appellent désormais `useSyncStore.getState().syncOneFile(path)` — un
nouveau point d'entrée du store, sur le modèle de `syncNow`, qui charge
l'état de sync, appelle `syncOneFile`, sauvegarde l'état, journalise. Fire-
and-forget comme avant : fermer un fichier ou la fenêtre n'attend jamais le
réseau.

`useAutoSync.ts` ne change pas : lancement et intervalle restent des
`syncNow()` complets.

## Erreurs et cas limites

| Cas | Comportement |
|---|---|
| `syncOneFile` sur un fichier jamais synchronisé ET qui n'existe plus au moment d'y accéder (fermé puis supprimé entre-temps) | lecture échoue, erreur reportée dans `result.errors`, rien d'autre touché |
| Le fichier fermé n'est pas dans le dossier de synchronisation | `syncOneFile` ne fait rien (même garde que `canPublish`) |
| Suppression distante pendant que le fichier est ouvert dans le canevas | jamais supprimé ni écrasé : conflit `deleted-remote`, comme pour tout pull sur le fichier ouvert |
| Deux clients suppriment le même enregistrement | le second reçoit 404 au `delete`, compté comme un succès |
| Chemin distant non fiable, dans les nouvelles passes aussi | `isSafeRelativePath` avant tout accès disque, comme partout ailleurs |
| Publication automatique qui échoue (disque plein, fichier verrouillé) | le fichier reste `local-only`, retenté au sync suivant, pas d'erreur bloquante pour le reste du passage |

## Hors périmètre

- Symétrie complète pour la collection `dossiers` (suppression, cascade) —
  voir décision de cadrage n°2.
- Retirer le bouton « Publier » manuel — reste disponible, devient
  simplement rarement nécessaire.
- Un sync ciblé pour autre chose qu'« un fichier qu'on referme » (par
  exemple republier un seul fichier depuis un menu) — le même `syncOneFile`
  pourrait servir plus tard, non câblé ailleurs pour l'instant.

## Tests

- `syncService` : passe 2 (intact → supprimé ; modifié → conflit
  `deleted-remote`, prof re-pousse, élève archive puis supprime ; fichier
  ouvert → jamais touché ; fichier introuvable/méta étrangère → entrée
  retirée sans dégât) ; passe 3 (succès, 404, contenu changé → conflit
  `deleted-local` tranché par rôle, fichier local recréé → tombstone
  annulée, entrée héritée sans empreinte → comparaison de révision) ;
  publication automatique (local-only devient map et se pousse dans le même
  passage, échec d'écriture laisse local-only) ; `syncOneFile` (un seul
  enregistrement demandé, pas de `getFullList`, publie si besoin, ignore un
  fichier hors dossier de sync).
- `useDeleteMindMap` : plan (tombstonable / conservé), ordre tombstone
  avant suppression disque, déliage de copie.
- `useUnsavedChangesGuard` : `requestOpenFile` et la fermeture de fenêtre
  appellent `syncOneFile`, pas `syncNow`.
