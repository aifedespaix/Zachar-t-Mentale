# Éditeur de carte mentale — Design

**Date** : 2026-09-06
**Statut** : Validé par l'utilisateur, prêt pour plan d'implémentation
**Lot** : 1/6 du projet "Zachar't Mentale"

## Contexte du projet

Logiciel de visualisation, édition et gamification de cartes mentales, destiné à un
élève TSA qui utilise actuellement XMind pour réviser ses cours (physique-chimie,
SVT, histoire, maths, français, langues). XMind est jugé trop riche en features
inutiles, peu ergonomique pour son usage, et sans mode de restitution des
connaissances (quiz).

Usage actuel de l'élève : carte mentale à 4 niveaux avec code couleur fixe :
1. **Rouge** — Titre principal
2. **Orange** — Sous-titre
3. **Bleu** — Sous-partie
4. **Jaune** — Info

Une carte = un chapitre de cours. L'élève travaille sur PC portable, déplacement
principalement au trackpad — d'où une exigence forte de simplicité (clic simple,
peu/pas de drag and drop) et de prévisibilité (profil TSA : cadre clair, retours
d'état explicites, jamais de disparition silencieuse d'éléments).

## Découpage du projet en lots

Le projet complet est trop large pour une seule spec. Il est découpé en 6 lots
indépendants, chacun avec son propre cycle design → spec → plan → implémentation :

1. **Éditeur de carte mentale** (ce document) — modèle de données, création/édition
   des cards, colonnes par niveau. Socle de tout le reste.
2. Mode quiz / gamification (masquage de cards, saisie, scoring, récompenses)
3. Import / Export (format texte propre, image, PDF multi-pages, export XMind)
4. Configuration (fichier éditable, couleurs OKLCH, nombre de colonnes, polices)
5. Navigation fichiers (barre latérale, arborescence de dossiers de cours)
6. Socle applicatif (Tauri, thème clair/sombre, build CI, auto-update)

Ce document couvre uniquement le **lot 1**.

## Stack technique

- **Shell applicatif** : Tauri + Bun
- **UI** : React + TypeScript
- **Graphe / rendu des cards** : React Flow (`@xyflow/react`)
- **Composants / accessibilité** : shadcn/ui (basé sur Radix UI)
- **Style / thème** : Tailwind CSS v4 (système de couleurs natif OKLCH)
- **Animations** : Framer Motion (Motion for React)

### Justification du choix de React Flow

Les libs "mind map" dédiées (MindElixir, jsMind, etc.) imposent leur propre layout
organique et leur propre moteur de rendu de nœuds — mal adaptées à nos contraintes
précises (colonnes à position X fixe, 4 zones de boutons par card, définition
cachable, animation de flip). React Flow est un moteur de graphe générique très
maintenu, avec rendu de nœuds 100% personnalisable (composants React libres),
pan/zoom natif, et une option `dragHandle` qui restreint le drag à un élément
précis du nœud — correspondant exactement à la poignée de drag dédiée définie
plus bas.

### Convention de versions des dépendances

