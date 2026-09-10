# Raccourcis clavier, menus contextuels et palette de commandes — design

## Le problème

L'application savait déjà tout faire, mais presque rien n'était atteignable
sans la souris : deux raccourcis en tout (`Ctrl+Z` / `Ctrl+Y`), aucun menu
contextuel sur les cartes, et une barre du haut réduite à six icônes sans
étiquette. Prendre des notes en direct pendant un cours — le cas d'usage qui
justifie l'app — demandait un aller-retour clavier/souris par carte.

Trois manques distincts :

1. **Pas de raccourcis standard.** Enregistrer, renommer, supprimer, copier,
   coller, dupliquer, zoomer : rien. Les réflexes acquis ailleurs ne
   marchaient pas ici, et un réflexe qui ne répond pas apprend surtout que
   l'application ne sait pas le faire.
2. **Pas de découvrabilité.** Une action n'existait que là où son bouton
   était. Rien ne disait qu'une touche pouvait faire la même chose.
3. **Pas de personnalisation.** Sur un clavier AZERTY, certains accords sont
   pris par le gestionnaire de fenêtres, et un raccourci qu'on ne peut pas
   appuyer est une fonctionnalité qu'on n'a pas.

## Le principe : un catalogue, trois portes

Tout repose sur une seule décision : **une action est déclarée une fois**, dans
`src/types/commands.ts`, avec son nom, son explication, sa catégorie et sa
touche par défaut. Rien d'autre dans l'application n'écrit en dur un libellé de
menu ni une combinaison de touches.

De ce catalogue découlent les trois façons d'atteindre une action :

- **le clavier**, via un répartiteur unique (`useGlobalShortcuts`) ;
- **les menus** (clic droit sur le canevas, clic droit sur une carte, menu
  « Fichier » de la barre du haut) ;
- **la palette de commandes** (`Ctrl+K`), qui cherche dans le catalogue.

Conséquence recherchée : réattribuer une touche dans les paramètres change du
même coup ce qu'affichent tous les menus et toutes les infobulles, parce qu'ils
lisent la même table. Un menu devient ainsi le moyen d'apprendre ses propres
raccourcis — on cherche l'action à la souris, on lit la touche à côté, et la
fois suivante on se passe du menu.

### Le registre

Une commande déclarée n'est pas une commande exécutable : il faut que quelqu'un
sache la faire. C'est le rôle de `useCommandRegistry`, où **le composant qui
détient l'état publie le gestionnaire** — le canevas publie « ajouter une
sous-carte », la barre latérale publie « masquer l'arborescence », la barre du
haut publie « enregistrer ». Aucun store n'a eu à grossir d'un miroir de l'état
local d'un composant pour être joignable depuis une touche.

Chaque enregistrement porte aussi sa **disponibilité**. C'est elle qui grise
l'entrée de menu, atténue la ligne dans la palette, et — surtout — fait que le
répartiteur **laisse passer la touche** au lieu de l'avaler pour une action qui
ne ferait rien.

### Les actions qui appartiennent à la carte

« Supprimer la carte » finit dans un dialogue qui compte les descendants et
propose de les détacher. Réimplémenter ce dialogue au niveau du canevas pour
servir un raccourci aurait donné deux confirmations, avec deux formulations qui
divergent. À la place, la commande dépose une *demande* (`CardRequest`) dans
`useCardSelectionStore`, et le nœud concerné la consomme en appelant sa propre
logique. Une implémentation, trois portes d'entrée.

## Les décisions qui ont demandé un arbitrage

### Portée : pourquoi `Entrée` ne marche que sur le canevas

Les touches nues (`Entrée`, `Tab`, `Suppr`, les flèches) sont indispensables à
un éditeur arborescent et catastrophiques en global : `Entrée` cesserait
d'activer un bouton, `Tab` cesserait de déplacer le focus. Chaque commande
déclare donc une portée, et les touches nues sont limitées au canevas — et,
dans le canevas, à ce qui n'est pas lui-même un contrôle, puisque chaque carte
porte sa propre rangée de boutons.

`Ctrl+S` fait l'exception inverse : c'est le seul réflexe qui part **au milieu
d'une phrase**, et ne rien répondre apprendrait à l'utilisateur que
l'application n'enregistre pas.

