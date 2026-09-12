# Types et tags des cartes mentales — Design

**Date** : 2026-09-12
**Statut** : Validé, en attente du plan d’implémentation
**Suite de** : `2026-09-11-deplacement-et-synchronisation-design.md`

## Contexte

Chaque carte mentale est un fichier (`.zmap`, ou `.json` legacy) qui contient `{ meta, cards }` dès qu’il a été publié. Le besoin : donner à chaque **fichier** un type — cours, exercices, prise de notes, corrections — posé à la création (notamment par le LLM qui génère les cartes), modifiable par le propriétaire ou par un prof, et synchronisé avec le fichier.

Deux usages :
1. **Lisible d’un coup d’œil** : un petit tag coloré sur la ligne de l’arborescence, dont le détail s’affiche au survol.
2. **Partagé** : quand un prof classe la carte d’un élève, le tag du prof est celui qui survit à la resynchronisation de l’élève.

Le contenu reste ce qu’il est dans le modèle fork : **seul l’auteur écrit le contenu**. « Le prof gagne » ne concerne que la métadonnée de type.

## Décisions de cadrage

1. **L’unité classée est le FICHIER**, pas la carte-nœud du canevas. Un fichier = un type.
2. **Vocabulaire fermé** : `cours`, `exo`, `prise de notes`, `corrections`, plus `default` (sans tag). Couleurs fixes, décidées par l’application.
3. **Le popover** montre le libellé et la description figée du type. Ni « qui l’a classé », ni « quand » : aucun champ supplémentaire.
4. **« Le prof gagne » ne porte que sur le type.** Le contenu demeure la propriété de son auteur, sans exception.
5. **Pas de classification d’un brouillon local.** Le type vit dans `meta`, que seuls les fichiers publiés possèdent. Le cycle est : créer, publier, classer — ou faire poser le type par le LLM à la génération.
6. **Rien n’est jamais perdu** : un fichier sans type est `default`. Les fichiers en plus chez l’élève ne sont pas touchés.

## Modèle de données

### Vocabulaire — `src/types/mapType.ts` (nouveau)

```ts
export type MapType = 'cours' | 'exo' | 'prise de notes' | 'corrections' | 'default'
export const DEFAULT_MAP_TYPE: MapType = 'default'
/** Ramène toute valeur inconnue à `default` : un type écrit par une version future ne casse rien. */
export function mapTypeOf(value: unknown): MapType
```

Le module porte aussi les libellés et les descriptions (une phrase par type), dans l’esprit de `CONTENT_KIND_ICONS` (`src/content/ContentKindBadges.tsx`).

### Couleurs — `src/colors/mapTypeColors.ts` (nouveau)

Paires oklch clair/sombre par type, sur le modèle exact de `src/colors/levelColors.ts`. `default` n’a pas de couleur : il ne s’affiche pas.

| Type | Hue | Lecture |
|---|---|---|
| `cours` | 235 | référence |
| `exo` | 150 | entraînement |
| `prise de notes` | 0, chroma 0 | achromatique, le brouillon |
| `corrections` | 30 | ce qui demande l’attention |

### Local — `MindMapMeta`

Ajout de `type?: MapType`, **absent = `default`**. Aucune migration : les fichiers existants restent lisibles tels quels. L’app écrit la valeur explicitement dès qu’elle réécrit un `meta` (publication, classement, tirage), et un type ramené à `default` est écrit `default` plutôt que retiré : tous les producteurs produisent la même forme.

### Serveur — `cartes_mentales`

Nouveau champ `type`, texte, optionnel, max 64. Un `select` a été écarté : chaque type ajouté demain demanderait alors une migration serveur, alors que le vocabulaire est fermé côté application et que toute valeur inconnue dégrade proprement. Chaîne vide et `default` sont lus de la même façon.

### État de synchronisation

`SyncStateEntry` gagne `lastSyncedType?: string`. Le format v2 est déjà en place et ses champs sont optionnels : **pas de changement de version**. Une entrée existante a `lastSyncedType === undefined`, ce qui veut dire « inconnu », pas « pas de type ».

## Algorithme

Le type est un petit frère du `path` : une passe de réconciliation, un drapeau dans `planPush`, un champ dans le payload.

### Amorçage

Avant cette version, **aucun enregistrement n’avait de type** : le point d’accord implicite de toute entrée migrée est donc `default`. `seedLastSyncedType` amarre une entrée inconnue sur `default` et rien d’autre — surtout pas sur le type local, qui ferait passer une classification de prof pour « je n’ai pas bougé » et la laisserait écraser.

### Réconciliation

