# App shell packaging (CI + auto-update) — Design

**Date** : 2026-09-08
**Statut** : Validé, en attente du plan d'implémentation
**Lot** : 6 (Packaging)

## Contexte

Dernier des 6 lots de la feuille de route (1 à 5 terminés — voir mémoire
projet). Le thème clair/sombre initialement prévu ici a été absorbé par le
lot 4 (retouche du data model de couleurs faite une seule fois). Ce lot
couvre ce qu'il reste : versionner le build Windows, un pipeline CI GitHub
Actions, la distribution par releases GitHub, et la mise à jour automatique
côté utilisateur final (l'étudiant TSA qui utilise l'app au quotidien, pas
un développeur).

Le repo est devenu open source le 2026-09-08 (purge de l'historique
`.cours`/`.cartes-mentales`, voir mémoire projet) — sans impact direct sur
ce lot, si ce n'est que le remote GitHub est/sera public.

**Explicitement hors périmètre** :
- macOS et Linux (Windows uniquement — l'étudiant et l'utilisateur sont
  tous deux sous Windows).
- Signature de code commerciale (certificat payant) : Windows SmartScreen
  avertira à l'installation de chaque nouvelle version signée par la seule
  clé updater (auto-signée, gratuite). Limitation connue et acceptée — pas
  de budget pour un certificat EV/OV.
- Synchronisation automatique des numéros de version entre `package.json`,
  `Cargo.toml` et `tauri.conf.json` (YAGNI pour un projet qui publie
  occasionnellement) : un seul fichier fait foi, voir plus bas.
- Publication de code Rust sur crates.io ou du frontend sur npm — l'app
  n'est distribuée que sous forme de binaire via les releases GitHub.

## Vue d'ensemble

1. **Versioning** : `src-tauri/tauri.conf.json > version` est l'unique
   source de vérité (comportement documenté de Tauri — il prime sur la
   version de `Cargo.toml`). Un tag git `vX.Y.Z` correspondant déclenche la
   release.
2. **CI** : `.github/workflows/release.yml`, déclenché sur push d'un tag
   `v*`, un seul job `windows-latest`, build via `tauri-apps/tauri-action`,
   publication automatique de la release GitHub (pas de brouillon —
   décision utilisateur).
3. **Updater** : `tauri-plugin-updater` seul (pas de
   `tauri-plugin-process` : sous Windows l'installeur relance l'app
   lui-même), clé de signature Ed25519 générée localement, endpoint =
   `latest.json` de la dernière release GitHub.
4. **UX** : vérification silencieuse au démarrage, téléchargement en
   arrière-plan si une mise à jour existe, bandeau discret non-bloquant
   proposant de redémarrer — jamais de popup surprise, jamais de
   redémarrage forcé (même principe de prévisibilité déjà appliqué au lot 4
   pour l'étudiant TSA : pas d'interruption de session en cours).

## Versioning & déclenchement de release

Processus manuel de release (pas de script de bump — un seul champ à
éditer) :

1. Éditer `version` dans `src-tauri/tauri.conf.json` (ex. `"0.1.0"` →
   `"0.2.0"`).
2. Commit.
3. `git tag v0.2.0 && git push origin v0.2.0`.

