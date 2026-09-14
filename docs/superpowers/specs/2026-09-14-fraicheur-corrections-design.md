# Fraîcheur des corrections — design

Sous-projet 4 de `docs/cartes-mentales-maintenance.md`.

## Problème

Un fichier `corrections` (type `meta.type: "corrections"`, voir la skill
`transformer-cours-en-carte-mentale`) est écrit pour corriger un exercice
(`exo`) précis. Rien aujourd'hui ne relie structurellement les deux fichiers
— seule une convention de nommage (`influences.zmap` →
`influences-corrections.zmap`) les rapproche, et rien ne détecte qu'une
correction est devenue incomplète si l'exercice source gagne ou perd des
cartes après coup.

Les fichiers `corrections` sont produits exclusivement par la skill
`transformer-cours-en-carte-mentale` (jamais par une action manuelle dans
l'app). Le besoin est donc un mécanisme que **la skill** peut exploiter pour
savoir, lors d'une reprise de chantier, quelles corrections existantes ne
couvrent plus fidèlement leur exercice — pas une fonctionnalité utilisateur
de l'app elle-même.

## Décisions

### Modèle de données

Deux champs optionnels dans `meta`, portés uniquement par le fichier
`corrections` (l'exo n'a rien à savoir de sa correction) :

```ts
interface MindMapMeta {
  // ... existant
  correctsId?: string             // meta.id de l'exo corrigé
  correctsSnapshot?: CardCounts   // compte de cartes de l'exo au moment où la
                                   // correction a été écrite/vérifiée pour la
                                   // dernière fois
}
```

`CardCounts` est le type déjà défini dans `src/sync/cardCounts.ts`
(`{ total, byLevel, detached }`), réutilisé tel quel plutôt qu'un simple
entier — ça permet, si besoin plus tard, de savoir *où* l'exo a changé
via `countDelta()` (déjà existant, déjà utilisé par le dialogue de
résolution de conflits pour afficher des deltas signés).

### Établissement du lien (`correctsId`)

- **Écriture normale** : à la création ou régénération d'un fichier
  `corrections`, la skill lit le `meta.id` de l'exo qu'elle corrige (déjà
  identifié par son nom de fichier/dossier dans le flux de la skill) et
  l'écrit directement dans `correctsId`. Aucune recherche a posteriori :
  la skill sait déjà quel exo elle corrige au moment où elle écrit.
- **Backfill** (fichiers `corrections` déjà existants, écrits avant ce
  champ) : quand la skill traite un fichier `corrections` sans
  `correctsId`, elle retrouve `<même nom sans le suffixe -corrections>.zmap`
  dans le même dossier de chapitre et, si trouvé, pose `correctsId` (et
  amorce `correctsSnapshot` avec le compte actuel de l'exo). Si rien n'est
  trouvé (correction orpheline), le fichier reste sans lien — pas d'erreur,
  pas de blocage.
- Une fois posé, `correctsId` ne change plus automatiquement : un
  renommage ultérieur de l'exo ou de la correction ne casse rien, puisque
  le lien suit l'`id`, pas le nom de fichier.

### Détection de fraîcheur

- Une correction est **obsolète** dès que le `CardCounts` actuel de l'exo
  lié diffère de `correctsSnapshot` sur `total` — à la hausse (l'exo a
  gagné des cartes, la correction est incomplète) comme à la baisse
  (l'exo a perdu des cartes, la correction en corrige potentiellement de
  trop). Tout delta compte, pas seulement une augmentation.
- Seul le **nombre** de cartes est comparé (pas leur contenu) : un énoncé
  reformulé sans changement de structure ne déclenche rien. C'est
  volontairement plus simple qu'une comparaison de hash de contenu
  (comme `isConflict` le fait pour la sync) — extension possible plus
  tard si un besoin réel apparaît, hors périmètre ici.
- Si `correctsId` ne résout à rien (exo introuvable, supprimé, déplacé
  hors périmètre suivi), aucune détection n'a lieu — silence, pas
  d'erreur.

### Déclenchement

Pas de calcul automatique dans l'app, pas de scan périodique, pas de
bouton "marquer à jour". La vérification n'a lieu que lorsque la skill est
explicitement invoquée pour traiter ou vérifier des fichiers `corrections`
(typiquement lors d'une reprise de chantier de maintenance) : elle relit
alors les exos liés, recompte leurs cartes, et compare à
`correctsSnapshot`.

`correctsSnapshot` ne se réinitialise que lorsque la skill (ré)écrit une
correction — jamais par une sauvegarde ordinaire dans l'app, puisque
l'app n'a aucun rôle dans ce mécanisme.

## Ce qui ne change pas

- **Aucun changement applicatif requis.** Vérifié dans le code : `meta`
  traverse l'app sans reconstruction champ par champ
  (`src/persistence/serialization.ts`, `src/hooks/useMindMapAuthor.ts`) —
  des champs inconnus de l'interface `MindMapMeta` survivent déjà aux
  allers-retours lecture/écriture. Aucune validation stricte de `meta`
  n'existe (`src/validation/cardsValidation.ts` ne valide que `cards`).
- **Pas d'UI.** Pas de badge, pas de tooltip, pas d'indicateur dans la
  sidebar — ce mécanisme est un outil interne à la skill, pas une
  fonctionnalité visible par l'utilisateur de l'app.
- **Pas d'action manuelle "marquer à jour".** La skill est le seul point
  d'écriture de `correctsSnapshot`.

## Touche facultative

Ajouter `correctsId?: string` et `correctsSnapshot?: CardCounts` à
l'interface `MindMapMeta` (`src/types/card.ts`) pour la documentation et le
typage — sans effet fonctionnel, juste pour qu'un futur lecteur du code
comprenne la provenance du champ s'il tombe dessus dans un fichier
`.zmap`.

## Implémentation

- Mise à jour de `SKILL.md`
  (`.claude/skills/transformer-cours-en-carte-mentale/SKILL.md`) :
  - section décrivant l'écriture de `correctsId`/`correctsSnapshot` à la
    création/régénération d'un fichier `corrections`
  - section décrivant la vérification de fraîcheur des corrections
    existantes lors d'une reprise de chantier
- Ajout facultatif des deux champs à `MindMapMeta`
  (`src/types/card.ts`), en import du type `CardCounts` depuis
  `src/sync/cardCounts.ts`

Pas de nouveau module, pas de test automatisé requis (rien de testable en
dehors du comportement de la skill elle-même, qui n'est pas du code TS).