`reconcileType({ localType, lastSyncedType, remoteType })` rend `{ kind: 'none' | 'push-type' | 'adopt', to? }`, avec la même règle que `reconcilePath` — premier arrivé gagne, égalité → le serveur :

| local vs accord | serveur vs accord | qui a bougé | action |
|---|---|---|---|
| égal | égal (ou pas d’enregistrement) | personne | rien |
| différent | égal | moi | `push-type` |
| égal | différent | autrui (le prof) | `adopt` |
| différent | différent, `local ≠ remote` | les deux | `adopt` — **le serveur gagne** |
| différent | différent, `local == remote` | les deux pareil | rien, l’accord suit le serveur |

### Adopter

Adopter = réécrire le `.zmap` avec le nouveau `meta.type`, **sans toucher à `meta.lastModified`**. Sans cette précaution, une classification déclencherait un push de contenu chez l’auteur. C’est le pendant exact du `renamePath` de la réconciliation de chemins.

### `planPush`

`planPush` rend désormais `{ content, path, type }`. Le drapeau `type` est vrai si l’entrée existe, que `typeLocal !== lastSyncedType`, et que `canClassify(meta, currentUser)`.

Permission — `src/sync/permissions.ts` gagne `canClassify(meta, user)` : la même règle que `canReorder` (auteur ou prof), **plus une exigence de `meta` non nul** — un brouillon local n’a nulle part où écrire un type. Nommée séparément parce qu’elle décide d’autre chose, et les deux restent la **source unique** partagée par l’interface et la synchronisation : l’arborescence n’offre jamais un geste que le sync refuserait.

`surveySyncFolder` ajoute le drapeau `type` à sa condition « en attente », donc le compteur de la sidebar compte une classification seule.

### Payload

- `create` porte `type`.
- `update` ne porte `type` que quand c’est lui qui a bougé : `update(id, { type })`. **Jamais de contenu dans ce payload.**
- Contenu et type qui bougent ensemble partent dans le même PATCH.

### Tirage

Après avoir écrit `record.content`, le tirage réapplique `meta.type = record.type` et enregistre `lastSyncedType = record.type`.

**La règle qui lève la redondance** : le champ `type` de l’enregistrement est **la vérité** ; le `type` embarqué dans le `content` n’est qu’un miroir local, réappliqué partout où on matérialise un fichier depuis un enregistrement (réconciliation et tirage). C’est le prix assumé du choix « métadonnée du fichier ET champ serveur », et il est écrit ici une fois pour toutes.

`lastSyncedContentHash` est calculé sur la chaîne **finalement écrite**, jamais sur la chaîne reçue, sinon la comparaison de conflit du passage suivant serait fausse.

### Conflit

Le type ne crée **jamais** de conflit : `isConflict` ne change pas. Un changement de type distant ne bumpe pas le contenu, donc l’empreinte reste égale et l’auteur n’est pas bloqué.

### Compte rendu

Les adoptions « les deux avaient bougé » rejoignent `notices`, comme les chemins. `SyncResult` gagne `reclassified`, compté comme `relocated`, et `syncResultLabel` le dit.

## Interface

### Le tag

`FileTreeRow` affiche, après le nom, une petite pilule colorée pour tout type différent de `default` : fond très désaturé, bordure et texte dans le hue du type, comme `levelColors`. `default` ne rend rien. Une valeur inconnue rend la pilule neutre avec le libellé brut.

### Le popover

Le survol de la pilule ouvre le `Tooltip` existant (`src/components/ui/tooltip.tsx`, dans le `TooltipProvider` de `FileSidebar`) avec le libellé et la description figée. Pas de nouveau composant.

### Changer le type

Sous-menu « Type » dans le menu contextuel de la ligne : les quatre types, plus « Sans type », avec une coche sur l’actuel. L’entrée est **toujours visible**, mais n’est active que si `canClassify(meta, currentUser)` — qui exige un `meta` et le droit d’écrire (auteur ou prof). **Pour une carte sans `meta` (brouillon), elle est donc visible et désactivée (grisée)**, avec le tooltip « Publiez cette carte pour pouvoir la classer » : le système s’explique lui-même, et l’utilisateur comprend la règle créer → publier → classer (décision de cadrage n°5 : le type vit dans `meta`). Même logique pour la carte d’un autre compte, qu’on n’a pas le droit de classer.

Nouveau `setMindMapType(path, type)` dans `src/persistence/fileStore.ts` : lit le `meta`, écrit le type, **préserve `lastModified`** (une classification n’est pas une édition de contenu), puis l’appelant rafraîchit l’arbre (`bumpFileMetaRevision` + `refreshFolder`) et le compteur (`refreshPendingCount`), comme le fait déjà la publication.

### Création et publication