Toujours utiliser les dernières versions stables des librairies au moment du
scaffold et lors des mises à jour ultérieures. Si un bug bloquant impose de figer
une version antérieure, documenter l'exception directement dans le code
(commentaire + lien vers l'issue upstream suivie), afin de pouvoir lever le pin
dès que le correctif est publié.

## Modèle de données

```ts
interface Card {
  id: string
  level: 1 | 2 | 3 | 4        // fixe pour ce lot : Rouge/Orange/Bleu/Jaune
  title: string
  definition?: string          // optionnel, sur n'importe quel niveau
  parentId: string | null      // null uniquement pour la racine (niveau 1)
  order: number                // position verticale parmi ses frères/sœurs
}
```

- Structure stockée comme une **liste plate** de cards (pas un arbre imbriqué),
  pour simplifier la sérialisation, l'undo/redo, et la compatibilité future avec
  le format d'import/export du lot 3.
- **Arbre strict, un seul parent par card** — pas de liens multi-parents. Le
  "maximum 3 enfants" observé chez l'élève reste une convention libre côté
  utilisateur, pas une limite technique imposée.
- **Une racine unique par fichier** (une carte mentale = un chapitre). Si un
  chapitre est trop gros, on le découpe en plusieurs fichiers plutôt que
  d'avoir plusieurs racines dans un même fichier.
- Le nombre de niveaux (4) est figé en dur dans ce lot ; le modèle interne reste
  néanmoins conçu comme une liste de niveaux (pas 4 champs fixes câblés en dur
  dans la logique) pour absorber la configurabilité prévue au lot 4 sans
  réécriture complète.

## Persistance

- Un fichier JSON par carte mentale (une carte = un chapitre).
- **Autosave** : sauvegarde automatique après chaque modification (debounced,
  ~500ms après la dernière action), pas de bouton "Enregistrer" à chercher.
- Ce format JSON est **interne** à l'éditeur — distinct du futur format texte
  d'import (lot 3), qui sera pensé pour être généré par un LLM à partir d'un
  cours.

## Layout & rendu

- **4 colonnes fixes**, une par niveau, position X figée dans React Flow. Seule
  la position Y (ordre vertical parmi les frères/sœurs) peut varier.
- Chaque card est un **nœud React Flow custom**, entièrement contrôlé côté
  composant React.
- **Design des cards** : fond de couleur clair + bordure et texte de couleur
  plus foncée (même teinte que le niveau), contraste conforme WCAG AA minimum
  sur les 4 couleurs. Couleurs calculées via OKLCH pour garantir une luminosité
  cohérente entre les 4 teintes.
- **Connecteurs** : trait coloré de la teinte du niveau **enfant** (celui vers
  lequel il pointe) — cohérent avec la règle "les boutons `+`/`->` sont de la
  couleur de la card qu'ils vont créer".
- **Pan/zoom** hérité nativement de React Flow (molette/pincement pour zoomer,
  glisser le fond — pas une card — pour déplacer la vue). Utile quand l'arbre
  grossit, notamment en colonne 4.
- **Auto-focus** : à la création d'une nouvelle card, la vue se recentre
  automatiquement dessus et le champ de titre passe en édition — pensé pour
  l'usage "prise de notes en direct pendant un cours".

## Anatomie d'une card

Chaque bord et zone de la card a un rôle fixe et non ambigu :

- **Bord droit** : bouton `->`, crée un enfant (coloré de la couleur du niveau
  enfant).
- **Bords haut et bas** : bouton `+`, crée un frère/sœur au même niveau (coloré
  de la même couleur que la card).
- **Bord gauche** : zone d'arrivée du connecteur depuis le parent (pas de bouton
  ici, sauf pour la racine qui n'a pas de parent).
- **Coin haut-gauche** : poignée de drag dédiée (icône type `⠿`, grise et
  discrète), pour le réordonnancement vertical — voir section suivante.
- **Bouton de suppression** : discret sur la card (ex. petit `x`).

**Boutons structurellement non applicables** (`+` sur la racine — pas de
frère/sœur possible pour une racine unique ; `->` sur un niveau 4 — pas de
niveau 5 ; `x` sur la racine — suppression de la racine interdite) : ces
boutons restent **affichés mais grisés/inactifs**, jamais retirés de la card,
sur le même principe que la poignée de drag verrouillée. Une card garde ainsi
toujours le même gabarit visuel à 4 boutons quel que soit son niveau — seul
l'état actif/grisé change — ce qui renforce la prévisibilité plutôt que de
faire varier le nombre de boutons affichés selon le niveau.
- **Corps de la card** : titre (clic pour éditer inline), définition optionnelle
  si présente.
- **Footer de la card** (sous le titre/définition) : rangée d'icônes avec
  tooltip, extensible :
  - Icône "définition" — affiche/masque la définition si elle existe, ou ouvre
    l'édition pour en ajouter une si absente.
  - Icône "retourner" — déclenche l'animation de flip visuelle de la card
    (aperçu manuel, sans logique de score/question). Cette animation sera
    réutilisée telle quelle par le futur mode quiz (lot 2) plutôt que refaite
    de zéro.
  - Emplacement réservé pour de futures icônes liées au contenu de la card.

## Réordonnancement vertical (drag)

Feature volontairement traitée comme un "défouloir" à faible enjeu : l'ordre des
cards de même niveau n'a aucun impact sur la donnée, donc aucune conséquence en
cas de manipulation — bon compromis pour laisser une interaction plus libre
(stimulation sensorielle/motrice) sans risque de casser quoi que ce soit.

- **Poignée de drag dédiée**, pas la card entière — évite toute ambiguïté avec
  les zones `+`/`->`/édition, et tout drag accidentel.
- Pas de boutons `↑`/`↓` additionnels — la poignée seule suffit, pour ne pas
  surcharger visuellement la card.
- **Bouton lock global** (dans l'interface, pas sur chaque card) — active/
  désactive le drag sur toutes les cards en même temps.
- Quand verrouillé, la poignée reste à sa place mais **grisée/désaturée**
  (non interactive), jamais complètement invisible — retour d'état visuel
  immédiat sans déplacer le contenu de la card, cohérent avec le principe de
  prévisibilité.

## Suppression

- Bouton de suppression discret sur chaque card, toujours affiché (grisé et
  inactif sur la racine, qui ne peut pas être supprimée — voir Anatomie d'une
  card ci-dessus).
- Si la card n'a **pas d'enfants** : suppression immédiate.
- Si la card **a des enfants** : modale de confirmation ("Supprimer cette card
  et ses X enfants ?") avant toute suppression irréversible.
- Ctrl+Z permet d'annuler une suppression (voir Undo/redo ci-dessous).

## Undo / redo

- Ctrl+Z / Ctrl+Shift+Z (ou Ctrl+Y) sur toutes les actions structurantes :
  création, suppression, édition de texte, réordonnancement.
- Historique conservé en mémoire pour la session en cours — pas de persistance
  de l'historique entre sessions dans ce lot.

## Accessibilité & principes TSA

- Contrastes texte/fond conformes WCAG AA minimum sur les 4 couleurs.
- Aucun état "caché" sans explication : tout élément désactivé (ex. poignée
  verrouillée) reste visible mais grisé, jamais disparu silencieusement.
- Aucune action destructive sans retour clair : confirmation quand il y a un
  enjeu (suppression avec enfants), undo disponible sinon.
- Focus clavier visible sur tout élément interactif (hérité de shadcn/ui +
  Radix), même si l'usage principal reste au trackpad.
- Toutes les actions de construction de l'arbre se font en **clic simple**,
  jamais en geste complexe ou en double-clic caché.

## Hors périmètre de ce lot

Explicitement différé aux lots suivants :

- Mode quiz/gamification complet (modale de config, difficulté, scoring,
  récompenses) — lot 2. Seule l'animation de flip est construite ici, comme
  brique réutilisable.
- Import (format texte généré par IA) et export (image / PDF / XMind) — lot 3.
- Interface de configuration (nombre de colonnes, couleurs, polices) et fichier
  de config éditable — lot 4. Les 4 niveaux/couleurs restent codés en dur pour
  ce lot.
- Barre latérale d'arborescence de dossiers de cours — lot 5.
- Packaging final (CI GitHub, auto-update) — lot 6. Développement en local via
  `tauri dev` pour l'instant.
