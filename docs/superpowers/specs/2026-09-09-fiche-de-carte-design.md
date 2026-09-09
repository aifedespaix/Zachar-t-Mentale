# Fiche de carte : sidebar de lecture et modale d'édition — Design

**Date** : 2026-09-09
**Statut** : **Arbitré le 2026-09-09** — quatre lots, A → D
**Lot** : 7 (Fiche de carte)

## Arbitrage

Quatre décisions ont été tranchées avec l'utilisateur avant rédaction :

| Décision | Choix retenu |
|---|---|
| Sort du `DefinitionPopover` | **Supprimé.** Une seule surface de lecture, une seule d'édition |
| Épinglage multi-cartes | **Livré dès le lot D**, en accordéon, modèle aperçu/épingle |
| Occupation de l'espace | **La sidebar pousse le canevas**, redimensionnable, avec recentrage du viewport |
| Disposition de la modale | **Édition et aperçu live côte à côte**, l'aperçu rendu par le même `BlockView` que la sidebar et le PDF |

## Contexte

Le lot 6 (« Contenus riches ») a donné aux cartes un modèle de blocs complet
— texte, formule KaTeX, image en sidecar, tableau — et l'a branché sur un
popover de 340 × 420 px. Le modèle de données tient ; c'est sa surface
d'interaction qui ne tient plus.

### Le chemin cassé : créer une description ne donne pas accès aux blocs

Il existe aujourd'hui **deux éditeurs différents pour le même champ**, et
lequel on obtient dépend de si la carte a déjà une définition :

| Action | Composant | Ce qu'on peut y mettre |
|---|---|---|
| **Créer** une description (`CardNode.tsx:766` → `startEditingDefinition`) | `<textarea>` brut monté **dans la carte** (`CardNode.tsx:837`) | texte seulement |
| **Modifier** une description existante | `DefinitionPopover` + `BlockEditor` | texte, formule, image, tableau |

Conséquence concrète : pour mettre une formule dans une carte vide, il faut
écrire du texte quelconque, valider, rouvrir par le popover, puis convertir le
bloc. Ce n'est pas une friction d'ergonomie, c'est un chemin qui ne mène pas où
il prétend. Et c'est ce `<textarea>` inline — pas le contenu riche — qui
agrandit la carte au moment de la saisie.

### Les limites du popover comme surface de travail

- **340 px de large, 420 px de haut avec défilement interne.** Ces valeurs sont
  délibérées (règles anti-décalage 1 et 2 de la spec « contenus riches ») et
  restent bonnes pour *lire*. Elles sont hors sujet pour *écrire* un tableau à
  trois colonnes, une formule sur deux lignes et une image dans la même
  définition.
- **Aucun moyen de réordonner les blocs.** `BlockEditor` sait ajouter,
  convertir et supprimer — pas déplacer. Sur une définition de cinq blocs,
  corriger l'ordre demande de tout retaper.
- **Validation implicite.** Cliquer à côté enregistre, `Échap` annule
  (`DefinitionPopover.tsx:70-88`). C'est le bon compromis pour un champ de deux
  lignes ; c'est une perte de données en attente sur une session d'édition
  longue.
- **La règle n°8 de la spec précédente n'est pas tenue** : le sélecteur de mode
  vit dans le corps de l'éditeur et non dans l'en-tête, donc passer en édition
  pousse les blocs d'une rangée vers le bas. Le commentaire de
  `BlockEditor.tsx:150-155` le note déjà (« Worth moving »).

### Le bug des images : le protocole asset n'est pas enregistré

Signalé par l'utilisateur (« j'ai testé de rajouter des images et elle ne
s'affiche pas »). **Ce n'est pas un défaut du code des blocs.**

`assetSrc()` (`persistence/assets.ts:104`) passe par `convertFileSrc()`, qui
produit une URL `http://asset.localhost/…` (`asset://localhost/…` hors
Windows). Or rien n'enregistre ce protocole :

