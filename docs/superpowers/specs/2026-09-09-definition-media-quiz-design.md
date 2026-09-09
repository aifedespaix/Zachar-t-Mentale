# Définition / Média et QCM adapté — Design

**Date** : 2026-09-09
**Statut** : Design — en attente de revue
**S'appuie sur** : la fiche de carte (`2026-09-09-fiche-de-carte-design.md`, PR #8,
déjà mergée sur `main`), la refonte quiz (`2026-09-07-refonte-quiz-design.md`),
le modèle `CardBlock` (`2026-09-08-contenus-riches-cartes-design.md`)

## Mission

Améliorer la génération des cartes mentales et le système de QCM pour
garantir un apprentissage bien organisé, en distinguant structurellement une
vraie **Définition** d'un **Média** (tableau, formule, exemple chiffré,
image), et en adaptant le QCM à cette distinction — dans les deux sens,
titre→contenu et contenu→titre.

## Investigation : ce qui existe déjà, ce qui manque

Avant de concevoir quoi que ce soit, vérification sur des cartes réellement
générées (`.cartes-mentales/math/pourcentages-v2.json`, 12 cartes) en
rejouant l'algorithme actuel (`src/state/quizReducer.ts`) et en comparant au
skill `transformer-cours-en-carte-mentale`.

**Déjà en place, à ne pas reconstruire :**

- Sens B (titre → contenu) existe : `qcm-definition`. Sens A (contenu →
  titre) existe : `qcm-title`, activé par le mode QCM.
- Le rendu riche des options de QCM existe déjà : une option `qcm-definition`
  dont le texte correspond au miroir d'une carte à `content` est déjà
  re-rendue via `BlockView` (`CardNode.tsx:917-928`) — une formule s'affiche
  déjà en fraction empilée dans le QCM, pas en `20/100`.
- Le bouton « fiche » (ex-`DescriptionButton`) existe déjà, ouvre la sidebar
  de lecture, ferme pendant un quiz — livré aujourd'hui même par PR #8.
- Le masquage du titre pendant une question en attente existe déjà
  (`displayMasked`).

**N'existe pas :**

- Aucune distinction structurelle « ceci est une vraie définition » vs
  « ceci est un tableau/une formule/un exemple ». Le quiz ne lit que le
  miroir texte (`card.definition`), quel que soit ce qu'il contient.
- Aucune convention `**mot-clé**`.
- Sens A tronque l'indice par difficulté (intégral/moitié/absent) — la
  mission demande l'affichage intégral.

**Deux problèmes trouvés sur données réelles, pas seulement théoriques :**

1. *Ambiguïté de titre* — `pourcentages-v2.json` contient deux cartes
   titrées « Avec calculatrice » dans deux branches différentes
   (« Appliquer un pourcentage » et « Calculer un pourcentage »), avec des
   définitions différentes mais toutes deux plausibles. En Sens B, le
   heading n'affiche que le titre nu, sans le thème parent — un élève qui
   maîtrise les deux méthodes n'a aucun moyen de savoir laquelle des deux
   définitions est comptée bonne. Le skill n'impose l'unicité qu'« entre
   sœurs », pas sur tout le fichier.
2. *Média déguisé en définition* — la carte niveau 4 « Exemple avec
   calculatrice » a pour `definition` : *« 20/100 x 425 = 85. Il y a 85
   élèves D.P. »* — un calcul, pas une définition. Question Sens A
   faisable mais teste la mémorisation d'un exemple arbitraire, pas la
   compréhension d'une méthode.

## A. Schéma — `Card.kind`

```ts
export type CardKind = 'definition' | 'media'   // absent = 'definition'

interface Card {
  ...
  /** Absent sur toute carte existante — rétro-compatible sans migration. */
  kind?: CardKind
  definition?: string   // miroir texte, inchangé — mécanique, jamais rédigé à la main pour une carte média
  content?: CardBlock[] // inchangé structurellement
}
```

Pas de nouveau champ `media` : `content` (blocs `table`/`math`/`image`/
`text`) porte déjà ce dont une carte média a besoin. `kind` ne fait que dire
au quiz *« ne traite pas le miroir texte de cette carte comme une vraie
définition »*.

**Validation** (`src/validation/cardsValidation.ts`) :

- `kind: 'media'` exige `content` avec au moins un bloc non-`text`. Une
  carte `media` entièrement textuelle n'a pas de raison d'être — c'est une
  définition mal classée.
