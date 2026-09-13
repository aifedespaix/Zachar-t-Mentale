# Correction du contenu d'un élève par le prof, et synchronisation à la fermeture — Design

## Contexte

Le modèle actuel (voir `2026-09-10-synchronisation-pocketbase-design.md`) repose
sur « l'auteur est le seul éditeur » : `meta.author` décide seul qui peut écrire
le CONTENU d'une carte mentale. `2026-09-11-deplacement-et-synchronisation-design.md`
a ensuite ouvert une brèche volontaire dans cette règle, mais seulement pour le
RANGEMENT (`canReorder`) et le TYPE (`canClassify`) : un prof peut déplacer,
renommer ou classer la carte d'un élève, jamais en écrire le contenu.

L'usage voulu va plus loin : un prof doit pouvoir CORRIGER le contenu d'une
carte créée par un élève — l'élève doit rester lisible et modifiable ensuite,
donc rester `author`. Ce document couvre exactement cette extension, plus deux
conséquences directes qu'elle soulève : que faire quand la correction du prof
et une carte ajoutée par l'élève se contredisent au moment de la synchronisation,
et quand déclencher cette synchronisation pour que rien ne se perde.

### Ce qui existe déjà et reste inchangé

- Le modèle fork (`duplicateMap`) pour qui n'est ni auteur ni prof.
- `canReorder` / `canClassify` dans `src/sync/permissions.ts` — inchangés, ils
  décident déjà correctement du rangement et du type.
- La règle PocketBase `Update`/`Delete` (`@request.auth.username = author ||
  @request.auth.role = "prof"`, ajoutée dans la mise à jour du 2026-09-11 de la
  première spec) — elle autorise déjà un prof à écrire N'IMPORTE QUEL champ
  d'un enregistrement `cartes_mentales`, contenu compris. La séparation
  contenu/rangement n'est donc imposée QUE côté client, par `planPush` (voir
  plus bas) — ce design ne touche à AUCUNE règle serveur.
