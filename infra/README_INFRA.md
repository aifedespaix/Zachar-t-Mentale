# Déployer PocketBase pour la synchronisation

Une seule image, ARM64 compatible (Raspberry Pi), SQLite embarqué — pas de base
de données séparée. Toute la configuration des collections est **automatique** :
il n'y a plus rien à créer à la main dans le tableau de bord.

Depuis l'arrivée de l'espace professeur, **le même conteneur sert aussi
l'interface web d'administration** (`admin/`) à la racine du domaine. PocketBase
publie de lui-même le contenu de `--publicDir` (`/pb_public`) pour toute URL qui
n'est ni `/api/…` ni `/_/…` : le Dockerfile y dépose le SPA construit, et il n'y
a donc **ni second conteneur, ni second domaine, ni CORS à ouvrir**.

| URL | Servie par |
| --- | --- |
| `https://cartes.mon-domaine.fr/` | l'interface professeur (`admin/`) |
| `https://cartes.mon-domaine.fr/api/…` | l'API PocketBase — **inchangée**, l'application de bureau ne voit aucune différence |
| `https://cartes.mon-domaine.fr/_/` | le tableau de bord PocketBase |

## 1. Renseigner les identifiants d'administration

```bash
cp infra/.env.example infra/.env
```

Puis remplissez les trois valeurs (`PB_URL`, `PB_ADMIN_EMAIL`,
`PB_ADMIN_PASSWORD`). `infra/.env` est gitignoré : ces valeurs ne partent
jamais dans le dépôt, et **elles servent deux fois** — au conteneur, qui crée le
superutilisateur au démarrage, et au script de configuration, qui s'en sert pour
s'authentifier. C'est le seul fichier à écrire.

## 2. Déploiement (Dokploy)

Dans Dokploy, créez une application « Docker Compose » pointant sur
`infra/docker-compose.yml`, avec les variables `PB_ADMIN_EMAIL` /
`PB_ADMIN_PASSWORD` (l'interface de Dokploy, ou le `infra/.env` du dépôt).
Exposez le port `8090` derrière votre tunnel Cloudflare, sur le sous-domaine de
votre choix (ex. `cartes.mon-domaine.fr`).

> **Si votre déploiement existe déjà, il n'y a RIEN à reconfigurer côté
> Dokploy ni côté tunnel.** Le service, son nom, son port `8090` et son volume
> `pb_data` sont inchangés ; seule la façon de fabriquer l'image change. Le
> domaine que vous avez déjà servira l'interface professeur en plus de l'API.
>
> Une seule chose est à vérifier dans Dokploy : que le service est bien
> **construit depuis le dépôt** et non tiré d'un registre. Le compose déclare
> désormais `build:` au lieu de `image:` — Dokploy le fait tout seul au premier
> redéploiement, mais s'il avait mis l'image en cache, un « Redeploy » (ou
> « Rebuild ») force la reconstruction.
>
> Le contexte de construction est la **racine du dépôt**, pas `infra/` : l'image
> a besoin de `admin/` et de `src/`. C'est déjà ce que déclare le compose
> (`context: ..`) ; rien à saisir.

Le premier build est plus long que d'habitude (il installe les dépendances de
`admin/` et compile le SPA, soit une poignée de secondes à quelques minutes
selon la machine). Les suivants réutilisent la couche des dépendances tant que
`admin/package.json` ne change pas.

L'image crée le superutilisateur au premier démarrage (`superuser upsert`, donc
idempotent au redémarrage) : **plus besoin de passer par `/_/`** pour
l'administrateur, sauf si vous voulez y jeter un œil.

> **L'image est épinglée** (`ghcr.io/muchobien/pocketbase:0.40.3`) et non
> `:latest`. Le script parle l'API des collections de PocketBase ≥ 0.23, et le
> SDK JS embarqué dans l'application (v0.28) vise cette série précise. Pour
> monter de version : changez l'image, relancez le script (voir plus bas) ; s'il
> se plaint, lisez son message avant de déployer.

## 3. Configurer le serveur

### Automatiquement, à chaque déploiement (par défaut)

