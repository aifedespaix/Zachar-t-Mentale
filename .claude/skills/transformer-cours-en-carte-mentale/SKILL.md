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
  definition?: string      // optionnel, à n'importe quel niveau
  parentId: string | null  // null uniquement pour la racine
  order: number             // position parmi les frères/sœurs
}
```

- Un fichier = une racine unique = un chapitre. Arbre strict, un seul parent
  par card. Si un chapitre est trop gros, le découper en plusieurs fichiers.
- Sortie : JSON array de `Card`, `JSON.stringify(cards, null, 2)`, un fichier
  par chapitre (voir `src/persistence/serialization.ts`).

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
   QCM parmi les `definition` de cards sœurs de même niveau : garder une
   forme comparable (longueur, registre) entre elles, sinon les distracteurs
   se repèrent par élimination.
8. **Valider avant de livrer** : une seule racine, tout `parentId` référence
   un `id` existant du même fichier, aucun niveau hors 1-4.

## Exemple (chapitre "Nombres relatifs")

Thème niveau 2 "Addition" → niveau 3 "Signes contraires" (`definition`:
règle du calcul) → niveau 4 "Exemple" (`definition`: "(+10) + (-4) =
+(10-4) = +6"). Son frère niveau 3 "Même signe" reçoit une `definition` de
longueur et de registre comparables, pas deux fois plus courte — sinon un
QCM les distinguerait trivialement.

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