### Disposition du clavier : AZERTY d'abord

Deux règles de normalisation, dans `src/shortcuts/keys.ts`, et elles vont en
sens contraire :

- **Les lettres suivent `event.key`.** La touche physique `KeyW` tape « z » en
  AZERTY ; lire `event.code` attribuerait `Ctrl+Z` à la mauvaise touche.
- **Les chiffres suivent `event.code`.** En AZERTY, la rangée du haut demande
  Maj pour produire un chiffre. `Ctrl+0` doit rester le même geste physique sur
  les deux dispositions, donc le `Maj` est ignoré pour ces touches.

La ponctuation est repliée sur un nom (`Plus`, `Comma`, `Minus`…) couvrant ses
formes avec et sans `Maj`, pour la même raison. Le prix — assumé — est que
`Maj` ne peut pas entrer dans un accord à base de chiffre ou de ponctuation.

### Conflits : on déplace, et on le dit

Deux commandes sur la même touche rendent l'une des deux silencieusement morte,
ce qu'aucun utilisateur ne peut diagnostiquer. Attribuer un accord déjà pris le
**retire** donc à son détenteur — et le panneau annonce laquelle des deux
actions vient de perdre son raccourci. `conflictsIn` subsiste pour les
collisions arrivant d'un fichier édité à la main, qui sont signalées en rouge.

### Ce que le fichier de réglages contient

Uniquement les **différences** avec le catalogue. Stocker la table résolue
figerait chaque valeur par défaut à la version qui a écrit le fichier : une
commande ajoutée plus tard arriverait sans touche, et une valeur par défaut
améliorée n'atteindrait jamais qui a ouvert les paramètres une fois. Un `null`
explicite est une décision (« plus de raccourci »), distincte d'une absence.

### Presse-papiers : interne, pas celui du système

Une carte est une branche d'objets typés (niveaux, icônes, contenus riches,
images pointant dans le dossier annexe de la carte mentale). La faire transiter
par `text/plain` la perdrait ou inventerait un format que rien d'autre ne sait
lire. Le presse-papiers de cartes est donc interne — et survit aux changements
de fichier, parce que copier une définition d'un chapitre vers un autre est ce
que cette fonctionnalité fait de plus utile. « Copier la branche en texte »
(`Ctrl+Maj+C`) existe séparément pour sortir un plan de l'application.

Ce qui dépasserait le niveau 4 au collage n'est jamais perdu : ces cartes
deviennent des cartes volantes, exactement comme lors d'un glisser-déposer.

### Sélection : React Flow reste seul propriétaire

Le canevas ne réécrit pas `selected` sur les nœuds qu'il transmet à React Flow.
Un second écrivain sur cet état déclenche une boucle de rendu (l'adoption émet
des changements, `onNodesChange` produit un nouveau tableau, l'adoption
recommence). Les sélections faites en code passent par l'action de React Flow
elle-même, `useCardSelectionStore` n'en étant que le miroir lu par les
commandes. Une carte tout juste créée n'existe pas encore dans son index : la
demande est mise en attente et rejouée quand le nœud apparaît.

### Ce qui reste caché, ce qui reste grisé

Une entrée absente d'un menu se lit comme une fonctionnalité manquante ; grisée,
elle dit « pas maintenant » et pointe la raison (la carte est verrouillée, le
presse-papiers est vide). Les menus n'escamotent donc plus leurs entrées.

Deux exceptions volontaires : **le menu d'une carte disparaît pendant un quiz**
(aucune de ses actions n'est autorisée), et **« Supprimer la carte mentale » est
livrée sans touche** — une action irréversible sur un fichier ne doit pas être à
un accord mal tapé. L'utilisateur peut lui en attribuer une.

## Ce qui a été retiré

`LockToggle`, `ThemeToggleButton`, `ExportMapButton`, `NewMindMapButton`,
`QuizButton` et `SettingsButton` étaient chacun un bouton et sa fenêtre. La
barre du haut monte désormais ces fenêtres elle-même, parce qu'une commande
lancée au clavier n'a aucun bouton pour ouvrir la sienne. Leurs tests ont été
repris dans `AppToolbar.test.tsx`.
