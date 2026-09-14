# Résolution de conflits et copies liées — Design

## Contexte

Depuis `2026-09-13-correction-contenu-prof-eleve-design.md`, une carte peut être
écrite des deux côtés : l'élève chez lui, le prof en correction. La
synchronisation sait DÉTECTER ce désaccord (`isConflict`) et refuse d'écraser
quoi que ce soit — elle le range dans `SyncResult.conflicts` et affiche
« 1 conflit(s) ».

Et puis plus rien. Aucun geste, nulle part, ne permettait de trancher : les deux
versions restaient en l'état, le message revenait à chaque synchronisation, et
la seule issue était d'éditer un fichier à la main jusqu'à ce que les dates
retombent du bon côté. Ce document couvre le geste manquant, et la question
qu'il soulève tout de suite après : que devient la version qu'on ne garde pas ?

### Ce qui existe déjà et reste inchangé

- `isConflict` et sa comparaison d'empreintes : la détection ne bouge pas.
- `mergeCards` : un tirage met les cartes locales absentes de la version reçue
  de côté (cartes volantes) au lieu de les perdre. C'est ce filet qui rend
  « accepter le serveur » supportable.
- Le modèle en fourche (`duplicateMap`) : un `file_id` local par enregistrement
  distant, jamais deux.
- Les règles PocketBase : ce design ne touche à aucune règle serveur.

## Décisions de cadrage

### 1. La résolution ne transfère rien

Une résolution réécrit UNE entrée de `sync-state.json`, et c'est tout. La
synchronisation suivante fait le transfert par ses chemins habituels.

- `accepter le serveur` : `lastSyncedModified` passe à la date du fichier local
  → plus rien à envoyer, et `lastSyncedUpdated` restant en retard, le tirage
  écrit la version distante ;
- `garder ma version` : `lastSyncedUpdated` et `lastSyncedContentHash` passent à
  ceux de l'enregistrement distant → `isConflict` se tait, l'envoi part, le
  tirage passe son tour.

L'alternative — écrire les fichiers depuis la boîte de dialogue — voulait dire
une deuxième implémentation du téléchargement des images, de la fusion des
cartes et de la mise à jour de l'état, dans le seul endroit de l'app qui peut
détruire du travail. Voir `resolvedStateEntry` dans
`src/sync/conflictResolution.ts`.

Conséquence assumée : rien ne bouge à l'écran tant que la synchronisation
suivante n'a pas tourné. La boîte la déclenche donc elle-même dès que la
dernière décision est prise (ou à la fermeture, si des décisions ont été
prises).

Conséquence assumée n°2 : la carte OUVERTE dans le canevas n'est jamais réécrite
par un tirage (garantie existante). « Accepter le serveur » sur la carte ouverte
ne s'appliquera donc qu'une fois refermée — la boîte le dit explicitement.

### 2. L'empreinte du conflit est un instantané, et c'est une sécurité

`keep-local` enregistre l'empreinte du contenu distant TEL QU'IL ÉTAIT au moment
du conflit. Si le serveur a encore bougé entre-temps, le prochain `isConflict`
compare une empreinte qui ne correspond plus et redéclare un conflit : la
nouvelle version distante est annoncée au lieu d'être écrasée en silence.

### 3. Trois issues, jamais deux

Le troisième bouton (« créer une copie ») n'est pas un confort : sans lui,
chaque conflit force à sacrifier un des deux travaux. Il écrit la version locale
dans une copie, puis résout comme « accepter le serveur ». Personne ne perd rien.

### 4. La copie est LIÉE à son original

Réponse à « est-ce que deux fichiers dupliqués peuvent être liés ? » : oui, et
c'est ce qui empêche la copie de devenir un orphelin anonyme trois semaines plus
tard.

Le lien (`MindMapMeta.copyLink`, voir `src/sync/copyLink.ts`) est porté par les
DEUX fichiers, et `groupId` — le `meta.id` de l'original — est ce qui les
rassemble. Il impose deux règles :

