# Audit UX — la modale de description vue par un élève (terminale, maths, en cours)

Persona unique : élève de terminale (17 ans), maths, laptop en classe, le prof dicte vite.
Je ne juge que depuis ce terrain : gestes comptés, secondes perdues, ce que je rate quand
le prof parle. Aucune considération d'architecture, sauf quand une idée ne *peut pas*
marcher avec les données de l'app — et là je le dis.

Fichiers lus : `src/content/DescriptionDialog.tsx`, `BlockEditor.tsx`, `MathFieldEditor.tsx`,
`MathPalette.tsx`, `BlockView.tsx`, `blocks.ts`, `descriptionHistory.ts`,
`src/types/cardBlock.ts`, `src/types/commands.ts`, `src/components/CardNode.tsx` (partie quiz),
`src/components/quiz/RecallDialog.tsx`, `admin/src/lib/quality.ts`.

**Réserve honnête** : les entrées 12 et 13 de la liste me sont arrivées tronquées ; je les juge
d'après mon brief initial (#12 = les `+` intercalés du tableau). Le reste est jugé verbatim.

---

## Verdict global

En cours, tout ce qui me fait lâcher le clavier pour la souris me coûte la phrase suivante du
prof. Je perds du temps sur trois choses précises, dans cet ordre :

1. **`≤`, `→`, `π`, `∞` n'existent pas dans un bloc texte.** La palette mathématique n'est
   rendue que pour un bloc `math` (`BlockEditor.tsx:878`) ; le footer d'un bloc texte, lui,
   ne propose que des lettres accentuées, des ligatures et des guillemets
   (`LanguageCharacterPalette`). Une définition « du français + un symbole » n'a donc aucune
   écriture naturelle : je la découpe en petits blocs, ou je tape « <= » et je perds le sens.
