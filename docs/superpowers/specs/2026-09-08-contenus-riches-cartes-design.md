# Contenus riches dans les cartes — Recherche & Design

**Date** : 2026-09-08
**Statut** : Brainstorming / recherche — à arbitrer avant plan d'implémentation
**Lot** : 6 (Contenus riches)

## Contexte

Aujourd'hui, `Card.definition` est un `string` brut (`src/types/card.ts`),
affiché tel quel dans un `<p>` (`DefinitionPopover.tsx:88`,
`StaticCardView.tsx:39`). C'est suffisant pour du français, et insuffisant pour
à peu près tout le reste.

Le constat est déjà visible dans les cartes générées. Extraits réels de
`.cartes-mentales/math/` :

| Ce qui est stocké | Ce que le cours affiche |
|---|---|
| `20/100 x 425 = 85` | 20⁄100 × 425 = 85 (fraction empilée) |
| `A = x² + 3(x+6) + x/10` | fraction empilée pour x⁄10 |
| `425 / 100 = 4,25` | ÷, pas `/` |
| `(+4) + (−4) = 0` | correct, mais tapé à la main en unicode |

Le `x` sert à la fois de multiplication et de variable dans la même ligne
(`A = x×x + 3×(x+6)`), les fractions sont écrites en ligne, les puissances
dépendent de la disponibilité d'un exposant unicode (`x²` existe, `x⁷` non).
Ce n'est pas un défaut de la skill de génération : c'est la limite du champ
`string`.

Le besoin exprimé va plus loin que les maths : formules, partitions, images
(drag & drop, clic → explorateur, `Ctrl+V`), et « d'autres matières ».

## Le problème à trancher d'abord : mode de champ ou blocs ?

L'intuition de départ est « un bouton qui change le mode d'input : texte par
défaut, math, musique, image ». C'est la bonne **affordance**, mais appliquée
au mauvais **objet** si le mode porte sur tout le champ.

Une définition pédagogique réelle mélange presque toujours :

> **Signes contraires** — On garde le signe du nombre le plus éloigné de zéro,
> puis on soustrait les distances à zéro. *(texte)*
> $(+10) + (-4) = +(10-4) = +6$ *(math)*

Un mode par champ oblige à choisir : soit la règle en français, soit la
formule. En pratique on finirait par créer une carte niveau 4 « Exemple »
uniquement pour héberger la formule — ce que la skill fait déjà, mais par
contrainte et non par choix pédagogique.

**Recommandation : une définition est une liste de blocs, et le bouton de mode
choisit le type du bloc courant / du prochain bloc inséré.** L'utilisateur voit
exactement ce qu'il a demandé (un sélecteur de mode), sans être enfermé dans un
type unique par carte.

### Modèle proposé

```ts
export type CardBlock =
  | { kind: 'text';  text: string }
  | { kind: 'math';  latex: string; display?: boolean }   // display = formule centrée
  | { kind: 'image'; asset: string; alt: string; width: number; height: number }
  | { kind: 'code';  lang: string; source: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'music'; abc: string }

export interface Card {
  // …inchangé…
  /** Projection texte brut — reste la seule source lue par le quiz, XMind et la validation. */
  definition?: string
  /** Présent = contenu riche ; `definition` en devient le miroir dérivé. */
  content?: CardBlock[]
}
```

**Règle d'or : `definition` ne disparaît pas et n'est jamais saisi à la main
quand `content` existe.** Il est recalculé par une fonction unique
`blocksToPlainText(content)` à chaque écriture. Un seul écrivain ⇒ les deux
champs ne peuvent pas diverger.

Ce que ça achète :

- **Zéro migration.** Les 7 cartes de `.cartes-mentales/` s'ouvrent sans
  changement, `content` absent = un seul bloc `text`.
- **`isUsableCardRecord` reste vrai** (`cardsValidation.ts:78`) : `definition`
  est toujours un `string`.
- **Le quiz, l'export XMind et `salvage()` continuent de fonctionner** sans
  être réécrits le jour 1 — ils lisent la projection, dégradée mais jamais
  vide.
- **Une version antérieure de l'app ouvre un fichier récent** en mode dégradé
  (texte) plutôt qu'en carte cassée.

