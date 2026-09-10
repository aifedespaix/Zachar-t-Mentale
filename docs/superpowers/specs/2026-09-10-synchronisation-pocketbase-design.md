# Synchronisation multi-utilisateurs (PocketBase) — Design

**Date** : 2026-09-10
**Statut** : Validé, en attente du plan d'implémentation

## Contexte

L'app est aujourd'hui 100% locale : lecture/écriture directe de fichiers
`.zmap` (JSON) sur disque via Tauri `fs`, aucune notion d'utilisateur ou de
compte. Le besoin : permettre à plusieurs personnes (vous en tant que
créateur de contenu « officiel », l'élève qui personnalise, et à terme
d'autres profs/élèves puisque le projet est open source) de synchroniser des
cartes mentales via un backend PocketBase auto-hébergé (Raspberry Pi, Docker,
derrière un tunnel Cloudflare), **chacun sur son propre serveur** — ce n'est
pas un backend central partagé par toutes les installations.

Règle métier — modèle fork, « créateur = éditeur unique » : seul l'auteur
d'un fichier peut le modifier. Un fichier appartenant à quelqu'un d'autre
s'affiche en lecture seule ; la seule action possible dessus est d'en faire
une copie locale dont on devient l'auteur.

Le rôle (`eleve`/`prof`) est une étiquette d'affichage uniquement — il ne
change aucune permission. La règle d'édition est identique pour tout le
monde : seul l'auteur écrit son fichier.

**Explicitement hors périmètre** : sync automatique (au lancement ou
périodique) — uniquement un bouton manuel pour cette v1. Permissions
différenciées par rôle. Résolution de conflit générique (le modèle fork
l'élimine par construction — voir plus bas). Partage sélectif par
classe/groupe — un serveur = une bibliothèque plate, tout le monde y voit
tout.

## Pourquoi PocketBase et pas une alternative plus simple

Syncthing ou une synchro Git ont été envisagés (aucun code serveur à écrire).
Ils conviendraient pour de la synchro personnelle multi-appareils d'un seul
utilisateur, mais **ne peuvent pas faire respecter « seul l'auteur modifie »
côté serveur** — ce sont des synchroniseurs de dossiers aveugles, la règle
reposerait entièrement sur la bonne foi du client. Le projet étant open
source et destiné à plusieurs élèves/profs sur un même serveur partagé, il
faut une autorisation réellement appliquée côté serveur. PocketBase le fait
nativement (auth intégrée + règles d'API par enregistrement), en un seul
binaire Go avec SQLite embarqué — pas de service de base de données séparé,
déploiement Raspberry Pi minimal.

## Vue d'ensemble

1. Chaque fichier `.zmap` synchronisé porte des métadonnées (`meta`) : id,
   auteur, rôle, date de dernière modification.
2. Deux collections PocketBase : `users` (collection auth, login par nom
   d'utilisateur) et `cartes_mentales` (une ligne par fichier synchronisé),
   plus une collection `assets` pour les images des sidecars.
3. Un service `syncService.ts` compare état local/serveur et pousse/tire les
   fichiers concernés, déclenché par un bouton « Synchroniser ».
4. La sidebar et le canevas affichent un état verrouillé pour tout fichier
   dont on n'est pas l'auteur, avec un bouton pour en faire sa copie.

## Format de fichier & migration

Format actuel (`src/persistence/serialization.ts`) : un tableau JSON brut de
`Card`. Nouveau format enveloppé :

```json
{
  "meta": {
    "id": "3f9e2b1a-...",
    "author": "aife",
    "role": "prof",
    "lastModified": "2026-09-10T14:32:00.000Z"
  },
  "cards": [ ... ]
}
```

`src/types/card.ts` gagne :

```ts
export type UserRole = 'eleve' | 'prof'

export interface MindMapMeta {
  id: string
  author: string
  role: UserRole
  lastModified: string // ISO 8601
}
```

`serializeCards`/`deserializeCards` deviennent `serializeMindMap(meta: MindMapMeta | null, cards: Card[])` /
`deserializeMindMap(json: string): { meta: MindMapMeta | null; cards: Card[] }` :

- JSON = tableau (format actuel, ou fichier `.json` legacy) → `{ meta: null, cards: parsed }`.
- JSON = objet avec `cards` → `{ meta: parsed.meta ?? null, cards: parsed.cards }`.
- Toute autre forme → erreur, comme aujourd'hui.

`meta: null` est le cas normal pour qui n'utilise jamais la sync : rien ne
change, le fichier reste toujours pleinement éditable localement et n'est
jamais envoyé au serveur. `meta` n'est écrit que lors du premier sync d'un
fichier (bouton « Synchroniser mon dossier » côté auteur) : `id` généré
(`crypto.randomUUID()`), `author`/`role` = utilisateur connecté,
`lastModified` = maintenant.

`saveMindMap` (dans `fileStore.ts`) prend le `meta` courant en paramètre et,
s'il n'est pas `null`, met à jour `lastModified` à chaque écriture — c'est ce
champ, pas le mtime du système de fichiers, qui pilote la comparaison de
sync (un mtime survit mal à une copie/déplacement de dossier).

## Backend PocketBase

### Collection `users` (auth)

- Type `auth`, `passwordAuth: { enabled: true, identityFields: ['username'] }`
  — pas de champ email requis.
- Champ ajouté : `role` (select, valeurs `eleve`/`prof`, requis).

### Collection `cartes_mentales`

| Champ | Type | Notes |
|---|---|---|
| `file_id` | text, unique | = `meta.id` |
| `author` | text | = `meta.author` (username, pas une relation — la règle `@request.auth.username = author` du brief d'origine s'applique directement dessus) |
| `path` | text | chemin relatif depuis la racine de sync (voir « Placement local ») |
| `content` | text (JSON) | le fichier `.zmap` sérialisé tel quel |
| `updated` | auto (champ PocketBase natif) | source de vérité pour « le serveur est plus récent » |

Règles API :
- List/View : `` (vide = public)
- Create : `@request.auth.id != ""`
- Update/Delete : `@request.auth.username = author`

### Collection `assets`

Les images des sidecars (`<carte>.assets/<hash>.<ext>`, voir
`src/persistence/assets.ts`) sont adressées par hash de contenu et jamais
réécrites une fois créées — pas de notion d'auteur ni de version à gérer.

| Champ | Type | Notes |
|---|---|---|
| `hash` | text, unique | nom du fichier sans extension |
| `extension` | text | |
| `file` | file | upload natif PocketBase |

Règles API : List/View publiques ; Create pour tout utilisateur
authentifié ; pas d'Update (un asset content-addressé n'est jamais modifié,
seulement créé) ; Delete non exposé en v1 (pas de nettoyage des assets
orphelins pour l'instant — hors périmètre).

## Réseau côté Tauri

L'app n'a aujourd'hui aucun plugin réseau (`package.json` ne liste que
`plugin-fs`/`plugin-dialog`/`plugin-opener`/`plugin-updater`). Le SDK JS
PocketBase utilise `fetch` : dans la webview Tauri, cela suppose que l'URL du
serveur (configurable par l'utilisateur, donc inconnue à la compilation) soit
autorisée par la CSP de `src-tauri/tauri.conf.json`. Deux options :
- Ajouter `@tauri-apps/plugin-http` et faire passer les appels PocketBase par
  son `fetch` (contourne la CSP de la webview, gère les origines dynamiques
  proprement — approche recommandée pour une URL serveur configurable par
  l'utilisateur).
- Desserrer la CSP (`connect-src`) — plus fragile puisque l'URL n'est connue
  qu'à l'exécution, à éviter.

Le plan d'implémentation tranchera ce point technique au moment d'écrire le
service (ajout de `@tauri-apps/plugin-http` au `Cargo.toml`/`package.json` et
capacités Tauri associées).

## Placement local des fichiers reçus

Les dossiers racine locaux (`useWorkspaceStore`) diffèrent d'une machine à
l'autre — le serveur ne peut pas dicter une arborescence locale arbitraire.
Un nouveau réglage « Dossier de synchronisation » (un des root folders
existants, choisi dans l'écran de réglages) sert de racine : `path` (champ
serveur) est résolu sous ce dossier. Un fichier reçu pour la première fois
est écrit à `<dossier de sync>/<path>`, en créant les sous-dossiers
manquants.

## Algorithme de sync

Le modèle fork élimine la résolution de conflit générique : un fichier n'est
jamais modifiable que par une seule machine (celle de son auteur). Pas de
merge à écrire — au pire un côté est en retard d'une version, résolu par
« le plus récent gagne », ce qui est sûr ici.

État local persistant : `.sync-state.json` à la racine du dossier de sync —
`Record<file_id, { lastSyncedModified: string; lastSyncedUpdated: string }>`,
mémorise le dernier état connu pour éviter de comparer le contenu complet à
chaque passage.

Au clic sur « Synchroniser » (`syncService.sync()`) :

1. **Push** — pour chaque `.zmap` local avec `meta !== null` et
   `meta.author === currentUser` :
   - absent du cache de sync **ou** `meta.lastModified` > `lastSyncedModified` connu
   - → `pb.collection('cartes_mentales').create/update(...)` (upsert par `file_id`), puis upload des assets référencés par le fichier qui n'existent pas encore sur le serveur (vérif par `hash`, pas de re-upload).
2. **Pull** — pour chaque enregistrement serveur avec `author !== currentUser` :
   - absent localement **ou** `updated` serveur > `lastSyncedUpdated` connu
   - → écrit/écrase le fichier local à son `path` résolu, télécharge les assets manquants.
3. Le cache `.sync-state.json` est mis à jour à la fin pour chaque fichier
   traité avec succès.
4. Un échec réseau ou serveur sur un fichier donné n'interrompt pas le
   traitement des autres — chaque erreur est collectée et affichée dans le
   résumé final, jamais une exception qui remonte et casse le bouton.

Le service expose :

```ts
interface SyncResult {
  pushed: number
  pulled: number
  errors: { fileId: string; message: string }[]
}

async function sync(config: SyncConfig): Promise<SyncResult>
```

`SyncConfig` = URL serveur + `pb.authStore` déjà authentifié + dossier de
sync résolu. Aucune sync silencieuse en tâche de fond — uniquement appelé
depuis le clic utilisateur (cohérent avec le choix : sync manuelle
uniquement, app 100% utilisable hors ligne, la sync est un bonus jamais un
prérequis).

## UI

### Réglages — écran « Synchronisation »

Nouveau panneau dans les réglages existants (même famille que
`AppearanceSettingsDialog`/`QuizSettingsDialog`) :
- URL du serveur PocketBase
- Nom d'utilisateur / mot de passe, bouton Connexion (`pb.collection('users').authWithPassword(...)`)
- Choix du dossier de synchronisation (parmi les root folders existants)
- Bouton « Synchroniser » + résumé du dernier sync (compteurs + erreurs éventuelles)

L'`authStore` PocketBase est persisté dans un fichier de config local
(même mécanisme que `quizSettings.ts`/`appearanceSettings.ts` sous
`appConfigDir()`) plutôt que le `localStorage` par défaut du SDK, qui n'a pas
de sens dans un contexte Tauri.

### Sidebar (`FileTreeRow.tsx`, `FileSidebar.tsx`)

Pour tout `.zmap` dont `meta !== null` et `meta.author !== currentUser` :
icône cadenas + fond grisé/bleuté (nouvelle variante de style, cohérente
avec les styles conditionnels déjà présents pour les fichiers illisibles —
lot 5).

### Canevas / détail (`MindMapCanvas.tsx`, `CardDetailPanel.tsx`)

Fichier non-auteur ouvert → mode lecture seule : actions d'édition
désactivées (glisser-déposer, ajout/suppression de carte, édition de
contenu), remplacées par un bandeau « Fichier de {author} — lecture seule »
avec bouton **Personnaliser / Faire ma copie**.

`duplicateMap(sourcePath: string): Promise<string>` :
1. Charge le fichier source, remplace `meta` par `{ id: crypto.randomUUID(), author: currentUser, role: currentRole, lastModified: now }`.
2. Écrit-le sur un chemin libre local (réutilise `freeMindMapPath`), copie le
   dossier sidecar d'assets (réutilise le pattern `duplicatePath`/
   `copyDirRecursive` de `fileOps.ts` — les assets restent adressés par le
   même hash, pas de recopie de contenu, juste du fichier).
3. Ouvre la copie, désormais pleinement éditable.

## Gestion d'erreurs / robustesse réseau

- Serveur injoignable au clic « Synchroniser » → message clair, aucun état
  local modifié, l'app reste utilisable normalement (cohérent avec « la sync
  est un bonus optionnel »).
- Échec d'authentification → message clair sur l'écran de réglages, ne
  bloque rien ailleurs dans l'app.
- Un fichier individuel qui échoue (conflit de règle API, réseau coupé en
  cours de sync) est reporté dans `SyncResult.errors` sans interrompre les
  autres fichiers du lot.
- Fichier local corrompu ou `meta` invalide rencontré pendant le scan de
  push → traité comme un fichier illisible existant (message français, ne
  bloque pas le sync des autres fichiers) — même philosophie que la gestion
  d'erreur déjà en place pour les fichiers illisibles (lot 5).

## Infra

`docker-compose.yml` (à la racine ou dans un dossier `infra/`) :
- Un seul service, image PocketBase compatible ARM64
- Un volume nommé pour `/pb_data`
- Pas de base de données séparée (SQLite embarqué)

`README_INFRA.md` :
- Déploiement via Dokploy (pointer sur le `docker-compose.yml`)
- Création manuelle des collections `users`/`cartes_mentales`/`assets` dans
  l'interface admin, avec la liste exacte des champs ci-dessus
- Les règles API à copier-coller telles quelles (section « Backend
  PocketBase » ci-dessus)
- Configuration du tunnel Cloudflare (pointeur vers la doc existante de
  l'utilisateur, pas réécrite ici)

## Tests

- `serialization.ts` : aller-retour `{meta, cards}` ; rétrocompatibilité
  tableau brut → `meta: null` ; fichier `.json` legacy toujours lisible.
- `syncService.ts` (avec un client PocketBase mocké) :
  - push d'un fichier jamais synchronisé (création)
  - push d'un fichier déjà connu, modifié localement (update)
  - push ignoré si rien n'a changé depuis le dernier sync
  - pull d'un fichier absent localement (création)
  - pull ignoré si le fichier local est déjà à jour
  - un fichier en erreur n'empêche pas les autres d'être traités, apparaît
    dans `errors`
  - fichiers sans `meta` (`meta === null`) totalement ignorés par le sync
- `duplicateMap()` : nouveau `meta.id`/`author`, fichier source inchangé,
  sidecar d'assets recopié.
- UI : `FileTreeRow` affiche le cadenas seulement quand `author !==
  currentUser` ; le canevas bascule bien en lecture seule et le bouton
  « Personnaliser » appelle `duplicateMap`.

## Hors périmètre (rappel)

- Sync automatique (lancement ou tâche de fond périodique) — bouton manuel
  uniquement pour cette v1.
- Permissions différenciées par rôle — `role` est un simple label d'affichage.
- Résolution de conflit générique / merge — éliminée par construction par le
  modèle fork.
- Partage sélectif par classe/groupe/visibilité restreinte — un serveur =
  une bibliothèque plate et publique en lecture pour tous ses comptes.
- Nettoyage des assets orphelins côté serveur.
- Chiffrement transport au-delà de ce qu'apporte déjà le tunnel Cloudflare
  (HTTPS) — pas de chiffrement applicatif supplémentaire.
