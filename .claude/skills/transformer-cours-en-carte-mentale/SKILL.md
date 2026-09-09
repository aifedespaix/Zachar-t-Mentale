---
name: transformer-cours-en-carte-mentale
description: Use when converting a course PDF (or any raw course material — worksheet, fill-in-the-blank sheet, existing but poorly-structured mind map) into a mind map file for the Zachar't Mentale app — producing Card JSON data, not application code.
---

# Transformer un cours en carte mentale

## Vue d'ensemble

Convertit un support de cours brut (PDF, fiche à trous, carte mentale existante
mal structurée) en un fichier `Card[]` JSON conforme au schéma de l'app
(`src/types/card.ts`). **Le schéma de l'app est l'unique source de vérité
structurelle** — jamais la mise en page ou la hiérarchie visuelle du document
source, même s'il s'agit déjà d'une carte mentale (XMind, etc.) donnée en
référence.

## Le schéma cible

```ts
type CardLevel = 1 | 2 | 3 | 4
type CardKind = 'definition' | 'media'   // absent = 'definition'
interface Card {
  id: string
  level: CardLevel        // 1=Titre principal 2=Sous-titre 3=Sous-partie 4=Info
  title: string
  kind?: CardKind          // 'media' pour un tableau/formule/exemple chiffré qui N'EST PAS une vraie définition
  definition?: string      // texte brut ; miroir DÉRIVÉ dès que `content` existe — reste obligatoire même pour une carte média, mais mécaniquement, jamais rédigé à la main
  content?: CardBlock[]    // optionnel pour une définition, obligatoire (≥ 1 bloc non-text) pour un média
  parentId: string | null  // null uniquement pour la racine
  order: number             // position parmi les frères/sœurs
}

type CardBlock =
  | { kind: 'text';  text: string }
  | { kind: 'math';  latex: string; display?: boolean }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'image'; asset: string; alt: string; width: number; height: number }
```

- Un fichier = une racine unique = un chapitre. Arbre strict, un seul parent
  par card. Si un chapitre est trop gros, le découper en plusieurs fichiers.
- Sortie : JSON array de `Card`, `JSON.stringify(cards, null, 2)`, un fichier
  par chapitre (voir `src/persistence/serialization.ts`).
- Extension : `.zmap` — c'est celle que l'installeur associe à l'app, donc la
  carte s'ouvre d'un double-clic depuis l'explorateur. Le contenu reste du JSON.
  Les anciens `.json` continuent de s'ouvrir, mais rien de neuf n'en écrit.

## Définition ou média : la carte est l'un OU l'autre

Une carte est `kind: 'media'` quand son contenu n'énonce pas un fait ou une
règle mais un calcul déjà résolu, une formule, un tableau, ou une
illustration — pas de phrase de définition à rédiger autour, la projection
texte de `content` suffit et se calcule mécaniquement (voir ci-dessus).
Sinon, elle est une définition (`kind` absent).

Test à faire mentalement sur chaque card : *si je devais expliquer cette
carte à quelqu'un, est-ce que je dirais « ça définit X » ou « ça montre
comment calculer/représenter X » ?* Le premier cas est `definition`, le
second `media`.

```json
// MÉDIA — un calcul déjà résolu, pas une définition
{
  "id": "ex-avec-calculatrice", "level": 4, "title": "Exemple avec calculatrice",
  "kind": "media",
  "parentId": "avec-calculatrice", "order": 0,
  "content": [
    { "kind": "math", "latex": "\\frac{20}{100} \\times 425 = 85" },
    { "kind": "text", "text": "Il y a 85 élèves demi-pensionnaires." }
  ],
  "definition": "20/100 × 425 = 85\nIl y a 85 élèves demi-pensionnaires."
}

// DÉFINITION — énonce une règle, même avec une formule dedans
{
  "id": "signes-contraires", "level": 3, "title": "Signes contraires",
  "parentId": "…", "order": 0,
  "content": [
    { "kind": "text", "text": "On garde le signe du nombre le plus éloigné de zéro, puis on soustrait les distances à zéro." },
    { "kind": "math", "latex": "(+10) + (-4) = +(10-4) = +6" }
  ],
  "definition": "On garde le signe du nombre le plus éloigné de zéro, puis on soustrait les distances à zéro.\n(+10) + (-4) = +6"
}
```

