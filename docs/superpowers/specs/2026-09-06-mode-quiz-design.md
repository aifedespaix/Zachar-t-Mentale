# Mode quiz / gamification — Design

**Date** : 2026-09-06
**Statut** : Validé par l'utilisateur en chat, prêt pour plan d'implémentation
**Lot** : 2/6 du projet "Zachar't Mentale"

## Contexte

Le lot 1 (éditeur de carte mentale) est terminé et mergé sur `main`. Ce document
couvre le lot 2 : le mode quiz, qui transforme une carte mentale existante en
outil de restitution active des connaissances, avec scoring et récompense de
fin de session.

Principe directeur hérité du lot 1 : aucune pression de temps, navigation libre
au clic/trackpad, retour d'état toujours explicite et prévisible (profil TSA).

## Prérequis — évolutions du lot 1

Le mode quiz s'appuie directement sur le mode verrouillé existant, qui doit
d'abord évoluer sur trois points avant d'être étendu par le quiz :

1. **`LockToggle` devient un bouton icône** (cadenas ouvert/fermé, type Lucide
   `Lock` / `LockOpen`), avec tooltip "Verrouiller la carte mentale" /
   "Déverrouiller la carte mentale" — même famille visuelle que les autres
   boutons à icône/tooltip du footer de card.
2. **Le verrouillage cache les affordances structurelles** : quand
   `locked === true`, les boutons `+` (frère/sœur), `->` (enfant), `x`
   (suppression) et la poignée de drag deviennent `visibility: hidden`
   (jamais `display: none`, pour ne jamais redimensionner la card ni déplacer
   la mise en page). C'est un traitement différent du grisage "impossible sur
   cette card" (racine sans `+`, niveau 4 sans `->`) qui reste inchangé : une
   chose est "impossible ici", une autre est "temporairement protégé".
3. **Le verrouillage bloque l'édition de contenu** : titre non-éditable
   (clic sans effet), et côté définition — ni édition d'une définition
   existante, ni ajout d'une nouvelle (même raisonnement : protéger le
   contenu pendant une relecture/un quiz).

**Fix lot 1 associé** (indépendant du verrouillage, mais découvert au même
moment) : cliquer sur une définition affichée doit l'ouvrir en édition, avec
exactement le même comportement que l'édition de titre (focus → édition →
blur commit / Escape annule / Entrée commit — la mécanique `editingDefinition`
/ `commitDefinition` / `cancelDefinition` existe déjà côté `CardNode`, il
manque seulement le déclencheur au clic sur le `<p>` de définition affichée).

## Deux types de question

Le mode quiz pose deux types de question, choisis automatiquement par
l'algorithme de sélection (voir plus bas) :

- **Type A — Rappel (flip)** : applicable à **toute** card. Le titre est
  masqué ; l'élève réfléchit, clique la card pour la retourner (réutilise
  l'animation de flip du lot 1 telle quelle), le titre apparaît, puis
  l'élève s'auto-évalue avec deux boutons qui apparaissent sur la card :
  ✓ (coin haut-droit, encadre la card en vert) / ✗ (coin haut-gauche, encadre
  la card en rouge). Une fois évaluée, la card garde sa bordure verte/rouge
  jusqu'à la fin du quiz.
- **Type B — QCM définition** : applicable uniquement aux cards **ayant une
  définition** (sinon impossible de générer des distracteurs sensés). Clic
  sur la card → modale affichant son titre + 3-4 définitions (une correcte,
  les autres piochées ailleurs dans la carte selon la difficulté — voir
  plus bas). Clic sur une proposition → feedback immédiat : la bonne
  définition s'encadre en vert avec une coche en haut-droite, et si le choix
  était faux, la définition cliquée s'encadre en rouge avec une croix en
  haut-gauche ; les autres options se désactivent. Fermeture automatique
  après un court délai, la card se fixe ensuite verte/rouge sur le canvas
  comme le Type A.
- **Repli automatique** : si une card tirée en Type B ne trouve aucune autre
  définition nulle part dans la carte pour servir de distracteur, elle
  bascule silencieusement en Type A. Le nombre d'options du QCM s'adapte
  aussi au nombre de distracteurs réellement disponibles (4 si possible,
  sinon 3, sinon 2 — jamais moins de 2, sous peine de repli en Type A).
  Jamais d'état d'erreur ou de question impossible à poser.

## Algorithme de sélection

