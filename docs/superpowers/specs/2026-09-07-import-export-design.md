# Import / Export — Design

**Date** : 2026-09-07
**Statut** : Validé, en attente du plan d'implémentation
**Lot** : 3 (Import / Export)

## Contexte

Lot 3 de la feuille de route à 6 lots. Les lots 1 (éditeur), 2 (quiz) et 5
(navigation fichiers, fait hors ordre) sont terminés. Ce lot couvre l'export
des cartes mentales vers des formats partageables/imprimables (PDF, image,
XMind) et l'import de cartes XMind existantes.

**Explicitement hors périmètre** : l'import de cours (PDF, fiche à trous,
image) généré ou reformulé par une IA. Ce chemin est déjà couvert par la skill
`.claude/skills/transformer-cours-en-carte-mentale/SKILL.md`, qui fait écrire
le JSON `Card[]` directement par un agent Claude, conforme au schéma de
l'app — l'utilisateur copie ensuite ce fichier dans le dossier suivi par la
sidebar. Aucun parsing PDF/image côté application n'est nécessaire. Améliorer
cette skill (mots-clés inventés pour catégoriser, définitions plus
systématiques et fiables) est un travail séparé, indépendant de ce plan.

## Vue d'ensemble

Deux capacités nouvelles, toutes deux déclenchées depuis la sidebar fichiers :

1. **Export** (bouton sur chaque ligne "carte mentale") : un dialog propose le
   format — **PDF** (priorité), **Image**, ou **XMind** (regroupé au même
   endroit pour ne pas le mettre en avant) — plus deux cases à cocher :
   « Afficher les définitions » et « Inclure les cartes volantes » (décochée
   par défaut).
2. **Import XMind** (bouton sur chaque ligne "dossier", à côté de « Nouvelle
   carte mentale » / « Nouveau sous-dossier ») : sélecteur de fichier natif
   filtré sur `.xmind`, produit un ou plusieurs fichiers `.json` dans le
   dossier ciblé.

## Export PDF / Image

### Rendu

Pas de deuxième instance React Flow interactive : superflu pour une capture
statique (pan/zoom/édition ne servent à rien ici). À la place, un conteneur
DOM hors-écran (`position: fixed`, hors viewport) qui réutilise le composant
de rendu visuel des cartes (extrait de `CardNode` en variante lecture seule,
sans les boutons structurels/drag) positionné en absolu avec les coordonnées
de `computeLayout` (`src/layout/columns.ts`, déjà pur et déterministe — aucun
rendu réel n'est nécessaire pour connaître la taille d'un sous-arbre).

Capture : `html-to-image` (nouvelle dépendance) rasterise le conteneur en PNG.
Un export **Image** s'arrête là. Un export **PDF** assemble une image par
page avec `jsPDF` (nouvelle dépendance), une page A4 paysage par capture.

### Pagination (récursive)

Le budget d'une page (nombre de lignes/colonnes de `computeLayout` qui
tiennent sur une A4 paysage à une échelle lisible) est une constante calculée
une fois, sur le même principe que `ROW_HEIGHT`/`COLUMN_WIDTH`.

1. L'arbre entier tient dans ce budget → une seule page.
2. Sinon, découpe au niveau des branches de niveau 2 : chaque branche devient
   une page candidate, avec la carte racine répétée en tête de page.
3. Une branche de niveau 2 encore trop grande se redécoupe à son tour au
   niveau 3 (répétant racine + branche niveau 2 en tête), puis si nécessaire
   en lots de cartes niveau 4 (répétant racine + niveau 2 + niveau 3).
4. Le résultat : autant de « mini-cartes mentales » à structure similaire
   qu'il faut pour couvrir exhaustivement l'arbre, chacune lisible en A4.

Cartes volantes (si la case est cochée) : une page finale dédiée après toutes
les pages de l'arbre, même grille que la zone « Cartes volantes » du canevas
(`computeDetachedZoneLayout`).

