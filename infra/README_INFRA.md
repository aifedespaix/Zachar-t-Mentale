# Déployer PocketBase pour la synchronisation

Une seule image, ARM64 compatible (Raspberry Pi), SQLite embarqué — pas de
base de données séparée.

## 1. Déploiement (Dokploy)

Dans Dokploy, créez une nouvelle application "Docker Compose" pointant sur
`infra/docker-compose.yml` de ce dépôt. Exposez le port `8090` derrière votre
tunnel Cloudflare existant, sur le sous-domaine de votre choix
(ex. `cartes.mon-domaine.fr`).

Au premier démarrage, PocketBase vous demande de créer le compte
administrateur via `https://cartes.mon-domaine.fr/_/`.

## 2. Collection `users` (déjà fournie par PocketBase — à ajuster)

Dans `Settings` de la collection `users` :

- Activez l'authentification par mot de passe avec l'identifiant `username`
  plutôt que l'email (`Options` → `Identity/Password` → champ d'identité :
  `username`).
- Ajoutez un champ `role` : type `select`, valeurs `eleve` / `prof`, requis.

## 3. Collection `cartes_mentales`

Créez une collection de type **Base**, nommée `cartes_mentales`, avec les
champs :

| Champ | Type | Options |
|---|---|---|
| `file_id` | Plain text | Requis, unique |
| `author` | Plain text | Requis |
| `path` | Plain text | Requis |
| `content` | Plain text | Requis (le JSON de la carte mentale) |

(`updated` existe déjà nativement sur toute collection PocketBase.)

**API Rules** (onglet "API Rules" de la collection) — copiez-collez tel quel :

- **List/Search rule**: *(laisser vide — public)*
- **View rule**: *(laisser vide — public)*
- **Create rule**: `@request.auth.id != ""`
- **Update rule**: `@request.auth.username = author`
- **Delete rule**: `@request.auth.username = author`

## 4. Collection `assets`

Créez une collection de type **Base**, nommée `assets`, avec les champs :

| Champ | Type | Options |
|---|---|---|
| `hash` | Plain text | Requis, unique |
| `extension` | Plain text | Requis |
| `file` | File | Requis, un seul fichier |

**API Rules** :

- **List/Search rule**: *(laisser vide — public)*
- **View rule**: *(laisser vide — public)*
- **Create rule**: `@request.auth.id != ""`
- **Update rule**: *(laisser sur "Superusers only" — un asset content-adressé n'est jamais modifié)*
- **Delete rule**: *(laisser sur "Superusers only" — pas de nettoyage automatisé en v1)*

## 5. Dans l'application

Dans Réglages → Synchronisation, entrez l'URL de votre serveur
(`https://cartes.mon-domaine.fr`), créez un compte élève ou prof, choisissez
le dossier local à synchroniser, puis cliquez sur « Synchroniser ».