| Ce qu'exige Tauri 2.11.5 | État du dépôt |
|---|---|
| `app.security.assetProtocol.enable: true` **et** un `scope` dans `tauri.conf.json` | **absent** — la section `security` ne contient que `"csp": null` |
| feature `protocol-asset` sur la crate `tauri` | **absente** — `tauri = { version = "2", features = [] }` |

Tout le reste de la chaîne fonctionne : le sidecar `<carte>.assets/` est bien
créé, le fichier est bien écrit sous son hash de contenu, le bloc est bien
sérialisé. Seul le `<img>` pointe vers une origine que personne n'écoute — d'où
une image cassée plutôt qu'une erreur.

**Le scope du protocole asset est indépendant de `fs:scope`.** Les deux doivent
autoriser `$HOME/**` ; en déclarer un seul laisse le bug intact.

Deux effets de bord repérés au passage, corrigés dans le même lot :

- les options de QCM rendent le contenu avec `resolveAsset={() => ''}`
  (`CardNode.tsx:875`), donc une définition illustrée affiche « Image
  introuvable » dans le quiz ;
- rien ne supprime un asset devenu orphelin quand son bloc est effacé (traité
  hors de ces lots, voir « Hors périmètre »).

## Le principe directeur : deux surfaces, pas trois

La question posée par l'utilisateur est la bonne : *« est-ce que l'utilisateur
comprendra bien que afficher les détails d'une carte, c'est bien la même
information que dans la sidebar ? »*

La réponse dépend entièrement du nombre de surfaces qui montrent une
description. Garder le popover **et** ajouter la sidebar **et** la modale en
ferait trois pour une seule donnée — et là, oui, l'utilisateur se demanderait
laquelle fait foi. D'où la décision de supprimer le popover.

Il reste :

- **la sidebar = la fiche de la carte.** L'unique endroit où on lit une
  description en entier ;
- **la modale = la fiche en mode édition.** L'unique endroit où on l'écrit.

La carte sur le canevas devient ce qu'elle est réellement : un titre, sa place
dans l'arbre, et une porte vers sa fiche.

Quatre mécanismes rendent le lien évident, et ils sont le cœur de la réponse à
la question posée :

1. **Un seul bouton, un seul libellé, une seule destination.** « Description »
   sur la carte mène toujours à la sidebar, jamais ailleurs.
2. **L'aperçu de la modale *est* le rendu de la sidebar.** Littéralement le
   même composant `BlockView`, déjà partagé avec `StaticCardView` et l'export
   PDF. Pendant qu'il écrit, l'utilisateur voit la chose exacte qu'il
   retrouvera. C'est une preuve visuelle, pas une promesse d'interface.
3. **La modale s'ouvre depuis la fiche et hérite de son en-tête** — même titre,
   même fil d'ariane, même couleur de niveau. Continuité : ce n'est pas un
   autre écran, c'est le même écran passé en écriture.
4. **Surlignage bidirectionnel.** La carte consultée est mise en évidence sur
   le canevas ; survoler l'en-tête d'une fiche fait ressortir sa carte. On ne
   peut pas se tromper de carte.

## Le bouton de la carte

Aujourd'hui : une icône fantôme (`AlignLeft`) noyée parmi trois autres dans la
rangée du bas. Elle ne dit ni qu'il y a une description, ni ce qu'elle contient.

Demain : un bouton large, à deux états, **de hauteur strictement fixe** dans
les deux cas.

```
┌──────────────────────────┐   ┌──────────────────────────┐
│ Signes contraires        │   │ Nombres relatifs         │
│                          │   │                          │
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐ │   │ ┌──────────────────────┐ │
│ │ ＋ Ajouter une        │ │   │ │ On garde le signe…   │ │
│ │   description         │ │   │ │ fx  🖼               │ │
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘ │   │ └──────────────────────┘ │
│                          │   │                          │
│  [⚯] [⇄] [🗑]            │   │  [⚯] [⇄] [🗑]            │
└──────────────────────────┘   └──────────────────────────┘
   état « créer »                  état « afficher »
```