Le tag pushé déclenche le workflow. `Cargo.toml > package.version` reste à
`0.1.0` par défaut de scaffold — Tauri l'ignore pour la version applicative
tant que `tauri.conf.json > version` est renseigné (c'est déjà le cas
aujourd'hui). Pas de vérification automatique de cohérence entre les deux :
si ça dérive un jour, ça n'a aucun effet fonctionnel, seulement cosmétique
dans les métadonnées Cargo.

## Pipeline CI — `.github/workflows/release.yml`

```yaml
name: publish

on:
  push:
    tags:
      - 'v*'

jobs:
  publish-tauri:
    permissions:
      contents: write
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v7

      - name: setup bun
        uses: oven-sh/setup-bun@v2

      - name: install Rust stable
        uses: dtolnay/rust-toolchain@stable

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'

      - name: install frontend dependencies
        run: bun install

      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: v__VERSION__
          releaseName: 'Zachar''t Mentale v__VERSION__'
          releaseBody: 'Voir les fichiers attachés pour installer cette version.'
          releaseDraft: false
          prerelease: false
```

Points clés :
- `tagName: v__VERSION__` doit correspondre exactement au tag déjà poussé
  (`tauri-action` reconnaît la release existante plutôt que d'en créer une
  seconde).
- `releaseDraft: false` : publication immédiate dès que le build réussit
  (décision utilisateur — pas d'étape de relecture manuelle).
- Les deux secrets `TAURI_SIGNING_*` sont lus automatiquement par
  `tauri-action`/`tauri build` — aucune configuration supplémentaire côté
  workflow au-delà de les déclarer dans l'environnement du step.
- Pas de matrice multi-OS : un seul `windows-latest`, cohérent avec le
  choix Windows-only.

## Plugin Updater

### Dépendances

- Rust (`src-tauri/Cargo.toml`) : `tauri-plugin-updater = "2"`.
- JS (`package.json`) : `@tauri-apps/plugin-updater`.
- Enregistrement du plugin dans `src-tauri/src/lib.rs`
  (`.plugin(tauri_plugin_updater::Builder::new().build())`), à côté des
  plugins `fs`/`dialog` déjà enregistrés.
- Pas de `tauri-plugin-process` / `@tauri-apps/plugin-process` : le
  redémarrage post-installation est assuré par l'installeur NSIS lui-même
  (`restartAfterInstall`), donc `relaunch()` n'aurait aucun appelant (YAGNI).

### Configuration — `tauri.conf.json`

```json
{
  "bundle": {
    "targets": ["nsis"],
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "<clé publique générée>",
      "endpoints": [
        "https://github.com/aifedespaix/Zachar-t-Mentale/releases/latest/download/latest.json"
      ]
    }
  }
}
```

`"targets": ["nsis"]` et non `"all"` : l'app est Windows-only, et `"all"`
produirait aussi un MSI. Or `tauri-action` a `updaterJsonPreferNsis:
false` par défaut, donc le `latest.json` généré pointerait vers le MSI —
qui exige une élévation UAC à chaque mise à jour et peut s'installer en
produit parallèle à côté d'une copie installée via NSIS. Un seul target
lève l'ambiguïté et raccourcit le build CI.

`productName` ne doit contenir aucune apostrophe ASCII (`'`). Tauri
substitue ce nom tel quel dans les chemins de raccourcis NSIS, et
plusieurs de ses macros d'installeur passent ces chemins dans une liste
d'arguments COM entre apostrophes simples — par exemple
`${IPersistFile::Load} $1 '("${shortcut}", ${STGM_READ})'`. Une
apostrophe ASCII referme la chaîne trop tôt, makensis recompte alors les
arguments de la macro et abandonne :

```
!insertmacro: macro "NSISCOMCALL" requires 4 parameter(s), passed 7!
Error in macro IsShortcutTarget on macroline 11
```

C'est ce qui a fait échouer la release v0.1.0 : l'app compilait,
l'installeur n'était jamais produit, et le tag ne portait que les
archives source générées automatiquement par GitHub. Le nom est donc
écrit avec l'apostrophe typographique `’` (U+2019) — la bonne apostrophe
française, et pas un délimiteur de chaîne NSIS. `src/test/packaging.test.ts`
verrouille l'invariant.

### Association de fichiers — ouvrir une carte au double-clic

L'installeur enregistre l'extension `.zmap` (`bundle.fileAssociations`), sous
le ProgID `ZachartMentale.MindMap`. C'est la raison d'être de l'installeur
plutôt que d'un portable : un `.exe` posé dans un dossier ne peut rien
enregistrer dans `HKCU\Software\Classes`, donc pas de double-clic, et
`APP_UNASSOCIATE` rend l'association à la désinstallation.

`.zmap` et pas `.json` : associer `.json` ferait de l'app l'éditeur par défaut
de TOUS les fichiers JSON de la machine. Le contenu, lui, ne change pas — un
`.zmap` est le même `Card[]` sérialisé. Les cartes écrites avant l'association
sont des `.json` et continuent de s'ouvrir (arbre, glisser-déposer, « Ouvrir
avec ») ; seules les écritures neuves prennent `.zmap`. `MIND_MAP_EXTENSIONS`
dans `src/persistence/paths.ts` est la liste unique qui porte cette règle.

Le chemin arrive par la ligne de commande — Windows lance
`zachart-mentale.exe "C:\cours\fractions.zmap"`. Deux moments, un seul
comportement :

- app fermée : `launch_mind_map` (commande Rust) relit `std::env::args()` ;
- app déjà ouverte : `tauri-plugin-single-instance` replie le second processus
  dans le premier et lui transmet son `argv`, réémis en événement
  `open-mind-map`. Sans ce plugin, un second double-clic démarrerait un
  DEUXIÈME éditeur — et deux copies qui autosauvegardent le même fichier
  toutes les 500 ms s'écraseraient mutuellement.

Des deux côtés, `useLaunchFile` passe le chemin à `requestOpenFile`, le même
point d'entrée que la barre latérale et le glisser-déposer : la garde des
modifications non enregistrées s'applique donc aussi à une ouverture depuis
l'explorateur.

Limite connue : la portée `fs` reste `$HOME/**`. Une carte rangée hors du
dossier utilisateur (un `D:\` par exemple) est refusée à la lecture, au
double-clic comme au glisser-déposer.

### Permissions — `src-tauri/capabilities/default.json`

Ajout de `"updater:default"` à la liste de permissions existante (aux
côtés de celles déjà accordées aux plugins `fs`/`dialog`/`opener`). Pas
de `"process:allow-restart"` — le plugin `process` n'est pas utilisé.

### Génération et gestion de la clé de signature

Étape manuelle, une seule fois, faite par l'utilisateur (voir échange en
conversation — pas d'accès `gh` CLI authentifié disponible pour que
l'agent la fasse à sa place) :

1. `bunx tauri signer generate -w ~/.tauri/zachart-mentale.key` — génère
   la paire de clés, affiche la clé publique dans le terminal.
2. Clé publique → collée dans `tauri.conf.json > plugins.updater.pubkey`
   (pas sensible, commitée normalement).
3. Contenu du fichier privé + le mot de passe choisi → deux secrets sur
   GitHub (Settings → Secrets and variables → Actions) : `TAURI_SIGNING_
   PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Le fichier `~/.tauri/zachart-mentale.key` local ne doit jamais être
   commité — il n'est pas sous le repo donc aucun risque avec `.gitignore`
   actuel, mais à mentionner dans le plan d'implémentation comme rappel
   explicite pour qui exécute cette étape.

## UX côté frontend

### `src/hooks/useAppUpdater.ts`

```ts
function useAppUpdater(): {
  updateReady: boolean
  dismissed: boolean
  applyUpdate: () => Promise<void>
  dismissUpdate: () => void
}
```

- Au montage (une fois, dans `App.tsx`) : appelle `check()` de
  `@tauri-apps/plugin-updater`.
- Si une mise à jour est disponible : appelle immédiatement
  `update.download()` en arrière-plan, sans attendre d'action
  utilisateur. Aucune UI pendant le téléchargement (pas de barre de
  progression — cohérent avec « jamais d'interruption »). **Important** :
  `download()` seul ne redémarre jamais l'app — `downloadAndInstall()`
  (la méthode combinée) a été délibérément évitée, car sous Windows elle
  termine le processus courant dès que l'installeur est lancé
  (`std::process::exit(0)` côté plugin), ce qui aurait tué la session en
  cours sans le bandeau de confirmation prévu.
- Une fois le téléchargement terminé : passe `updateReady` à `true`.
- `applyUpdate()` : appelle `update.install()`. Sous Windows, ceci lance
  l'installeur visible puis termine le processus — l'installeur relance
  l'app dans la nouvelle version (`restartAfterInstall` vaut `true` par
  défaut côté plugin). `@tauri-apps/plugin-process`/`relaunch()` ne sont
  donc pas utilisés : le redémarrage est entièrement porté par
  l'installeur Windows lui-même. Jamais appelé automatiquement.
- `dismissUpdate()` : masque le bandeau sans annuler la mise à jour déjà
  téléchargée. L'état `dismissed` vit dans ce hook (jamais démonté tant
  que l'app tourne), pas dans le composant du bandeau — un bandeau
  d'erreur non lié qui apparaît puis se referme ne doit jamais faire
  réapparaître un bandeau de mise à jour déjà masqué.
- Toute erreur (pas de réseau, endpoint injoignable, échec de
  téléchargement) est avalée silencieusement (`catch` + `console.
  error` pour le débogage) : `updateReady` reste `false`, l'app continue
  normalement, un nouveau essai aura lieu au prochain lancement. Pas de
  bannière d'erreur visible — une mise à jour n'est jamais une action
  bloquante ou anxiogène pour l'étudiant.

### `src/components/update/UpdateReadyBanner.tsx`

Rendu dans `App.tsx` juste sous le `<header>`, visible seulement quand
`updateReady` est `true` (même position que les bandeaux `loadError`/
`dropError` existants, jamais superposé à eux — si un de ces bandeaux
d'erreur est affiché, l'update banner attend qu'il se ferme avant de
s'afficher, pour ne jamais empiler deux bandeaux).

Contenu : texte court (« Mise à jour prête » — sans détails de version, pas
de changelog affiché, hors périmètre) + bouton « Redémarrer » appelant
`applyUpdate()` + un bouton de fermeture (×) appelant `dismissUpdate()`,
qui masque le bandeau sans annuler la mise à jour déjà téléchargée
(fermer le bandeau ne fait que le cacher ; le paquet vérifié reste sur
disque et s'installera au prochain « Redémarrer »).

Le composant est purement présentationnel : il ne détient **aucun** état
local. `App.tsx` le monte/démonte selon `updateReady && !dismissed`
fournis par `useAppUpdater` — un `useState` interne serait perdu au
démontage provoqué par un bandeau d'erreur concurrent, et le bandeau
masqué réapparaîtrait.

Nouveaux tokens CSS (`index.css`, light + dark, même mécanisme que
`--warning-*` du lot 4) :

```css
--info-bg: oklch(0.94 0.03 240);
--info-border: oklch(0.7 0.1 240);
--info-fg: oklch(0.35 0.08 240);
```

Classe `.status-banner--info` réutilisant la structure de `.status-banner`
existante avec ces tokens à la place des `--warning-*`.

## Gestion d'erreurs

- Réseau indisponible / endpoint GitHub injoignable au `check()` : échec
  silencieux, réessai au prochain lancement (voir ci-dessus).
- Téléchargement interrompu en cours de route : `download()` lève,
  capturé par le même `catch` silencieux — `updateReady` reste `false`,
  le bandeau ne s'affiche jamais et `install()` n'est donc jamais
  atteignable ; aucun fichier partiel appliqué (comportement natif du
  plugin, qui ne remplace le binaire qu'après un téléchargement complet
  et une vérification de signature réussie).
- Signature invalide (build corrompu ou mal signé) : le plugin refuse
  l'installation nativement, remonté comme une erreur `catch`ée — même
  traitement silencieux, pas de faux binaire installé.

## Tests

- `useAppUpdater.ts` : mock de `@tauri-apps/plugin-updater` (`check`,
  résolvant un faux `Update` avec `download`/`install`/`close`), même
  pattern de mock que les autres hooks Tauri du projet (ex.
  `fileStore.test.ts`).
  - `check()` résout `null` → `updateReady` reste `false`, `download`
    jamais appelé.
  - `check()` résout une update disponible → `download()` appelé
    automatiquement, `install()` **jamais** appelé, puis `updateReady`
    passe à `true`.
  - `check()` ou `download()` rejette → `updateReady` reste `false`, pas
    d'exception qui remonte au composant appelant.
  - `applyUpdate()` appelle `update.install()` ; no-op si aucune update
    n'a été trouvée.
  - `dismissUpdate()` passe `dismissed` à `true`.
- `UpdateReadyBanner.tsx` : affiche le bouton Redémarrer et appelle
  `onApply` au clic ; le bouton de fermeture appelle `onDismiss` sans
  appeler `onApply`. (La visibilité elle-même est testée dans `App.tsx` —
  le composant n'en décide plus.)
- `App.tsx` : le bandeau update et les bandeaux d'erreur existants
  (`loadError`/`dropError`) ne s'affichent jamais simultanément ; et un
  bandeau masqué reste masqué après qu'un bandeau d'erreur non lié soit
  apparu puis refermé (régression du `useState` local).
- Le pipeline CI lui-même n'est pas unit-testable de façon significative :
  vérifié en pratique en coupant un vrai tag une fois l'implémentation
  terminée (voir plan d'implémentation).

## Hors périmètre (rappel)

- macOS / Linux.
- Certificat de signature de code commercial (SmartScreen avertira,
  accepté).
- Script de synchronisation de version entre les 3 fichiers.
- Changelog affiché dans le bandeau de mise à jour.
- Barre de progression de téléchargement visible.
- Publication sur un store applicatif (Microsoft Store, etc.).
