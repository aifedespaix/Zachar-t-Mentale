# Audit UX — persona « débutant en informatique »

> **Qui je suis.** J'utilise un ordinateur pour mes cours. Je connais Word et un navigateur.
> Je ne connais pas les raccourcis clavier, je ne sais pas ce qu'est LaTeX, j'ai peur de « casser »
> quelque chose. Je n'écris pas de code et je n'ai modifié aucun fichier du dépôt.
>
> **Ce que j'ai regardé** (pour de vrai, pas au hasard) : la fenêtre « Description » et ses blocs,
> les symboles de maths, les caractères spéciaux, le tableau, les flèches autour de la fenêtre,
> le bouton « Ajouter un bloc », les corbeilles, « Supprimer », « Fermer », « Enregistré automatiquement ».
>
> **Comment je juge** : est-ce que je comprends le mot employé ? est-ce que je dois apprendre un
> raccourci ? est-ce que je risque de faire une bêtise par accident ? est-ce que je saurai revenir en arrière ?

## Note sur la liste des idées

La liste qui m'a été transmise dans la consigne comportait **sept entrées vides** (les n° 8 à 14
étaient réduites à quelques mots). J'ai donc repris la **liste d'origine, mot pour mot**, telle que
l'auteur du produit l'avait écrite (18 idées). Je juge les 18. Aucune n'est laissée « non auditée ».

Les 7 entrées reconstituées, dans les mots de l'auteur :

- **8** : bouton icône + texte « Question » à droite d'un bloc ; ajoute un champ « header » en bleu clair pour taper une question.
- **9** : une question est un bloc « parent » qui peut contenir plusieurs blocs ; bordure bleue, fond bleu transparent, les enfants gardent leur propre fond (gris).
- **10** : une description peut contenir soit des blocs, soit des blocs-parents, « et les organiser ».
- **11** : bug — un champ formule affiche deux champs (texte + visuel) au chargement.
- **12** : bug — dans un tableau, une case passée en « formule » n'a pas la bonne taille.
- **13** : ajouter les boutons undo/redo en icônes (couleur, désactivé…) dans la barre du haut.
- **14** : bug — en mode tableau, la liste des actions à droite dit « image » au lieu de « tableau » ; et déplacer « ajouter colonne / ajouter ligne » dans cette liste pour pouvoir supprimer le bas du tableau et ses explications.

## Faits vérifiés qui changent mon avis

1. **#11 est un vrai bug.** Le champ formule choisit son affichage **une seule fois, à l'ouverture**,
   d'après un chargement qui n'est pas encore terminé la première fois. Résultat : la **première**
   formule de la session montre un champ de texte bizarre **et** un aperçu, et les suivantes
   s'affichent normalement. Ce n'est pas moi qui me trompe : c'est l'app.
2. **#14 est un vrai bug.** Le bouton de type d'un bloc tableau affiche bien « Image » (l'icône, elle,
   est celle d'un tableau). Ce mot faux m'a déjà fait croire que mon tableau avait changé de nature.
3. **#3 me demanderait d'apprendre des raccourcis, et il y a un piège.** Aujourd'hui : `Entrée` crée
   un bloc, `Maj+Entrée` va à la ligne. Ailleurs dans l'app (le grand plan de cartes) : `Entrée` crée
   une carte, `Tab` crée une sous-carte, `Maj+Entrée` crée une carte au-dessus. Si dans la fenêtre
   `Tab` devenait « changer le type de bloc », la **même touche** ferait « créer une sous-carte »
   dehors et « transformer ma formule en texte » dedans. Je ne m'en souviendrai jamais.
4. **#17 n'est pas une nouveauté.** Les bulles d'aide existent déjà ailleurs (barre du haut, panneau
   des fiches). Ici elles manquent encore. Donc je suis **pour** : ce n'est pas une chose de plus à
   apprendre, c'est la même chose partout.
5. Le petit texte sous le tableau (« les `+` au-dessus des colonnes… ») est **la seule explication en
   français** de comment le tableau se remplit. Et les `+` eux-mêmes sont très pâles : je ne les vois
   presque pas.