La case « Afficher les définitions » est globale (toutes ou aucune), appliquée
au rendu avant capture — pas de granularité par carte.

### Nommage / destination

Dialog de sauvegarde natif (`@tauri-apps/plugin-dialog`, `save()`), en dehors
du dossier suivi par défaut (fichier de partage/impression, pas un fichier de
cours suivi par la sidebar). Nom par défaut : nom du fichier source + suffixe
de format.

## XMind

### Import

- Zip lu via `jszip` (nouvelle dépendance), format **XMind Zen/2021
  uniquement** (`content.json` dans le zip) — pas l'ancien `content.xml`
  (XMind 8 et antérieur). Un vieux fichier peut être resauvegardé au format
  moderne depuis XMind si besoin.
- Une feuille (sheet) XMind = un fichier `.json` de l'app (même règle « un
  fichier = une racine = un chapitre » que la skill de transformation). Un
  `.xmind` à plusieurs feuilles produit plusieurs fichiers, nommés d'après le
  titre de chaque feuille, dans le dossier ciblé.
- Sujet central → niveau 1 ; enfants → niveaux 2/3/4 selon la profondeur
  XMind. Notes du sujet → `definition`.
- **Profondeur XMind > 4** : plutôt que détacher ces sujets en cartes
  volantes (qui perdraient tout contexte hiérarchique une fois isolées), le
  sous-arbre excédentaire est **replié en texte** dans la `definition` de la
  carte de niveau 4 correspondante (une ligne indentée par sujet descendant,
  préfixée par son titre). Aucune information n'est perdue, l'invariant à 4
  niveaux stricts est respecté.

### Export

- Notre arbre tient toujours dans une profondeur XMind arbitraire : pas de
  clamp nécessaire. Niveau 1 → sujet central ; niveaux 2/3/4 → sujets
  enfants ; `definition` → note du sujet.
- Cartes volantes (s'il y en a) → sujets enfants d'un sujet synthétique
  « Cartes volantes » accroché au sujet central, pour ne rien perdre (miroir
  du traitement PDF).
- Écrit via `jszip` puis `save()`/`writeFile` (binaire), même dialog de
  destination que PDF/Image.

## Gestion d'erreurs

- Import XMind corrompu / zip illisible / format non supporté (`content.xml`
  legacy) : message explicite via `setWorkspaceError` (même pattern que les
  erreurs fs existantes de `useWorkspaceStore`), aucun fichier `.json`
  partiellement écrit.
- Export (PDF/Image/XMind) qui échoue en cours d'écriture, ou dialog de
  sauvegarde annulé par l'utilisateur : erreur affichée, aucun fichier
  partiel laissé sur le disque.

## Tests

- Pagination récursive testée en pur, sans rendu réel (même approche que
  `columns.test.ts` existant) : arbres larges/étroits, cas pile au budget,
  cartes volantes incluses/exclues.
- Codec XMind testé en aller-retour (import → export doit redonner un arbre
  équivalent) et sur cas limites : profondeur > 4 (repliage en texte),
  plusieurs feuilles, notes vides/absentes, zip corrompu.
- `html-to-image` / `jsPDF` mockés dans les tests unitaires — pas de vrai
  rendu DOM→canvas en CI.

## Nouvelles dépendances

`html-to-image`, `jspdf`, `jszip`.

## Hors périmètre (rappel)

- Parsing PDF/image de cours par l'app (couvert par la skill
  `transformer-cours-en-carte-mentale`, hors code applicatif).
- Format XMind legacy (`content.xml`, XMind 8 et antérieur).
- Sélection d'une sous-partie à exporter (toujours le fichier entier — le
  découpage en pages gère déjà les arbres trop grands).
- Amélioration de la skill de transformation (mots-clés inventés, définitions
  systématiques) — tâche séparée, indépendante de ce plan.
