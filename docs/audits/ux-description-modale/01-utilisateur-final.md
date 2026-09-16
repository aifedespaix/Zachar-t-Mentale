# Audit UX — modale de description

**Persona unique : l'utilisateur final lambda.** Quelqu'un qui révise ses cours.
Pas un développeur, pas un designer, pas un power user. Il écrit une définition,
il veut y mettre une formule, il n'a jamais entendu parler de LaTeX.

Aucun code écrit, aucun fichier modifié — hormis ce rapport.

## Ce que j'ai lu pour juger (et pas seulement deviner)

| Fichier | Ce que j'y ai vérifié |
| --- | --- |
| `src/content/DescriptionDialog.tsx` | modale `min(1600px, 96vw)` × `min(94vh, 1180px)`, contenu bridé à `maxWidth: 1080` ; les 4 `NavArrow` posées à `-18px` **hors du cadre** ; `NAV_RELATION` (« Précédent / Suivant / Parent / Sous-partie ») ; footer (« Enregistré automatiquement », « Raccourcis », « Fermer ») ; `ShortcutsPanel` qui documente `Entrée` = Nouveau bloc et `Maj + Entrée` = Retour à la ligne ; autosave 600 ms ; pas de toolbar haute |
| `src/content/BlockEditor.tsx` | `GHOST_BUTTON` 30×26, gutter 24 px, poignée de drag 24 px ; `BlockKindMenu` (l. 799) ; `BlockFooter` visible **uniquement sur le bloc actif** ; `TableFooter` ; `TableField`/`TableCellField` (handles 18 px, `+` **déjà** entre colonnes et à gauche de chaque ligne) ; drag & drop HTML5 avec `outline` pointillé seulement ; `insertBlockAfter(index, { kind: 'text', text: '' })` en dur ; aucun handler `Tab`, aucun `Ctrl+Entrée` |
| `src/content/MathFieldEditor.tsx` | `const [showMathField] = useState(() => loaded)` (l. 103) — décidé **une fois au montage** ; le `fallback` porte le textarea LaTeX **et** l'aperçu KaTeX empilés ; `Entrée` (sans `Maj`) = nouveau bloc |
| `src/content/MathPalette.tsx` | 3 groupes, 18 touches, libellés français visibles sous les glyphes ambigus, cibles 46×44 / 70×52, `title` natif sur chaque touche |
| `src/types/cardBlock.ts` | `text \| math \| image \| table`. **Aucun type conteneur, aucun `children`.** Cellule = `string \| { latex }` — pas d'image possible |
| `src/content/descriptionHistory.ts` | undo **propre à la description**, `MAX_DEPTH = 100`, par carte, perdu au rechargement |
| `src/components/ui/tooltip.tsx` | un vrai `Tooltip` Radix existe déjà (`delayDuration = 0`) |

---

## Verdict global