2. **La première formule de la session m'ouvre deux champs**, et dans ce champ-là la palette
   écrit à la fin du texte et pas au curseur (#11).
3. **Le tableau est invisible.** Le menu « Type du bloc » ne propose que Texte et Formule
   (`BlockEditor.tsx:818-829`), et sur un tableau ce menu affiche « Image » (#14). Je conclus
   que les tableaux n'existent pas, alors que le code les fait très bien.

Ce qui me ferait gagner : ne pas rechanger de type entre deux formules (#4), et que le tableau
soit trouvable. Ce qui me ferait perdre : toute touche qui me vole `Tab` ou `Entrée`.

---

## Mes scénarios réels, chronométrés

### A — la dictée avec un symbole (le plus fréquent)

Le prof dicte : « f est croissante sur I si pour tous a, b de I : a ≤ b ⇒ f(a) ≤ f(b) ».
Je tape la phrase dans le bloc texte. Il me faut `≤`. Trois chemins, tous mauvais :

- **Découper** : `Entrée` (nouveau bloc) → clic sur le menu de type → clic « Formule » → clic sur
  `≤` dans la palette. **4 gestes par symbole**, et ma phrase est maintenant un empilement de
  3 blocs séparés.
- **Le hack `$$`** : je finis la phrase par `$$` (2 frappes) → tout le bloc devient une formule.
  Rapide, mais le lendemain ma prose française s'affiche en italique mathématique.
- **Écrire « <= »** et perdre l'égalité au sens strict.

Réaliste : **4 à 8 secondes et les yeux quittés du prof par symbole**. Sur une définition de
deux lignes avec trois symboles, c'est 20 s — soit la phrase suivante.

### B — deuxième formule, conversion, erreur

Après une formule, `Entrée` fabrique **toujours** un bloc texte (`BlockEditor.tsx:561`).
Formule 2 = taper `$$` (2 frappes, si je le sais) ou **2 clics** (menu de type → Formule).
Convertir un texte en formule : même menu, mon texte revient comme source LaTeX — acceptable.
Erreur : `Ctrl+Z` marche et reste local à la fiche, mais sa **granularité est une pause de
600 ms** (`DescriptionDialog.tsx:80`, `descriptionHistory.ts:47-52`) : un seul `Ctrl+Z` me rend
3 à 4 s de frappe, pas la lettre fautive. 100 pas d'historique, donc largement de quoi revenir.

### C — tableau de signes

Bloc vide → clic sur l'icône « colonnes » (`BlockEditor.tsx:577-587` ; aucune étiquette
visible, juste un `title`) → tableau 1×2 ; puis 1 clic sur `+` au-dessus d'une colonne ;
2 clics sur `+` à gauche des lignes — ou, plus rapide, `Entrée` dans une cellule, qui ajoute la
ligne suivante (`:1400`). **~4 clics + 2 menus pour un 3×3, soit 20-30 s**, sur des cibles de
18 px à 42 % d'opacité (`:1332-1351`).

Puis le contenu : `-∞`, `+∞`, `≤` dans les cellules → **aucune palette**. Les cellules ne
s'enregistrent pas dans `mathFields` (`ref={() => {}}`, `:1428`), donc la palette du footer ne
les voit pas. Sur la première cellule formule de la session je dois taper `\infty`, `\leq` à la
main. Et un **tableau de variations** (flèches, cellules fusionnées) est impossible : je colle
une capture d'écran.

### D — le lendemain, je relis

Sur écran, c'est bon : `BlockView` rend les vraies formules et les vrais tableaux, et le QCM
sait ré-afficher les blocs d'une option (`CardNode.tsx:1166-1177`). Ce qui est cassé :

- mes tentatives de formule multi-lignes reviennent sur **une seule ligne** (voir #6) ;
- la fiche est un empilement de blocs, et cliquer n'importe où ouvre un footer qui pousse tout
  vers le bas ;
- une question écrite dans la fiche ne m'est **jamais posée** : le quiz masque le **titre**, la
  définition n'est qu'un indice (`RecallDialog.tsx:21-33`) ;
- dans le QCM, mon option est comparée comme **texte plat** (`CardNode.tsx:1149` puis
  `:1169`, `allCards.find(c => c.definition === option)`).

---

## Les 18 idées, jugées depuis mon terrain

1. **Boutons parent/enfant en icône seule + nom en tooltip** — ❌. Aujourd'hui l'arrow me dit
   « Suivant : Théorème de Pythagore », dans les couleurs de la carte visée : je sais *où je
   vais* sans rien toucher. Icône seule = il faut survoler, attendre le tooltip, à la souris.
   Cacher le nom rend la navigation plus jolie et plus lente.
2. **Animation des blocs déplacés** — ⚠️. Joli, mais en cours je ne réordonne pas : j'écris dans
   l'ordre dicté. Utile le soir, quand je réorganise une fiche. Zéro seconde gagnée en classe.
3. **`Entrée` = ligne, `Ctrl+Entrée` = bloc, `Tab` = type de bloc** — ❌ pour `Tab`, ⚠️ pour
   `Ctrl+Entrée`. `Tab`, c'est mon réflexe « champ suivant », et **dans un tableau c'est ma
   touche de remplissage cellule par cellule** ; la détourner en « changer le type » rendrait le
   tableau de signes infernal. En plus, sur le canevas `Tab` crée une sous-carte et `Entrée` une
   carte en dessous (`commands.ts:235, 243, 251`, et `Mod+Entrée` ouvre cette modale `:274`) :
   inverser dans la modale, c'est la même touche avec deux sens à un écran d'écart. Et je ne
   retiendrai pas `Ctrl+Entrée` — je l'ai mémorisé comme « envoyer » dans Teams/Discord.
4. **Le nouveau bloc garde le type du dessus** — ✅ le meilleur gain de la liste, avec un piège.
   Trois formules d'affilée = 3 × (2 clics ou `$$`) économisés, sans lâcher le clavier. Le
   piège : hériter de `math` quand je reprends la prose m'affiche « donc » en italique, et je
   dois rouvrir le menu. Idéal : le bloc vide hérite, et repasse en texte dès que j'y tape de
   la prose.
5. **Palette dans une barre en haut, changeant selon le bloc focus** — ❌. C'est 800-1000 px de
   trajet souris au moment précis où je ne veux pas quitter le clavier ; sous la formule, la
   palette est juste sous ce que j'écris. Et si elle change avec le bloc *focus*, je clique un
   symbole sans certitude du bloc qui va le recevoir. (Vrai défaut à corriger autrement : elle
   ne s'affiche que sous le bloc actif, ce qui pousse tout vers le bas.)
6. **`Entrée` dans le champ formule = aller à la ligne** — ❌🏗️ **piège de données, vérifié**.
   Un bloc `math` est **une seule ligne par construction** (`cardBlock.ts:29-33`), et
   `latexToPlainText` écrase les blancs (`blocks.ts:103`, `\s+` → ` `). Or c'est cette projection
   plate qui sert d'option de QCM (`CardNode.tsx:1149/1169`) et de note à l'export. Un vrai saut
   de ligne tapé au clavier est un simple blanc pour LaTeX : soit KaTeX n'affiche rien de plus,
   soit il faut `\\`, que le miroir recopie tel quel (`x=1\\y=2` dans l'option). Avec
   `\begin{cases}`, le miroir écrit carrément `beginx=1\\y=2endcases` (les commandes inconnues
   perdent leur anti-slash, `blocks.ts:100-101`). Le besoin est réel — systèmes, calculs en
   étapes — mais il se sert avec **des blocs formule consécutifs**, pas avec une ligne dans un
   bloc. Faire croire le contraire est pire qu'inutile.
7. **Après un changement de type au clic, le curseur va dans le champ** — ✅. Ça m'économise un
   clic et une seconde, 3 à 5 fois par définition, et ça se voit tout de suite.
8. **Bouton « Question » à droite du bloc, titre bleu clair** — ❌. En révision, ma question est
   une **carte**, pas un bloc : le quiz masque le titre, la définition n'est qu'un indice. Une
   question écrite dans une fiche ne m'est jamais posée.
9. **Une question est un bloc parent contenant des blocs (bleu translucide)** — ❌🏗️. Même
   raison, plus le coût : un nouveau type entre dans le miroir plat `definition`, donc ma
   question peut ressortir comme **distracteur de QCM**. Et un contenant, c'est un changement de
   format partagé avec l'admin prof (`admin/src/lib/quality.ts` importe `CardBlock`).
10. **Une description contient des blocs normaux ou des blocs-questions** — ❌🏗️. C'est la
    version « modèle de données » de #8/#9 : même verdict, et ça touche `CardBlock`,
    `sanitizeBlock`, `isEmptyBlock`, `nonTextKinds`, la sérialisation, la validation prof. Coût
    élevé, bénéfice nul pour moi.
11. **Bug des deux champs de formule** — ⛔🐛 le vrai tueur. Je décris l'expérience exacte : à la
    première formule d'une session, `MathFieldEditor` décide au montage que MathLive n'est pas
    là (`MathFieldEditor.tsx:103`) et rend le `fallback` : **un champ LaTeX monospace, et
    dessous, l'aperçu KaTeX** (`BlockEditor.tsx:1099-1125`). Deux champs empilés pour une seule
    formule : je ne sais pas lequel est « le mien ». La formule suivante, ou la même rouverte,
    donne un champ WYSIWYG. Pire : dans le champ LaTeX, faute d'élément vivant, la palette
    **appende à la fin** (`MathFieldEditor.tsx:120-129`) — j'écris `x`, je clique `≤`, j'obtiens
    `x≤`. Oui, ça m'a fait renoncer : j'ai écrit `<=` et je suis passé à la suite.
12. **Les `+` intercalés du tableau** *(entrée reçue tronquée)* — ⚠️. L'idée est la bonne :
    insérer exactement là où je clique, plutôt que « ajouter au bout puis déplacer ». Deux
    réserves : les cibles font 18 px à 42 % d'opacité, et surtout rien n'annonce que le tableau
    existe (menu de type = Texte/Formule seulement).
13. **Annuler / Rétablir en icônes en haut** *(entrée reçue tronquée)* — ⚠️. Utile pour la
    découvrabilité : je ne sais pas que `Ctrl+Z` ici est l'historique *de la fiche*. Mais le
    problème réel n'est pas la porte d'entrée, c'est la granularité (un pas par pause de 600 ms).
14. **Le menu de type affiche « Image » sur un tableau** — 🐛✅. À corriger, et ça compte : quand
    je vérifie « c'est bien un tableau ? », je lis **« Image »** et je crois que mon tableau a
    été converti en photo. Trois secondes de panique en pleine dictée.
15. **`+` mal placés / lignes et colonnes déplaçables à la souris** — ⚠️ pour le placement,
    🏗️ pour le glisser-déposer. Les `+` sont sur *chaque* frontière (au-dessus de chaque
    colonne, à gauche de chaque ligne) : la position est bonne, c'est la **taille** qui ne va
    pas. Le déplacement des lignes/colonnes à la souris **n'existe pas** (seuls les blocs sont
    `draggable`, `:702`) — et je n'y penserais pas : `Entrée` dans une cellule ajoute déjà la
    ligne suivante, c'est plus rapide que la souris.
16. **Choisir « image » en plus de formule/texte (bloc **et** case de tableau)** — ⚠️ pour le
    bloc, ❌🏗️ pour la case. Le besoin image est réel (figure de géométrie, capture du prof,
    photo du tableau : plusieurs fois par semaine) mais le bouton « Image » existe **déjà** en
    bas de l'éditeur, et `Ctrl+V` marche : ce qui manque est la découvrabilité, pas le type.
    Mettre « Image » dans le menu Texte/Formule est même risqué : convertir un bloc texte en
    image, c'est perdre le texte. Dans une **case**, c'est impossible : `TableCell` vaut
    `string | { latex }` (`cardBlock.ts:25`), une image n'y est pas représentable — et je n'en
    ai pas besoin dans un tableau de signes.
17. **Bulles d'aide sur tous les boutons** — ⚠️. Nécessaire pour les icônes sans texte (l'icône
    « colonnes », le `Aa/∑` d'une cellule, la poignée de glissement) — mais un tooltip n'est pas
    une étiquette : il faut survoler et attendre, et c'est au clavier que je travaille. Je
    préfère un mot visible à une bulle.
18. **Un `+` à la place du bouton suivant/précédent absent, qui crée la carte manquante avec le
    curseur sur son titre** — ⚠️. Ça m'arrive : en écrivant une définition je réalise que la
    carte intermédiaire manque. Mais créer une carte depuis la modale, c'est aussi créer des
    cartes vides par erreur, que je nettoie le soir. Additif donc pas déroutant (`NavArrow`
    ne rend rien quand le voisin n'existe pas, `DescriptionDialog.tsx:520`).

---

## Les 3 idées qui me serviraient vraiment en cours

1. **#4 — le nouveau bloc garde le type du dessus**, couplé à `Entrée` = bloc suivant : trois
   formules d'affilée sans jamais lâcher le clavier, 4-6 s gagnées par formule, les yeux qui
   restent sur le prof (avec la soupape « repasse en texte si j'y tape de la prose »).
2. **#7 — le curseur se place dans le champ après un changement de type** : un clic et une
   seconde économisés, 3 à 5 fois par définition, sans rien apprendre.
3. **#14 + #17 sur le tableau** : que le menu de type dise « Tableau » (aujourd'hui il dit
   « Image ») et que l'icône « colonnes » soit nommée. Le tableau de signes est un usage
   **hebdomadaire** en maths ; le code le fait déjà, il est juste introuvable.

## Les 3 idées qui ne me serviraient jamais (ou me gêneraient)

1. **#6 — `Entrée` = aller à la ligne dans la formule** : les données ne le permettent pas (un
   bloc = une ligne, le miroir écrase les blancs). Je croirais écrire un système que la révision
   et le QCM aplatiraient : trompeur, donc nuisible.
2. **#8 / #9 / #10 — le bloc Question** : en révision je crée une **carte** ; un bloc question ne
   m'est jamais posé, il pollue le texte plat qui sert d'option de QCM, et il coûte un type
   partagé avec l'admin prof.
3. **#5 — la palette en haut, changeante** : trajet souris et ambiguïté du bloc cible, au moment
   où je suis le plus pressé. Dans la même veine : **#3 pour `Tab`** et **#1** (le nom de la
   carte caché dans un tooltip) me gêneraient aussi.

## Ce qui me manque le plus, et qui n'est pas dans la liste

- **`≤`, `→`, `π`, `∞`, `≠` accessibles dans un bloc texte.** C'est la cause racine du découpage
  de mes définitions, et le seul manque qui me ferait écrire des notes propres au lieu de « <= ».
- **La palette dans les cellules de tableau** : aujourd'hui aucune (les cellules ne
  s'enregistrent pas comme champ actif), donc `-∞`, `+∞` et les flèches se tapent en LaTeX brut.
- **Un tableau de variations** (cellules fusionnées, flèches) ou, à défaut, un accès direct à une
  image : aujourd'hui je colle une capture, et encore faut-il savoir que `Ctrl+V` marche.
- **Un quiz qui utilise ce que j'écris.** Je remplis mes définitions pour être interrogé dessus,
  or seul le titre est interrogé — « compléter la formule » (les trous existent déjà pour le
  titre, `BlankFillField`) serait mon usage n°1 en révision.
- **Une aide visible sur place.** Je ne connais ni `$$`, ni `Maj+Entrée`, ni la poignée de
  glissement : ils ne sont listés que dans le panneau « Raccourcis » du bas
  (`DescriptionDialog.tsx:584-586`), que je n'ouvre jamais en cours. Un raccourci que je ne vois
  pas est un raccourci qui n'existe pas.

---

## Faits de code vérifiés (pour l'implémenteur)

- `cardBlock.ts:29-33` : « Every math block is its own line by construction » ; `:25` :
  `TableCell = string | { latex }` — pas d'image en cellule.
- `blocks.ts:103` : `\s+` → une espace ; `:100-101` : une commande inconnue perd son
  anti-slash (`\begin{cases}` → `begincases`).
- `CardNode.tsx:1149` : l'option correcte est `card.definition` ; `:1169` : l'option est
  retrouvée par `allCards.find(c => c.definition === option)` — deux cartes au miroir identique
  afficheraient les blocs de la première.
- `MathFieldEditor.tsx:103` (décision au montage) et `:120-129` (insertion **à la fin** faute
  d'élément vivant) : #11 est confirmé, et la palette perd le curseur exactement là.
- `BlockEditor.tsx:799` : libellé « Image » pour un `table` (#14) ; `:818-829` : le menu de type
  ne propose que Texte et Formule ; `:561` : un nouveau bloc est toujours `text` (#4) ;
  `:1400` : `Entrée` dans une cellule ajoute une ligne ; `:1332-1351` : poignées de 18 px à
  42 % d'opacité ; `:702` : seuls les blocs sont `draggable` (#15) ; `:1428` : `ref={() => {}}`
  → aucune cellules enregistrée, donc aucune palette dans un tableau.
- `commands.ts:235/243/251/274` : sur le canevas `Tab` = sous-carte, `Entrée` = carte en dessous,
  `Maj+Entrée` = carte au-dessus, `Mod+Entrée` = ouvrir cette modale — d'où le risque
  d'inversion de convention de #3.
- `DescriptionDialog.tsx:80` + `descriptionHistory.ts:28,47-52` : autosave 600 ms, un pas
  d'historique par pause, 100 pas.