- `useAutoSync` (`src/hooks/useAutoSync.ts`) et `useSyncStore.syncNow` : la
  synchronisation au lancement et par intervalle existe déjà, réglable dans
  Réglages → Synchronisation. Ce design lui ajoute un TROISIÈME déclencheur
  (la fermeture d'une carte), il ne remplace rien.
- Le champ `detached` sur `Card` (`src/types/card.ts`) : la « carte volante »
  existe déjà comme concept (`parentId: null`, pas d'enfants, `level`
  vestigial). Ce design le réutilise tel quel comme résultat de fusion —
  aucun nouveau champ de données n'est nécessaire.

## Décisions de cadrage

- **`meta.author` ne change jamais.** Un prof qui corrige la carte d'un élève
  écrit un contenu différent sous le même `author` — l'élève reste
  propriétaire, exactement comme demandé (« il doit donc rester owner »).
  Il n'y a pas de champ « dernier éditeur » à ajouter : hors scope, voir plus
  bas.
- **Le rôle, jamais l'identité, décide de l'accès en écriture au contenu.**
  Comme `canReorder`/`canClassify`, la nouvelle règle tient en une ligne :
  auteur OU prof.
- **La fusion à la synchronisation est une différence d'ensembles, pas une
  fusion à trois voies.** Il n'est pas nécessaire de connaître la version de
  base (dernière synchronisée) : toute carte présente localement chez l'élève
  et ABSENTE de la version reçue du prof est mise de côté (carte volante) ;
  toute carte présente des deux côtés adopte la version du prof sans
  comparaison champ à champ. C'est plus simple qu'une fusion à trois voies et
  ça correspond exactement à la règle décrite : « on écrit ce que le prof a
  voulu, et les cartes en plus deviennent volantes ».
- **« Fermer une carte » veut dire fermer le fichier carte mentale** (changer
  de fichier ouvert, ou fermer l'application) — confirmé par l'utilisateur.
  Ce n'est pas un événement au niveau d'une carte individuelle dans l'arbre.
- **La correction par LLM (adapter la skill `transformer-cours-en-carte-mentale`
  pour un mode correction) est un besoin réel mais un chantier séparé** : ce
  document pose le contrat de permissions et de synchronisation que cette
  skill devra respecter ensuite ; il n'adapte pas la skill elle-même.

## Section 1 — Permissions et propriété

Nouvelle fonction dans `src/sync/permissions.ts`, sur le même modèle que
`canReorder`/`canClassify` :

```ts
/**
 * Whether `user` may change the CONTENT of a map — its cards.
 *
 * Même règle que `canReorder`/`canClassify` (auteur ou prof), mais celle-ci
 * décide du contenu lui-même : un prof peut corriger la carte d'un élève sans
 * jamais en devenir l'auteur — `meta.author` ne change pas, l'élève reste
 * propriétaire, seul son contenu diffère après correction.
 */
export function canEditContent(meta: MindMapMeta | null, user: SyncUser): boolean {
  if (meta === null) return true
  return meta.author === user.username || user.role === 'prof'
}
```

Un seul point d'appel change en conséquence : `App.tsx:384`

```ts
const isReadOnly = loadedMeta !== null && loadedMeta.author !== currentUser?.username
```

devient

```ts
const isReadOnly = currentUser !== null && !canEditContent(loadedMeta, currentUser)
```

(un utilisateur non connecté reste en lecture seule sur tout fichier publié,
comme aujourd'hui — seule la condition d'écriture change). C'est le seul
endroit de l'interface qui décide aujourd'hui du verrouillage de l'éditeur de
carte ; `ReadOnlyMapDialog` / « faire ma copie » (`duplicateMap`) continue de
s'afficher dans les mêmes conditions pour qui n'a ni l'un ni l'autre droit
(ex. un élève ouvrant la carte d'un autre élève, ou celle du prof).

## Section 2 — Algorithme de synchronisation

### Push (`planPush`, `src/sync/syncService.ts`)

Une seule ligne change :

```ts
// avant
const content =
  meta.author === currentUser.username && (entry === undefined || entry.lastSyncedModified < meta.lastModified)

// après
const content =
  canEditContent(meta, currentUser) && (entry === undefined || entry.lastSyncedModified < meta.lastModified)
```

Ça permet à un prof de pousser une correction de contenu sur le fichier
LOCAL de l'élève, sur SA machine — le scénario réel n'est pas « le prof
pousse depuis son poste vers le fichier de l'élève » (les deux ont chacun
leur propre copie locale) mais bien : le prof ouvre la carte de l'élève
(possible dès aujourd'hui, en lecture ; ce design le rend éditable), la
modifie localement chez lui, et pousse — exactement le chemin que `planPush`
emprunte déjà pour n'importe quel fichier qu'on édite localement puis
synchronise.

### Pull (`pullOne`, `src/sync/syncService.ts`)

La ligne qui bloque aujourd'hui tout le mécanisme disparaît :

```ts
// avant — ignore purement et simplement tout enregistrement qu'on a soi-même
// écrit, quel que soit son contenu distant
async function pullOne(record: RemoteMindMapRecord): Promise<void> {
  if (record.author === currentUser) return
  ...
```

```ts
// après
async function pullOne(record: RemoteMindMapRecord): Promise<void> {
  const known = entries[record.file_id]
  if (known && known.lastSyncedUpdated >= record.updated) return
  ...
```

C'est sûr, pas seulement pour le nouveau cas : le contrôle juste en dessous
(`known.lastSyncedUpdated >= record.updated`) compare contre l'instantané
distant pris AVANT la passe de push de ce même run (`remoteRecords` est
chargé une seule fois, au tout début de `sync()`) — donc un fichier que
l'utilisateur vient de pousser lui-même, dans ce même run, a déjà une entrée
`lastSyncedUpdated` à jour et ce contrôle le fait sauter tout seul, sans avoir
besoin du garde-fou sur `author`. Ce garde-fou ne protégeait donc que le cas
qu'on veut justement débloquer : un enregistrement que JE possède mais que
quelqu'un d'autre (le prof) a modifié depuis mon dernier sync.

### Fusion à la réception d'une correction

Quand `pullOne` s'apprête à écraser un fichier local existant (le cas
`exists(localPath)` déjà présent dans le code), et seulement dans ce cas
(un `create` n'a rien de local à préserver), la fusion suivante remplace
l'écrasement pur :

1. Charger les cartes locales actuelles (`localCards`) avant d'écrire quoi que
   ce soit.
2. Désérialiser les cartes reçues (`remoteCards`, déjà fait par
   `deserializeMindMap`).
3. `extra = localCards.filter(c => !remoteCards.some(r => r.id === c.id))`
4. Pour chaque carte de `extra` : `parentId: null`, `detached: true` — elle
   devient une carte volante, avec le même `level` vestigial que n'importe
   quelle autre carte détachée (voir `src/types/card.ts`).
5. Le fichier écrit est `remoteCards` + `extra` ainsi transformées.

Aucune carte partagée entre les deux ensembles (même `id`) n'est comparée
champ à champ : la version du prof gagne intégralement, sans tenter de
fusionner un titre ou une définition modifiés des deux côtés. C'est la règle
explicitement demandée (« on écrit ce que le prof a voulu ») et ça évite un
vrai moteur de fusion à trois voies — dont on n'a d'ailleurs pas besoin : cette
différence d'ensembles ne dépend d'aucune version de référence commune,
seulement de ce qui est reçu contre ce qui est local au moment du pull.

Cas limites couverts par construction, pas par un cas spécial :
- Une carte de `extra` déjà détachée localement reste détachée (rien à faire,
  la transformation est idempotente).
- Une carte de `extra` dont le PARENT a survécu côté prof n'est pas
  rattachée automatiquement — elle est mise de côté quand même, pour rester
  cohérent avec la règle « tout ce qui n'est pas dans la version du prof
  devient volant », et parce que deviner où la rattacher serait plus risqué
  que de laisser l'élève la ranger à nouveau lui-même.
- Un fichier qui n'existe pas encore localement (`!exists(localPath)`, un
  premier pull) n'a pas de fusion à faire : il n'y a rien de local à
  préserver.

### Protection du fichier actuellement ouvert dans le canevas

`sync()` n'a aujourd'hui aucune idée de ce que l'interface affiche — il
parcourt le dossier de synchronisation sans savoir qu'un de ces fichiers est
peut-être en cours d'édition, dans le canevas, à l'instant même où la passe de
pull tourne (déclenchée par l'intervalle automatique, ou par le nouveau
déclencheur de fermeture ci-dessous). Écraser silencieusement ce fichier sous
les pieds de l'élève pendant qu'il l'édite romprait exactement la garantie
demandée (« il ne doit pas perdre ses données »).

`sync()` reçoit donc un paramètre optionnel supplémentaire, le chemin relatif
du fichier actuellement chargé dans le canevas (`null` si aucun) ; `pullOne`
saute tout enregistrement dont le chemin correspond à ce chemin exclu, quel
que soit par ailleurs l'état de `lastSyncedUpdated`. C'est `useSyncStore.syncNow`
qui calcule ce chemin au moment de l'appel (à partir de l'état applicatif
courant) et le transmet à `sync()` — le détail exact de ce câblage (quel
store lit quoi) est laissé à l'implémentation plutôt que figé ici.

Cette protection est un garde-fou général, pas un cas spécial pour le
prof/élève : elle empêche n'importe quel pull (lancement, intervalle,
fermeture) de perturber une édition en cours, quel qu'en soit l'auteur.

