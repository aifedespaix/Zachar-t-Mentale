# Refonte du mode quiz — Design

**Date** : 2026-09-07
**Statut** : Brainstormé et validé en chat (texte + maquettes visuelles), prêt pour plan d'implémentation
**Fait suite à** : [2026-09-06-mode-quiz-design.md](2026-09-06-mode-quiz-design.md) (lot 2, déjà implémenté) — ce document amende et étend ce lot, il ne le remplace pas entièrement.

## Contexte

Le mode quiz du lot 2 est en place et utilisé, mais l'usage réel a révélé un
bug bloquant et plusieurs limites de conception :

- **Bug bloquant** : cliquer sur un titre masqué pendant le quiz ne fait
  rien — impossible de répondre par ce chemin. La révélation ne passe que par
  une petite icône dans le pied de card, peu découvrable.
- La modale de configuration est fonctionnelle mais visuellement pauvre
  (checkboxes texte, aucune explication de ce que fait chaque difficulté).
- Le mode QCM actuel ne s'applique qu'aux définitions, tiré au hasard selon
  la difficulté — pas de contrôle explicite, et jamais de QCM sur les titres.
- L'affichage de la définition d'une card (hors quiz) ne fonctionne pas
  correctement, agrandit la card, et n'est pas visuellement distinct du titre.
- L'animation de "retournement" fait pivoter le contenu à 180° sur lui-même,
  ce qui produit du texte visible à l'envers en miroir — perçu comme un bug.

Ce document couvre la refonte de ces cinq points, en s'appuyant sur des
maquettes visuelles validées interactivement avec l'utilisateur (sélecteur de
niveaux, cartes de difficulté, modale QCM en 3 directions concurrentes,
affichage de la définition en 2 directions concurrentes).

## Résumé des changements

