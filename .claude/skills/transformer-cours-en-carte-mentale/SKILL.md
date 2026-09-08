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
interface Card {
  id: string
  level: CardLevel        // 1=Titre principal 2=Sous-titre 3=Sous-partie 4=Info
  title: string
  definition?: string      // texte brut ; miroir DÉRIVÉ dès que `content` existe
  content?: CardBlock[]    // optionnel : définition riche (formules, tableaux)
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
7. **Comparabilité pour le mode quiz.** Le quiz pioche ses distracteurs de
   QCM parmi les `definition` de cards sœurs de même niveau — donc parmi les
   PROJECTIONS texte, pas parmi les blocs. C'est cette projection qui doit
   rester de forme comparable (longueur, registre) entre sœurs, sinon les
   distracteurs se repèrent par élimination. Corollaire : deux formules dont
   la projection est identique se percutent en une seule option de QCM, ce
   qui est correct mais réduit le nombre de distracteurs — varier les
   formulations entre sœurs.
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

## Erreurs fréquentes

| Erreur | Pourquoi c'est faux |
|---|---|
| Copier la hiérarchie d'une carte mentale existante fournie en référence | Cette carte n'a pas forcément été construite selon les règles de l'app (4 niveaux fixes, arbre strict) — c'est une source de contenu, pas un modèle structurel |
| Laisser des "…………" recopiés du PDF à trous | Le fichier sert à réviser ; du contenu manquant n'aide pas à apprendre |
| Créer une card par exercice d'un énoncé d'application | Les exercices sont de la pratique, pas des connaissances de cours — hors périmètre de la carte mentale |
| `definition` très inégales entre cards sœurs | Casse la génération de distracteurs QCM du mode quiz (lot 2) |
| Inventer un numéro de chapitre non trouvé dans les sources | Nommer par slug thématique si le numéro réel n'est pas connu |

## Adaptation à d'autres matières

Ce mapping niveau2/3/4 = thème/règle/exemple est calibré pour les maths
(collège). Pour une autre matière, redéfinir ce que représente chaque niveau
avant de commencer (ex. histoire : niveau2=grande période, niveau3=événement,
niveau4=date/cause ; SVT : niveau2=système, niveau3=mécanisme,
niveau4=vocabulaire/schéma) — ne pas réutiliser le mapping maths tel quel.