## Section 3 — Interface : signaler la fusion

`SyncResult` (`src/sync/syncService.ts`) gagne un champ pour les fusions
effectuées :

```ts
export interface SyncResult {
  ...
  /** Un pull qui a mis des cartes locales de côté au lieu de les perdre. */
  merged: { fileId: string; path: string; floatedCount: number }[]
}
```

`syncResultLabel()` (`src/sync/syncResultLabel.ts`) en tient compte pour
produire une ligne comme « 2 cartes mises de côté dans "Chapitre 3" » en plus
du résumé existant (envoyés/reçus/erreurs). Le journal verbeux
(`useSyncStore.syncNow`, bloc `if (get().verboseLog)`) reçoit la même
boucle que `result.transferred`/`result.moved` déjà en place, une entrée par
fusion.

Pas de nouvelle bannière dédiée : le mécanisme d'affichage du résultat de
sync existant (celui qui montre déjà « X envoyé, Y reçu ») est le bon endroit
— une fusion est une variété de réception, pas un événement à part.

## Section 4 — Synchronisation automatique à la fermeture

Point d'accroche : `useUnsavedChangesGuard` (`src/hooks/useUnsavedChangesGuard.ts`)
gère déjà les deux moments où une carte « se ferme » — `requestOpenFile` (on
bascule vers un autre fichier) et `onCloseRequested` (on ferme la fenêtre) —
et les deux font déjà `await flush()` avant de continuer. C'est le point
d'ancrage naturel : les données de l'élève sont sur disque, dans l'ordre,
AVANT que la synchronisation ne parte, donc rien n'est perdu à l'enregistrement
même si l'élève ferme juste après avoir édité.