1. Nouvelle règle déterministe de choix du type de question par card
   (au lieu d'un tirage aléatoire pondéré par la difficulté).
2. Nouveaux ratios de difficulté (20/50/75% au lieu de 30/60/100%), qui
   pilotent aussi le niveau d'indice affiché en QCM-titre.
3. Modale de configuration redessinée : niveaux en boutons carrés colorés,
   difficulté en cartes avec icônes, mode QCM en carte togglable.
4. Nouvelle page **Paramètres**, séparée et persistée sur disque : seuil de
   tolérance aux fautes de frappe (défaut 100%, strict) et guide de longueur
   façon pendu (activé par défaut).
5. Réponse tapée avec correction automatique floue (similarité en %).
6. Correction de l'animation de retournement (carte à deux faces).
7. Modale QCM entièrement redessinée (direction "Grille Carnet"), gérant les
   deux types de question avec indices progressifs par difficulté.
8. Affichage de la définition hors quiz : popover ancré à la card, qui ne la
   redimensionne jamais.

## 1. Bug corrigé : interaction sur le titre masqué

**Cause actuelle** : `handleTitleFocus` (dans `CardNode`) fait un `blur()`
immédiat dès que le champ masqué reçoit le focus, pour empêcher de voir le
vrai titre via le DOM. Résultat : impossible d'entrer en édition tant que la
card est masquée, et rien d'autre ne propose de saisir une réponse — seule la
petite icône flip du pied de card permet de révéler.

**Correction** : un clic sur un titre masqué (question de type `recall`,
donc uniquement les cards **sans définition** — voir section 2) doit ouvrir
la saisie normalement : le champ devient éditable, l'utilisateur tape sa
réponse, et la validation se fait à la touche Entrée ou au blur (voir
section 6 pour la correction automatique). Le flux d'auto-évaluation actuel
(flip manuel puis boutons ✓/✗) disparaît pour ce type de question : la
correction est désormais automatique.

## 2. Modèle de question — nouvelle règle déterministe

Remplace le tirage aléatoire actuel (`qcmRatio` par difficulté). Chaque card
tirée reçoit un type de question déterminé uniquement par (a) la présence
d'une définition et (b) le mode QCM :

| | Sans définition | Avec définition |
|---|---|---|
| **Mode normal** (QCM décoché) | `recall` — titre à taper, correction auto | `qcm-definition` — titre affiché, définition à deviner parmi 4 choix (comportement actuel inchangé) |
| **Mode QCM** (coché) | `qcm-title` — titre à deviner parmi 4 choix, sans indice texte (contexte du graphe uniquement) | `qcm-title` — titre à deviner parmi 4 choix, avec la définition comme **indice progressif selon la difficulté** (section 3) |

Le mode QCM est donc un bascule globale "teste les titres en QCM" : il ne
change jamais le traitement des cards sans définition qui, de toute façon, ne
peuvent être testées que sur leur titre — mais il fait basculer les cards
**avec** définition de "deviner la définition" à "deviner le titre en
s'aidant de la définition".

**Repli automatique** (inchangé dans l'esprit du lot 2) : si le pool de
distracteurs (titres ou définitions selon le cas) est vide ou insuffisant,
la question dégrade silencieusement vers `recall` (titre tapé). Jamais
d'état d'erreur visible.

## 3. Difficulté — nouveaux ratios, double rôle

```ts
const DIFFICULTY_SETTINGS: Record<QuizDifficulty, { sampleRatio: number }> = {
  facile: { sampleRatio: 0.2 },
  moyen: { sampleRatio: 0.5 },
  difficile: { sampleRatio: 0.75 },
}
```

`qcmRatio` disparaît (le mode QCM est désormais un choix explicite, plus une
probabilité). Le tirage stratifié par niveau reste inchangé dans son
mécanisme (au moins 1 card par niveau non-vide, cf. commentaire existant dans
`quizReducer.ts`).

La difficulté garde un **second rôle**, réutilisé pour les questions
`qcm-title` uniquement :

| | Indice affiché (si la card a une définition) | Scope des distracteurs |
|---|---|---|
| Facile | Définition complète | Toute la carte |
| Moyen | Définition tronquée (~50% des caractères, coupée au mot le plus proche, `…`) | Même niveau |
| Difficile | Aucun indice texte — note statique "Aide-toi de la position de la carte dans l'arbre" | Branche (parent direct) en priorité, élargie si besoin (branche → niveau → carte, comme aujourd'hui pour `qcm-definition`) |

Une card `qcm-title` **sans définition** n'a jamais d'indice texte, quelle
que soit la difficulté (rien à tronquer) — elle retombe directement sur la
note de contexte de graphe.

Le scope de distracteurs par difficulté (branche/niveau/carte) déjà
implémenté dans `buildDistractorPool` pour les définitions est réutilisé à
l'identique pour piocher des **titres** distracteurs.

## 4. Modale de configuration — redesign

Composition validée (maquette `config-modal-v2.html`) :

- **Niveaux inclus** : 4 boutons carrés de taille identique, disposés en
  ligne. Chaque bouton EST le carré coloré (couleur `border` du niveau en
  fond plein, texte de contraste choisi via les utilitaires existants de
  `contrast.ts` plutôt que codé en dur), avec le nom du niveau centré dedans
  ("Titre", "Sous-titre", "Sous-partie", "Info"). État désactivé (niveau
  décoché) : fond gris neutre, texte gris clair. Pas de swatch séparé à
  l'intérieur du bouton — le bouton entier porte la couleur.
- **Difficulté** : 3 cartes colorées de largeur égale, alignées
  horizontalement, style cohérent avec les cards de l'app (coins arrondis,
  bordure 2px) : vert (Facile), orange (Moyen), rouge (Difficile). Chacune
  porte une icône Lucide (`Sprout` / `Zap` / `Flame`), le nom du niveau, et
  sa description ("Cache 20% des cartes", "Cache 50% des cartes", "Cache 75%
  des cartes").
- **Mode QCM** : une carte togglable unique (même langage visuel que les
  cartes de difficulté — icône, titre, description — toute la surface est
  cliquable), avec un vrai composant `Switch` shadcn (basé sur le primitif
  `Switch` de `radix-ui`, déjà une dépendance du projet, à ajouter dans
  `src/components/ui/` aux côtés de `button.tsx`/`dialog.tsx`) affichant
  l'état actif/inactif.

## 5. Nouvelle page Paramètres (persistante)

Contrairement aux niveaux/difficulté/QCM (choisis à chaque lancement de
quiz), le seuil de tolérance et le guide de longueur sont des préférences
d'apprentissage stables. Ils vivent dans un écran séparé, accessible via une
icône ⚙️ dans l'en-tête de l'application (à côté du bouton Quiz existant),
**jamais affichée dans le flux de lancement d'un quiz**.

**Persistance** : nouveau module `src/persistence/quizSettings.ts`, sur le
modèle exact de `workspaceConfig.ts` existant (fichier JSON dans
`appConfigDir()`, ici `quiz-settings.json`) :

```ts
export interface QuizSettings {
  similarityThreshold: number   // 0-100, défaut 100
  lengthGuideEnabled: boolean   // défaut true
}
```

Un nouveau store `useQuizSettingsStore` (zustand) charge ces réglages au
démarrage et les persiste à chaque changement, sur le modèle de
`useWorkspaceStore`.

**Contenu de la page** (maquette `settings-page.html`) :

- **Précision exigée pour "correct"** : curseur 50%–100%, valeur affichée en
  grand, avec un exemple dynamique ("photosynthès" ≈ 92%) illustrant l'effet
  du seuil. Défaut 100% (exact) — voulu ainsi car une réponse presque bonne
  n'est pas toujours acceptable pédagogiquement (ex. une identité
  remarquable où le signe +/- change tout).
- **Guide de longueur** : toggle (composant `Switch`, même que section 4),
  avec un aperçu visuel du rendu "pendu" en dessous (section 7).

## 6. Réponse tapée + correction automatique floue

S'applique uniquement aux questions `recall` (titre tapé). Au moment de la
validation (Entrée ou blur du champ) :

1. **Normalisation** des deux chaînes (réponse tapée et vrai titre) :
   minuscules, suppression des accents/diacritiques (normalisation Unicode
   NFD + retrait des marques combinantes), espaces de bord retirés.
2. **Similarité** calculée par distance de Levenshtein normalisée en
   pourcentage : `(1 - distance / longueur_max) × 100`.
3. **Verdict binaire inchangé** : `correct` si similarité ≥
   `similarityThreshold` (Paramètres, défaut 100%), sinon `incorrect` — le
   score global (`computeScore`) ne change pas de forme.
4. **Feedback visuel enrichi** : si la similarité n'est pas 100%, un badge
   affiche le pourcentage exact, coloré sur un dégradé vert (proche de 100%)
   → orange → rouge (proche de 0%), à côté du vrai titre révélé et de la
   réponse tapée par l'utilisateur (barrée si incorrecte). Ce badge est un
   affichage seul ; il ne modifie jamais le score binaire.

## 7. Guide de longueur (façon pendu)

Actif par défaut (Paramètres). Pour toute question `recall` :

- Le champ de saisie a un `maxLength` égal à la longueur exacte du vrai
  titre — impossible de taper plus long que la réponse.
- Un guide visuel est affiché au-dessus du champ, reproduisant le titre sous
  forme de tirets : **seuls les caractères lettre/chiffre sont masqués**
  (`\p{L}` / `\p{N}` Unicode) ; espaces, ponctuation et symboles (parenthèses,
  `+`, `−`, `=`, exposants comme `²`) restent visibles tels quels — convention
  classique du jeu du pendu. Ceci permet de distinguer visuellement `(A+B)²`
  de `(A-B)²` avant même de taper, ce qui a été explicitement validé comme
  souhaitable pour l'apprentissage des identités remarquables en
  mathématiques.
- Le guide est un simple gabarit visuel statique (pas des cases de saisie
  individuelles) : l'utilisateur continue de taper dans un unique champ
  texte, positionné sous ou aligné avec le gabarit.

## 8. Animation de retournement corrigée

**Bug actuel** : `CardNode` anime `rotateY` de 0 à 180° sur le **même**
contenu (pas de face arrière distincte). Passé 90°, le même texte reste
affiché mais inversé en miroir — lu comme un bug par l'utilisateur, pas
comme un effet de carte à jouer.

**Correction** : introduction d'un motif "carte à deux faces" réutilisable
(face avant / face arrière empilées, `backface-visibility: hidden`,
`transform-style: preserve-3d`), qui remplace l'animation actuelle dans les
deux contextes où elle est utilisée, sans changer leur déclenchement :

- **Bouton "Retourner" générique** (hors quiz, inchangé dans son
  comportement de bascule libre) : face avant = contenu actuel de la card,
  face arrière = plaque décorative unie reprenant la couleur du niveau (pas
  de contenu fonctionnel, purement esthétique — comme le dos d'une carte à
  jouer).
- **Révélation de quiz** (question `recall`) : face avant = champ masqué
  puis en saisie, face arrière = résultat gradé (titre réel, bordure
  colorée, badge de similarité si non-exact — section 6). Le flip se
  déclenche une seule fois, au moment où la correction automatique produit
  un résultat, et la card reste sur sa face arrière (l'état gradé) jusqu'à
  la fin du quiz — il ne s'agit plus d'une bascule libre comme le bouton
  générique.

## 9. Modale QCM — redesign (direction "Grille Carnet")

Direction retenue parmi 3 maquettes concurrentes (`qcm-comparison.html`,
directions A "Steady Signals", B "Le Jardin des Progrès", C "Grille
Carnet") : **C, Grille Carnet**.

Caractéristiques à reprendre dans l'implémentation :

- Fine bande dégradée en en-tête, reprenant les 4 couleurs de niveau de
  l'app — purement décorative, ancre le contexte visuel du mind-map.
- Chaque option de réponse est une fiche numérotée par un badge lettre
  (A/B/C/D) dans un badge carré à coins arrondis — **jamais la couleur
  seule** pour indiquer un état : le badge, l'icône et le texte portent
  toujours l'information en double.
- Grille 2×2 pour les 4 options, espacement généreux, cibles de clic larges.
- État "bonne réponse" : bordure + fond vert, badge rempli vert avec icône
  coche, texte explicite "Bonne réponse" en plus de la couleur. Les autres
  options passent à 55% d'opacité (pas de rouge flash sur un mauvais choix
  non sélectionné).
- **Bloc `qcm-definition`** (titre affiché, définitions en options) :
  comportement identique à l'existant, redessiné dans ce style.
- **Bloc `qcm-title`** (titre à deviner) : encart d'indice en pointillés
  au-dessus de la grille d'options, dont le contenu dépend de la difficulté
  (section 3) — icône ampoule pour un indice texte (complet ou tronqué),
  icône nœuds/arbre pour le cas "aucun indice, contexte du graphe".
- Aucune animation brusque ni clignotement — transitions discrètes,
  cohérent avec le principe TSA déjà acquis pour le reste de l'app.

## 10. Affichage de la définition hors quiz — popover ancré

Remplace l'actuel toggle inline (`definitionShown` + `<p>` sous le titre),
qui ne fonctionne pas de façon fiable, redimensionne la card, et ne sépare
pas visuellement titre et définition.

**Design retenu** (option 2 de `definition-display.html`) : popover ancré à
la card, positionné pour ne pas se faire chevaucher par une card voisine
quand c'est possible, refermé au clic à l'extérieur. La card elle-même ne
change **jamais** de taille, quelle que soit la longueur de la définition —
seul le popover, positionné en overlay, porte le texte.

Le popover reprend un bandeau/kicker "Définition" (cohérent avec le style
retenu section 9) suivi du texte, en typographie soignée et bien séparée du
titre de la card. L'édition existante (clic sur le texte → `editingDefinition`
→ `commitDefinition`/`cancelDefinition`) reste accessible en cliquant le
texte du popover — mécanique déjà en place, seul le conteneur change.

## Modèle de données récapitulatif

```ts
export type QuizDifficulty = 'facile' | 'moyen' | 'difficile'

export interface QuizConfig {
  levels: CardLevel[]
  difficulty: QuizDifficulty
  qcmMode: boolean               // nouveau
}

export type QuizQuestionType = 'recall' | 'qcm-definition' | 'qcm-title'  // 'qcm' renommé/scindé

export interface QuizQuestion {
  cardId: string
  type: QuizQuestionType
  distractorDefinitions?: string[]  // qcm-definition uniquement
  distractorTitles?: string[]       // qcm-title uniquement
  hint?: string                     // qcm-title uniquement ; absent = contexte du graphe seul
}

export interface QuizSettings {
  similarityThreshold: number   // 0-100, défaut 100
  lengthGuideEnabled: boolean   // défaut true
}
```

`QuizResult` (`'unanswered' | 'correct' | 'incorrect'`) et `computeScore`
sont inchangés — le pourcentage de similarité est un affichage transitoire
côté `CardNode`, jamais persisté dans le store de quiz.

## Accessibilité & principes TSA

Étend les principes déjà actés dans le lot 2 :

- Aucune information portée par la couleur seule, nulle part dans les
  nouveaux écrans (badges lettre, icônes, texte explicite systématiques).
- Aucune animation rapide, clignotante ou surprenante — le flip corrigé
  (section 8) et les micro-transitions de la modale QCM (section 9) sont
  volontairement discrets.
- Toujours prévisible : le guide de longueur (section 7) donne une
  information fiable et stable sur ce qui est attendu, jamais approximative.
- Pas de pression temporelle, cohérent avec l'existant.

## Hors périmètre

Explicitement écarté après discussion :

- **Mots-clés stockés dans le modèle de card** pour enrichir les indices de
  QCM-titre : jugé disproportionné (champ de donnée supplémentaire à
  maintenir, pas d'extraction automatique fiable sans LLM) au regard du
  gain — la troncature déterministe de la définition (section 3) couvre le
  besoin.
- **Score partiel réel** (au lieu du seuil binaire) : le pourcentage de
  similarité reste un affichage, le score final garde sa forme actuelle
  (`correct`/`incorrect`/`unanswered`).
- **Cases de saisie par caractère** (façon pendu interactif) : le guide de
  longueur reste un gabarit visuel au-dessus d'un champ texte unique, pas un
  composant de saisie caractère par caractère.
- Tout ce qui était déjà hors périmètre du lot 2 (historique de scores
  inter-sessions, badges/paliers, répétition espacée, scoping par
  branche/sous-arbre) le reste.