Formules physique/chimie (`\\ce{}`, `\\pu{}`) et tableaux suivent exactement
les mêmes règles de bloc que déjà décrites plus bas — la seule différence est
de leur donner `kind: 'media'` plutôt que de forcer une phrase de définition
autour quand il n'y en a pas de naturelle.

**Hors périmètre** : les schémas labellisés (coupe de sol, cellule, chaîne
alimentaire...) n'ont pas de type de bloc dédié aujourd'hui. Route une
légende/schéma SVT vers un bloc `table` (numéro / nom / rôle) plutôt que de
l'omettre — moins fidèle visuellement, mais dans le périmètre du modèle
actuel.

## Écrire les maths en blocs, pas en texte

Une formule tapée dans `definition` s'affiche telle quelle : `20/100 x 425`,
`x/10`, un `x` qui sert à la fois de multiplication et de variable. Une
formule en bloc `math` s'affiche comme dans le cours — fraction empilée,
exposant, racine.

**Règle : dès qu'une définition contient une expression mathématique, elle
passe en `content`**, en découpant règle et formule en deux blocs :

```json
{
  "id": "…", "level": 3, "title": "Signes contraires",
  "parentId": "…", "order": 0,
  "content": [
    { "kind": "text", "text": "On garde le signe du nombre le plus éloigné de zéro, puis on soustrait les distances à zéro." },
    { "kind": "math", "latex": "(+10) + (-4) = +(10-4) = +6" }
  ],
  "definition": "On garde le signe du nombre le plus éloigné de zéro, puis on soustrait les distances à zéro.\n(+10) + (-4) = +(10-4) = +6"
}
```

- **`definition` reste obligatoire** quand `content` existe : c'est le miroir
  texte que lisent le quiz, l'export XMind et la réparation. Il vaut la
  projection des blocs — texte tel quel, formule en unicode approché
  (`\\frac{a}{b}` → `a/b`, `^2` → `²`, `\\times` → `×`, `\\sqrt{x}` → `√x`).
  En cas de doute, écrire la version lisible : jamais un champ vide.
- **N'utilise `content` que si un bloc n'est pas du texte.** Une définition
  entièrement textuelle s'écrit en `definition` seule, sans `content` — c'est
  ce que fait l'app, et un `content` inutile crée du bruit dans le fichier.
- **Échappement JSON** : la sortie est du JSON, donc une commande LaTeX y
  porte DEUX barres obliques inverses. `\\frac{20}{100}` dans le fichier est
  le `\frac{20}{100}` que lit KaTeX. C'est l'erreur la plus facile à faire.
- **LaTeX utile au collège**, tel qu'écrit DANS le JSON : `\\frac{a}{b}`,
  `x^2`, `\\sqrt{2}`, `\\times`, `\\div`, `\\leq`, `\\geq`,
  `\\pi`. Chimie et physique passent par la même extension :
  `\\ce{2H2 + O2 -> 2H2O}`, `\\pu{9.81 m/s^2}`.
- **Un tableau** (conjugaison, vocabulaire, dates, unités) est un bloc
  `table`, pas des lignes de texte séparées par des tirets.
- **Pas de bloc `image`** : l'asset doit exister dans le dossier `.assets`
  de la carte, ce qu'une génération de texte ne peut pas produire.

## Processus