- **Nouvelle règle, indépendante de `kind`** : unicité des titres sur
  l'ensemble du fichier, pas seulement entre sœurs — corrige le bug #1
  ci-dessus. Émise comme avertissement de validation (pas un blocage dur :
  une carte mentale existante avec des doublons doit continuer à s'ouvrir),
  et comme règle du skill de génération pour les nouveaux fichiers.

## B. Bouton de fiche — itération sur le lot « fiche de carte »

Le `DescriptionButton` actuel (`CardNode.tsx:137-217`, livré par PR #8)
affiche déjà un bouton qui ouvre la fiche, mais garde une ligne de texte en
aperçu + une rangée de pastilles de type. Décision de cette session : aller
plus loin, retirer tout aperçu textuel.

- **Position** : coin bas-droit, flottant sur la bordure (même famille
  visuelle que les badges déjà existants — verdict de quiz, boutons
  `+`/`→`), seul coin encore libre. L'émoji (`CardIconBadge`, haut-droit,
  inset) ne bouge pas : c'est l'identité de la carte, le badge fiche est une
  action qui révèle plus de contenu — même logique de placement que la
  ligne de badges en bas de carte dans Trello/Linear.
- **Couleur** : la couleur de niveau de la carte (`colors.border`, déjà
  calculée par `clampCardLevel`), pas une palette bleu/orange séparée.
- **Icône** : dépend de `kind` — `BookOpen` pour une définition ; pour une
  carte média, l'icône du premier bloc non-`text` trouvé dans `content`
  (`Table`, `Sigma`, `Image` — mapping déjà disponible dans
  `ContentKindBadges`, à réutiliser plutôt qu'à dupliquer).
- Retirer l'aperçu texte améliore en réalité la règle anti-décalage n°1 de
  la spec « contenus riches » (empreinte de la carte indépendante du
  contenu) : un badge de taille fixe dans un coin ne dépend d'aucune
  longueur de texte, contrairement à la ligne ellipsée actuelle.
- Reste désactivé si `locked`, disparaît pendant un quiz (`!quizActive`),
  inchangé.

## C. Génération des QCM (`quizReducer.ts`, `quiz.ts`, wiring `CardNode.tsx`)

**Routage**, remplace la logique actuelle (`card.definition ? 'qcm-definition' : 'recall'`) :

| `kind` | mode QCM off | mode QCM on |
|---|---|---|
| `definition` (ou absent), avec `definition` | `qcm-definition` (Sens B) | `qcm-title` (Sens A) |
| `definition` (ou absent), sans `definition` | `recall` | `recall` |
| `media` (implique toujours `content`) | `qcm-media` (Sens B) | `qcm-media-title` (Sens A) |

Une carte `media` n'a pas de repli `recall` : `content` non-`text` est
obligatoire par validation, donc il y a toujours matière à QCM.

**Sens A (`qcm-title` / `qcm-media-title`) — suppression de la troncature
graduée par difficulté :**

```
facile / moyen → indice affiché intégralement (définition ou média rendu)
difficile      → aucun indice textuel (position dans l'arbre seule) — inchangé
```

`buildHint` perd sa branche `moyen` tronquée. La difficulté continue d'agir
ailleurs (portée des distracteurs : branche → niveau → tout le fichier,
inchangé) — elle ne disparaît pas du quiz, elle arrête seulement de couper
l'indice au milieu d'une phrase.

Pour `qcm-media-title`, l'indice n'est plus une chaîne mais le rendu du
bloc média (`BlockView`) — `QcmDialog` doit accepter un indice riche
(`hintNode?: ReactNode`) en plus du `hint?: string` actuel, qui ne rend
aujourd'hui que du texte brut à côté de l'icône ampoule.

**Heading adapté par type dominant**, pour `qcm-media-title` seulement (le
générique « Quel est le titre de cette carte ? » ne dit pas quoi regarder) :
« À quel titre correspond ce tableau ? / cette formule ? / cette image ? »,
déterminé par le premier bloc non-`text` de `content`.

**Distracteurs média** : `buildDistractorPoolFrom` est déjà générique
(`pick: card => string | undefined`) — réutilisée telle quelle avec
`pick = c => c.kind === 'media' ? blocksToPlainText(contentOf(c)) : undefined`
pour l'identité/dédoublonnage, et le `renderOption` déjà branché sur
`qcm-definition` s'étend à `qcm-media` de la même manière (résoudre l'option
vers la carte source, rendre ses blocs).

**Aide « titre à trous »** (`blankPreview`, aujourd'hui réservée à
`recall`) : étendue à `qcm-title` et `qcm-media-title` pendant l'attente sur
le canevas. C'est l'aide visuelle systématique demandée dans la mission —
elle existe déjà pour `recall`, il s'agit de l'activer aussi pour les deux
variantes Sens A.

**Mots-clés `**stabilotés**`** : convention nouvelle, texte brut entre
double astérisques dans `definition`/les blocs `text`. Rendu coloré
uniquement dans la fiche (`BlockView`, panneau de détail) — jamais dans une
option de QCM, où tout s'affiche en texte plat (astérisques retirés, aucune
couleur). Confirmé : sinon une option à 3 mots-clés colorés à côté d'une
option à 0 devient un indice de forme involontaire, contraire à la règle
existante du skill (« les sœurs ne se distinguent pas par leur
emballage »).