- **même dossier, même nom** : la copie s'appelle `<original> (copie)`, à côté de
  l'original. Renommer ou déplacer l'un entraîne l'autre
  (`src/persistence/copyLinkOps.ts`) ;
- **visible** : les deux lignes de l'arborescence portent une pastille (« liée »
  d'un côté, « copie » de l'autre), donc on voit le couple sans rien ouvrir.

La règle « même nom » est une PROPAGATION, jamais un interdit : renommer la copie
en « Chapitre 2 » renomme l'original en « Chapitre 2 » et la copie en
« Chapitre 2 (copie) ». Refuser le renommage aurait puni l'utilisateur d'avoir
choisi de garder les deux versions.

Un membre qui ne peut pas suivre (nom déjà pris, dossier en lecture seule) est
laissé où il est : le geste que l'utilisateur a demandé a déjà eu lieu, et
l'annuler à cause d'un voisin serait pire que de dépareiller le couple jusqu'au
prochain renommage. Supprimer un membre délie le dernier survivant
(`unlinkIfAlone`) — un lien qui ne désigne plus personne promet un voisin que
l'utilisateur irait chercher.

### 5. Le lien ne quitte jamais la machine

Le lien décrit un arrangement de FICHIERS : « cette carte a une copie à côté
d'elle ». Rien de tout cela n'est vrai ailleurs. La synchronisation le retire
donc de ce qu'elle envoie (`withoutCopyLink`) et le préserve sur ce qu'elle
reçoit. L'empreinte enregistrée est celle du contenu SANS lien — c'est elle
qu'on compare au contenu distant, qui n'en porte jamais ; la prendre sur le
fichier tel quel ferait déclarer un conflit à chaque édition d'une carte liée.

La copie, elle, a une identité de synchronisation NEUVE : elle est publiée comme
une carte à part entière. Sur une autre machine, elle arrive donc sans son lien
— et c'est juste, puisque là-bas rien ne garantit que les deux fichiers soient
côte à côte.

## Interface

Le bouton est SUR le message de synchronisation — celui de la barre latérale et
celui des réglages — parce que c'est là qu'on apprend qu'il y a des conflits. Un
bouton rangé ailleurs aurait obligé à retenir un mot puis à aller le chercher.
Corollaire : un message qui annonce des conflits ne s'efface plus tout seul au
bout de cinq secondes.

La boîte traite UN conflit à la fois (« Conflit 2 sur 3 ») et montre, côte à
côte : la date de modification, le nom, le dossier, le total de cartes et le
compte par niveau — avec l'écart signé sur la colonne locale, parce que c'est ce
qu'on cherche vraiment quand on compare. Un nom ou un dossier différent est
signalé par une pastille au-dessus de la grille : ce n'est pas le même désaccord
qu'un désaccord de contenu.

Les trois boutons, et leurs couleurs, sont le message avant les mots :

| Bouton | Couleur | Effet |
| --- | --- | --- |
| Accepter le changement | bleu (`--info-*`) | la version du serveur reprend la main |
| Refuser et garder ma version | rouge (`--destructive`) | la version locale repart au serveur |
| Créer une copie | orange (`--warning-*`) | les deux survivent, la locale part dans une copie liée |

Une décision qui n'a pas pu être enregistrée laisse la boîte SUR son conflit :
enchaîner laisserait croire qu'elle est prise.

## Limites connues

- Un conflit signalé par une version antérieure de l'app n'a pas de comparatif
  (`detail` absent) : la boîte le dit et renvoie vers une nouvelle
  synchronisation plutôt que d'afficher une grille vide.
- La comparaison ne descend pas au niveau de la carte : elle compte, elle ne
  diffe pas. Un diff carte à carte serait une fonctionnalité à part entière.
- Sur une seconde machine, les deux fichiers d'un couple sont deux cartes
  ordinaires (voir décision 5).