L'alternative — un champ union unique `definition: string | CardBlock[]` —
est plus propre conceptuellement mais impose de toucher au même commit la
validation, le repair, le quiz, l'export XMind et la skill. Le coût est réel
et le bénéfice est esthétique. À reconsidérer une fois les blocs stabilisés.

### Projection texte brut (`blocksToPlainText`)

| Bloc | Projection |
|---|---|
| `text` | tel quel |
| `math` | LaTeX → unicode pour les cas courants (`\frac{a}{b}` → `a/b`, `^2` → `²`, `\times` → `×`, `\sqrt{x}` → `√x`), sinon le LaTeX brut |
| `image` | `[image : {alt}]` |
| `code` | la source, sans coloration |
| `table` | lignes séparées par ` | ` |
| `music` | `[partition : {première ligne du titre ABC}]` |

Le repli unicode n'a pas besoin d'être exhaustif : il couvre ce qu'un collégien
écrit (fraction, puissance, racine, ×, ÷, ≤, ≥, π) et retombe sur le LaTeX
sinon. Jamais de champ vide — c'est ce qui garantit que le quiz et XMind ne
perdent rien silencieusement.

## Les types de blocs, par matière

Classés par rapport valeur / coût, pas par ordre d'envie.

### P0 — Maths **et** physique-chimie, pour une seule dépendance

`katex@0.18.7` + son extension `contrib/mhchem` (livrée dans le paquet, à
importer séparément).

- Maths : `\frac{20}{100} \times 425 = 85`, `x^7`, `\sqrt{2}`, systèmes,
  matrices, intégrales.
- Chimie : `\ce{2H2 + O2 -> 2H2O}`, `\ce{H2SO4}` — **gratuit**, c'est la même
  extension.
- Physique : `\pu{9.81 m/s^2}` pour les unités, même extension.