1. **Racine (niveau 1)** — titre du chapitre.
2. **Niveau 2** — grands thèmes du chapitre (3 à 7 en général).
3. **Niveau 3** — règles ou cas particuliers d'un thème.
4. **Niveau 4** — formule précise, piège, ou exemple déjà résolu dans le
   cours. Ne pas créer de niveau 4 quand le niveau 3 n'a rien à détailler
   en dessous : sa `definition` suffit.
5. **Reconstituer le contenu à trous** des fiches "élève" avec la bonne
   réponse mathématique/factuelle complète — un pointillé recopié n'apprend
   rien.
6. **Exclure les exercices d'application** (énoncés à résoudre par
   l'élève) : ce n'est pas un fait de cours à structurer. Ne garder que les
   exemples déjà résolus/corrigés dans le support de cours, en `definition`
   de niveau 4.
7. **Écrire pour le quiz** — voir la section dédiée ci-dessous. C'est la
   contrainte la plus facile à rater et celle qui casse le plus le mode
   révision.
8. **Valider avant de livrer** : une seule racine, tout `parentId` référence
   un `id` existant du même fichier, aucun niveau hors 1-4.

## Exemple (chapitre "Nombres relatifs")

Thème niveau 2 "Addition" → niveau 3 "Signes contraires" → niveau 4
"Exemple". La règle est du texte, le calcul est un bloc `math` :

```json
{
  "id": "ex-signes-contraires", "level": 4, "title": "Exemple",
  "parentId": "signes-contraires", "order": 0,
  "content": [{ "kind": "math", "latex": "(+10) + (-4) = +(10-4) = +6" }],
  "definition": "(+10) + (-4) = +(10-4) = +6"
}
```

Et un cas où le bloc change vraiment l'affichage — une fraction, illisible
en ligne et empilée une fois rendue :

```json
{
  "id": "ex-avec-calculatrice", "level": 4, "title": "Exemple avec calculatrice",
  "parentId": "avec-calculatrice", "order": 0,
  "content": [
    { "kind": "math", "latex": "\\frac{20}{100} \\times 425 = 85" },
    { "kind": "text", "text": "Il y a 85 élèves demi-pensionnaires." }
  ],
  "definition": "20/100 × 425 = 85\nIl y a 85 élèves demi-pensionnaires."
}
```

Son frère niveau 3 "Même signe" reçoit une `definition` de longueur et de
registre comparables, pas deux fois plus courte — sinon un QCM les
distinguerait trivialement.

## Écrire pour le mode quiz

Chaque card devient une question. Une carte mentale bien structurée mais
écrite sans y penser produit un quiz incohérent — c'est la principale cause
de quiz inutilisables, et ça ne se voit qu'à l'usage.

L'app pose cinq types de questions, et chacune impose une contrainte
différente sur ce qui est écrit :

| Question | Ce que l'app montre | Ce que l'utilisateur fournit | Déclenchée quand |
|---|---|---|---|
| `qcm-definition` | le `title` de la card | il choisit la bonne `definition` parmi 4 | `kind` absent/`definition`, la card a une `definition` |
| `recall` | le `title` en texte à trous | il écrit le titre lettre par lettre | `kind` absent/`definition`, la card n'a PAS de `definition` |
| `qcm-title` | la `definition` en entier (comme indice) | il choisit le bon `title` parmi 4 | `kind` absent/`definition`, mode QCM activé |
| `qcm-media` | le `title` de la card | il choisit le bon média (tableau/formule/image) parmi 4 | `kind: 'media'` |
| `qcm-media-title` | le média en entier (comme indice) | il choisit le bon `title` parmi 4 | `kind: 'media'`, mode QCM activé |

### 1. Titre et définition doivent se déterminer l'un l'autre

C'est la règle centrale, et elle vaut dans les DEUX SENS, parce que le quiz
pose la question dans les deux sens :

- **Du titre vers la définition** (`qcm-definition`) : en lisant le titre
  seul, la bonne définition doit être identifiable parmi celles de ses sœurs.
