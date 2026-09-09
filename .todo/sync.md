# Contexte du projet

Je développe une application desktop (Tauri + React) de création de cartes mentales pour un élève autiste. L'application lit et écrit des fichiers JSON structurant ces cartes directement dans des dossiers locaux du PC.
Je souhaite implémenter un système de synchronisation bidirectionnelle léger avec un backend PocketBase auto-hébergé (sur un Raspberry Pi via Docker/Dokploy derrière un tunnel Cloudflare).

# Logique métier : "Créateur = Éditeur unique" (Modèle Fork)

Pour éviter les conflits et la perte de données, la règle d'or est la suivante : seul l'auteur d'un fichier peut le modifier.

1. Chaque fichier JSON de carte mentale doit contenir une structure de métadonnées :
   `{ "meta": { "id": "uuid", "author": "nom_user", "last_modified": timestamp }, "nodes": [...] }`
2. L'application React connaît l'utilisateur connecté (`currentUser`).
3. Quand l'app lit un fichier local :
   - Si `currentUser === file.meta.author` : Le fichier est totalement éditable (UI standard).
   - Si `currentUser !== file.meta.author` : Le fichier s'affiche en lecture seule (UI avec fond grisé/bleuté, cadenas). Le seul moyen de le modifier est de cliquer sur un bouton "Personnaliser / Faire ma copie", ce qui duplique le fichier localement avec un nouvel ID et `author: currentUser`.
4. La synchronisation : l'app locale télécharge les fichiers du serveur qui sont plus récents ou manquants, et upload vers le serveur les fichiers locaux créés/modifiés par le `currentUser`.

# Ce que tu dois générer et implémenter

## 1. Infrastructure (PocketBase via Docker)

Génère les fichiers nécessaires pour déployer PocketBase facilement sur mon Raspberry Pi (architecture ARM64) via Dokploy :

- Un `docker-compose.yml` propre et optimisé pour PocketBase.
- Un petit fichier de documentation `README_INFRA.md` qui m'explique :
  - Comment initialiser la collection `cartes_mentales` dans l'interface d'admin de PocketBase (champs nécessaires : `file_id`, `author`, `path`, et le champ file).
  - Les "API Rules" exactes à copier-coller dans PocketBase pour sécuriser la collection (Lecture publique, Création publique, Update/Delete limités à `@request.auth.username = author`).

## 2. Intégration côté Tauri / React (Service de Synchronisation)

Écris le code du service de synchronisation (`syncService.ts` ou équivalent) utilisant le SDK JS officiel `pocketbase`. Ce service doit :

- S'authentifier auprès de PocketBase.
- Récupérer la liste distante, comparer avec les fichiers locaux (via Tauri `fs`), et télécharger les nouveautés/mises à jour dans la bonne arborescence.
- Pousser sur le serveur les fichiers créés ou modifiés localement par l'utilisateur actif.
- Gérer intelligemment la comparaison (via le `last_modified` ou `updated` pour ne pas télécharger inutilement).

## 3. UI et Composants React

Propose l'implémentation ou les modifications pour :

- Le parseur des métadonnées des fichiers JSON.
- La Sidebar (l'arborescence des fichiers) : ajout du style conditionnel (cadenas/couleur) selon l'auteur.
- Le composant de visualisation de la carte : verrouillage de l'édition si pas l'auteur, et fonction `duplicateMap()` liée au bouton "Faire ma copie".

Agis comme un développeur Senior pointu sur Tauri, React et PocketBase. Privilégie un code modulaire, robuste face aux coupures réseau, et va à l'essentiel sans over-engineering. Pose-moi des questions si tu as besoin de précisions sur l'architecture actuelle de mon code React/Tauri avant de commencer.
Si tu trouve que l'idée pocket base es tpas la meilleur hésite pas à me propsoer des alternatives plus simple / robustes
et pariel pour la logique utilisée pour sync