Le compose embarque un service `schema` : il attend que PocketBase se déclare
sain, applique `infra/setup-pocketbase.mjs`, puis s'arrête. **Vous n'avez rien à
lancer** — un `git push` suivi d'un déploiement Dokploy met la base au niveau du
code qui vient d'être déployé.

Ce n'est pas un service qui tourne : pas de port, pas de domaine, rien à router.
Il vit trois secondes et sort. Le script étant idempotent, un serveur déjà à
jour ne bouge pas (« Rien à faire »), et le rejouer à chaque déploiement ne
coûte rien.

```bash
docker compose -f infra/docker-compose.yml logs schema   # ce qu'il a fait
```

> Si le service `schema` échoue, le déploiement est signalé en échec. C'est
> voulu : une base en retard sur le code est exactement ce qu'on ne veut pas
> laisser passer sans le savoir. Ses messages d'erreur sont ceux du script
> (section 8).
>
> Pour reprendre la main, supprimez le bloc `schema` du compose : la commande
> ci-dessous fait exactement la même chose, quand vous le décidez.

### À la main, quand vous le voulez

Depuis votre machine, dans le dépôt :

```bash
# Configuration complète, en lisant infra/.env
bun run infra/setup-pocketbase.mjs

# Ou tout à la main, par exemple pour un serveur distant :
bun run infra/setup-pocketbase.mjs \
  --url https://cartes.mon-domaine.fr \
  --email admin@mon-domaine.fr \
  --password 'le-mot-de-passe-superutilisateur'
```

Tout passe par l'API REST du serveur, avec une session superutilisateur : la
commande fonctionne aussi bien sur `http://127.0.0.1:8090` (conteneur local
avec le port publié, ou un `pocketbase serve` lancé à côté) que sur l'URL
publique derrière le tunnel.

**Elle est idempotente** : elle compare ce que le serveur a déjà à ce qu'il
devrait avoir, et n'écrit que ce qui diffère. Relancée, elle répond
« déjà à jour » — c'est aussi le moyen de vérifier un serveur existant.
`--dry-run` affiche le plan sans rien écrire.

> **Un serveur configuré AVANT l'arrivée du partage d'agencement ou du champ
> `type` doit être réappliqué.** Deux évolutions du schéma se rattrapent en
> relançant le script : la règle `Update`/`Delete` de `cartes_mentales` a changé
> (`author || prof`), et la collection a gagné le champ `type`. Tant que le
> script n'a pas été relancé dessus, un prof reçoit un **403** quand il pousse le
> `path` d'une carte d'élève, et un prof qui classe la carte d'un élève écrit
> dans une colonne qui n'existe pas — le renommage comme le classement
> n'atteignent jamais le serveur, alors que tout le reste (contenu, tirage,
> tests, journal) reste vert. Les règles API, elles, sont **inchangées** : le
> champ `type` ne s'accompagne d'aucune règle nouvelle. Aucune autre étape n'est
> nécessaire :
>
> ```bash
> bun run infra/setup-pocketbase.mjs --dry-run   # ce qui serait changé
> bun run infra/setup-pocketbase.mjs             # applique
> bun run infra/setup-pocketbase.mjs --check     # 0 = conforme
> ```
>
> Idempotent des deux côtés : un serveur déjà à jour ne bouge pas.

> **Un serveur configuré AVANT l'espace professeur doit être réappliqué, lui
> aussi — par la même commande.** Trois collections s'ajoutent (`dossiers`,
> `sync_events`, `sync_conflicts`) ; aucune collection existante n'est modifiée,
> et aucune règle ne change. Tant que le script n'a pas été relancé, la
> synchronisation fonctionne **exactement comme avant** — c'est l'interface
> d'administration qui reste partiellement muette : les onglets « Conflits » et
> « Journal » affichent « collection absente du serveur », et un dossier vide
> créé depuis le téléphone ne s'enregistre pas. Rien n'est perdu, rien n'est à
> réparer : il suffit de lancer
>
> ```bash
> bun run infra/setup-pocketbase.mjs --dry-run   # les trois créations annoncées
> bun run infra/setup-pocketbase.mjs             # applique
> ```