- **De la définition vers le titre** (`qcm-title`) : en lisant la définition
  seule, le titre doit être retrouvable.

Une définition qui ne dit pas de QUOI elle parle casse le second sens :

```json
// MAUVAIS — la définition marche pour n'importe quelle opération
{ "title": "Addition de fractions", "definition": "On applique la règle vue plus haut." }

// BON — la définition contient ce qui la rattache à son titre
{ "title": "Addition de fractions", "definition": "Mettre au même dénominateur, puis additionner les numérateurs en gardant le dénominateur commun." }
```

Test à faire mentalement sur chaque card : **si je masque le titre, la
définition suffit-elle à le retrouver ? Si je masque la définition, le titre
suffit-il à la reconnaître parmi ses sœurs ?** Si l'une des deux réponses est
non, réécrire.

### 2. Marquer les mots-clés d'une définition

Dans le texte d'une `definition` (ou d'un bloc `text`), encadrer les mots ou
groupes de mots essentiels avec des doubles astérisques : `**mot-clé**`.
L'application les affiche en couleur dans la fiche de lecture — jamais dans
le quiz, où toute option s'affiche en texte plat, y compris pour cette
carte-là si elle sert de distracteur ailleurs.

```json
// BON — les mots qui portent le sens sont marqués, la phrase reste lisible sans eux
{ "title": "Addition de fractions", "definition": "**Mettre au même dénominateur**, puis additionner les numérateurs en gardant le dénominateur commun." }
```

Ne pas marquer une phrase entière ni un mot sur deux — deux ou trois termes
par définition, ceux qu'un élève chercherait à retenir en premier.

### 3. Les sœurs doivent être distinguables — mais pas trivialement

Les distracteurs d'un QCM sont pris parmi les cards sœurs (même parent, sinon
même niveau, sinon tout le fichier). D'où deux échecs symétriques :

- **Trop proches** : deux sœurs dont les définitions ne diffèrent que par un
  mot que le titre ne laisse pas deviner → la bonne réponse est indevinable.
- **Trop lointaines** : une définition deux fois plus longue, ou seule à
  citer un exemple chiffré, se repère par sa FORME sans lire son contenu →
  question gratuite.

Viser des sœurs de longueur et de registre comparables, qui se distinguent
par leur CONTENU (la règle énoncée) et pas par leur emballage.

Corollaire pour les maths : deux formules dont la projection texte est
identique fusionnent en une seule option de QCM — c'est correct mais ça
réduit le nombre de distracteurs. Varier les formulations entre sœurs.

**Le titre lui-même doit être unique sur TOUT le fichier, pas seulement
entre sœurs.** Deux cartes de branches différentes partageant un titre (ex.
« Avec calculatrice » sous deux thèmes distincts) rendent le QCM titre→
définition réellement ambigu : la question n'affiche que le titre nu, sans
le thème parent, donc rien ne dit laquelle des deux définitions est la
bonne — un élève qui connaît les deux méthodes n'a aucun moyen de choisir.
Si deux cartes décrivent la même méthode sous deux thèmes, différencier
leurs titres (« Avec calculatrice, en appliquant » / « Avec calculatrice, en
calculant ») plutôt que les laisser identiques.

### 4. Un titre sans définition sera écrit à la main

Une card sans `definition` devient une question `recall` : l'app affiche le
titre en texte à trous (`P____s______e`) et l'utilisateur tape les lettres
manquantes. La difficulté choisie décide du nombre de lettres offertes au
départ (moitié en facile, un quart en moyen, la première lettre seule en
difficile), et chaque essai raté en offre une de plus.

Un titre destiné à être tapé doit donc être :

- **court et unique** — « Théorème de Pythagore », pas « Le théorème de
  Pythagore et ses applications au calcul de longueurs » ;