## Verdict global

**Ce que je comprends.** J'ouvre une fenêtre, j'écris ma définition dans des « blocs » ; un bloc peut
être du texte ou une formule ; je clique des symboles pour les maths ; je peux faire un tableau ; les
flèches autour me font changer de carte. Je comprends « Enregistré automatiquement », « Fermer »,
« Supprimer », et la phrase qui explique le tableau.

**Ce que je ne comprends pas.** Les mots « LaTeX », « WYSIWYG », « header », « barre du haut »,
« undo/redo », « bloc parent / enfant ». Et surtout : beaucoup d'idées **remplacent un bouton avec un
mot écrit** par une **icône seule**, un **raccourci clavier**, ou une **bulle qui n'apparaît qu'au
survol**. Pour moi, ça veut dire : la fonction disparaît de l'écran, et je ne peux plus la découvrir
tout seul. Un débutant n'apprend que ce qu'il voit.

**En un mot :** les corrections de bugs (**#11**, **#12**, **#14**, **#7**) me soulagent et ne me
demandent rien. Les changements de touches (**#3**) et tout ce qui se cache (**#1**, **#5**, **#14**
retirer les explications) me font peur. Le reste est acceptable **à condition** de garder un mot écrit
quelque part et une façon de faire sans la souris.

## Item par item

| # | Idée | Mon avis | En langage simple |
|---|------|----------|-------------------|
| 1 | Flèches parent/enfant : icône seule, nom au survol, animation au survol | ❌ pour l'icône seule · ✅ pour l'animation | Aujourd'hui je lis « ← Parent : Chapitre 5 » et je sais où je vais **avant** de cliquer. Une petite flèche seule, je dois deviner, et le nom qui n'arrive qu'au survol ne m'aide pas : je ne sais pas ce que je cherche. La couleur de la carte cible ne me dit rien non plus (je ne connais pas les couleurs par cœur). L'animation au survol, elle, ne me gêne pas : si ça montre que c'est cliquable, tant mieux — à condition que ça ne saute pas. |
| 2 | Les blocs bougent en douceur quand on les déplace | ⚠️ | Joli, mais ça ne m'apprend pas **où** va le bloc. Ce qui m'aide, c'est une **ligne à l'endroit où il va atterrir**. Si ça bouge beaucoup, ça me perd et ça me fatigue. Il faut pouvoir l'arrêter (certaines personnes sont sensibles au mouvement). |
| 3 | `Entrée` = ligne · `Ctrl+Entrée` = bloc · `Tab` = changer le type | ❌ | **La plus dangereuse pour moi.** Aujourd'hui `Entrée` crée un bloc et je l'ai appris… mais dans Word, `Entrée` va à la ligne, donc je me trompe déjà. Changer encore, c'est repartir de zéro. `Ctrl+Entrée`, je ne le découvrirai **jamais** tout seul : je ne connais pas ces combinaisons. Et `Tab` fait déjà « créer une sous-carte » ailleurs dans l'app : la même touche qui ferait deux choses, c'est la garantie que je transforme ma formule en texte sans le vouloir — et je ne saurai pas revenir. Si on change `Entrée`, il faut une phrase qui l'explique **dans la fenêtre** et un bouton « Nouveau bloc » bien visible. |
| 4 | Un nouveau bloc garde le type du bloc du dessus | ✅ | Ça m'évite de chercher le menu. Petite inquiétude : « pourquoi mon nouveau bloc est une formule alors que je veux écrire du texte ? » — mais le bouton Texte/Formule est visible, donc je peux corriger sans aide. |
| 5 | Les symboles passent dans une barre en haut qui change selon le bloc | ⚠️ | Aujourd'hui les symboles sont **juste sous le bloc où j'écris** : je vois d'où ils viennent. En haut, je ne saurai pas quel champ est « actif », et j'ai peur d'insérer un symbole dans le mauvais bloc. Acceptable **seulement** si le bloc actif est vraiment bien entouré (cadre de couleur + son numéro écrit). Et si une barre apparaît/disparaît en glissant, ça attire l'œil pour rien. |
| 6 | `Entrée` dans la formule va à la ligne | ❌ | Confusion assurée : `Entrée` ne ferait plus la même chose selon l'endroit. Et je ne saurai plus comment ajouter un bloc **après** ma formule. Il faudrait me l'écrire en français dans la fenêtre, sinon je crois que l'app s'est cassée. |
| 7 | Après changement de type, le curseur se place dans le champ | ✅ | Excellent. Je clique « Formule » et je peux taper tout de suite, sans chercher. Et rien de ce que j'ai écrit n'est perdu. C'est exactement le genre d'amélioration qui ne me demande rien. |
| 8 | Bouton « Question » + champ bleu clair | ⚠️ | Le mot « Question » me parle, le bleu clair aussi. Mais « champ header », c'est de l'informaticien : écrivez « Énoncé de la question ». Et je ne comprends pas **où je mets ma réponse** : juste en dessous ? Sans cette réponse à ma question, le bouton me laisse bloqué. |
| 9 | La question est un bloc qui en contient d'autres (bleu) | ⚠️ | L'idée me parle (une question, ses réponses dessous) — c'est comme un exercice. Mais si les blocs à l'intérieur ne sont **pas décalés vers la droite** avec un trait qui les rattache, je croirai juste à un bloc bleu. Et « parent / enfant », ce sont des mots d'arbre généalogique, pas de cours. |
| 10 | Une description peut contenir des blocs ou des blocs-questions | ⚠️ | Je comprends le principe. Ce que je ne comprends pas, c'est le verbe « organiser » : il ne me dit pas **le geste**. Dites-moi : « glisser un bloc dans la question pour le ranger dedans », et je le ferai. |
| 11 | Bug : deux champs pour une formule | ✅ | **Oui, je l'ai vu** : un champ de texte bizarre (`\frac...`) **et** le joli rendu en dessous. Je ne sais pas lequel est le vrai, j'ai peur de taper dans le mauvais. Un seul endroit où j'écris, c'est un grand soulagement — et c'est un bug, donc ce n'est pas moi le problème. |
| 12 | Bug : une case « formule » trop petite | ✅ | Une case trop petite où le texte déborde, ça fait « cassé ». Je n'ose plus toucher au tableau. À corriger. |
| 13 | Boutons Annuler / Rétablir en haut | ⚠️ | Avoir un **bouton visible** pour annuler : oui, mille fois oui — je ne connais pas `Ctrl+Z`, donc aujourd'hui je ne peux **pas** revenir en arrière, et c'est ma plus grosse angoisse. Mais deux flèches courbes sans mot, non : écrivez « Annuler » et « Rétablir ». Et dites-moi **où** est « le haut » : dans cette fenêtre, ou dans la fenêtre principale ? |
| 14 | Bug « image » au lieu de « tableau » (+ retirer le bas du tableau) | ✅ pour corriger le mot · ❌ pour retirer les explications | Le mot faux m'a déjà trompé : j'ai cru que mon tableau était devenu une image. À corriger absolument. **Mais** le petit texte sous le tableau est la seule phrase qui m'explique les `+` et les corbeilles : si on l'enlève, je ne sais plus rien. Si on déplace les boutons « ajouter ligne / colonne » à droite, il faut au minimum garder une phrase courte, sinon je chercherai longtemps. |
| 15 | Mieux placer les `+` du tableau + déplacer lignes/colonnes à la souris | ⚠️ | Les `+` « au bon endroit », oui — mais **d'abord les rendre visibles** : aujourd'hui ils sont si pâles que je ne les vois pas. Pour le glisser-déposer des lignes : je ne devine pas qu'on peut attraper une ligne. Il faut une poignée visible **et** garder des boutons « monter / descendre », comme pour les blocs. Sinon je ne déplacerai jamais rien. |
| 16 | Pouvoir choisir « image » en plus de « formule » et « texte » | ⚠️ dans le menu d'un bloc · ❌ dans une case de tableau | Dans le menu d'un bloc : pourquoi pas — mais alors pourquoi pas « Tableau » aussi ? Sinon je ne comprends pas la logique. Dans une **case** de tableau : non. Une image dans une petite case de tableau, je ne vois pas comment ça s'affiche, et j'ai peur que ça casse mon tableau. |
| 17 | Des bulles d'aide au survol sur tous les boutons | ✅ | **Pour.** L'app le fait déjà ailleurs, donc ce n'est pas une chose de plus à apprendre : c'est la même chose partout. Deux conditions : la bulle doit arriver **vite** (aujourd'hui, quand elle arrive après une seconde, je crois que le bouton ne fait rien), et elle doit venir **en plus** du mot écrit, jamais **à la place**. Au doigt (tablette), la bulle n'existe pas. |
| 18 | Un `+` à la place du bouton « suivant / précédent » absent | ⚠️ | L'idée est bonne : « il n'y a rien ici, je peux le créer ». Mais un `+` ne dit pas **avant** ou **après** : écrivez « Créer la carte suivante ». Et si je clique par erreur, est-ce que ça crée une carte vide dans mon fichier ? Si oui, je veux pouvoir l'annuler tout de suite. Le curseur qui se place dans le titre : ✅ très bien. |

## Ce que je ne comprendrai pas sans qu'on me l'explique

- Les mots : **LaTeX**, **WYSIWYG**, **header**, **barre du haut / toolbar**, **undo / redo**,
  **bloc parent / enfant**.
- Que `Tab` puisse vouloir dire « changer le type de bloc » ici, et « créer une sous-carte » dehors.
- Pourquoi mon tableau s'appelle **« Image »**.
- Ce que devient une formule écrite sur **plusieurs lignes** : est-ce encore un seul bloc ? comment
  j'ajoute un bloc **après** ? (Aujourd'hui, c'est déjà `Maj+Entrée` pour la ligne suivante — qui me
  l'a dit ? Personne.)
- Comment **sortir** d'une question : comment je remets un bloc « dehors » ?
- Ce qu'un `+` crée exactement : une carte ? un bloc ? une ligne ? Est-ce que c'est annulable ?

## Les 3 choses qui me font peur

1. **#3 — changer ce que fait `Entrée`.** C'est la touche que j'utilise sans réfléchir, et je ne
   connais pas `Ctrl+Z`. Si le comportement change, je vais créer des blocs ou écrire dans le mauvais
   champ sans comprendre pourquoi, et je ne saurai pas réparer. Le `Tab` qui ferait deux choses
   différentes dans la même app aggrave tout.
2. **Les actions qui font peur collées aux actions utiles.** La corbeille juste à côté du `+` dans le
   tableau (#15), et le `+` qui crée une carte (#18) : je clique à côté et je ne sais pas annuler.
   Aujourd'hui, « Supprimer la description » me demande confirmation — c'est bien, faites pareil
   partout.
3. **Tout ce qui devient invisible sans la souris.** Icône seule (#1), symboles qui changent tout seuls
   en haut (#5), explications du tableau supprimées (#14). Si l'écran ne montre plus rien, je ne peux
   plus rien apprendre, et je n'ose plus cliquer. Et au doigt (tablette), il n'y a pas de survol.

## Ce que je ferais plus simple

1. **Un mot écrit sur chaque bouton, toujours.** La bulle en plus, jamais à la place (#1, #13, #17) —
   et des bulles rapides, sinon je crois que le bouton ne fait rien.
2. **Ne pas toucher à `Entrée` maintenant** (#3). D'abord : boutons visibles **Annuler / Rétablir**
   (#13) et **« Nouveau bloc »** bien visible, plus une phrase d'explication dans la fenêtre. Ensuite,
   peut-être — et jamais `Tab`, à cause du plan de cartes.
3. **Corriger d'abord ce qui me fait peur sans rien m'apprendre** : #11 (un seul champ de formule),
   #12 (taille de case), #14 (le mot « Image » seulement, en gardant les explications), #7 (curseur
   dans le champ). Ces quatre-là me rassurent et ne me demandent aucun effort.
4. **Pour les questions (#8, #9, #10) et le tableau (#15), me montrer une maquette** avant de
   construire : je dois **voir** le décalage vers la droite, le trait qui dit « c'est dedans », les
   `+` bien visibles et la poignée à attraper. Je ne sais pas lire un plan, je sais regarder une image.
5. **Une phrase d'aide en français sous chaque nouveauté.** Celle qui existe déjà sous le tableau est
   très bien : gardez ce réflexe, c'est comme ça que j'apprends l'app.

---

### Détails techniques derrière ces avis (pour le développeur)

Ces points ne sont pas des impressions : ils viennent de la lecture du code.

- **#11** — `src/content/MathFieldEditor.tsx:103` : `const [showMathField] = useState(() => loaded)`.
  L'affichage est décidé **une seule fois à l'ouverture**, donc la première formule d'une session part
  sur le champ texte + l'aperçu. Le commentaire au-dessus (lignes 89–102) explique ce choix : éviter
  qu'un champ se remplace en pleine phrase. C'est le prix à payer, pas un oubli — mais le débutant,
  lui, voit « deux champs » et perd confiance.
- **#14** — `src/content/BlockEditor.tsx:799` :
  `const current = kind === 'math' ? 'Formule' : kind === 'text' ? 'Texte' : 'Image'`.
  Un bloc `table` tombe donc sur « Image » (l'icône, elle, est `Table2`). Corriger le mot ne casse
  rien ; retirer le footer (lignes 910–938) supprime la seule explication écrite du tableau.
- **#3** — aujourd'hui : `AutoGrowTextarea` (~1056) `Entrée` → `onEnterBlock`, `Maj+Entrée` → retour à
  la ligne ; même chose dans le champ formule (`MathBlockField`, ~1108) ; la liste des raccourcis
  (`ShortcutsPanel`, `DescriptionDialog.tsx:584-589`) **affiche déjà** ces règles. Ailleurs dans
  l'app : `card.addSiblingBelow` = `Entrée`, `card.addChild` = `Tab`, `card.addSiblingAbove` =
  `Maj+Entrée` (`src/types/commands.ts:230-253`). C'est la collision `Tab` qui est le vrai problème.
- **#17** — un composant de bulle existe déjà et s'affiche **immédiatement**
  (`src/components/ui/tooltip.tsx`, `TooltipProvider` à `delayDuration = 0`), alors que la fenêtre
  utilise partout l'infobulle native du navigateur (`title=`), lente (~1 s), non stylable et invisible
  au doigt. La migration est donc une bonne nouvelle pour moi, et elle est **déjà à moitié faite**
  ailleurs dans l'app (barre du haut, panneau des fiches) : ce n'est pas une nouveauté à apprendre.
- **#5 / #4 / #15** — la palette est rendue **dans le bloc actif seulement** : `BlockEditor.tsx:591`
  affiche le footer sous la condition `{isActive && (<BlockFooter …>)}`, et l'insertion, si le champ
  n'a pas le curseur, écrit **à la fin du texte** (`insertText`, choix assumé : « dégradé, jamais un
  clic perdu »). Remonter la palette en haut casse cette certitude : je ne saurai plus dans quel bloc
  le symbole est parti.
- **#15** — les `+` du tableau existent déjà au bon endroit (au-dessus de chaque colonne, à gauche de
  chaque ligne) mais leur rangée est à peine visible : `HANDLE_ROW`, `BlockEditor.tsx:1332-1338`,
  porte `opacity: 0.42`. Ce n'est donc pas un problème de placement avant tout, mais de **visibilité**.
- **#2** — le respect du mouvement est déjà une habitude du dépôt : `@media (prefers-reduced-motion:
  reduce)` est présent plusieurs fois dans `src/index.css`. Toute animation de déplacement de blocs
  (#2) doit s'y brancher, sinon les personnes sensibles au mouvement (comme moi) subiront l'animation
  sans pouvoir l'éteindre.
- **#9 / #10** — le modèle de données ne connaît que `text | math | image | table`
  (`src/types/cardBlock.ts`) : **aucun bloc ne peut en contenir un autre**. Ce n'est donc pas un
  réglage d'affichage mais un changement de structure, qui touche aussi le quiz, l'export et le PDF.
  Raison de plus pour me montrer une maquette avant.
