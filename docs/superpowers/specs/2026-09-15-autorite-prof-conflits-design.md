# Autorité du prof sur les conflits de synchronisation — Design

**Date** : 2026-09-15
**Statut** : Implémenté
**Suite de** : `2026-09-11-deplacement-et-synchronisation-design.md`,
`2026-09-12-types-et-tags-des-cartes-design.md`,
`2026-09-14-resolution-de-conflits-design.md`

## Contexte

L'usage réel est plus simple que ce que la synchronisation supposait : deux
comptes, chacun sur un seul et unique ordinateur — un élève qui écrit ses
cartes et reçoit celles du prof, un prof qui range, classe et corrige. Le prof
n'est jamais en concurrence avec un autre prof, ni l'élève avec un autre
élève ; la seule concurrence possible, sur un fichier donné, est entre ces
deux rôles.

Or trois mécanismes de résolution — le chemin (`reconcilePath`), le type
(`reconcileType`) et le contenu (`isConflict` + la boîte de dialogue de
`2026-09-14-resolution-de-conflits-design.md`) — tranchaient jusqu'ici sans
tenir compte du rôle :

- chemin et type : « premier arrivé gagne, égalité → le serveur » — une
  course. Si l'élève synchronisait avant le prof, le rangement du PROF se
  faisait défaire au prochain sync de sa propre machine ;
- contenu : un conflit ouvrait une boîte de dialogue à TROIS choix (accepter
  le serveur, garder ma version, créer une copie), côté élève comme côté
  prof, pour une décision qui, dans cet usage à deux rôles fixes, a en
  réalité toujours la même réponse.

Ce document remplace les deux par une seule règle : **le prof a le dernier
mot**, appliquée automatiquement, sans jamais faire attendre personne devant
un choix.

## Décisions de cadrage

1. **Le prof gagne toujours, sans exception et sans course.** Chemin, type,
   contenu : les trois suivent la même autorité. Le rôle décide, jamais
   l'ordre d'arrivée sur le serveur.