Trois matières couvertes par une bibliothèque de ~280 kB, rendu **synchrone**
(point capital pour la stabilité de l'interface, voir plus bas).

### P0 — Image

Le cas le plus demandé et le plus transversal : schéma de SVT annoté, carte de
géographie, œuvre en histoire des arts, figure de géométrie capturée depuis
GeoGebra, extrait de partition scanné, tableau de conjugaison photographié.

Trois entrées, toutes attendues :

1. **`Ctrl+V`** — l'événement `paste` du webview expose
   `clipboardData.items` ; suffisant pour une capture d'écran ou une image
   copiée depuis un navigateur. Repli sur
   `@tauri-apps/plugin-clipboard-manager` (`readImage()` → `Uint8Array`) pour
   les cas où le webview ne présente pas l'image (copie depuis l'explorateur
   de fichiers selon l'OS).
2. **Drag & drop** — **piège majeur, déjà documenté dans le code** : Tauri
   intercepte les dépôts de fichiers de l'OS *avant* qu'ils n'atteignent le
   webview, donc **l'événement DOM `drop` ne se déclenche jamais**
   (`useFileDropZone.ts`, commentaire d'en-tête). Il faut passer par
   l'événement drag & drop au niveau fenêtre, et convertir sa position —
   rapportée en **pixels physiques** — en pixels logiques avant de la croiser
   avec le `getBoundingClientRect()` de la zone (`isInZone`, même fichier).
   Le hook existant est le modèle exact à suivre. Deux conséquences :
   - il n'accepte aujourd'hui que le `.json` (`INVALID_FILE_MESSAGE`) et
     rejette tout le reste ; il devra router selon l'extension plutôt que
     refuser ;
   - un seul événement fenêtre alimente les deux zones (canvas → ouvrir une
     carte, popover ouvert → insérer une image). C'est le test de zone qui
     arbitre, et il faut décider lequel gagne quand un popover est ouvert
     au-dessus du canvas. Proposition : le popover ouvert gagne toujours.
3. **Clic → explorateur natif** — `open()` de
   `@tauri-apps/plugin-dialog`, déjà utilisé par `pickXmindFile()`
   (`exportIO.ts`), avec un filtre sur les extensions d'image.

### P1 — Tableau

Le meilleur rapport valeur / effort après le texte, parce qu'il sert partout :
conjugaison (langues), vocabulaire bilingue, frise de dates (histoire), unités
et constantes (physique), tableau de signes (maths). Aucune dépendance : un
`<table>` et une grille éditable.

### P1 — Code

Informatique / NSI, et aussi les formules de tableur en maths appliquées.
Recommandation : **pas de bibliothèque en v1**. Un `<pre>` monospace avec fond
neutre transmet 90 % de l'information ; `shiki@4.4.3` pèse plusieurs Mo et
`highlight.js` impose un thème. La coloration se rajoute plus tard sans changer
le modèle de données (`lang` est déjà stocké).

### P2 — Musique

`abcjs@6.7.0`. La notation ABC est **du texte** — elle se stocke, se diffe, se
génère par la skill, contrairement à MusicXML.

```
X:1
K:C
CDEF GABc |
```

Bonus non négligeable : abcjs embarque un synthétiseur. Une carte « quelle est
cette gamme ? » qui **joue** l'extrait est un mode de quiz que rien d'autre
n'ouvre. À noter aussi comme la seule modalité que le PDF ne peut pas porter.

Alternatives écartées : VexFlow (API programmatique, pas de format texte
stockable), OpenSheetMusicDisplay (MusicXML — XML verbeux, pas éditable à la
main, et c'est une surcouche de VexFlow donc plus lourde).

### P2 — Audio

Prononciation en langues, dictée musicale, extrait sonore en SVT. Même
stockage que l'image (fichier en sidecar). Le blocage est l'export : un PDF ne
porte pas de son. Traitement honnête : le bloc audio s'exporte en
`[audio : {titre}]` et le dialog d'export le signale.

### P3 — Molécules

`smiles-drawer@2.4.1` pour la chimie organique (`CC(=O)Oc1ccccc1C(=O)O` →
squelette de l'aspirine). Utile au lycée, hors sujet au collège, et `\ce{}`
couvre déjà les équations. À garder en réserve.

### P3 — Diagrammes

Mermaid (`11.17.2`) pour les cycles SVT, les flux économiques. **Déconseillé** :
plusieurs Mo, rendu asynchrone (donc décalage de mise en page, voir ci-dessous),
et le bloc image couvre le besoin par capture d'écran. La complexité n'est pas
justifiée pour une carte mentale dont les blocs font 260 px de large.

### Sans bloc dédié

- **Phonétique (API)** — `/bɔ̃.ʒuʁ/` est de l'unicode. Un simple palier de
  boutons de symboles dans le bloc texte suffit ; aucun rendu spécial.
- **Langues à écriture non latine** — un attribut `lang` sur le bloc texte
  (police + direction), pas un type de bloc.
- **Géométrie** — un éditeur de figures est un projet à part entière. Le bloc
  image (capture GeoGebra) couvre le besoin réel.

### Récapitulatif

| Bloc | Dépendance | Poids | Matières | Priorité |
|---|---|---|---|---|
| `math` | katex + mhchem | ~280 kB | maths, physique, chimie | **P0** |
| `image` | aucune | 0 | SVT, géo, arts, géométrie, tout | **P0** |
| `table` | aucune | 0 | langues, histoire, physique, maths | P1 |
| `code` | aucune (v1) | 0 | NSI | P1 |
| `music` | abcjs | ~700 kB | musique | P2 |
| `audio` | aucune | 0 | langues, musique | P2 |
| `molecule` | smiles-drawer | ~200 kB | chimie organique | P3 |
| `diagram` | mermaid | ~3 Mo | SVT, éco | écarté |

## UI / UX

Contrainte posée : *simple, pratique, intuitif, et l'interface ne doit pas
bouger de partout à chaque changement.*

Le code respecte déjà cette contrainte à trois endroits, et ces précédents
dictent la suite :

- `DefinitionPopover` existe **précisément** parce que l'affichage inline de la
  définition redimensionnait la carte (voir son commentaire d'en-tête).
- Le titre est **toujours** un `<input>`, jamais échangé contre un `<span>`,
  parce que les deux n'ont pas la même taille intrinsèque (`CardNode.tsx`, le
  commentaire au-dessus du champ).
- `EdgeButton` passe par `x`/`y` de motion et jamais par un `transform` CSS
  brut, parce que `whileHover` l'écraserait (commentaire de `EdgeButtonProps`).

### Les huit règles anti-décalage

1. **L'empreinte de la carte ne dépend jamais du contenu de la définition.**
   Le contenu riche vit dans le popover. Sur la carte, au plus une rangée de
   pastilles de **hauteur fixe** (`fx`, `♪`, `🖼`, `{}`, `▦`) indiquant ce que
   la définition contient. Ajouter une formule ne redimensionne pas la carte.
2. **Le popover a une largeur fixe et une `max-height` avec défilement
   interne.** Une formule sur trois lignes et une image de 400 px tiennent dans
   la même boîte. Largeur actuelle 260 px (`DefinitionPopover.tsx:52`), à
   porter à ~340 px pour les formules — une fois, pas selon le contenu.
3. **Lecture et édition occupent la même boîte** : mêmes marges, même
   interligne, même largeur. C'est le principe de l'`<input>` de titre,
   appliqué au popover.
4. **Le rendu math est synchrone.** KaTeX rend pendant le commit React. Une
   bibliothèque asynchrone (MathJax, Mermaid) repeint après coup et fait sauter
   la mise en page. C'est un critère de sélection, pas un détail.
5. **Une image réserve sa boîte avant d'être décodée.** `width`/`height` sont
   stockés dans le bloc au moment de l'insertion ; le rendu pose un conteneur
   `aspect-ratio` immédiatement. Zéro reflow quand le fichier arrive — c'est le
   décalage le plus visible et le plus évitable.
6. **Changer de mode ne détruit jamais le contenu.** `text` → `math` conserve
   la chaîne comme source LaTeX ; `math` → `text` conserve le LaTeX comme
   texte. Réversible ⇒ explorable sans peur.
7. **L'insertion de bloc passe par une gouttière `+` permanente**, pas par une
   barre d'outils qui apparaît au survol et pousse le reste.
8. **Le sélecteur de mode est dans l'en-tête du popover, toujours visible.**
   L'en-tête « DÉFINITION » existe déjà (`DefinitionPopover.tsx:62-72`) et a
   une hauteur fixe : le sélecteur s'y installe sans rien déplacer.

### Le sélecteur de mode

Un segmented control d'icônes dans l'en-tête, libellés en français au survol :

```
┌───────────────────────────────────────────┐
│ DÉFINITION      [ T ][ fx ][ 🖼 ][ ▦ ][ ♪ ] │  ← hauteur fixe, toujours là
├───────────────────────────────────────────┤
│ On garde le signe du nombre le plus       │
│ éloigné de zéro, puis on soustrait…       │
│                                           │
│        (+10) + (−4) = +(10 − 4) = +6      │  ← bloc math, rendu KaTeX
│                                           │
│  ＋  ← gouttière d'insertion permanente    │
└───────────────────────────────────────────┘
        largeur fixe, max-height + scroll
```

**Le bouton est le chemin découvrable, pas le chemin obligatoire.** Trois
raccourcis en parallèle, parce qu'imposer un clic avant chaque formule tue le
flux « prise de notes en direct » que l'éditeur revendique :

- taper `$$` (ou `\(`) dans un bloc texte le convertit en bloc math sur place ;
- `Ctrl+M` insère un bloc math ;
- coller une image (`Ctrl+V`) ou en déposer une insère un bloc image — aucun
  mode à sélectionner au préalable.

### Éditer une formule sans connaître LaTeX

C'est le vrai risque d'adoption. Le public cible est un collégien : `\frac{a}{b}`
n'est pas « simple, pratique, intuitif ».

Deux options :

| | Saisie | Coût | Verdict |
|---|---|---|---|
| **MathLive** `<math-field>` (`0.110.0`) | WYSIWYG : `/` fait une fraction, clavier virtuel, sortie LaTeX | ~500 kB, chargé à la demande | **Recommandé** |
| Textarea LaTeX + aperçu KaTeX + palette de ~20 boutons | il faut savoir/apprendre le LaTeX | 0 kB de plus | Repli |

**Recommandation : KaTeX pour tout l'affichage, MathLive uniquement pour
l'éditeur, chargé en `import()` dynamique à la première ouverture d'un bloc
math en édition.** Le démarrage de l'app n'en paie rien, et les deux échangent
du LaTeX donc l'interopérabilité est acquise.

Pourquoi ne pas prendre MathLive seul (il sait aussi rendre, via
`convertLatexToMarkup()`) : le support de `\ce{}` / mhchem n'y est pas
documenté, alors qu'il est explicite côté KaTeX. Garder KaTeX à l'affichage,
c'est garder la chimie gratuitement. Le coût est une légère dérive de glyphes
entre l'éditeur et le rendu — à mesurer (spike 4), acceptable a priori. Le
spike 1 ayant montré que KaTeX traverse l'export sans dommage, garder KaTeX à
l'affichage ne coûte plus rien du tout.

## Images : capture, stockage, cycle de vie

### Stockage — sidecar, pas base64

Trois options, une seule tient :

| Option | Problème |
|---|---|
| Data URI dans le JSON | L'autosave réécrit **tout le fichier** à chaque frappe. Une capture de 2 Mo → +2,7 Mo de base64 réécrits en boucle. `serializeCards` pretty-print à 2 espaces n'arrange rien. Rédhibitoire. |
| Dossier `.assets/` global au workspace | Déduplication gratuite, mais une carte mentale n'est plus autoportante : la copier ailleurs casse ses images. |
| **Sidecar par carte** : `mon-chapitre.assets/<sha256>.png` | **Retenu.** Le JSON reste léger, la carte reste transportable comme une paire (fichier + dossier), et le hash déduplique une image collée deux fois. |

Le bloc référence `{ asset: "a3f9…c1.png" }` — un nom relatif au sidecar,
jamais un chemin absolu (qui casserait au premier déplacement du workspace).

### Garde-fous à l'insertion

- Redimensionner au-delà de ~1600 px de large avant écriture (une carte fait
  260 px : personne n'a besoin d'un 4000 px), ré-encoder en PNG/WebP.
- Refuser au-delà d'un plafond (~10 Mo) avec un message, plutôt que de laisser
  gonfler le dossier en silence.
- `alt` demandé (ou dérivé du nom de fichier) : c'est ce qui apparaîtra dans
  l'export XMind et dans la projection texte.

### Cycle de vie — trois pièges

1. **Le renommage / déplacement / suppression d'une carte doit emporter son
   sidecar.** `fileOps.ts` (`renamePath`, `deletePath`) ne connaît aujourd'hui
   que le `.json`. Sans ça, renommer une carte casse toutes ses images.
2. **Ne jamais ramasser les assets orphelins à l'autosave.** Supprimer un bloc
   image puis `Ctrl+Z` doit retrouver l'image. Le ramassage se fait à la
   fermeture du fichier, ou sur une action explicite « nettoyer les médias
   inutilisés », jamais dans la boucle d'autosave.
3. **Un asset manquant s'affiche en placeholder nommé**, pas en case vide :
   « image introuvable : a3f9…c1.png ». Cohérent avec le principe déjà posé
   dans le lot 3 — *aucun état caché sans explication*.

## Audit de l'export

Demande explicite : *vérifier que l'export gère bien tout ça.* Réponse courte :
**non, pas en l'état** — et pas seulement parce que le rendu n'est pas branché.
Onze points, du plus bloquant au plus mineur.

Trois d'entre eux ont été **mesurés** plutôt que supposés, dans un spike qui
rejoue le pipeline réel (mêmes options que `captureElement.ts`) sous Chromium :
`docs/superpowers/spikes/2026-09-08-contenus-riches/`. Le point 3 s'est révélé
**faux**, le point 4 **pire que prévu**, et abcjs **sans problème**.

### Ce qui casse aujourd'hui

**1. `StaticCardView` ignorerait complètement les blocs.**
`StaticCardView.tsx:39` affiche `{card.definition}` dans un `<p>`. Avec le
modèle proposé, une carte à formule s'exporterait en `\frac{20}{100}` littéral.
Il faut y brancher le même rendu de blocs que le popover — et le partager, pas
le dupliquer, sinon les deux dérivent.

**2. Chevauchement de cartes : la mise en page d'export est à hauteur fixe.**
`EXPORT_CARD_HEIGHT = 120` (`StaticCardView.tsx:6`) alors que
`ROW_HEIGHT = 168` (`columns.ts:8`) : il y a exactement **48 px de marge
verticale** par rangée, et `computeLayout` est purement géométrique — il ne
mesure rien. Une carte avec une image dépasse et **recouvre sa voisine**.
De même horizontalement : `COLUMN_WIDTH = 320` contre
`EXPORT_CARD_WIDTH = 260`, soit 60 px.
*Traitement v1* : plafonner la hauteur des blocs riches en export (image en
vignette ~48 px, `overflow: hidden`) — `computeLayout` reste pure et
intouchée. *Traitement long terme* : un troisième format d'export (voir
point 11).

**3. ~~Les polices KaTeX ne s'afficheront pas à la première capture.~~
Mesuré : faux dans cette configuration.**
Crainte initiale : `html-to-image` sérialise le DOM dans un `<foreignObject>`
SVG où les `@font-face` ne résolvent pas de façon fiable, et KaTeX dépend
entièrement de ses polices — symptôme attendu, une formule réduite à ses traits
de fraction. **Le spike (`docs/superpowers/spikes/2026-09-08-contenus-riches/`)
l'infirme** : la formule sort intacte dès la **première** capture, avec un
compte d'encre identique à froid, à chaud et après préchargement, et une
capture visuellement indiscernable du rendu natif du navigateur.
`html-to-image` lit les `cssRules` de la feuille KaTeX et embarque ses
`.woff2`/`.woff`/`.ttf` en data URI — les requêtes sont visibles côté serveur.
*Conséquence* : ni capture d'échauffement, ni `document.fonts.load()`, ni repli
MathJax. **Un seul moteur math, pas de dérive visuelle à craindre.**
*Réserve à lever* : le spike a tourné sous **Chromium**, ce qui couvre
directement Windows (WebView2) mais **ni macOS (WKWebView) ni Linux
(WebKitGTK)** — or `tauri.conf.json` déclare `"targets": "all"`, et c'est
justement sous WebKit que les `@font-face` dans un `<foreignObject>` ont été
historiquement les plus fragiles. À rejouer dans l'app réelle sur ces deux
plateformes (spike 5) avant de tenir le risque pour définitivement levé. Les
résultats abcjs et image cross-origin, eux, ne dépendent pas du moteur.
*Seule condition à tenir* : la CSS KaTeX doit venir du **bundle** (même
origine). Depuis un CDN, l'accès aux `cssRules` lève et les polices ne sont pas
embarquées — donc **jamais de CDN pour KaTeX**, à inscrire comme contrainte.

**4. Une image d'une autre origine fait échouer *tout* l'export.**
*Confirmé par le spike, et pire que prévu.* `convertFileSrc()` produit une URL
servie par le protocole `asset:` de Tauri, donc d'origine distincte de la page.
L'image s'affiche parfaitement dans le DOM — et `toPng` **rejette sa promesse**
en tentant de la ré-encoder en data URI. Ce n'est pas « l'image manque sur la
page exportée », c'est « l'export lève », page comprise.
*Traitement* : inliner chaque asset en data URI **avant** la capture (ou servir
`asset:` avec `Access-Control-Allow-Origin` — les deux correctifs sont validés
dans le spike). C'est du travail réel, pas une option, et il faut en plus un
message d'erreur : une exception nue sur un rejet non-`Error` (`toPng` rejette
avec un `Event`, pas une `Error`) traverserait mal le `catch` d'`ExportDialog`,
qui affiche `error instanceof Error ? … : 'erreur inconnue'`.

**5. La pagination compte des feuilles, pas des hauteurs.**
`PAGE_ROW_BUDGET = 6` (`pagination.ts:10`) suppose qu'une rangée ≈ une hauteur
constante. Avec des images, la hauteur par rangée explose et `assemblePdf`
réduit toute la page pour la faire tenir dans l'A4 (`assemblePdf.ts`,
`Math.min(…, 1)`) — **rendant le texte des cartes voisines illisible**.
*Traitement* : budgétiser en hauteur estimée plutôt qu'en nombre de feuilles.
La fonction est pure et testée, le changement est local.

**6. XMind ne porte que du texte brut.**
`cardsToXmindContent` écrit `notes: { plain: { content: card.definition } }`
(`exportXmind.ts:17`). Avec la projection texte, les formules sortent en
unicode dégradé — acceptable. Les images sont **perdues** : XMind sait les
embarquer (`resources/` + attribut `image`), c'est un chantier à part.
*Traitement v1* : le marqueur `[image : {alt}]` de la projection garantit que
rien ne disparaît sans trace, et le dialog d'export annonce la limite.

**7. `salvage()` jetterait une carte qui n'a qu'une image.**
`cardsValidation.ts:312` : `if (title === '' && definition === undefined) return null`.
Une carte sans titre dont tout le contenu est une image (cas typique d'un
schéma de SVT) serait **supprimée** par la réparation. `salvage()` doit
considérer `content` comme du contenu récupérable, et le recopier.

**8. `content` n'est pas validé.**
`isUsableCardRecord` (`cardsValidation.ts:71-83`) ne connaît pas le champ. Un
`kind` inconnu, un bloc image sans `asset`, un `rows` non tableau : autant de
plantages en rendu, exactement le scénario que le module de validation existe
pour empêcher. Il faut une validation par type de bloc, et une dégradation en
bloc `text` plutôt qu'un rejet de la carte.

**9. Le quiz tronque les indices au milieu du LaTeX.**
`truncateAtWordBoundary(card.definition, 0.5)` en difficulté « moyen »
(`quizReducer.ts:114`) coupe à un espace. Sur du LaTeX ça produit
`\frac{20}{10` — invalide, et KaTeX lève. La troncature doit s'appliquer à la
projection texte, ou tronquer par bloc entier.

**10. Les distracteurs de QCM se dédoublonnent sur la chaîne brute.**
`buildDistractorPoolFrom` (`quizReducer.ts:66-72`) utilise un `Set<string>` sur
`card.definition`. Avec la projection c'est cohérent par construction — à
condition que le QCM **affiche** le bloc riche tout en **comparant** la
projection. Un QCM sur des formules rendues est d'ailleurs un gain
pédagogique net, pas seulement une compatibilité à préserver.
`computeTitleSimilarity` ne porte que sur les titres : non concerné.

**11. Le fichier `.json` n'est plus autoportant.**
C'est aussi une surface d'échange : le copier seul perd ses images.
*Traitement* : (a) `fileOps` emporte le sidecar sur renommage/suppression ;
(b) un export « carte + médias » en `.zip` ; (c) le placeholder nommé du
point 3 de la section précédente.

### Deux intentions d'export, pas une

Le point 2 révèle un besoin de fond. « La carte » (vue d'ensemble, A4 paysage,
contenus riches en vignette) et « la fiche de révision » (une page par branche,
formules et images en taille réelle, lisible pour réviser) sont deux produits
différents. Le second est le bon endroit pour les images pleine taille, et il
évite de tordre `computeLayout` pour faire tenir les deux dans un seul rendu.
À proposer comme troisième format dans `ExportDialog`, après les blocs.

### Tableau de couverture visé

| Bloc | PDF / Image | XMind | JSON |
|---|---|---|---|
| `text` | ✅ | ✅ | ✅ |
| `math` | ✅ *(vérifié ; reste le point 1)* | ⚠️ unicode dégradé | ✅ |
| `image` | ✅ *(après points 1 + 2 + 4 + 5)* | ⚠️ `[image : alt]` | ⚠️ sidecar (point 11) |
| `table` | ✅ | ⚠️ lignes en texte | ✅ |
| `code` | ✅ | ✅ | ✅ |
| `music` | ✅ *(vérifié : SVG 100 % vectoriel)* | ⚠️ marqueur | ✅ |
| `audio` | ❌ *(impossible)* — marqueur | ⚠️ marqueur | ✅ |

## Impacts hors export

- **La skill `transformer-cours-en-carte-mentale`** doit apprendre à émettre
  `content` avec des blocs `math`. C'est par elle que le contenu arrive en
  volume : sans mise à jour, les cartes générées resteront en `20/100 x 425`
  et la fonctionnalité ne servira qu'à la saisie manuelle. La consigne de
  comparabilité des distracteurs (point 7 de la skill) doit être reformulée sur
  la projection texte.
- **`serializeCards`** ne change pas — `content` est du JSON ordinaire.
- **L'autosave** n'est pas menacé tant que les binaires restent hors du JSON
  (d'où le sidecar).

## Découpage proposé

| Lot | Contenu | Dépend de |
|---|---|---|
| 6a | Modèle `CardBlock`, `blocksToPlainText`, validation par bloc, `salvage` (points 7-8) | — |
| 6b | Rendu de blocs partagé popover / `StaticCardView` + sélecteur de mode + règles anti-décalage | 6a |
| 6c | Bloc `math` : KaTeX + mhchem à l'affichage, MathLive en édition différée | 6b |
| 6d | Export : polices KaTeX, inlining des assets, budget de pagination en hauteur (points 2-5) | 6c |
| 6e | Bloc `image` : `Ctrl+V` / drop / dialog, sidecar, cycle de vie `fileOps` (points 11) | 6b |
| 6f | Quiz : projection dans les distracteurs et la troncature, rendu riche en QCM (points 9-10) | 6a |
| 6g | Skill : émission de `content` | 6a |
| 6h | `table`, puis `code` | 6b |
| 6i | `music` (abcjs), `audio` | 6b |

## Spikes

Les deux premiers sont **faits** — harnais, protocole et résultats dans
`docs/superpowers/spikes/2026-09-08-contenus-riches/` (rejouable :
`node docs/superpowers/spikes/2026-09-08-contenus-riches/run.mjs`).

1. ~~**KaTeX dans `html-to-image`**~~ ✅ **fait — KaTeX passe.** Glyphes
   intacts dès la première capture, aucun contournement nécessaire. Le
   spike bloquant est levé : **un seul moteur math**. Seule contrainte qui en
   sort : charger la CSS KaTeX depuis le bundle, jamais depuis un CDN.
   Sous-produit : l'image d'une autre origine fait échouer tout l'export
   (point 4), et `toPng` rejette avec un `Event`, pas une `Error`.
2. ~~**abcjs en capture**~~ ✅ **fait — abcjs passe.** Le SVG produit contient
   26 `<path>` et **zéro `<text>`** : purement vectoriel, aucune police à
   résoudre, donc immunisé par construction. La partition sort intacte du PDF.
3. **`Ctrl+V` d'image dans le webview Tauri**, par OS — pour savoir si le
   plugin clipboard est un repli ou une nécessité.
4. **Dérive visuelle MathLive ↔ KaTeX** sur une dizaine de formules de collège.
   Ne concerne que le confort d'édition.
5. **Rejouer le spike 1 dans l'app Tauri réelle, sous macOS et sous Linux**
   (webviews WebKit, non couverts par une mesure sous Chromium). C'est la
   seule réserve qui pèse encore sur « un seul moteur math » ; les spikes 1
   à 3 restent acquis sous Windows.

## Hors périmètre

- Éditeur de figures géométriques (couvert par le bloc image).
- Diagrammes Mermaid (couvert par le bloc image, coût disproportionné).
- Import XMind des images et des notes riches — l'import reste texte.
- Contenu riche dans le **titre** de carte : le titre est la clé du quiz
  (`computeTitleSimilarity`, distracteurs de `qcm-title`) et doit rester une
  chaîne comparable.

## Sources

- [MathLive — Mathfield](https://mathlive.io/mathfield/) · [avec React](https://mathlive.io/mathfield/guides/react/) · [npm](https://www.npmjs.com/package/mathlive)
- [KaTeX — extension mhchem](https://github.com/KaTeX/KaTeX/blob/main/contrib/mhchem/README.md) · [manuel mhchem](https://mhchem.github.io/MathJax-mhchem/)
- [KaTeX + html-to-image : image blanche, cause et correctif](https://dev.to/x_kernel27795/katex-html-to-image-outputs-a-blank-white-image-heres-why-and-how-to-fix-it-2ikd) · [html-to-image #213 — polices](https://github.com/bubkoo/html-to-image/issues/213)
- [MathJax 4 — options de sortie SVG (`fontCache`)](https://docs.mathjax.org/en/latest/options/output/svg.html)
- [abcjs](https://www.npmjs.com/package/abcjs) · [démo de changement de glyphes](https://paulrosen.github.io/abcjs/examples/change_glyphs.html)
- [OpenSheetMusicDisplay — comparatif des bibliothèques](https://opensheetmusicdisplay.org/blog/sheet-music-display-libraries-browsers/) · [VexFlow](https://www.vexflow.com/)
- [Tauri v2 — clipboard-manager](https://v2.tauri.app/reference/javascript/clipboard-manager/) · [tauri-plugin-clipboard (images)](https://github.com/CrossCopy/tauri-plugin-clipboard)
- [smiles-drawer](https://www.npmjs.com/package/smiles-drawer)