**La hauteur fixe n'est pas un détail esthétique** : c'est la règle
anti-décalage n°1 de la spec « contenus riches » (*l'empreinte de la carte ne
dépend jamais du contenu de la définition*). Un aperçu de deux ou trois lignes
la violerait — deux cartes voisines n'auraient plus la même hauteur et l'arbre
bougerait à chaque édition. Donc :

- **une seule ligne** de projection texte (`card.definition`, le miroir déjà
  calculé par `blocksToPlainText`), tronquée par `text-overflow: ellipsis` ;
- **une rangée de pastilles de type**, elle aussi de hauteur fixe, une par
  `kind` présent hors `text` : `fx` (formule), `🖼` (image), `▦` (tableau). Les
  pastilles disent ce qu'il y a dedans sans l'afficher — c'est ce qui donne
  envie de cliquer.

L'état « créer » utilise un contour pointillé et une opacité réduite : présent
et lisible, sans peser autant qu'une carte qui a du contenu.

Le bouton reste désactivé quand la carte est verrouillée (`locked`) et toute la
rangée d'actions disparaît pendant un quiz, comme aujourd'hui.

## La sidebar fiche

```
┌─ canevas ────────────────────┬─ fiche ─────────────────────┐
│                              │ Nombres relatifs › Addition │
│   ┌────────┐                 │ ▌ Signes contraires    📌 ✎ │
│   │ carte  │◀── surlignée    │─────────────────────────────│
│   └────────┘                 │ On garde le signe du nombre │
│                              │ le plus éloigné de zéro,    │
│                              │ puis on soustrait les       │
│                              │ distances à zéro.           │
│                              │                             │
│                              │   (+10) + (−4) = +6         │
│                              │                             │
│                              │   [schéma]                  │
│              ↔ redimensionnable                            │
└──────────────────────────────┴─────────────────────────────┘
```

- **En-tête** : fil d'ariane des parents (`Nombres relatifs › Addition`), titre
  de la carte, et un liseré de la couleur de son niveau. C'est ce qui rend
  l'identité de la carte non ambiguë quand plusieurs fiches sont ouvertes.
- **Corps** : `BlockView` sur `contentOf(card)` — le même rendu que le PDF.
- **Actions** : `📌` épingler (lot D), `✎` modifier (ouvre la modale).
- **Vide** : une carte sans description affiche un état vide avec le même
  bouton « Ajouter une description » que la carte, plutôt qu'un panneau blanc.

### Elle pousse le canevas, et le canevas se recentre

La sidebar réduit la largeur du canevas plutôt que de se superposer : rien
n'est masqué, et on peut lire une fiche en gardant l'arbre sous les yeux — ce
qui est tout l'intérêt.

**Contrepartie à traiter obligatoirement** : rétrécir le viewport React Flow
peut faire sortir de l'écran la carte qu'on vient de cliquer. À l'ouverture, la
vue est recentrée pour que la carte consultée reste visible. C'est le détail
qui décide si la sidebar est agréable ou insupportable.

Largeur redimensionnable et mémorisée, sur le modèle déjà en place pour la
sidebar fichiers (`persistence/sidebarWidth.ts`). Sur une fenêtre de 1280 px,
sidebar fichiers (~250) + fiche (~400) laissent ~630 px de canevas : le
redimensionnement et le repli ne sont pas optionnels.

## L'épinglage (lot D)

Le besoin est réel : comparer les définitions de deux ou trois cartes pour
raisonner verticalement. Deux corrections par rapport à l'intuition de départ.

### Le défaut n'est pas « ça reste »

Le mot « épingler » suggère que les fiches s'accumulent. Sans garde-fou, on
ouvre dix fiches sans s'en rendre compte et la sidebar devient un dépotoir. Le
modèle qui marche est celui des onglets d'aperçu de VS Code :

