# Déployer PocketBase pour la synchronisation

Une seule image, ARM64 compatible (Raspberry Pi), SQLite embarqué — pas de base
de données séparée. Toute la configuration des collections est **automatique** :
il n'y a plus rien à créer à la main dans le tableau de bord.

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

L'image crée le superutilisateur au premier démarrage (`superuser upsert`, donc
idempotent au redémarrage) : **plus besoin de passer par `/_/`** pour
l'administrateur, sauf si vous voulez y jeter un œil.

> **L'image est épinglée** (`ghcr.io/muchobien/pocketbase:0.40.3`) et non
> `:latest`. Le script parle l'API des collections de PocketBase ≥ 0.23, et le
> SDK JS embarqué dans l'application (v0.28) vise cette série précise. Pour
> monter de version : changez l'image, relancez le script (voir plus bas) ; s'il
> se plaint, lisez son message avant de déployer.

## 3. Configurer le serveur : une commande

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

Ce qu'elle installe :

| Collection       | Champs                                                              | Règles API                                                                   |
| ---------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `cartes_mentales` | `file_id` (unique), `author`, `path`, `content`                      | lecture publique ; création pour tout compte connecté ; modification et suppression par l'auteur seul |
| `assets`         | `hash` (unique), `extension`, `file` (≤ 10 Mio)                    | lecture publique ; création pour tout compte connecté ; jamais modifié        |
| `users`          | ajoute `username` (unique, obligatoire) et `role` (`eleve`/`prof`)  | inscription publique fermée ; connexion par pseudo                            |

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
| `--add-user pseudo:role[:motdepasse]` | Crée (ou met à jour) un compte `eleve`/`prof`. Sans mot de passe, un mot de passe solide est généré **et affiché**. |
| `--verify pseudo:motdepasse` | Après configuration, se connecte avec ce compte et fait un aller-retour réel sur `cartes_mentales` (écriture d'un contenu long, relecture, suppression) : la preuve que les champs et les règles acceptent le trafic de l'application. |
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

## 6. Quand ça ne marche pas

- **Journal de synchronisation** : chaque connexion et chaque synchronisation y
  laisse une ligne (succès comme échec), dans le dossier de configuration de
  l'application :

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