- `stampMindMapSyncMeta` (publication) pose `type: 'default'`.
- `createMindMapFile` ne change rien : un brouillon n’a pas de `meta`.
- `duplicateMap` / `stripMindMapSyncMeta` : un brouillon n’a pas de type, une copie repart `default`.
- Le LLM (`transformer-cours-en-carte-mentale`) écrit `meta.type` à la génération.

## Reprise des fichiers existants

Les `.cartes-mentales/**` déjà présents ont été repris le 2026-09-12 : le champ `type` est injecté dans chaque `meta`, déduit du nom, `default` si ambigu. La reprise **insère une ligne** au lieu de re-sérialiser, donc tout le reste du fichier est préservé à l’octet près, et `lastModified` est inchangé. Une sauvegarde complète des 17 fichiers a été prise avant l’opération.

Résultat : 17 fichiers classés, 0 échec.
- `cours` (13) : edward-hopper, Espagnol, hablamos espanol en el mundo, developper-reduire, expressions-litterales, nombres-relatifs, outils-pour-le-calcul, pourcentages-v2, circuits-electriques, formation-univers, jour-nuit-saisons, phases-de-la-lune, systeme-solaire-et-vie.
- `prise de notes` (2) : Cahier de Lecteur, edwxard-hopper-biographie.
- `default` (2) : testttt, animaux.

## RBAC et infrastructure

**Aucune règle serveur ne change.**

```
Update/Delete : @request.auth.username = author || @request.auth.role = "prof"
```

La règle autorise déjà un prof à écrire n’importe quel champ de l’enregistrement, `type` compris, et l’auteur à écrire le sien. « Le prof gagne » reste une **discipline du client** — le prof n’envoie que `{ type }` — exactement comme pour le `path`, et pour la raison déjà documentée : une règle PocketBase est par enregistrement, pas par champ.

En revanche, `README_INFRA.md` et `--check` doivent être mis à jour : **un serveur configuré avant l’arrivée du champ doit être réappliqué**, sinon un prof classant la carte d’un élève écrit dans un champ qui n’existe pas. L’encadré existant sur la réapplication du script s’étend au nouveau champ. `bun run infra/setup-pocketbase.mjs` reste idempotent.

## Tests

- `mapTypeOf` : valeur connue, inconnue, absente, non-chaîne.
- `mapTypeColors` : une couleur par type, lisible dans les deux thèmes.
- `seedLastSyncedType` : entrée sans `lastSyncedType` amarrée sur `default`.
- `reconcileType` : les cinq lignes du tableau, dont « les deux ont bougé différemment » → serveur.
- `planPush` : drapeau `type` ; un prof classe la carte d’un élève ; un élève ne classe pas celle d’un autre.
- `surveySyncFolder` : une classification seule apparaît dans `pending`.
- `syncService` (faux client) : le prof pousse `{ type }` **sans** `content` ; l’élève adopte un type distant posé par le prof ; une adoption réécrit le fichier sans bumper `lastModified` ; le tirage réapplique `record.type`.
- `fileStore.setMindMapType` : préserve `lastModified`, écrit `default`, refuse un fichier sans `meta`.
- UI : pilule seulement pour un type non défaut ; `default` ne rend rien ; coche du menu ; entrée « Type » visible mais désactivée sur un brouillon, avec son tooltip, et active pour l’auteur comme pour un prof.
- Non-régression : un `.zmap` sans type reste lisible ; `isConflict` inchangé ; un fichier repris ne déclenche aucun push de contenu.

## Hors périmètre

- Type sur une carte-nœud du canevas.
- Tags libres, couleurs choisies par l’utilisateur.
- « Qui a classé » et « quand ».
- Classer un brouillon local non publié.
- Filtrer, trier ou rechercher par type dans l’arborescence.
- Renommer le fichier selon son type.
- Tout nettoyage ou suppression automatique.

## Fichiers touchés

Nouveaux : `src/types/mapType.ts`, `src/colors/mapTypeColors.ts`, `src/sync/typeReconciliation.ts`, et leurs tests.

Modifiés : `src/types/card.ts`, `src/persistence/fileStore.ts`, `src/persistence/syncState.ts`, `src/sync/syncService.ts`, `src/sync/permissions.ts`, `src/sync/syncResultLabel.ts`, `src/components/sidebar/FileTreeRow.tsx`, `src/state/useSyncStore.ts`, `infra/pocketbase-schema.mjs`, `infra/README_INFRA.md`, `.claude/skills/transformer-cours-en-carte-mentale/SKILL.md`.

`src/persistence/serialization.ts` n’a pas besoin de changer : `meta` y est un objet opaque qui traverse tel quel.