- **sans ponctuation décorative** — les parenthèses, guillemets et tirets
  sont affichés en clair (ce sont des repères, pas des lettres à trouver),
  donc un titre qui en abuse offre sa structure gratuitement ;
- **écrit tel qu'on l'écrirait de mémoire** — pas d'abréviation improvisée ni
  de numérotation (« 3.2 Addition »), qui rendent la saisie devinette.

Si un titre ne peut pas être court, donner une `definition` à la card : elle
bascule alors en QCM, où la longueur du titre n'est plus un problème.

### 5. Rédiger l'indice de `qcm-title` via la définition

En mode QCM, la `definition` (ou le média) sert d'indice pour retrouver le
titre : affichée intégralement en facile et en moyen, absente en difficile
(il ne reste que la position dans l'arbre). Elle n'est plus jamais coupée en
plein milieu — écrire l'information qui rattache la définition à son titre
n'importe où dans le texte, pas seulement au début, reste malgré tout une
bonne pratique : une définition lisible d'un coup d'œil sert mieux l'élève
qu'une définition optimisée pour une troncature qui n'existe plus.

Ce que ça impose :

- **Ne jamais écrire le titre mot pour mot dans la définition** : l'indice
  donnerait la réponse. Le reformuler.

```json
// MAUVAIS — l'indice donne la réponse, et l'essentiel arrive trop tard
{ "title": "Périmètre du cercle", "definition": "Voir la figure. On parle ici du périmètre du cercle, qui vaut 2πr." }

// BON — sujet identifiable dès le début, titre non recopié
{ "title": "Périmètre du cercle", "definition": "Longueur du tour complet, égale à 2 × π × rayon." }
```

### 6. Une définition par card, autoportante

Pas de renvoi (« comme vu plus haut », « idem », « voir la card
précédente ») : en quiz, une définition est lue SEULE, hors de son contexte
dans l'arbre, à côté de trois distracteurs. Un renvoi y devient du bruit.

## Erreurs fréquentes

| Erreur | Pourquoi c'est faux |
|---|---|
| Copier la hiérarchie d'une carte mentale existante fournie en référence | Cette carte n'a pas forcément été construite selon les règles de l'app (4 niveaux fixes, arbre strict) — c'est une source de contenu, pas un modèle structurel |
| Laisser des "…………" recopiés du PDF à trous | Le fichier sert à réviser ; du contenu manquant n'aide pas à apprendre |
| Créer une card par exercice d'un énoncé d'application | Les exercices sont de la pratique, pas des connaissances de cours — hors périmètre de la carte mentale |
| `definition` très inégales entre cards sœurs | La bonne réponse d'un QCM se repère à sa forme, sans lire le contenu |
| Définition qui ne nomme pas son sujet (« On applique la règle ») | Illisible comme indice en mode QCM : le titre devient introuvable |
| Titre recopié mot pour mot dans sa propre définition | En mode QCM, l'indice donne directement la réponse |
| Titre long ou numéroté sur une card sans définition | Elle devient une question à écrire lettre par lettre : intapable |
| Renvoi d'une card à une autre (« comme ci-dessus ») | Une définition est lue seule en quiz, hors de son contexte |
| Inventer un numéro de chapitre non trouvé dans les sources | Nommer par slug thématique si le numéro réel n'est pas connu |
| Titre identique à celui d'une carte d'une autre branche | Rend le QCM titre→définition réellement ambigu — aucune des deux définitions n'est reconnaissable comme LA bonne réponse |

## Adaptation à d'autres matières

Ce mapping niveau2/3/4 = thème/règle/exemple est calibré pour les maths
(collège). Pour une autre matière, redéfinir ce que représente chaque niveau
avant de commencer (ex. histoire : niveau2=grande période, niveau3=événement,
niveau4=date/cause ; SVT : niveau2=système, niveau3=mécanisme,
niveau4=vocabulaire/schéma) — ne pas réutiliser le mapping maths tel quel.