La liste est surtout du poli pour quelqu'un qui connaît déjà l'app. Sur 18 idées :
**3 vrais bugs** à corriger tout de suite (#11, #12, #14-label), **4 gains sans
risque** (#2, #7, #13, et le « + » de #15 qui existe déjà), **5 idées qui me
ralentissent ou me perdent** (#3-Tab, #8, #9, #10, #18). Rien dans la liste ne
répond à ma vraie question de première ouverture : *comment je découvre tout seul
qu'on peut écrire une formule ?* C'est le seul point qui peut me faire abandonner
l'app le premier soir.

---

## Les 18 idées, une par une

> Chaque idée est citée dans les mots du propriétaire du produit, puis jugée avec
> mes yeux d'élève : est-ce que je trouve ça tout seul demain ? est-ce que ça me
> ralentit dans le cas à 90 % (écrire une définition avec une formule) ?

### #1 Icônes seules + tooltip aux couleurs de la carte cible
> *« le bouton qui va vers le parent ou vers l'enfant, il faudrait afficher uniquement l'icône, et afficher le titre en tooltip sur hover (le design du tooltip doit être celui de la card cible…) tous les boutons pour changer de carte cible doivent avoir une animation hover »*

**⚠️ Modifier.** Aujourd'hui, les mots « Parent / Précédent / Suivant /
Sous-partie » sont ce qui m'apprend la structure de ma carte : « ↑ Précédent » et
« ← Parent », je les distingue sans réfléchir, deux flèches nues non. Je dois
survoler pour savoir où j'atterris — et un tooltip ne s'affiche pas au clavier.
Garde un mot court + l'icône, et l'animation hover oui, mais discrète.
Objection concrète : les 4 flèches vivent à `-18px`, **à moitié hors du cadre de
la modale** — si on les réduit à une icône, elles deviennent une cible de 20 px
collée au bord de l'écran, à viser à la souris.

### #2 Animer le déplacement des blocs
> *« quand on déplace des blocs, ils doivent s'animer pour bien montrer où ils vont et lequel vient à la place (vitesse classique d'une bonne UX) »*

**✅ Garder.** Déplacer un bloc sans aucun retour est angoissant : je lâche la
souris et je ne sais pas si j'ai déplacé le bon. Aujourd'hui il n'y a qu'un
`outline` pointillé (§ `BlockEditor.tsx:537`). Une animation courte qui montre le
bloc qui suit la souris et les autres qui se décalent ne me coûte rien pendant que
je tape. Seule réserve de forme : elle doit respecter « mouvement réduit », sinon
c'est du bruit sur une machine lente.

### #3 Raccourcis : `Entrée` = ligne, `Ctrl+Entrée` = bloc, `Tab` = changer le type
> *« [enter] doit ajouter une ligne plutôt que de créer un nouveau bloc ; [ctrl+enter] doit accepter ajouter un bloc ; [tabulation] doit changer le type de bloc (formule ↔ texte) (dis-moi si le raccourci est bon) »*

**⚠️ Modifier (et ❌ sur `Tab`).**
- `Entrée` = **ligne** : oui. C'est ce que Word m'a appris, et aujourd'hui, quand
  j'écris une définition en trois phrases, `Entrée` me coupe en deux et crée un
  bloc que je n'ai pas demandé. Mais l'app **documente déjà l'inverse** dans le
  panneau « Raccourcis » (`Entrée` = Nouveau bloc, `Maj + Entrée` = Retour à la
  ligne) : je vais devoir désapprendre. Si on inverse, il faut que la nouvelle
  règle soit écrite là où je tape, pas seulement dans le panneau.
- `Ctrl + Entrée` = **bloc** : je ne le trouverai jamais tout seul. C'est le
  raccourci de celui qui connaît déjà l'app ; il doit rester un doublon du bouton
  « Ajouter un bloc », pas la seule façon de créer un bloc au clavier.
- `Tab` = **changer le type** : ❌ à refuser. `Tab` c'est « champ suivant »
  partout — y compris pour sortir d'une case de tableau. Détourner la touche la
  plus utilisée de mon clavier pour transformer un bloc, c'est changer des types
  sans le vouloir en permanence. Si un raccourci est vraiment voulu : une
  combinaison explicite (`Ctrl + Maj + M` par exemple), jamais `Tab` seul.

### #4 Le nouveau bloc garde le type du bloc du dessus
> *« la fonctionnalité ajout de bloc (clic ou raccourci) doit garder le même type que le bloc du dessus (rester formule ou texte) »*

**⚠️ Modifier.** Utile dans un seul cas : écrire plusieurs formules d'affilée
(aujourd'hui chacune naît en texte, il faut recliquer sur le menu de droite à
chaque fois). À limiter : on n'hérite que de `text`/`math`, **jamais** de
`tableau` ni d'`image`, et **pas** depuis le bouton « Ajouter un bloc » en bas de
la modale — sinon, après un tableau, j'obtiens un tableau vide que je n'ai pas
demandé. Sans cette limite, l'idée me fait perdre du temps au lieu d'en gagner.

### #5 Palette de symboles : du footer vers une toolbar en haut, avec switch animé
> *« plutôt que de les mettre en footer de chaque bloc, il faudrait les mettre en toolbar en haut ; réduire un peu la place prise ; ça doit switch quand on focus ou crée un bloc de type texte ou formule, avec une animation slide right/left »*

**⚠️ Modifier.** Le problème réel est bon : le footer n'apparaît **que sur le
bloc actif** (`BlockEditor.tsx:591`), donc en passant d'un bloc à l'autre le
contenu se déplie/se replie et **le texte bouge sous mon curseur pendant que
j'écris**. Mais la solution proposée a un coût : dans une modale large de
`min(1600px, 96vw)`, une barre fixe en haut m'oblige à quitter la ligne où
j'écris pour aller chercher un symbole — et surtout, elle m'empêche de voir *sur
quel bloc* le symbole va tomber (aujourd'hui c'est évident : il est juste
dessous). Compromis que je recommande : **réserver la place** du footer pour
supprimer le saut, le garder attaché au bloc, et se passer du slide animé.

### #6 Formule WYSIWYG : `Entrée` = nouvelle ligne dans la formule
> *« les champs latex wysiwyg, permettre, quand on appuie sur [enter] d'aller à la ligne pour en taper une nouvelle »*

**⚠️ Modifier.** Acceptable **seulement si #3 est appliqué aussi au texte** :
sinon la même touche veut dire deux choses selon le bloc, et c'est exactement ce
qui me perd. Aujourd'hui `Entrée` dans une formule = nouveau bloc
(`MathFieldEditor.tsx:163-167`), et le commentaire du code assume « une formule
est une ligne par construction ». Si on change, il faut une sortie claire (une
touche ou un bouton pour quitter la formule), sinon je reste coincé dedans.

### #7 Focus automatique après changement de type (clic)
> *« quand on passe de formule à texte ou vice versa via clic, mettre automatiquement le focus sur le champ »*

**✅ Garder.** Petit, gratuit, évident. Aujourd'hui je clique « Formule » et
**rien ne se passe visiblement** : je dois recliquer dans la boîte pour écrire,
et je crois que ça n'a pas marché. Le focus va dans le champ, point. C'est dans
le trio de tête des gains.

### #8 Un bouton « Question » qui ajoute un champ d'en-tête bleu dans un bloc
> *« rajouter un bouton icon + texte "Question" : quand on clique, ça ajoute un champ header en texte bleu clair (adapté thème dark/light) qui permet de taper une question »*

**❌ Refuser.** Je ne comprends pas ce que c'est, et je vais me tromper. Une
**carte est déjà une question** dans le quiz (l'app me demande « que signifie
X ? ») : un champ bleu « Question » *à l'intérieur* de ma définition, je vais
écrire ma définition dedans. Le besoin décrit — « répondre à des questions
directement ici » — c'est l'écran de quiz, pas la modale de description.

### #9 Une question = un bloc « parent » contenant des blocs, bordure et fond bleus
> *« une question est un bloc "parent" qui peut contenir plusieurs blocs, les questions ont une bordure bleue, un fond bleu un peu transparent, mais ses enfants ont bien le bon fond de couleur propre à eux (dis-moi si c'est une bonne idée en ux) »*

**❌ Refuser tel quel** (réponse directe à la question posée : non, ce n'est pas une
bonne idée en l'état). Un « bloc parent » contre une « **carte** parente » — qui
existe déjà dans la carte mentale — c'est le même mot pour deux choses
différentes. J'aurais peur de manipuler un bloc en croyant manipuler une carte.
Et la **couleur porte déjà le niveau** d'une carte partout dans l'app : un bloc
bleu vole ce code de lecture. Je perds mes repères au lieu d'en gagner.

### #10 Une description peut contenir des blocs *ou* des blocs parents
> *« une description peut contenir soit des blocs soit des blocs parents et les organiser »*

**🏗️ À décomposer.** Le besoin « organiser » est **déjà** rendu par les
parents/enfants de la carte mentale. Avant d'ajouter une seconde hiérarchie
*à l'intérieur* d'une description, il faut dire qui en a besoin et à quel moment
précis ; sinon j'ai deux arbres à gérer et je ne sais plus où j'ai rangé quoi.

### #11 Bug : on voit deux champs pour une formule
> *« y'a un bug sur les champs formules : quand ils sont chargés on en voit deux : format texte + visuel ; quand on change le type (vers texte puis retour vers formule) ça affiche bien comme il faut en WYSIWYG »*

**✅ Garder — priorité 1.** C'est le seul point qui me bloque au moment exact où
j'écris une formule, donc sur le cas à 90 %. À la première formule d'une session
je vois **deux boîtes** pour une seule formule, dont une en LaTeX monospace avec
des `\frac{}{}` : je ne sais pas laquelle remplir, j'écris dans la mauvaise, et
je crois que l'app est cassée.
**Fait vérifié (confirmé par la lecture du code) :** ce n'est pas une impression —
`MathFieldEditor.tsx:103` (`useState(() => loaded)`, décision prise une fois au
montage) + le `fallback` de `BlockField` qui empile textarea LaTeX **et** aperçu
KaTeX. Ensuite MathLive est chargé et le bloc suivant s'ouvre en WYSIWYG.
**Ce que j'ajoute en tant qu'utilisateur :** même une fois le chargement corrigé,
le champ LaTeX brut ne doit **jamais** apparaître tout seul. Si le WYSIWYG n'est
pas prêt, montre une boîte de formule normale (ou un état « je charge »), pas du
code. C'est la chose la plus effrayante de tout l'écran pour moi.

### #12 Case de tableau en formule : mauvaise largeur
> *« en mode tableau, quand on change une case en mode "formule" le champ ne fait pas la bonne taille, il doit prendre la largeur de la case mère »*

**✅ Garder.** Une case plus étroite que ses voisines et mon tableau a l'air cassé.
Je n'ai pas besoin de comprendre pourquoi, j'ai besoin que ça s'aligne. Aucun coût
pour moi, aucun risque : à corriger.

### #13 Boutons undo/redo en icônes dans la toolbar du haut
> *« rajouter les boutons undo / redo en icônes avec bonne couleur / disabled etc dans la toolbar du haut »*

**✅ Garder, mais où ?** Il n'y a **pas de toolbar haute** dans cette modale : le
header ne contient que le fil d'Ariane et le titre. Ces boutons atterriraient
donc près de la croix de fermeture, ou en bas à côté de « Raccourcis ». Peu
importe, l'essentiel est ailleurs : un « ↶ » cliquable que je vois après avoir
supprimé un bloc, c'est ce qui fait la différence entre « j'ose essayer » et
« j'ai peur de tout casser ». Je ne connais pas `Ctrl + Z` sur cet écran, mais je
connais la flèche courbe.
**Réserve honnête :** l'undo d'ici est celui de la description (100 pas par
carte, `descriptionHistory.ts`), pas l'undo global, et il disparaît au
rechargement. Le tooltip doit dire la vérité, pas promettre « annuler » sans
limite.

### #14 Le menu de droite annonce « image » pour un tableau ; y déplacer ligne/colonne
> *« en mode tableau, dans la liste des actions à droite, ça met "image" plutôt que tableau ; il faudrait également placer les boutons ajouter colonne + ajouter ligne dans la liste de boutons à droite, pour enlever le footer du tableau »*

**⚠️ Modifier (moitié à garder, moitié à refuser).**
- Le label est **un mensonge** : mon tableau est annoncé « Image » dans le bouton
  de droite, et le menu ne propose ensuite que Texte/Formule — donc le bouton
  décrit un état que le menu ne sait même pas produire. **Fait vérifié :** le
  libellé vient de `BlockEditor.tsx:799` (`kind === 'math' ? 'Formule' : kind === 'text' ? 'Texte' : 'Image'`), qui traite tout le reste — dont `table` — comme
  « Image ». Quand un bouton me ment sur ce qu'est mon bloc, je doute de tout le
  reste de l'écran. À corriger absolument.
- Déplacer « ajouter ligne / colonne » dans le menu de droite : **non**. Monter un
  tableau 4×3 passerait à deux clics par ligne au lieu d'un, et le footer du
  tableau est le seul endroit qui m'explique les `+` et les corbeilles. On peut
  raccourcir ce texte, pas supprimer les boutons.

### #15 Tableau : bien placer les « + » et permettre le drag des lignes/colonnes
> *« les boutons "+" qui ajoutent les colonnes et lignes, il faudrait les placer au bon endroit : entre deux colonnes ou deux lignes (+ aux extrémités) ; permettre également de déplacer les lignes/colonnes du tableau via une icône avec drag/drop et affichage en direct »*

**⚠️ Modifier.** Première moitié : **c'est déjà fait**. Dans
`TableField`/`TableRow`, chaque colonne a son `+` (et sa corbeille) au-dessus
d'elle, et chaque ligne a le sien à sa gauche — vérifie dans l'app avant de
refaire l'existant. Ce que je veux vraiment, c'est que ces boutons de **18 px**
(`HANDLE_BUTTON`) soient cliquables **sans viser** : aujourd'hui je rate, donc je
ne m'en sers pas.
Seconde moitié : ajouter une poignée de drag par-dessus ces deux boutons fait de
ce coin de 40 px un champ de mines. Déplacer une ligne de tableau est rare dans
une définition ; deux flèches (monter/descendre) dans le menu, ou tirer le numéro
de ligne, suffisent. Le drag « aperçu live » est du luxe qui me coûte de la
précision.

### #16 Ajouter « image » au choix de type (bloc **et** case de tableau)
> *« le bouton pour choisir formule / texte : rajouter image (autant dans la barre de droite d'un bloc que dans une case du tableau) »*

**⚠️ Modifier.** Oui pour le **menu de bloc** : c'est là que je déclare ce qu'est
mon bloc, et une image dans une définition (schéma, figure de géométrie) est un
vrai besoin. Mais l'entrée doit **ouvrir le sélecteur de fichier** — pas
transformer mon texte en image vide. Non pour les **cases de tableau** : la
donnée ne le permet pas (`TableCell = string | { latex }`) et une photo dans une
case de ~90 px est illisible. Enfin, l'app a **déjà** un bouton « Insérer une
image » en bas de la modale : deux entrées pour la même chose doivent être
clairement la même chose, sinon je me demande laquelle est la bonne.

### #17 Des tooltips au lieu des `title` sur tous les boutons de l'app
> *« pense à rajouter des tooltip plutôt que des title sur tous les boutons de l'app »*

**⚠️ Modifier.** Sur un bouton **sans texte** — le petit « ∑ / Aa » des cellules,
les flèches du gutter, la corbeille — le tooltip aide vraiment : le `title` natif
met une seconde à apparaître, s'affiche en gris système et fait « vieille page
web ». Un vrai tooltip Radix existe déjà dans le design system
(`src/components/ui/tooltip.tsx`, `delayDuration: 0`) et il ne coûte rien.
Mais **pas partout** : sur les touches de la palette de symboles, qui portent
déjà leur nom écrit dessous (« Fraction », « Racine carrée »), et sur les boutons
qui ont un libellé visible (« Ajouter un bloc », « Fermer »), c'est du bruit qui
repasse par-dessus ce que je lis déjà. Et un tooltip ne remplace pas le nom lu
par un lecteur d'écran : `aria-label` reste, on ajoute, on ne retire pas.
*Note : la demande dit « sur tous les boutons de l'app » — hors de cette modale,
c'est un chantier transverse (`AppToolbar`, `CardNode`, `FileSidebar`…) qui
n'apporte rien au cas « écrire une définition ».*

### #18 « + » sur les flèches quand il n'y a pas de voisin, pour créer une carte
> *« le bouton suivant / précédent, si jamais il n'y en a pas, ça doit être un bouton "+" qui permet de créer l'enfant/frère précédent ou suivant, et quand on clique, mettre automatiquement le focus sur le titre »*

**❌ Refuser tel quel.** C'est la **seule idée de la liste qui me ferait casser ma
carte**. J'explore les flèches autour de la modale, je clique sur un `+` à peine
visible au bord du cadre, et je crée une carte — **où ? sous quel parent ? derrière
cette fenêtre ?** Je ne le vois pas, et la modale est justement conçue pour être
difficile à quitter par accident. Créer une carte est une décision de structure :
ça se prend sur la carte mentale, là où je vois l'arbre. « Frère précédent » ne
veut rien dire pour moi.
Si le besoin est réel, la version acceptable est : un `+` **uniquement** quand le
voisin est absent, qui **annonce le parent de destination**, et qui m'emmène sur
la carte après création pour que je voie où elle est tombée.

---

## Les 3 idées qui me font gagner le plus

1. **#11 — le bug de la double boîte de formule.** C'est le seul point qui me
   bloque à l'instant précis où j'écris une formule, donc sur le cas à 90 %. Tant
   qu'il est là, je ne crois pas au reste de l'app.
2. **#13 — undo / redo visibles.** Ça transforme la peur de casser en liberté
   d'essayer, sur un écran où je viens de supprimer un bloc et où je ne connais
   pas les raccourcis.
3. **#7 — focus automatique après changement de type.** J'écris une formule sans
   lever les mains, et surtout je comprends que mon clic a bien fonctionné.

*(Juste derrière, #2 : voir le bloc suivre la souris quand je le déplace.)*

## Les 3 idées qui me feraient perdre du temps ou me perdre

1. **#9, avec #8 et #10 — la seconde hiérarchie « blocs parents » bleus.** Dans
   une app dont toute la structure est déjà des parents/enfants, je ne saurai plus
   si je manipule un bloc ou une carte. Et je vais écrire dans le mauvais champ.
2. **#3, sa partie `Tab` — changer le type de bloc au `Tab`.** C'est la touche que
   j'utilise le plus pour me déplacer ; détournée, je change des types sans le
   vouloir, y compris dans les cases de tableau. Un raccourci ne doit pas coûter
   une convention universelle.
3. **#18 — le `+` au bord de la modale qui crée une carte.** Le clic que je fais
   une fois en explorant, que je regrette, et dont je ne sais pas comment
   revenir. Un `+` qui crée une structure invisible, c'est le contraire d'aider.

## Ce qui manque dans la liste (le plus important)

- **Comment je découvre la formule toute seule.** À la première ouverture j'ai un
  bloc vide et un bouton qui dit « Texte » — rien ne m'annonce qu'autre chose
  existe. Il faut deviner le menu de droite, ou connaître `$$`. Aucune des 18
  idées ne traite ce mur : c'est pourtant mon premier contact avec l'app.
- **Un état « je charge » pour la première formule, une fois pour toutes.** Le
  premier bloc-formule d'une session n'a pas d'état de chargement, il a un champ
  LaTeX (`MathFieldEditor.tsx:103`). Même hors bug #11, il faut décider ce que je
  vois pendant que MathLive arrive — et ce ne doit pas être du code.
- **Le saut de mise en page sous mon curseur.** Le footer apparaît/disparaît selon
  le bloc actif (`BlockEditor.tsx:591`) : quand je clique d'un bloc à l'autre, le
  texte que je lis se décale. C'est le vrai fond du #5, et ça n'est pas traité
  comme tel dans la liste.
- **Rien sur le mouvement réduit et les machines lentes.** La liste ajoute de
  l'animation un peu partout (#1, #2, #5, #15) dans un écran que j'utilise **en
  cours, pendant que le prof parle**. Et les 4 flèches à `-18px`, à moitié hors
  du cadre, sont déjà difficiles à viser : si on les réduit à une icône (#1), ça
  devient un jeu d'adresse.

---

## Précisions après les faits vérifiés communiqués

- **#11 : confirmé, ce n'est pas une impression.** Le mécanisme est bien
  `MathFieldEditor.tsx:103` + le `fallback` empilé de `BlockField`. Mon avis
  d'utilisateur ne change pas sur le fond, mais il s'ajoute une exigence que le
  correctif technique seul ne couvre pas : **le LaTeX brut ne doit jamais
  s'afficher sans que je l'aie demandé**, même pendant le chargement ou si
  MathLive échoue.
- **#14 : confirmé comme vrai bug** (`BlockEditor.tsx:799`) — et c'est plus grave
  qu'une coquille : le bouton de droite affiche « Image » pour un tableau alors
  que le menu ne propose que Texte/Formule. Ce n'est donc pas juste un mot faux,
  c'est un bouton qui décrit un état que l'interface ne sait pas produire.
- **#17 : la demande porte sur toute l'app** (`AppToolbar`, `CardNode`,
  `FileSidebar`…), pas seulement sur la modale. Du point de vue du cas d'usage
  « écrire une définition », le gain est concentré sur les boutons **sans texte**
  de la modale (palette, gutter, « ∑ / Aa », corbeilles) ; le reste est du
  nettoyage de cohérence, pas un gain de temps pour moi.
- **#3 : l'inversion est réelle.** Le panneau « Raccourcis » de la modale
  documente aujourd'hui `Entrée` = Nouveau bloc et `Maj + Entrée` = Retour à la
  ligne (`DescriptionDialog.tsx:584-585`). Passer à `Entrée` = ligne demande donc
  de changer la documentation **et** de me prévenir là où j'écris, sinon je crois
  que l'app a un bug.
