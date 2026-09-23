---
name: transformer-cours-en-carte-mentale
description: Use when converting a course PDF (or any raw course material — worksheet, fill-in-the-blank sheet, existing but poorly-structured mind map) into a mind map file for the Zachar't Mentale app, or when correcting a student's already-filled `.zmap` as a teacher — producing Card JSON data, not application code.
---

# Transformer un cours en carte mentale

## Vue d'ensemble

Convertit un support de cours brut (PDF, fiche à trous, carte mentale existante
mal structurée) en un fichier `.zmap` JSON, l'enveloppe `{ meta, cards }`, conforme au schéma de l'app
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
  icon?: string             // nom Lucide en PascalCase, purement mnémonique — cf. « Corriger le fichier d'un élève »
}

type CardBlock =
  | { kind: 'text';  text: string }
  | { kind: 'math';  latex: string; display?: boolean }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'image'; asset: string; alt: string; width: number; height: number }
```

- Un fichier = une racine unique = un chapitre. Arbre strict, un seul parent
  par card. Si un chapitre est trop gros, le découper en plusieurs fichiers.
- Sortie : l’ENVELOPPE `{ "meta": { … }, "cards": [ … ] }`, sérialisée
  `JSON.stringify({ meta, cards }, null, 2)`, un fichier par chapitre.
- `meta` = `{ "id": <uuid>, "author": <pseudo fourni>, "role": <"eleve" | "prof" fourni>, "lastModified": <ISO maintenant>, "type": <type> }`.
  Le pseudo et le rôle sont ceux de la personne pour qui le fichier est produit ;
  si l’invocation ne les donne pas, les DEMANDER avant d’écrire.
- `type` appartient à
  `"cours" | "exo" | "prise de notes" | "corrections" | "corrigé" | "default"` :
  `cours` pour un contenu de référence, `exo` pour un entraînement,
  `prise de notes` pour des notes à compléter, `corrections` pour un corrigé de
  référence écrit pour tout le monde, `corrigé` pour la copie d’un élève
  reprise par son prof (voir « Corriger le fichier d’un élève » plus bas),
  `default` si le document ne relève clairement d’aucun.
- Extension : `.zmap` — c'est celle que l'installeur associe à l'app, donc la
  carte s'ouvre d'un double-clic depuis l'explorateur. Le contenu reste du JSON.
  Les anciens `.json` continuent de s'ouvrir, mais rien de neuf n'en écrit.

## Où écrire le fichier

L'arborescence de `.cartes-mentales/` est : `<matière>/<chapitre>/<fichier>.zmap`.

- **Matière** : dossier kebab-case, nom complet non abrégé (`mathematiques`,
  `physique-chimie`, `anglais`, `espagnol`, `francais`…). Réutiliser le
  dossier existant de la matière ; n'en créer un nouveau que si elle n'existe
  encore nulle part.
- **Chapitre** : un dossier par chapitre, kebab-case. Préfixe numérique
  (`01-`, `02-`…) UNIQUEMENT si le support source donne un vrai numéro de
  chapitre ou un ordre explicite dans la progression — jamais inventé (déjà
  dans les erreurs fréquentes ci-dessous). Sinon, un slug thématique seul
  (`edward-hopper/`, `cahier-de-lecteur/`) : ces matières n'ont pas toujours
  de progression numérotée, et ce n'est pas grave.
- **Fichier** : nommé d'après le sous-thème précis qu'il couvre
  (`introduction-et-formule.zmap`, `biographie.zmap`), jamais d'après le
  chapitre déjà donné par le nom du dossier, et jamais suffixé par le type de
  contenu (`-cours`, `-exo`…) — ce type est `meta.type`, pas le nom de
  fichier. Un chapitre découpé en plusieurs fichiers (cf. « Si un chapitre est
  trop gros ») les regroupe tous dans le MÊME dossier de chapitre.
  - **Exception : fichier `corrections` d'un exercice existant.** Un
    `meta.type: "corrections"` (voir « Corriger le fichier d'un élève » plus
    bas pour la distinction avec `corrigé`) partage forcément le sous-thème
    de l'exercice qu'il corrige et doit coexister avec lui dans le même
    dossier de chapitre — deux fichiers ne peuvent pas porter le même nom. Le
    suffixe `-corrections` est alors la seule exception à la règle
    ci-dessus : `influences.zmap` (exo) → `influences-corrections.zmap`.
    N'utiliser ce suffixe que dans ce cas précis ; il reste interdit pour
    tout autre type (`cours`, `prise de notes`, `default`…) puisque ceux-là
    n'ont pas ce problème de collision de nom.
- **Jamais de PDF ni de support brut sous `.cartes-mentales/`** : les sources
  restent dans `.cours/`. `.cartes-mentales/` ne contient que des `.zmap`
  (et leurs `.assets/` générés par l'app elle-même).
- **Ne jamais créer de dossier `.assets` à la main** : l'app le dérive du nom
  du fichier `.zmap` lui-même (`nom-fichier.assets/`) dès qu'une image y est
  ajoutée depuis l'interface — hors périmètre de cette skill (cf. « Pas de
  bloc image » plus bas).

## Fraîcheur d'un fichier `corrections`

Un fichier `corrections` (voir l'exception de nommage ci-dessus) peut
devenir incomplet si l'exercice qu'il corrige gagne ou perd des cartes
après coup. Deux champs de `meta`, réservés à cette skill (l'app ne les
affiche ni ne les modifie jamais), permettent de le détecter :

```ts
correctsId?: string             // meta.id de l'exo corrigé
correctsSnapshot?: CardCounts   // compte de cartes de l'exo, capturé ici
```

`CardCounts` est le type de `src/sync/cardCounts.ts` :
`{ total, byLevel, detached }`. Le compter à la main sur les `cards` de
l'exo lié (un objet, incrémenté par carte, séparant les cartes volantes
— `detached: true` — du reste) plutôt que d'en approximer un. Deux règles à
respecter pour rester fidèle à `countCards()` : une carte volante compte
dans `total` mais dans aucun niveau de `byLevel` ; une carte dont le
`level` sort de 1-4 compte aussi dans `total` sans être rangée dans aucun
niveau. Un écart sur ces deux règles produit un faux signal d'obsolescence.

### À la création ou régénération d'un fichier `corrections`

Lire le `meta.id` de l'exo corrigé (déjà identifié par son nom de
fichier/dossier : `influences.zmap` → `influences-corrections.zmap`),
compter ses cartes, et écrire les deux champs dans le `meta` de la
correction :

```json
"meta": {
  "id": "…",
  "author": "aife",
  "role": "prof",
  "lastModified": "…",
  "type": "corrections",
  "correctsId": "<meta.id de influences.zmap>",
  "correctsSnapshot": { "total": 5, "byLevel": { "1": 1, "2": 2, "3": 1, "4": 1 }, "detached": 0 }
}
```

### En reprenant un chantier de maintenance

Quand on demande à cette skill de vérifier ou mettre à jour des
corrections existantes, pour chaque fichier `corrections` portant un
`correctsId` : relire l'exo correspondant (le retrouver par son
`meta.id`, pas par son nom — un renommage ne casse pas le lien),
recompter ses cartes, comparer à `correctsSnapshot`. Tout écart sur
`total` — à la hausse comme à la baisse — signale que la correction est
à revoir avant d'être considérée à jour ; ne comparer que le nombre de
cartes, pas leur contenu.

**Backfill** : un fichier `corrections` déjà existant sans `correctsId`
n'est pas une erreur. Chercher `<même nom sans le suffixe
-corrections>.zmap` dans le même dossier de chapitre ; si trouvé, poser
`correctsId` et amorcer `correctsSnapshot` avec le compte actuel avant de
continuer la vérification. Si rien n'est trouvé (correction orpheline),
laisser le fichier tel quel — pas de lien à forcer.

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

## Corriger le fichier d’un élève — le type `corrigé`

Cas d’entrée différent de tous les autres : l’invocation ne donne pas un
support de cours à structurer mais un `.zmap` DÉJÀ REMPLI par un élève (une
fiche de questions, des réponses, une prise de notes), et demande de le
corriger en tant que prof. Le résultat est le MÊME fichier, repris — jamais
un fichier neuf à côté.

**`corrections` et `corrigé` ne sont pas le même type** :

| Type | Ce que c’est | Qui l’écrit |
|---|---|---|
| `corrections` | le corrigé de référence d’un exercice ou d’une évaluation, indépendant de toute copie | le prof, pour toute la classe |
| `corrigé` | la copie d’UN élève, reprise et rectifiée, son travail conservé | le prof, dans le fichier de l’élève |

### Ce qui change dans `meta`

Seulement `type` → `"corrigé"` et `lastModified` → l’instant de la correction.

**`id`, `author` et `role` ne changent pas.** Le fichier reste celui de
l’élève : l’app autorise explicitement un prof à écrire le contenu d’une
carte dont il n’est pas l’auteur (`canEditContent` dans
`src/sync/permissions.ts`), et la synchro repousse la carte sous son auteur
d’origine. Recréer un fichier avec un nouvel `id` ferait un doublon côté
serveur et sortirait l’élève de sa propre carte.

Le fichier garde aussi son chemin et son nom : le renommer ou le déplacer
n’apporte rien et se lit comme un déplacement côté synchro.

### Ce qu’on ne touche jamais

- **Aucun `id` de carte réécrit, aucune carte supprimée, aucun `parentId` ni
  `order` remanié.** La structure de l’élève FAIT PARTIE de son travail :
  la remanier lui rend une carte qu’il ne reconnaît plus.
- **Une réponse juste reste telle quelle**, même mal tournée. Corriger le
  style n’est pas corriger.

### Ce qu’on corrige

- **Une réponse fausse** : la `definition` (ou les blocs `content`) est
  réécrite juste, en gardant les mots de l’élève partout où ils n’étaient pas
  faux. Ne JAMAIS laisser une erreur dans une `definition` : le fichier sert
  à réviser, et le quiz apprendrait la faute par cœur.
- **Un trou** : carte laissée sans `definition`, « ………… » recopié du sujet
  → complété avec la bonne réponse, exactement comme pour une fiche à trous.
- **Ce qui manque complètement** : une carte NOUVELLE, à sa place dans
  l’arbre, avec un `id` neuf qui n’entre en collision avec aucun de ceux de
  l’élève.
- Toute carte ajoutée ou réécrite repasse par les règles habituelles : titre
  et définition qui se déterminent l’un l’autre, sœurs de longueur
  comparable, maths en blocs `math`, mots-clés en `**gras**`.

### Montrer ce qui a été repris (facultatif)

Poser `icon: "PencilLine"` sur les cartes touchées donne à l’élève la liste
de ce que le prof a repris d’un coup d’œil : l’icône est purement mnémonique,
elle n’entre dans aucun quiz. Ne rien poser sur les cartes laissées intactes,
et laisser en place une icône que l’élève avait déjà choisie — elle est à lui.

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
| `qcm-title` | la `definition` comme indice (en entier en facile/moyen, **mots-clés remplacés par `____`** en difficile) | il choisit le bon `title` parmi 4 | `kind` absent/`definition`, mode QCM activé, la card a une `definition` |
| `qcm-title` (card-thème) | « Regroupe : A, B, C. » — les titres de ses sous-cards, dans l'ordre `order` | il choisit le bon `title` parmi 4 | mode QCM activé, la card n'a PAS de `definition` mais a des enfants |
| `recall` (repli QCM) | le `title` en texte à trous | il écrit le titre | mode QCM activé, card SANS `definition` ET SANS enfant |
| `qcm-media` | le `title` de la card | il choisit le bon média (tableau/formule/image) parmi 4 | `kind: 'media'` |
| `qcm-media-title` | le média en entier, à toutes les difficultés | il choisit le bon `title` parmi 4 | `kind: 'media'`, mode QCM activé |

L'app ne pose **jamais** de question « devine d'après la position de la card
dans l'arbre » : chaque question part d'un texte écrit. Ce texte, c'est toi
qui le fournis — une card sans rien d'écrit ne peut être qu'un texte à trous.

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
L'application les affiche en couleur dans la fiche de lecture ; dans le quiz,
toute option s'affiche en texte plat, y compris pour cette carte-là si elle
sert de distracteur ailleurs.

**En difficulté « difficile », ces mots-clés deviennent des trous** dans
l'indice de `qcm-title` : « **Mettre au même dénominateur**, puis… » s'affiche
« ____, puis… ». Le marquage fabrique donc directement la question difficile,
et se choisit avec ça en tête :

- **Masquer ce qui se retient, pas ce qui se devine.** Le mot-clé est le terme
  que l'élève doit savoir restituer (la notion, le mot technique, la valeur).
  Un article ou un mot de liaison masqué ne teste rien.
- **La phrase trouée doit encore désigner UN seul titre** parmi ses sœurs.
  Si masquer les mots-clés rend la définition applicable à n'importe quelle
  sœur, c'est qu'on a masqué tout ce qui la distinguait : garder visible au
  moins un élément discriminant.
- **Si un mot du titre apparaît dans la définition, le marquer** : en
  difficile il sera masqué au lieu de souffler la réponse.
- **Une définition sans aucun `**…**` s'affiche en entier même en
  difficile** — la card perd alors son niveau de difficulté. Marquer au moins
  un terme sur chaque card qui a une définition.

```json
// BON — les mots qui portent le sens sont marqués, la phrase reste lisible sans eux
{ "title": "Addition de fractions", "definition": "**Mettre au même dénominateur**, puis additionner les numérateurs en gardant le dénominateur commun." }
```

Ne pas marquer une phrase entière ni un mot sur deux — un à trois termes
par définition, ceux qu'un élève chercherait à retenir en premier. Au-delà,
la version difficile n'est plus qu'une suite de `____` illisible.

```json
// MAUVAIS en difficile — « ____ ____ de ____ : ____ » ne dit plus rien
{ "definition": "**Somme** **des carrés** des **côtés** : **hypoténuse²**" }