> **Un serveur amorcé PAR CE SCRIPT avant cette version n'a ni `created` ni
> `updated` sur `cartes_mentales`, et doit être réappliqué.** PocketBase ≥ 0.23
> a cessé d'ajouter ces colonnes d'office : le tableau de bord les met encore
> sur toute collection qu'il crée, mais une collection créée par l'API reçoit
> exactement les champs demandés, et le script ne les demandait pas. Un serveur
> configuré à la main dans `/_/` n'est donc PAS concerné ; un serveur monté de
> zéro par le script l'est.
>
> L'effet est silencieux et sérieux : `updated` est ce que la synchronisation
> lit pour distinguer « le serveur a bougé » de « je l'ai déjà vu »
> (`isConflict`, et le contrôle de révision côté réception). Absent, l'API ne
> le renvoie pas, chaque comparaison porte sur `undefined`, et l'algorithme perd
> son seul repère. Le script ajoute les deux champs sans toucher aux données :
>
> ```bash
> bun run infra/setup-pocketbase.mjs --dry-run   # « champ « updated » ajouté (autodate) »
> bun run infra/setup-pocketbase.mjs             # applique
> ```

Ce qu'elle installe :

| Collection       | Champs                                                              | Règles API                                                                   |
| ---------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `cartes_mentales` | `file_id` (unique), `author`, `path`, `content`, `type`            | lecture publique ; création pour tout compte connecté ; modification et suppression par l'auteur, ou par un compte `prof` |
| `assets`         | `hash` (unique), `extension`, `file` (≤ 10 Mio)                    | lecture publique ; création pour tout compte connecté ; jamais modifié        |
| `users`          | ajoute `username` (unique, obligatoire) et `role` (`eleve`/`prof`)  | inscription publique fermée ; connexion par pseudo                            |
| `dossiers`       | `path` (unique), `created_by`                                       | lecture publique ; création, renommage et suppression réservés aux `prof` |
| `sync_events`    | `username`, `level`, `trigger`, `summary`, compteurs, `detail`      | lecture réservée aux `prof` ; écriture pour tout compte connecté ; jamais modifié |
| `sync_conflicts` | `file_id`, `path`, `username`, `local_content`, `status`            | lecture et arbitrage par le `prof` ou par le compte concerné                   |

Les trois dernières servent **l'espace professeur** (`admin/`), et elles sont
**facultatives** : un serveur sur lequel le script n'a pas encore été relancé
synchronise exactement comme avant. Les clients ne font qu'y déposer leur compte
rendu, et l'échec de ce dépôt n'a jamais d'effet sur une synchronisation (voir
`src/sync/syncReporting.ts`). Ce qui manque dans ce cas, c'est seulement ce que
l'interface d'administration affiche : le journal reste vide et les conflits
n'y remontent pas.

- **`dossiers`** ne contient que les dossiers **vides**. Un dossier peuplé est
  déjà impliqué par le `path` des cartes qu'il contient — c'est cette
  dérivation qui reste la source de vérité de l'arborescence.
- **`sync_conflicts`** porte `local_content` : la version locale **perdante**,
  celle que `sync()` refuse d'écraser. Sans elle, un conflit ne se tranche que
  devant la machine de l'élève, puisque c'est le seul endroit où cette version
  existe.

Les règles exactes de `cartes_mentales`, telles que le script les applique — **inchangées** (le champ `type` n'en ajoute ni n'en retire aucune) :

```
List/View : (vide)
Create    : @request.auth.id != ""
Update    : @request.auth.username = author || @request.auth.role = "prof"
Delete    : @request.auth.username = author || @request.auth.role = "prof"
```

> Une règle PocketBase est *par enregistrement*, pas par champ : `author || prof`
> autorise donc un client prof à écrire n'importe quel champ, `content` compris.
> La séparation « l'auteur pousse `content`, le prof pousse `path` » est une
> discipline du CLIENT, pas une garantie du serveur. C'est acceptable ici : un
> serveur appartient à un prof, qui en est l'administrateur, et la propriété qui
> protège réellement les gens — un élève ne peut pas toucher l'enregistrement
> d'un autre élève — reste intacte.

Deux points valent d'être connus, parce que PocketBase ne les fait pas deviner :

