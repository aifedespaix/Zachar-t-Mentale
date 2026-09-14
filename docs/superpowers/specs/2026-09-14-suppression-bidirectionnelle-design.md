# Suppression bidirectionnelle (app ↔ serveur) — Design

## Contexte

L'application de bureau (Tauri + React) synchronise un dossier local avec
PocketBase via sync() (src/sync/syncService.ts). L'interface d'administration
web (admin/) écrit directement dans les mêmes collections.

Aujourd'hui, la suppression ne va que dans un sens, ou pas du tout :

- Côté app, deletePath (src/persistence/fileOps.ts) ne supprime que le disque.
  Ni l'état de synchronisation ni le serveur ne sont touchés. Un fichier
  supprimé localement reste en base, et peut être republié au push suivant.
- Côté serveur, la suppression d'un enregistrement (par un prof, depuis l'admin
  ou l'app) n'est jamais remontée : le fichier local survit en orphelin,
  invisible.
- Le champ tombstones de ServerSyncState (src/persistence/syncState.ts) a été
  déclaré pour la propagation des suppressions, mais n'est lu nulle part.

La spec 2026-09-11 (deplacement-et-synchronisation-design) avait conçu les
passes « Propagation des suppressions distantes » et « Tombstones », jamais
implémentées. En cas de conflit, elle prévoyait de détacher silencieusement le
fichier local en brouillon. Cette spec reprend l'ossature et la remplace sur ce
point : une suppression distante se propage normalement, et un désaccord réel
passe par le système de résolution de conflit existant.

### Ce qui existe déjà et reste inchangé

- Les règles PocketBase : la suppression d'une carte appartient à son auteur ou
  à un prof ; assets n'a ni update ni delete (adressage par contenu).
- isConflict compare l'empreinte du contenu distant à lastSyncedContentHash, pas
  seulement la révision : une modification de path ou de type ne déclenche pas
  de conflit de contenu.
- Un conflit de contenu se résout en réécrivant la mémoire du sync
  (resolvedStateEntry), puis le run suivant transfère par les passes habituelles.
- pullEmptyFolders fait déjà descendre les dossiers vides.
- La collection dossiers ne contient QUE des dossiers vides : un dossier peuplé
  est impliqué par le path des cartes.

## Décisions de cadrage

1. Une suppression faite par le prof se propage chez l'élève. La propagation est
   le cas normal, jamais un détachement silencieux en brouillon.
2. Un désaccord réel entre dans le système de résolution de conflit, jamais
   tranché brutalement.
3. Issues d'un conflit de suppression : voir la section Conflits.
4. Cascade d'un dossier : l'arbre dit la vérité — on ne supprime que ce qu'on a
   le droit de supprimer, et la confirmation annonce ce qui reste.
5. dossiers : symétrie complète (création ET suppression), réservée au rôle prof.

Hors de ce chantier : les images orphelines (assets), les conflits de
suppression remontés à l'admin web, la corbeille et l'annulation.

## Modèle de données

### État de synchronisation (src/persistence/syncState.ts)

ServerSyncState gagne trois champs :

- tombstones: string[] — les file_id dont la suppression distante reste à
  appliquer. Déjà déclaré, enfin utilisé.
- folderTombstones: string[] — les chemins relatifs (forme canonique à barre
  oblique) d'enregistrements dossiers à supprimer.
- knownFolders: string[] — les chemins des enregistrements dossiers vus au
  dernier sync.

Le format reste version 2. Aucune migration : un état écrit sans ces champs les
lit comme des tableaux vides. emptyServerState les initialise.