// BON — « Dans un triangle rectangle, le carré de l'____ égale la somme des carrés des deux autres côtés. »
{ "definition": "Dans un triangle rectangle, le carré de l'**hypoténuse** égale la somme des carrés des deux autres côtés." }
```

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

### 4. Une card sans définition : thème ou texte à trous

Une card sans `definition` n'a que deux destins :

- **Elle a des enfants** (card-thème, typiquement niveau 1-2) : en mode QCM,
  la question est « Regroupe : A, B, C. », avec les titres de ses enfants
  dans l'ordre de leur `order`, et l'élève choisit le titre parmi 4. Pour que
  ça marche :
  - le titre du thème doit être **le nom naturel qui englobe ses enfants**
    (« Opérations sur les fractions », pas « Partie 2 ») ;
  - les titres des enfants, lus ensemble, doivent **évoquer ce thème-là et
    pas un thème voisin**. Des enfants génériques (« Méthode », « Exemple »,
    « Cas particulier ») rendent la question impossible ;
  - un thème à un seul enfant donne un indice maigre : regrouper ou donner
    une `definition` au thème.
- **Elle n'a pas d'enfant** (feuille) : il n'y a rien d'écrit sur quoi poser
  un QCM, donc c'est TOUJOURS une question `recall`, même en mode QCM. Une
  feuille est presque toujours une notion : **lui donner une `definition`**
  est le meilleur moyen d'en faire une bonne question.

La question `recall` : l'app affiche le
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
titre : affichée intégralement en facile et en moyen, avec ses mots-clés
remplacés par `____` en difficile (voir §2) ; un média s'affiche en entier à
toutes les difficultés. Elle n'est jamais coupée en plein milieu : une
définition lisible d'un coup d'œil sert mieux l'élève.

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
| Définition sans aucun `**mot-clé**` | En difficile, rien n'est masqué : la question est aussi facile qu'en facile |
| Mots-clés trop nombreux, ou masquant tout ce qui distingue la card de ses sœurs | En difficile, l'indice troué ne désigne plus aucun titre en particulier |
| Card-thème aux enfants génériques (« Méthode », « Exemple ») | « Regroupe : Méthode, Exemple » ne permet de retrouver aucun thème |
| Feuille sans définition « parce que le titre suffit » | Elle ne peut être qu'un texte à trous, jamais un QCM |
| Renvoi d'une card à une autre (« comme ci-dessus ») | Une définition est lue seule en quiz, hors de son contexte |
| Inventer un numéro de chapitre non trouvé dans les sources | Nommer par slug thématique si le numéro réel n'est pas connu |
| Titre identique à celui d'une carte d'une autre branche | Rend le QCM titre→définition réellement ambigu — aucune des deux définitions n'est reconnaissable comme LA bonne réponse |
| Écrire le `.zmap` directement sous `<matière>/`, sans dossier de chapitre | Casse l'arborescence `matière/chapitre/fichier.zmap` — même un chapitre à un seul fichier a son dossier |
| Suffixer le nom de fichier par le type (`-cours`, `-exo`) | Le type est déjà `meta.type` ; le nom de fichier décrit le sous-thème, pas la nature du contenu |
| Corriger un élève en créant un fichier neuf (nouvel `id`, `author` du prof) | Doublon côté serveur, et l’élève est sorti de sa propre carte : le corrigé s’écrit DANS son fichier |
| Classer en `corrections` la copie reprise d’un élève | `corrections` est le corrigé de référence d’un exercice ; une copie d’élève rectifiée est `corrigé` |
| Laisser la réponse fausse de l’élève dans une `definition` | Le fichier sert à réviser : le quiz apprendrait l’erreur par cœur |
| Réécrire les ids ou réordonner l’arbre d’un élève pour « faire propre » | Sa structure fait partie de son travail, et la synchro y verrait un autre fichier |

## Adaptation à d'autres matières

Ce mapping niveau2/3/4 = thème/règle/exemple est calibré pour les maths
(collège). Pour une autre matière, redéfinir ce que représente chaque niveau
avant de commencer (ex. histoire : niveau2=grande période, niveau3=événement,
niveau4=date/cause ; SVT : niveau2=système, niveau3=mécanisme,
niveau4=vocabulaire/schéma) — ne pas réutiliser le mapping maths tel quel.