## D. Skill `transformer-cours-en-carte-mentale`

Mise à jour de `SKILL.md`, section « schéma cible » et « écrire pour le
mode quiz » :

- `kind: 'definition' | 'media'` — critère de bascule : une carte est
  `media` quand son contenu n'énonce pas un fait/une règle mais un calcul
  déjà résolu, une formule, un tableau, ou une illustration (le cas
  « Exemple avec calculatrice » de l'investigation devient l'exemple
  canonique de carte `media`).
- Formules physique/chimie (`\\ce{}`, `\\pu{}`) et tableaux : déjà couverts
  par les règles existantes du skill pour les blocs `math`/`table` — la
  seule nouveauté est de les faire porter `kind: 'media'` plutôt que de
  forcer une phrase de définition autour.
- Convention `**mot-clé**` dans le texte des définitions.
- Règle d'unicité de titre étendue à tout le fichier (pas seulement les
  sœurs).
- Table des types de questions mise à jour (5 lignes au lieu de 3 :
  `qcm-definition`, `qcm-title`, `recall`, `qcm-media`, `qcm-media-title`),
  avec la contrainte d'écriture propre à chacune.

**Hors périmètre pour ce lot** : schémas SVT en JSON (coupe de sol,
cellule, chaîne alimentaire...). Pas de type de bloc `schema` aujourd'hui,
et en construire un (positions, légendes, connecteurs, rendu SVG, export
PDF/XMind) est un sous-projet à part entière. Pour l'instant, le skill
route une légende/schéma SVT vers le bloc `table` existant (numéro / nom /
rôle) — moins fidèle visuellement, mais dans le périmètre déjà solide du
modèle actuel. Un vrai bloc `schema` reste un lot futur, à brainstormer
séparément si le besoin se confirme à l'usage.

## E. Tests

- `quizReducer.test.ts` : routage par `kind` (les 4 branches du tableau
  ci-dessus), absence de troncature Sens A, pool de distracteurs média,
  heading adapté par type de bloc dominant.
- `cardsValidation.test.ts` : `kind: 'media'` sans bloc non-`text` rejeté,
  avertissement sur titre dupliqué dans tout le fichier.
- `QcmDialog.test.tsx` : `hintNode` riche rendu correctement, options en
  texte plat même quand la définition source contient `**mots-clés**`.
- `CardNode.test.tsx` : badge bas-droit (position, couleur de niveau, icône
  par `kind`/type de bloc), `blankPreview` actif sur `qcm-title`/
  `qcm-media-title` en plus de `recall`.
- `BlockView`/rendu de fiche : `**mot-clé**` → span coloré, astérisques
  jamais visibles à l'écran.

## Risques

| Risque | Traitement |
|---|---|
| Cartes existantes sans `kind` mal interprétées | `kind` absent = `'definition'`, comportement identique à aujourd'hui — aucune migration nécessaire |
| Cartes mentales déjà générées avec des titres dupliqués (bug #1) | Avertissement de validation, pas un blocage — la carte s'ouvre et se joue quand même, juste avec un signalement |
| `hintNode` riche fait diverger `QcmDialog` de son usage actuel (texte seul) | Rendu par le même `BlockView`/`resolveAsset` déjà partagé avec la fiche et le PDF — pas de nouveau moteur de rendu, juste un second point d'entrée |
| Le skill oublie de router un contenu clairement média vers `kind: 'media'` | La règle de bascule (calcul résolu / formule / tableau / illustration vs fait énoncé) est testable mentalement, comme les règles existantes du skill pour titre/définition |