- **Le champ `username` n'existe plus par défaut** dans PocketBase ≥ 0.23 (la
  collection `users` fournie s'authentifie par email). L'application se
  connecte par pseudo : le script crée ce champ, son index unique, et bascule
  l'identité de connexion dessus. C'est ce que les anciennes instructions
  manuelles demandaient sans que le champ existe.
- **Un champ texte sans longueur maximale est plafonné à 5000 caractères** par
  PocketBase. Le `content` d'une carte mentale dépasse largement cette taille :
  le script lui donne 5 000 000 de caractères, sinon la synchronisation échoue
  au premier chapitre un peu fourni.

Options utiles (`--help` liste tout) :

| Option | Effet |
| --- | --- |
| `--dry-run` | Affiche ce qui serait changé, n'écrit rien. |
| `--check` | Lecture seule **et code de sortie** : `0` si le serveur est conforme, `1` s'il reste des changements, `2` s'il est injoignable. Fait pour un déploiement automatique. |
| `--export [chemin]` | Écrit l'état **réel** des trois collections en JSON trié (par défaut `infra/pocketbase-schema.applied.json`) : committable, et un diff ne montre alors qu'une vraie dérive de configuration. |
| `--add-user pseudo:role[:motdepasse]` | Crée (ou met à jour) un compte `eleve`/`prof`. Sans mot de passe, un mot de passe solide est généré **et affiché**. |
| `--verify pseudo:motdepasse` | Après configuration, se connecte avec ce compte et fait un aller-retour réel sur `cartes_mentales` (écriture d'un contenu long, relecture, suppression) : la preuve que les champs et les règles acceptent le trafic de l'application. |
| `--backup-cron <expr>` · `--backup-keep <n>` | Planification des sauvegardes automatiques (défaut `0 3 * * *`) et nombre conservé (défaut 7). |
| `--no-backups` | Ne touche pas aux sauvegardes automatiques du serveur. |
| `--insecure` | Accepte un certificat TLS auto-signé (serveur local). |

## 4. Créer les comptes des élèves et du professeur

```bash
bun run infra/setup-pocketbase.mjs --add-user eleve1:eleve
bun run infra/setup-pocketbase.mjs --add-user prof:prof:son-mot-de-passe
```

Le mot de passe omis est généré (16 caractères) et affiché une fois — notez-le
pour le transmettre. Le script peut aussi servir à réinitialiser un mot de passe :
relancer la même commande avec un mot de passe écrase l'ancien.

Vous pouvez toujours passer par le tableau de bord (`https://…/_/` →
collection `users`) : l'inscription par l'API publique, elle, est fermée.

## 5. Dans l'application

Réglages → Synchronisation : entrez l'URL du serveur, connectez-vous avec un
compte créé ci-dessus (pseudo + mot de passe), choisissez le dossier local à
synchroniser, puis cliquez sur **Synchroniser**. Le même bouton existe en bas de
la barre latérale.

L'adresse et les identifiants sont **enregistrés en clair** dans le dossier de
configuration de l'application, sur cet appareil uniquement : le formulaire est
donc déjà rempli au démarrage, et l'application se reconnecte toute seule quand
la session a expiré. Ce fichier n'est jamais synchronisé ni versionné ; il voisine
avec le jeton de session PocketBase, qui donne déjà accès aux mêmes cartes.

Si un dossier contient des cartes **jamais publiées** (créées dans l'application,
donc sans identité de synchronisation), elles ne partent pas — c'est ce que dit
le message « N cartes n'ont pas encore d'identité de synchronisation » dans les
réglages, avec le bouton qui les publie toutes d'un coup. Une carte publiée garde
son auteur : lui seul, ou un prof (qui déplace les cartes de ses élèves),
pourra la modifier par la suite.

## 6. Sauvegardes

Le script d'installation **active les sauvegardes automatiques de PocketBase**,
qu'il faut connaître parce qu'elles sont désactivées d'origine : son `cron` est
vide, donc un serveur que personne ne surveille n'a rien à restaurer tant que
quelqu'un n'y a pas pensé. Par défaut il programme une sauvegarde par nuit à 3 h
et en garde 7 ; `--backup-cron`/`--backup-keep` changent cela, `--no-backups`
laisse le serveur tranquille.

Pour une sauvegarde **maintenant** — avant de changer la version de l'image, par
exemple :

```bash
bun run infra/backup-pocketbase.mjs                       # crée et télécharge
bun run infra/backup-pocketbase.mjs --list                # ce que le serveur garde
bun run infra/backup-pocketbase.mjs --restore <clé> --yes # ⚠ remplace TOUTES les données
```

Elle arrive dans `infra/backups/` (gitignoré) et se restaure donc aussi depuis
le tableau de bord. `--restore` exige `--yes` : il remplace cartes, comptes et
réglages, et PocketBase redémarre son service dans la foulée.

## 7. Vérifier et automatiser

`bun run infra/setup-pocketbase.mjs --check` répond à la seule question qui
compte pour un déploiement : « ce serveur est-il exactement configuré ? » — et le
dit dans son code de sortie (`0` oui, `1` non, `2` injoignable). Un
post-déploiement peut donc refuser de publier tant que la réponse est non.

Le workflow `.github/workflows/infra-pocketbase.yml` fait ce contrôle en
intégration continue, contre un PocketBase **éphémère monté à la version épinglée
dans `infra/docker-compose.yml`** : il vérifie que `--check` échoue sur un
serveur vierge, que la configuration passe, que le second passage ne change plus
rien, qu'un compte ordinaire peut réellement publier et relire un fichier long,
et qu'une sauvegarde se télécharge. C'est la seule protection réelle contre une
API PocketBase qui bouge sous nos pieds — c'est exactement ce qui a fait
disparaître le champ `username` des collections par défaut.

## 8. Quand ça ne marche pas

- **Le journal, à distance d'abord** : ouvrez `https://…/` → onglet
  « Journal ». Chaque synchronisation de chaque appareil y laisse une ligne, avec
  ce qui est parti, ce qui est arrivé, et ce qui a échoué. C'est la façon la plus
  rapide de répondre à « est-ce que ça passe, chez lui ? » sans toucher à sa
  machine. Le journal local ci-dessous reste plus détaillé, et reste la
  référence pour un vrai diagnostic.

- **Journal de synchronisation (local, sur la machine concernée)** : chaque
  connexion et chaque synchronisation y laisse une ligne (succès comme échec),
  dans le dossier de configuration de l'application :

  | Système | Chemin |
  | --- | --- |
  | Windows | `%APPDATA%\com.clape.zachart-mentale\sync-debug.log` |
  | macOS | `~/Library/Application Support/com.clape.zachart-mentale/sync-debug.log` |
  | Linux | `~/.config/com.clape.zachart-mentale/sync-debug.log` |

  Le bouton **« Ouvrir le dossier des logs »** (Réglages → Synchronisation)
  l'ouvre directement, et le chemin exact est affiché à côté.

- **Messages du script** :
  - *Serveur injoignable* : URL, tunnel ou réseau.
  - *Email ou mot de passe superutilisateur refusé* : les valeurs de `infra/.env`
    ne sont pas celles du serveur.
  - *Pas d'API superutilisateur* : l'URL ne pointe pas sur un PocketBase ≥ 0.23.
- **Vérifier un serveur déjà en service** : `bun run infra/setup-pocketbase.mjs`
  doit répondre « déjà à jour ». S'il propose des changements, lisez-les : c'est
  exactement ce qu'il appliquera.

## 9. L'espace professeur

L'interface web servie à la racine du domaine. Elle est décrite dans
[`admin/README.md`](../admin/README.md) ; l'essentiel tient en trois points :

- **On s'y connecte avec les comptes créés à l'étape 4**, et seuls les comptes
  `prof` sont acceptés.
- **Elle ne demande aucun déploiement séparé** : elle est dans l'image
  PocketBase, construite par `infra/Dockerfile`.
- **Elle a besoin des trois collections de l'étape 3** (`dossiers`,
  `sync_events`, `sync_conflicts`). Si elle affiche « collection absente du
  serveur », c'est que le script n'a pas encore été relancé sur ce serveur —
  une commande, aucune perte de données.

```bash
bun run infra/setup-pocketbase.mjs --check   # 0 = le serveur a tout ce qu'il faut
```