knownFolders est indispensable : sans cette mémoire, un dossier vide supprimé
côté serveur et encore présent en local serait recréé par la passe de création
(ce dossier local n'existe pas au serveur, donc je le crée). Elle lève
l'ambiguïté entre « supprimé par le prof » et « jamais existé ».

### Conflits

SyncConflict gagne un champ kind, optionnel dans le type pour ne pas casser les
littéraux existants : 'content' | 'deleted-remote' | 'deleted-local'. sync()
le renseigne toujours ; les lecteurs retombent sur 'content'.

ConflictChoice (src/sync/conflictResolution.ts) gagne accept-deletion et
delete-anyway. Les trois choix existants restent pour le contenu.

### Résultat de synchronisation

SyncResult gagne remoteDeleted et localDeleted, les compteurs du compte rendu.
syncResultLabel.ts les affiche.

### Réseau (src/sync/pocketBaseAdapter.ts)

- mindMaps.delete(id, options)
- folders.create(path, createdBy) et folders.delete(id) ; getFullList existe déjà.

### Infra

Un seul changement de règle : dossiers.createRule passe de « tout compte
connecté » à prof uniquement. Un enregistrement de dossier vide est l'affaire du
prof, des deux côtés. Aucun changement de champ ni d'index. À appliquer avec
bun run infra:plan puis bun run infra:apply.

## Algorithme (sync())

Six passes, dans cet ordre : 1 réconciliation des chemins ; 2 propagation des
suppressions distantes ; 3 application des tombstones ; 4 dossiers ; 5 push ;
6 pull. L'ordre n'est pas cosmétique.

### Passe 2 — propagation des suppressions distantes (cartes)

Pour chaque entrée de ce serveur dont le file_id n'est plus dans la liste
distante :

- fichier local absent → entrée retirée, rien d'autre ;
- fichier local présent et intact (meta.lastModified inférieur ou égal à
  lastSyncedModified) → suppression locale, entrée retirée, localDeleted ;
- fichier local présent et modifié depuis, ou fichier actuellement ouvert dans
  le canevas (openFilePath) → conflit kind 'deleted-remote' ; on ne touche à
  rien ;
- fichier introuvable au chemin mémorisé, méta absente ou file_id différent →
  entrée retirée sans toucher au fichier, avec une ligne de compte rendu.

Le chemin est résolu depuis lastSyncedPath après le garde isSafeRelativePath.
Une entrée héritée sans lastSyncedPath ne peut pas localiser son fichier :
entrée retirée, rien touché.

### Passe 3 — application des tombstones (cartes)

Pour chaque file_id de tombstones :

- un fichier local porte encore ce file_id → l'utilisateur l'a recréé : la
  tombstone est annulée ;
- enregistrement distant absent → entrée et tombstone retirées (déjà fait) ;
- présent, et l'empreinte du contenu distant diffère de lastSyncedContentHash →
  conflit kind 'deleted-local' : le contenu a changé depuis le dernier sync ;
- sinon → mindMaps.delete(id), entrée et tombstone retirées, remoteDeleted. Un
  404 compte comme un succès.
- sans entrée ou sans empreinte (héritée) → comparaison de révisions
  (lastSyncedUpdated en retard sur updated) : si le serveur a bougé, conflit ;
  sinon suppression.

La détection réutilise le raisonnement d'isConflict : une modification distante
qui n'a touché que le path ou le type ne bloque pas la suppression, seule une
modification de contenu compte.

### Passe 4 — dossiers

- suppression locale : pour chaque chemin de folderTombstones, on retrouve
  l'enregistrement dans la liste distante et on appelle folders.delete(id) ;
  absent → tombstone retirée ; 404 = succès ; échec → tombstone conservée ;
- suppression distante : pour chaque chemin de knownFolders qui n'est plus dans
  la liste distante — si le dossier local existe et est vide (aucune carte
  dessous), on le supprime ; sinon on oublie l'enregistrement, qui était
  vestigial (les cartes impliquent le dossier) ;
- création : chaque dossier local vide, dans le dossier de synchronisation,
  absent de la liste distante, non tombstoné, et seulement pour un prof, devient
  folders.create(chemin relatif, username). Une violation d'unicité compte comme
  un succès ;
- en fin de passe, knownFolders = liste distante actuelle, plus les créés, moins
  les supprimés.

Un élève ne crée ni ne supprime jamais d'enregistrement dossiers : son dossier
vide reste local. Si la collection n'existe pas (404), toute la passe est
silencieuse, comme pullEmptyFolders aujourd'hui.

### Passes 5 et 6 — push et pull

Inchangées. La création de dossier n'y ajoute rien : elle est entièrement dans
la passe 4.

## Suppression locale — l'action partagée

Les deux points d'entrée actuels (FileTreeRow.confirmDelete et la commande
file.delete de AppToolbar) appellent deletePath directement. On les remplace par
une action partagée (hook useDeleteMindMap, sur le modèle de usePublishMindMap)
qui lit l'état de sync via useSyncStore et le sauve.

1. Planifier. Un plan, calculé sur le sous-arbre, dit ce qui part et ce qui
   reste :
   - une carte est supprimable si elle n'a pas de méta (jamais publiée) ou si
     canReorder(meta, user) est vrai (auteur ou prof) ;
   - un fichier non-carte (other) est supprimable, purement local ;
   - un dossier dont le chemin est dans knownFolders (donc un enregistrement du
     prof) n'est pas supprimable par un élève.
   Le dialogue de confirmation affiche le plan avant : nombre de cartes
   supprimées, nombre de cartes conservées en lecture seule, et dossiers du prof
   qui resteront.
2. Poser les tombstones. Un file_id par carte supprimable ayant une méta ; un
   chemin relatif par dossier supprimable, prof uniquement, quel que soit son
   contenu. Toute la branche est couverte, y compris un dossier à cartes dont
   l'enregistrement distant existe : sans sa tombstone, le pull le recréerait
   vide. Résoudre un chemin sans enregistrement est idempotent, la passe 4 le
   constate et abandonne.