| Geste | Effet |
|---|---|
| Cliquer le bouton d'une carte | Ouvre sa fiche **en aperçu** — elle remplace la fiche en aperçu précédente |
| `📌` sur une fiche | Elle devient **permanente** ; la suivante s'ouvre en aperçu sous elle |
| `×` sur une fiche | La ferme |

Une seule fiche en aperçu à la fois, autant d'épinglées que voulu.

### L'accordéon doit vraiment replier

Trois fiches empilées dans 400 px, c'est moins de place que le popover qu'on
remplace. L'accordéon ne sauve la mise que si une section repliée n'affiche
**que son en-tête** (titre + pastilles de type), et pas un extrait de son
contenu. Une seule section dépliée par défaut ; l'utilisateur peut en déplier
plusieurs s'il veut comparer.

### Trois règles d'état, sinon ce sont des bugs

| Situation | Comportement |
|---|---|
| Changement de carte mentale | La sidebar se vide — les fiches appartiennent au fichier ouvert, pas à l'application |
| Une carte ouverte est supprimée | Son entrée disparaît ; l'annulation (undo) la ramène |
| Un quiz démarre | La sidebar se ferme entièrement |

Le dernier point n'est pas cosmétique : `qcm-definition` demande de reconnaître
une définition, et une fiche ouverte à côté **donne la réponse**. Même
raisonnement que la sidebar fichiers, déjà masquée pendant un quiz
(`App.tsx:247`).

## La modale d'édition

```
┌─ Nombres relatifs › Addition ─── Signes contraires ─────────── [×] ─┐
│ ┌─ [T] [fx] [🖼] [▦] ───────────┐  ┌─ Aperçu ──────────────────┐   │
│ │ ⠿ On garde le signe du nombre │  │ On garde le signe du      │   │
│ │   le plus éloigné de zéro…    │  │ nombre le plus éloigné…   │   │
│ │ ⠿ (+10)+(−4) = +(10−4) = +6   │  │                           │   │
│ │   [palette : ½ xⁿ √ × ÷ ≤ π]  │  │   (+10) + (−4) = +6       │   │
│ │ ⠿ [image : schéma]       [alt]│  │                           │   │
│ │ ＋                             │  │   [schéma]                │   │
│ └───────────────────────────────┘  └───────────────────────────┘   │
│  ~60 %                              ~40 %, = sidebar = PDF         │
│                            [Annuler]  [Enregistrer]  Ctrl+⏎        │
└─── min(1100px, 92vw) × 85vh ───────────────────────────────────────┘
```

Au-delà de la taille, quatre ajouts qui font la différence :

### Réordonner les blocs

Poignée `⠿` par bloc (et flèches haut/bas accessibles au clavier). Absent
aujourd'hui, bloquant dès qu'une définition dépasse trois blocs.

### Palette mathématique

MathLive est déjà installé et branché (`MathFieldEditor`). Ce qui manque, c'est
de ne pas avoir à connaître LaTeX — le vrai risque d'adoption pour un
collégien, déjà identifié dans la spec précédente.

Une rangée de boutons insérant le squelette au curseur : fraction, puissance,
racine, indice, × ÷ ± ≤ ≥ ≠ ≈ π ∞, parenthèses redimensionnées. Et, pour le
même prix — c'est la même extension KaTeX — `\ce{}` pour les équations de
chimie et `\pu{}` pour les unités de physique.

Les raccourcis existants restent : `$$` en fin de bloc texte le convertit en
formule.

### Outils image

Zone de dépôt sur toute la modale, `Ctrl+V`, bouton « Parcourir », plus par
bloc : le texte alternatif (déjà là) et une **largeur d'affichage**. Rien de
tout cela n'est vérifiable tant que le protocole asset n'est pas activé — d'où
l'ordre des lots.

### Validation explicite

Le « cliquer à côté enregistre » du popover ne se transpose pas à une modale.

| Geste | Effet |
|---|---|
| `Enregistrer` / `Ctrl+Entrée` | Enregistre et ferme |
| `Annuler` | Ferme sans enregistrer |
| `Échap` | Ferme si rien n'a changé ; **demande confirmation** sinon |
| Clic sur le fond | Même comportement qu'`Échap` |

