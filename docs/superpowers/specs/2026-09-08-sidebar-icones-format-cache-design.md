# Sidebar : icônes de format + cache — Design

**Date** : 2026-09-08
**Statut** : Validé, en attente du plan d'implémentation
**Sous-projet** : B (sur 4 — D et A faits, B en cours, C à suivre)

## Contexte

Deuxième volet de l'amélioration de la sidebar (voir
`docs/superpowers/specs/2026-09-08-sidebar-menu-contextuel-design.md` pour
le contexte complet des 4 sous-projets). Aujourd'hui, `fileTree.ts` classe
un fichier en nœud `mindmap` uniquement sur la base de son extension
(`isMindMapPath` : `.zmap` ou l'ancien `.json`) — jamais sur son contenu.
`FileTreeRow.tsx` affiche systématiquement l'icône générique `FileJson`
(lucide) pour tout nœud `mindmap`, valide ou non.

Objectif : si le contenu du fichier est une carte mentale bien formatée,
afficher le favicon de l'app (`public/favicon.svg`) à la place — un signal
visuel immédiat que c'est le bon format. Si le contenu est mal formaté
(JSON illisible, ou JSON valide mais structurellement invalide), garder
l'icône générique ; ouvrir un tel fichier déclenche déjà, sans aucun
changement de ce sous-projet, le flux de réparation existant
(`CorruptedMapDialog` dans `App.tsx` pour l'invalidité structurelle ; un
message d'erreur simple pour le JSON illisible — la distinction entre ces
deux cas n'affecte pas l'icône, qui reste binaire).

**Explicitement hors périmètre** : le menu contextuel du graph (sous-projet
C). Le fait que les dossiers `.assets` (sidecars d'images) apparaissent
comme des dossiers ordinaires avec un menu complet (dont « Dupliquer ») —
relevé lors de la revue finale du sous-projet A, mais c'est un problème de
classification dans `fileTree.ts` sans rapport avec la validation de
contenu ; à traiter séparément si besoin.

## Vue d'ensemble

1. Un hook `useMindMapFormatValid(path: string): boolean | undefined` (un
   par ligne de `FileTreeRow`) détermine si le fichier est un format valide
   — réutilise exactement `loadMindMap` + `validateCards`, le même chemin
   que l'ouverture d'un fichier utilise déjà, pour qu'il n'y ait jamais de
   divergence entre « l'icône dit que c'est bon » et « ça s'ouvre
   vraiment ».
2. Un cache persisté sur disque (`src/persistence/mindMapFormatCache.ts`)
   évite de relire et revalider un fichier qui n'a pas changé depuis la
   dernière vérification — comparaison par date de modification (mtime) et
   taille du fichier.
3. `FileTreeRow.tsx` : l'icône d'un nœud `mindmap` est `FileJson` par
   défaut (comme aujourd'hui) et bascule vers le favicon dès que la
   validation résout à `true` — jamais de blocage du rendu de la ligne.

`fileTree.ts` et le type `FileTreeNode` restent entièrement inchangés : le
scan de dossier (extension, synchrone) et la validation de contenu
(asynchrone, mise en cache) sont deux préoccupations séparées.

## Le hook `useMindMapFormatValid`

Nouveau fichier `src/hooks/useMindMapFormatValid.ts` (même dossier que les
hooks existants `useFileDropZone.ts`/`useResolvedTheme.ts`) :

```ts
function useMindMapFormatValid(path: string): boolean | undefined
```

- Retourne `undefined` tant que la validation n'a pas résolu (icône
  générique affichée pendant ce temps — c'est ce qui rend l'opération
  non-bloquante : la ligne s'affiche immédiatement, l'icône se met à jour
  silencieusement ensuite).
- Au montage : `stat(path)` (un aller-retour IPC léger, jamais de lecture
  du contenu) pour obtenir `mtime`/`size` actuels.
  - Si une entrée en cache existe pour `path` avec le même `mtimeMs` et la
    même `size` : l'entrée est fraîche, retourne son `valid` directement,
    aucune lecture du fichier.
  - Sinon (absente, ou `mtime`/`size` différents, ou `mtime` vaut `null` —
    cas rare autorisé par le type Tauri, jamais fait confiance) : revalide
    en entier — `loadMindMap(path)` puis `validateCards` sur le résultat ;
    une rejection de `loadMindMap` (JSON illisible) compte comme invalide,
    au même titre qu'un rapport `validateCards` non `valid`. Si `mtime` est
    non-null, le résultat est écrit dans le cache (voir plus bas) ; sinon
    il n'est jamais mis en cache (toujours revalidé au prochain rendu).
  - Si `stat(path)` échoue (fichier supprimé entre le scan et cette
    vérification) : traité comme invalide, rien n'est mis en cache pour
    cette entrée.

## Le cache persisté

Nouveau fichier `src/persistence/mindMapFormatCache.ts`, calqué sur le
mécanisme de `quizSettings.ts`/`appearanceSettings.ts` :

- Fichier `mindmap-format-cache.json` sous `appConfigDir()`.
- Contenu : `Record<cheminAbsolu, { mtimeMs: number; size: number; valid:
  boolean }>`.
- `loadMindMapFormatCache()` : fichier absent → cache vide (`{}`). Fichier
  présent mais JSON invalide/corrompu → **cache vide également**, sans
  lever d'erreur — contrairement aux fichiers de réglages existants (qui ne
  se protègent pas contre un JSON corrompu), ce cache est jetable et
  reconstructible à volonté ; il n'y a aucune raison de laisser une
  corruption de ce fichier casser quoi que ce soit au démarrage.
- `saveMindMapFormatCache(cache)` : crée le dossier si besoin, écrit le
  JSON indenté — comme les fichiers de réglages existants.
- **Écritures groupées** : les mises à jour de cache (une par fichier
  nouvellement validé ou revalidé) sont accumulées en mémoire dans le
  module ; l'écriture sur disque est déclenchée par un debounce (~500 ms
  après la dernière mise à jour), même mécanisme que `useAutosave` — évite
  une rafale de petites écritures disque au premier lancement sur un
  dossier de cours avec de nombreux fichiers.