3. Supprimer localement, sélectivement. On supprime les fichiers supprimables
   (deletePath fichier, sidecar d'assets compris), puis on remonte les dossiers
   devenus vides. On n'appelle plus deletePath(dossier, true) sur un dossier
   mitoyen : c'est ce qui garantissait la suppression aveugle des cartes du
   prof.
4. Enregistrer l'état. Les entrées de sync sont CONSERVÉES : la passe 3 en a
   besoin pour comparer l'empreinte distante. On n'ajoute que les tombstones,
   via saveSyncState.
5. Inchangé : déliage du lien de copie, remise à zéro du fichier ouvert,
   rafraîchissement du dossier.

Une suppression locale n'écrit rien sur le réseau. Elle pose des intentions ; le
sync suivant les applique (auto, manuel, ou déclenché à la fermeture d'un
fichier).

## Conflits

| kind | situation | issues |
| --- | --- | --- |
| content | les deux ont modifié le contenu | accept-remote / keep-local / copy (inchangé) |
| deleted-remote | le prof a supprimé, l'élève avait modifié | accept-deletion, « Accepter la suppression » / keep-local, « Garder ma version », republiée |
| deleted-local | l'élève a supprimé, le prof a modifié depuis | accept-remote, « Restaurer la version du prof » / delete-anyway, « Supprimer quand même » |

La résolution reste ce qu'elle est : on réécrit la mémoire du sync, le run
suivant transfère.

- deleted-remote + accept-deletion : lastSyncedModified = meta.lastModified. La
  passe 2 voit le local intact et le supprime.
- deleted-remote + keep-local : entrée retirée. La passe 5 recrée
  l'enregistrement.
- deleted-local + accept-remote : tombstone retirée. La passe 6 retélécharge la
  version du prof, l'entrée étant en retard sur la révision distante.
- deleted-local + delete-anyway : lastSyncedContentHash = empreinte distante.
  La passe 3 ne voit plus de changement et supprime.

Interface : ConflictResolutionDialog gagne une variante suppression (deux
boutons, pas de comparatif de cartes, un côté n'ayant plus de contenu). Le
fichier ouvert dans le canevas n'est jamais supprimé par une propagation
distante : il devient un conflit. Les conflits de suppression se résolvent sur
l'appareil ; ils ne remontent pas dans sync_conflicts.

## Erreurs et robustesse

- DELETE distant échoué : tombstone conservée, erreur journalisée, nouvel essai
  au sync suivant. Une erreur persistante se répète, c'est assumé et visible au
  journal.
- Suppression locale échouée (fichier verrouillé) : aucune tombstone posée ;
  erreur d'espace de travail, rien d'autre.
- Deux clients suppriment le même enregistrement : le second reçoit 404, compté
  comme un succès.
- Chemin distant non fiable : isSafeRelativePath avant tout join ou suppression.
- Serveur sans la collection dossiers : passe silencieuse.
- La propagation ne supprime jamais le fichier ouvert ; elle produit un conflit.

## Tests

- syncService.test.ts : propagation distante (intacte, modifiée, fichier ouvert,
  local absent, méta étrangère) ; tombstones (succès, 404, contenu distant
  changé, fichier local recréé, entrée héritée) ; passes dossiers (création prof,
  suppression locale, suppression distante, rôle élève, collection absente).
- conflictResolution.test.ts : les nouveaux choix, pour chaque kind.
- Un test du plan de suppression locale : supprimables, conservés, dossiers.
- FileTreeRow et AppToolbar : tombstones posées seulement pour ce qu'on possède ;
  un dossier mitoyen garde les cartes du prof ; le dialogue annonce les comptes.
- useFolderCreation : prof → enregistrement ; élève → aucun.
- bun run test, bun run test:admin (admin inchangé), bunx tsc --noEmit.

## Fichiers touchés

- src/persistence/syncState.ts — tombstones utilisé, folderTombstones,
  knownFolders.
- src/sync/syncService.ts — passes 2, 3 et 4, détection de conflit, compteurs,
  MindMapsApi.delete, FoldersApi.create et delete.
- src/sync/pocketBaseAdapter.ts — delete d'une carte, create et delete d'un
  dossier.
- src/sync/conflictResolution.ts — nouveaux kinds et choix, resolvedStateEntry.
- src/components/sync/ConflictResolutionDialog.tsx — variante suppression.
- src/state/useSyncStore.ts — résolution des nouveaux conflits.
- src/hooks/useDeleteMindMap.ts (nouveau) — action partagée, plan de suppression
  locale.
- src/components/sidebar/FileTreeRow.tsx, src/components/toolbar/AppToolbar.tsx
  — utiliser l'action partagée.
- src/sync/syncResultLabel.ts — compteurs remoteDeleted et localDeleted.
- infra/pocketbase-schema.mjs — dossiers.createRule = prof uniquement.

## Approches écartées

- Soft-delete serveur (champ deleted_at) : détection de conflit plus propre,
  mais change le schéma, les règles, toutes les lectures et l'admin, et exige
  une purge ; le mot « supprimer » ne supprime plus.
- Suppression immédiate en ligne : casse le hors-ligne, fait de deletePath un
  écrivain réseau, et duplique la permission et le conflit hors du sync.

## Hors périmètre

- Images orphelines : assets est adressé par contenu et sa règle serveur
  interdit la suppression.
- Conflits de suppression remontés à l'admin web (sync_conflicts).
- Corbeille, annulation, purge des tombstones d'un serveur abandonné.
- Le détachement silencieux en brouillon du design 2026-09-11, remplacé par le
  conflit explicite.