L'écriture passe par `updateContent`, qui reste le seul écrivain du couple
`content` / `definition` — invariant inchangé.

## État et stockage

Un store dédié, `useCardDetailStore`, plutôt qu'un état local :

```ts
interface OpenCard {
  cardId: string
  pinned: boolean
  collapsed: boolean
}

interface CardDetailState {
  open: OpenCard[]       // ordre d'affichage ; au plus un `pinned: false`
  editingCardId: string | null
  width: number          // persistée, comme sidebarWidth
}
```

La liste est un tableau **dès le lot C**, alors que le lot C n'affiche qu'une
fiche à la fois. C'est délibéré : passer de `selectedCardId: string | null` à
une liste au lot D imposerait de réécrire chaque lecteur. Le coût est nul
maintenant, réel plus tard.

Rien de tout cela n'est écrit dans le `.zmap` : quelles fiches sont ouvertes
est un état de session, pas une propriété du document.

## Ce qui disparaît

| Élément | Raison |
|---|---|
| `DefinitionPopover.tsx` (+ ses tests) | Remplacé par la fiche ; le garder ferait trois surfaces pour une donnée |
| Le `<textarea>` inline de `CardNode` et `startEditingDefinition` / `commitDefinition` / `cancelDefinition` | C'est le chemin cassé décrit plus haut, et la cause de l'agrandissement de la carte |
| Le bouton « Retourner » et `FlipCard` | Son dos est un rectangle vide et coloré (`CardNode.tsx:582-592`) ; la fiche couvre le besoin. **À confirmer par l'utilisateur avant retrait** |

`updateDefinition` reste dans le store : la validation et la réparation
l'utilisent.

## Découpage en lots

| Lot | Contenu | Dépend de |
|---|---|---|
| **A** | Protocole asset (feature Rust + `assetProtocol` + scope), `resolveAsset` des options de QCM | — |
| **B** | Modale d'édition : deux volets, palette math, réordonnancement, outils image, validation explicite. Retrait du `<textarea>` inline | A |
| **C** | Sidebar fiche mono-carte, bouton large à deux états, retrait du popover, recentrage du viewport, fermeture pendant un quiz | B |
| **D** | Aperçu / épingle, accordéon, largeur redimensionnable et mémorisée, règles d'état | C |

A est court et donne un résultat vérifiable immédiatement ; il conditionne tout
test des lots suivants impliquant une image.

## Hors périmètre

- **Nettoyage des assets orphelins.** Supprimer un bloc image laisse son
  fichier dans le sidecar. Le contenu est adressé par son hash, donc rien ne
  casse ; c'est une question d'encombrement, à traiter avec le cycle de vie des
  fichiers (`fileOps`).
- **Édition du titre depuis la fiche.** Le titre reste édité sur la carte.
  L'ajouter à la fiche créerait un deuxième point d'écriture pour un champ qui
  n'en demande pas.
- **Nouveaux types de blocs** (`code`, `music`, `audio`). Le modèle les prévoit
  déjà et la modale leur laisse la place, mais ils ne sont pas dans ces lots.
- **Import XMind des notes riches.** Inchangé, reste du texte.

## Risques

| Risque | Traitement |
|---|---|
| La carte consultée sort de l'écran à l'ouverture de la sidebar | Recentrage du viewport, lot C — traité comme une exigence, pas une finition |
| Canevas trop étroit sur un portable | Redimensionnement + repli obligatoires, lot C |
| Fuite de réponses pendant un quiz | Fermeture complète de la sidebar dès `quizActive`, lot C |
| Régression de l'export PDF | L'aperçu de la modale et la fiche utilisent `BlockView`, déjà partagé avec `StaticCardView` : une dérive d'affichage devient impossible par construction |
| Perte de travail dans la modale | Confirmation sur `Échap` / clic extérieur si modifié, lot B |