- **Pas de purge proactive** : les entrées pour des fichiers renommés ou
  supprimés restent dans le cache. Coût négligeable (JSON, même avec des
  centaines d'entrées obsolètes) ; pas de logique de nettoyage tant que ça
  ne pose pas de problème réel (YAGNI).

## Rendu dans `FileTreeRow.tsx`

Dans la branche `node.type === 'mindmap'` :

```tsx
const formatValid = useMindMapFormatValid(node.path)
// ...
{formatValid ? (
  <img src="/favicon.svg" width={16} height={16} alt="" />
) : (
  <FileJson size={16} />
)}
```

`/favicon.svg` est déjà servi à la racine (même chemin que `index.html`
utilise pour l'icône de l'onglet), fonctionne en dev comme en build. Aucun
changement au comportement d'ouverture, de renommage, de suppression, de
duplication, ou du menu contextuel (sous-projet A) — uniquement l'icône
affichée.

## Tests

- `mindMapFormatCache.test.ts` : chargement (absent → vide, présent →
  parsé, corrompu → vide sans erreur), sauvegarde (écrit le JSON, crée le
  dossier), et la logique de fraîcheur (mtime+size identiques → frais ;
  différents → périmé).
- `useMindMapFormatValid.test.ts` (ou intégré aux tests de
  `FileTreeRow.tsx`, selon ce qui est le plus simple à isoler avec les
  mocks déjà en place) : état initial `undefined`, résout à `true` pour un
  fichier valide (mock `loadMindMap`/`validateCards`), résout à `false`
  pour un JSON illisible (mock `loadMindMap` qui rejette) et pour un JSON
  structurellement invalide (mock `validateCards` qui échoue), réutilise le
  cache sans relire le fichier quand `stat` correspond à une entrée déjà
  connue.
- `FileTreeRow.test.tsx` : un nœud `mindmap` affiche `FileJson` par défaut
  puis bascule vers l'image du favicon une fois la validation résolue à
  `true` ; reste sur `FileJson` si elle résout à `false`.