2. **Rien n'est perdu.** La version qui cède est archivée automatiquement
   dans une copie liée (`sync/copyLink.ts`, déjà utilisé par le bouton
   « créer une copie » de l'ancienne boîte) avant d'être remplacée — c'est
   le même filet de sécurité, simplement posé sans qu'on ait à cliquer
   dessus.
3. **Plus de dialogue de conflit.** Avec une règle déterministe des deux
   côtés, il n'y a plus jamais de décision à faire prendre à l'utilisateur :
   `ConflictResolutionDialog`, `ResolveConflictsButton` et
   `src/sync/conflictResolution.ts` sont retirés — un dialogue qui ne peut
   plus jamais s'ouvrir est du code mort, pas une fonctionnalité en réserve.
4. **Le signalement au prof (`sync_conflicts`, `syncReporting.ts`) reste
   inchangé.** Un conflit est toujours détecté et rapporté — c'est ce qui
   nourrit `sync_conflicts` côté administration — mais il n'est plus
   « ouvert » : il est déjà tranché au moment où le rapport part. Le
   prochain sync qui ne le revoit plus le classe `resolved-elsewhere`
   exactement comme avant, ce qui est maintenant littéralement vrai.
5. **Chemin/type et contenu ne sont pas le même risque.** Un déplacement ou
   un reclassement ne perd rien en soi (c'est la même carte, ailleurs ou
   autrement étiquetée) : la résolution est silencieuse, sans archivage. Un
   conflit de CONTENU, lui, peut perdre du texte : la version qui cède est
   toujours archivée avant d'être écrasée.

## Chemin et type — `reconcilePath` / `reconcileType`

Les deux fonctions (`src/sync/pathReconciliation.ts`,
`src/sync/typeReconciliation.ts`) gagnent un paramètre `iAmProf: boolean`.
Seul le cas « les deux ont bougé, différemment » change :

| | avant | après |
|---|---|---|
| un seul côté a bougé | premier arrivé gagne (inchangé) | inchangé |
| les deux ont bougé, même valeur | rien à faire (inchangé) | inchangé |
| les deux ont bougé, différemment | le serveur gagne toujours | **le prof gagne toujours** : `push-path`/`push-type` si `iAmProf`, sinon `relocate`/`adopt` comme avant |

Concrètement : si je suis prof, je pousse mon propre chemin/type même si le
serveur porte déjà autre chose (l'élève avait synchronisé en premier) ; si je
suis élève, je m'aligne sur le serveur, qui reflète alors forcément un geste
du prof.

`syncService.ts` passe `iAmProf: currentRole === 'prof'` aux deux appels,
dans `reconcileOne`.

## Contenu — résolution automatique dans `pushOne`

`isConflict` ne change pas : elle détecte toujours exactement la même chose
(contenu modifié des deux côtés depuis le dernier sync connu). Ce qui change,
c'est ce qui se passe une fois le conflit détecté — dans `syncService.ts`,
directement, plus dans une boîte de dialogue :

1. Le conflit est toujours ajouté à `result.conflicts` avec son `detail`
   complet, exactement comme avant — c'est ce que `syncReporting.ts` envoie
   au serveur.
2. Puis il est tranché sur place :
   - **je suis prof** : la version DISTANTE (celle que mon push va
     remplacer) est archivée dans une copie liée à côté du fichier local
     (`archiveRemoteAsLinkedCopy`, nouveau dans
     `persistence/copyLinkOps.ts`), puis les images qu'elle référence sont
     tirées du serveur pour que la copie ne parte pas avec des images
     cassées. La fonction ne s'arrête pas là : elle CONTINUE dans le push
     normal, qui envoie ma version comme s'il n'y avait pas eu de conflit ;
   - **je suis élève** : ma version LOCALE (celle que le prof va remplacer)
     est archivée dans une copie liée (`createLinkedCopy`, déjà utilisée par
     l'ancien bouton « créer une copie », réutilisée telle quelle), puis la
     fonction s'arrête — sans pousser. Le tirage qui suit, dans le MÊME
     passage de synchronisation, écrit alors la version du prof à la place :
     rien de spécial à faire, c'est exactement ce chemin qu'emprunte
     n'importe quel enregistrement plus récent que ce qu'on a vu.
3. Dans les deux cas, une entrée est ajoutée à `result.notices` : « modifié
   des deux côtés — le prof a le dernier mot, votre version a été gardée
   dans « X (copie).zmap » » (ou l'inverse côté prof). C'est la même liste
   qui porte déjà les résolutions « les deux ont bougé » de la
   réconciliation de chemin/type — un conflit de contenu tranché
   automatiquement est la même famille d'information.

`persistence/copyLinkOps.ts` gagne `archiveRemoteAsLinkedCopy`, en miroir de
`createLinkedCopy` : même convention de nommage (`<original> (copie)`, même
dossier), mais la source du contenu archivé est une CHAÎNE reçue du serveur,
pas un fichier disque — c'est le fichier local (`anchorPath`) qui apprend le
lien, la chaîne distante qui devient la copie. Les deux fonctions partagent
désormais `nextLinkedCopyPath`, le calcul du prochain rang libre.

## Ce qui disparaît

- `src/components/sync/ConflictResolutionDialog.tsx` (+ test) — la boîte à
  trois boutons.
- `src/components/sync/ResolveConflictsButton.tsx` — le bouton qui l'ouvrait.
- `src/sync/conflictResolution.ts` (+ test) — `resolvedStateEntry`,
  `describePathChange`, le type `ConflictChoice`.
- `useSyncStore.resolveConflict` et son état `resolvingConflicts` dans
  `FileSidebar.tsx` / `SyncSettingsPanel.tsx`.
- Le comportement « un message qui annonce des conflits ne s'efface jamais
  tout seul » (`FileSidebar.tsx`) : il n'y a plus rien à laisser en attente,
  un conflit résolu s'affiche et s'efface comme n'importe quel résultat de
  sync.

Ce qui NE disparaît PAS : `SyncConflict`, `SyncConflictDetail`,
`result.conflicts`, et toute la chaîne `syncReporting.ts` →
`sync_conflicts` → interface d'administration. Un conflit reste un fait
qu'on veut pouvoir consulter à distance ; ce n'est plus une décision qu'on
attend de quelqu'un.

## Erreurs et cas limites

| Cas | Comportement |
|---|---|
| Le contenu distant ne se désérialise pas au moment d'archiver (`archiveRemoteAsLinkedCopy`) | `null` renvoyé, aucune copie écrite, mais le push du prof continue quand même — mieux vaut pousser sans archive que ne rien pousser |
| Le fichier local n'a pas d'identité de synchronisation au moment d'archiver | même chose : `null`, on continue |
| L'archivage écrit la copie mais la lecture du fichier local échoue ensuite (push) | erreur de fichier ordinaire, reportée dans `result.errors` — le conflit reste signalé dans `result.conflicts`, la copie archivée existe déjà |
| Les deux comptes sur la MÊME machine (trou connu du modèle fork, hors périmètre) | la règle s'applique quand même par rôle courant ; dans ce cas rare, elle archive et écrase sans distinguer « l'autre » de « moi-même sur une autre machine » — accepté, le filet de copie liée couvre la perte |

## Hors périmètre

- Lier sémantiquement deux cartes (exercice/corrigé, prise de notes/cours)
  par un mécanisme visible dans l'app — l'existant (`meta.correctsId`,
  `types-et-tags-des-cartes`) reste tel quel, c'est un chantier séparé.
- Recherche/filtre par type dans la barre latérale.
- Un rôle « les deux sont profs » ou « les deux sont élèves » : hors du
  modèle à deux comptes fixes que cette synchronisation cible.

## Tests

- `reconcilePath` / `reconcileType` : le cas « les deux ont bougé
  différemment » testé pour `iAmProf: true` (pousse) et `iAmProf: false`
  (s'aligne sur le serveur) — les autres lignes de la table inchangées.
- `syncService` : un conflit de contenu où le prof gagne (archive puis
  pousse quand même, `result.conflicts` toujours rempli) ; un conflit où
  l'élève cède (archive, ne pousse pas, le tirage qui suit écrit la version
  du prof) ; un conflit dont un des côtés est illisible continue de se
  signaler proprement et échoue proprement au push qui suit, sans rien
  cacher ; plusieurs fichiers dont un seul en conflit ne bloquent plus les
  autres NI lui-même.
- UI : le message de synchro affiche « N conflit(s) résolu(s) » et
  s'efface après son délai normal, comme tout autre résultat — il n'y a
  plus de bouton ni de boîte à ouvrir.
