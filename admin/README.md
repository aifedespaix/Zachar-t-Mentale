# Espace professeur — interface web d'administration

Une page web, servie **par le serveur de synchronisation lui-même**, depuis
laquelle un professeur administre toute la bibliothèque : arborescence,
création de cartes, conflits, journal. Pensée pour être utilisée **debout, sur
un téléphone, à côté de l'élève** — le poste de bureau est la variante
confortable, pas l'inverse.

## Ce qu'on peut y faire

| Onglet | Ce qu'il permet |
| --- | --- |
| **Fichiers** | Toute l'arborescence. Créer, renommer, déplacer et supprimer dossiers et cartes. Ouvrir une carte et en réécrire le contenu. Changer son type. Recherche instantanée (accents ignorés). |
| **Nouvelle** | Coller le JSON d'une carte mentale, la faire **valider**, puis la ranger et l'attribuer. |
| **Conflits** | Les fichiers que deux côtés ont modifiés. Comparaison carte par carte, et arbitrage en un geste. |
| **Journal** | Une ligne par synchronisation de chaque appareil : ce qui est passé, ce qui a échoué. |

## Le validateur

Deux questions, séparées exprès, parce qu'elles n'ont pas les mêmes
conséquences :

- **La structure** — une seule racine, quatre niveaux au plus, aucune carte
  orpheline ni circulaire. Elle **bloque** l'enregistrement. Le contrôle est
  fait par `validateCards`, le code **même** que celui qui décide si le canevas
  de l'application accepte d'ouvrir un fichier : l'admin ne peut donc pas
  enregistrer quelque chose que l'application refuserait d'afficher. Un fichier
  invalide peut être **réparé automatiquement** (`repairCards`), qui ne supprime
  rien : les cartes mal placées sont détachées et parquées en zone volante.
- **La qualité** — titres manquants, cartes sans définition, titres en double
  entre cartes sœurs, définitions devenues des paragraphes de cours, images
  irrécupérables, arbre plat. Elle **avertit** seulement. C'est délibéré : un
  squelette volontairement incomplet, à remplir en direct avec l'élève, doit
  pouvoir être enregistré.

## Le choix de l'auteur, à la création

Il décide qui pourra modifier la carte ensuite, et c'est le seul réglage de cet
écran qui a une conséquence durable :

- **vous** (par défaut) → cours de référence. L'élève la révise, ne la modifie
  pas.
- **un élève** → exercice à compléter. Il en est propriétaire et peut la
  retravailler depuis son application.

Un professeur peut de toute façon modifier n'importe quelle carte par la suite.

## Développement

```bash
cd admin
bun install
PB_URL=https://cartes.mon-domaine.fr bun run dev    # http://localhost:1430
bun run test
bun run build
```

Le serveur de développement **proxifie** `/api` et `/_` vers `PB_URL` (par
défaut `http://127.0.0.1:8090`). C'est la même topologie qu'en production —
même origine, donc aucun CORS — et donc le même comportement.

Depuis la racine du dépôt : `bun run admin:dev`, `bun run test:admin`,
`bun run admin:build`.

## Architecture, en trois points

- **Pas de backend.** Le SPA parle directement à l'API REST de PocketBase, avec
  la session du professeur. Les droits sont ceux du serveur ; l'écran de
  connexion qui refuse les comptes élèves est une politesse, pas une sécurité
  (voir `src/lib/pb.ts`).
- **Le code des cartes n'est pas recopié.** L'alias `@app` pointe sur le `src/`
  de l'application de bureau : types, validation, sérialisation et chemins sont
  importés. Un validateur recopié finirait par accepter ce que l'application
  refuse.
- **L'arborescence est dérivée.** Il n'existe pas de table « dossiers
  peuplés » : une carte porte un `path` relatif, et les dossiers sont les noms
  qui apparaissent dedans. Renommer ou déplacer un dossier consiste donc
  exactement à réécrire le préfixe de chaque chemin concerné — c'est
  `planRelocation`, pur et testé, dans `src/lib/api.ts`. Seuls les dossiers
  **vides** existent comme enregistrements, parce qu'aucun chemin ne peut les
  impliquer.

## Déploiement

Rien à faire de particulier : `infra/Dockerfile` construit ce dossier et dépose
le résultat dans le `/pb_public` de PocketBase, qui le sert à la racine du même
domaine que l'API. Un conteneur, un port, une adresse. Voir
`infra/README_INFRA.md`.