Après un `flush()` réussi (dans les deux branches), si un compte est connecté
et un dossier de synchronisation choisi (`useSyncStore.getState().currentUser
!== null && syncFolderPath !== null`), on déclenche `syncNow({ trigger: 'auto'
})` sans l'attendre (fire-and-forget) — bloquer la fermeture de la fenêtre ou
le changement de fichier sur un aller-retour réseau serait une régression
d'expérience que rien ne demande. C'est un sync du dossier complet, pas
seulement du fichier qu'on ferme : `syncNow` fait déjà exactement ce qu'il
faut (le fichier qu'on vient de fermer n'est plus « actuellement ouvert »
donc n'est plus protégé par le garde-fou de la Section 2, et peut recevoir sa
fusion) et créer un chemin de synchronisation à fichier unique séparé
ajouterait une deuxième façon de faire la même chose pour un gain marginal.

`onCloseRequested` a une contrainte de plus : la fenêtre attend déjà la
résolution de `flush()` avant d'appeler `closeNow()`. Le sync déclenché reste
fire-and-forget même là — on n'attend pas le réseau pour fermer la fenêtre,
volontairement, puisque tout ce que la fermeture doit garantir (les données
sur disque) l'est déjà par `flush()`.

## Hors périmètre

- **Adapter la skill `transformer-cours-en-carte-mentale` à un mode
  correction** — dépend du contrat de permissions posé ici, mais reste un
  changement de documentation de skill, pas de code applicatif. Chantier
  séparé.
- **Un champ « dernier éditeur »** distinct de `meta.author`, pour distinguer
  dans l'interface une carte écrite par le prof d'une carte écrite par
  l'élève. Rien dans la demande initiale n'exige cette distinction visuelle ;
  `meta.lastModified` existe déjà si un besoin apparaît plus tard.
- **Fusion champ à champ** d'une carte modifiée des deux côtés (même `id`,
  contenu différent chez l'élève et chez le prof) — explicitement écarté par
  la règle demandée : la version du prof gagne entièrement pour toute carte
  partagée.
- **Notification push / temps réel** d'une correction reçue. La
  synchronisation reste déclenchée (lancement, intervalle, fermeture), jamais
  poussée par le serveur.
- **Historique des versions** d'une carte corrigée (pouvoir revenir à la
  version de l'élève avant correction). Les cartes mises de côté couvrent déjà
  le cas qui inquiétait l'utilisateur (perte de contenu), sans avoir besoin
  d'un historique complet.

## Tests

- `canEditContent` : auteur seul (élève sur sa propre carte), prof seul (sur
  la carte d'un élève), ni l'un ni l'autre (élève sur la carte d'un autre
  élève, ou sur celle du prof), `meta === null` (jamais publié → éditable).
- `planPush` : un prof avec une entrée de sync existante pour un fichier
  d'élève modifié localement (chez le prof) plannifie `content: true`.
- `pullOne` : un enregistrement qu'on a soi-même écrit, retrouvé inchangé au
  prochain sync (`lastSyncedUpdated >= record.updated`), ne déclenche aucune
  réécriture — le comportement actuel pour le cas simple (élève seul,
  personne d'autre n'a touché son fichier) ne régresse pas.
- Fusion : cartes locales et distantes disjointes → toutes les locales
  deviennent volantes ; cartes identiques des deux côtés → aucune fusion,
  aucun changement ; carte présente des deux côtés avec un contenu différent
  → la version distante (le prof) gagne sans trace de la version locale.
- Le fichier actuellement ouvert dans le canevas est exclu d'un pull, que la
  synchronisation vienne de l'intervalle automatique ou de la fermeture d'un
  AUTRE fichier.
- `useUnsavedChangesGuard` : un `flush()` réussi déclenche `syncNow`; un
  `flush()` en échec ne le déclenche pas (rien de nouveau à synchroniser tant
  que l'échec n'est pas résolu par l'utilisateur).