**Configuration** (modale de config, ouverte par le bouton "Quiz" de la barre
d'action, au même endroit que le bouton de verrouillage) :

```ts
type QuizDifficulty = 'facile' | 'moyen' | 'difficile'

interface QuizConfig {
  levels: CardLevel[]      // niveaux inclus dans le quiz, tous cochés par défaut
  difficulty: QuizDifficulty
}
```

Le périmètre se limite à une **sélection de niveaux** pour ce lot (pas de
scoping par branche/sous-arbre — voir Hors périmètre).

**Presets de difficulté** — pas de curseur numérique, 3 boutons fixes,
cohérent avec la prévisibilité déjà en place pour le verrouillage. Chaque
preset règle trois paramètres à la fois :

| | Facile | Moyen | Difficile |
|---|---|---|---|
| % de cards du périmètre tirées | 30% | 60% | 100% |
| Mix Type A / Type B (parmi les cards à définition) | 80% / 20% | 50% / 50% | 30% / 70% |
| Source des distracteurs QCM | n'importe où dans la carte | même niveau, n'importe quelle branche | même niveau **et** même branche (ancêtre direct de niveau supérieur) en priorité |

Pour "Difficile", si la branche ne fournit pas assez de distracteurs, on
complète en élargissant progressivement : branche → niveau entier → toute la
carte. Dégradation, jamais d'échec.

**Tirage stratifié par niveau** : pour chaque niveau coché, on tire
`round(nombre_de_cards_du_niveau × %_du_preset)` cards **sans remise**,
au hasard parmi les cards de ce niveau dans le périmètre. Ceci garantit
qu'aucun niveau n'est totalement ignoré et qu'une même card n'est jamais
posée deux fois dans le même quiz.

Le choix Type A / Type B se fait ensuite card par card, uniquement parmi les
cards tirées qui ont une définition, en respectant le ratio du preset
(les cards sans définition sont automatiquement Type A).

## Déroulé sur le canvas

Le quiz se joue **directement sur la carte mentale existante** (pas d'écran
séparé) : le canvas React Flow passe en "mode quiz", qui hérite du mode
verrouillé (boutons structurels cachés, édition bloquée) et y ajoute :

1. Bouton "Quiz" → modale de config (niveaux + difficulté) → au lancement,
   si la carte n'était pas déjà verrouillée, elle se verrouille
   automatiquement pour la durée du quiz, et se déverrouille en sortie
   uniquement si elle ne l'était pas avant (l'état de verrouillage explicite
   de l'utilisateur avant le quiz est respecté au retour).
2. Les cards **non tirées** restent affichées normalement, servent de repère
   spatial/contexte — cohérent avec la logique déjà acquise de navigation
   dans l'arbre (pan/zoom).
3. Les cards **tirées** affichent leur état de question (masqué/QCM) à leur
   emplacement habituel dans la mise en page, sans réordonnancement.
4. **HUD flottant** (coin de l'écran, non intrusif) : "X/Y répondues" +
   bouton "Terminer le quiz", cliquable à tout moment même si toutes les
   questions n'ont pas de réponse.
5. **Fin de quiz** : modale récapitulative avec le score (`Y/N bonnes
   réponses`) et une **animation de célébration fixe, toujours la même**
   (pas de variation aléatoire — un profil TSA est mieux servi par une
   récompense prévisible qu'un effet "loot" surprise). Bouton "Retour à la
   carte" qui nettoie l'état de quiz (démasque tout, retire les bordures
   vert/rouge, déverrouille si applicable).

## État & modèle de données

Nouveau store Zustand `useQuizStore`, séparé de `useCardsStore` — le quiz ne
modifie jamais les cards elles-mêmes, uniquement un état de session éphémère,
non persisté sur disque (comme l'historique undo du lot 1) :

```ts
type QuizQuestionType = 'recall' | 'qcm'
type QuizResult = 'correct' | 'incorrect' | 'unanswered'

interface QuizQuestion {
  cardId: string
  type: QuizQuestionType
  distractorDefinitions?: string[]   // uniquement pour 'qcm' ; mélangées avec la bonne définition à l'affichage
}

interface QuizState {
  active: boolean
  config: QuizConfig | null
  questions: QuizQuestion[]
  results: Record<string, QuizResult>
  wasLockedBeforeQuiz: boolean
}
```

Actions principales : `startQuiz(config)` (tire les questions, verrouille si
besoin), `answerRecall(cardId, correct)`, `answerQcm(cardId, chosenDefinition)`,
`endQuiz()` (calcule le score final, nettoie, restaure le verrouillage).

`MindMapCanvas` passe un champ `quiz` optionnel dans les `data` du nœud
`CardNode` (même pattern que `autoEdit`/`isReparentTarget` existants) quand
le quiz est actif et que la card fait partie des questions tirées :
`{ type, result, distractorDefinitions? }`.

## Accessibilité & principes TSA

- Pas de minuteur, pas de rythme imposé — navigation libre comme le reste de
  l'éditeur.
- Récompense de fin de quiz fixe et prévisible, jamais aléatoire.
- Aucune disparition silencieuse de contenu : les cards non tirées restent
  visibles normalement, le score et l'état de chaque question restent
  visibles en permanence pendant le quiz.
- Repli automatique documenté ci-dessus : jamais d'état d'erreur visible côté
  utilisateur.

## Hors périmètre de ce lot

Explicitement différé :

- Scoping du quiz sur une branche/sous-arbre précis (le lot 2 ne propose que
  la sélection par niveaux).
- Historique des scores entre sessions, badges/paliers débloquables,
  pondération façon répétition espacée (cards ratées plus souvent reposées) —
  ce lot reste volontairement simple : score + animation fixe, sans
  persistance ni progression cumulative.
- Import/export, configuration des couleurs/niveaux (lots 3 et 4).
