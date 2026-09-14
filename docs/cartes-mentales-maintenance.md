# Maintenance des cartes mentales — feuille de route

**But de ce fichier** : suivre un chantier trop large pour une seule session,
à travers des sessions qui seront `/clear`ées entre elles. Chaque session
reprend ce fichier là où la précédente l'a laissé, coche ce qu'elle a fait,
committe, et s'arrête proprement.

## Comment reprendre ce travail (à lire à chaque session)

1. Charge la skill `transformer-cours-en-carte-mentale` (édition/création de
   cartes) avant toute manipulation de `.zmap`.
2. Descends ce fichier dans l'ordre des sous-projets. Le premier sous-projet
   dont le statut n'est pas `✅ Terminé` est celui à reprendre.
3. À l'intérieur, prends la première case non cochée.
4. **Sous-projets 1 à 3** (travail éditorial) : exécute directement l'item,
   en respectant les normes ci-dessous et celles de la skill.
5. **Sous-projets 4 et 5** (dev) : si aucun brainstorming n'a encore eu lieu
   dessus (pas de spec sous `docs/superpowers/specs/` qui les couvre), lance
   `/superpowers:brainstorming` dessus et arrête-toi après avoir obtenu
   l'accord de l'utilisateur — n'implémente rien avant. Le problème est posé
   plus bas, pas la solution : ne code jamais à partir de cette seule
   description.
6. Coche la case, mets à jour le statut du sous-projet si besoin,
   **commit** (message clair, un commit par item ou par petit lot cohérent),
   **push**.
7. Si un point est ambigu (contenu manquant, doute sur un renommage, fichier
   illisible...), arrête-toi et pose la question plutôt que de deviner.
8. Continue tant que le contexte le permet ; sinon laisse la session
   s'arrêter proprement — ce fichier reprend le relais à la suivante.

## Normes de référence

- Structure : `.cartes-mentales/<matière>/<chapitre>/<fichier>.zmap`
- Matière : kebab-case (`histoire-geo`, pas `Histoire-Geo`)
- Chapitre : kebab-case, numéroté si plusieurs (`01-rappels/`)
- Fichier : kebab-case, sous-thème uniquement — jamais suffixé par le type
  (`-cours`, `-exo`...), le type vit dans `meta.type`
- `meta.type` ∈ `cours | exo | prise de notes | corrections | corrigé |
  default` — `default` n'est acceptable que si aucun autre type ne convient
  vraiment ; sinon c'est le signe qu'il faut reclasser
- Reste des règles (contenu, quiz, niveaux par matière) : voir
  `.claude/skills/transformer-cours-en-carte-mentale/SKILL.md`

---

## Sous-projet 1 — Mise aux normes de `.cartes-mentales/`

**Statut** : ✅ Terminé
**Pourquoi en premier** : les sous-projets 2 et 3 écrivent dans cette
arborescence ; autant qu'elle soit propre avant.

Dossiers matière à renommer :

- [x] `Français/` → `francais/` (convention retenue : sans accent, cohérente
      avec `anglais/`, `espagnol/`, `mathematiques/`, `physique-chimie/` — à
      appliquer aussi pour ce qui sera ingéré depuis `to-injest`)
- [x] `Histoire-Geo/` → `histoire-geo/`

Fichiers à renommer (kebab-case, sans suffixe de type) :

- [x] `anglais/edward-hopper/Biographie.zmap` → `biographie.zmap`
- [x] `anglais/edward-hopper/hooper.zmap` — confirmé faute pour "hopper"
      (le contenu porte sur son professeur Robert Henri et le mouvement
      Ashcan/Abstract Expressionism, pas une seconde biographie) → renommé
      `influences.zmap` d'après son contenu plutôt qu'en corrigeant juste
      l'orthographe
- [x] `francais/Cahier de Lecteur.zmap` → `cahier-de-lecteur.zmap`
      (dossier `.assets` associé renommé en conséquence)
- [x] `francais/les classes grammaticales exercices.zmap` →
      `classes-grammaticales.zmap`
- [x] `francais/les mots invariables.zmap` → `mots-invariables.zmap`
- [x] `histoire-geo/Guerre Totale.zmap` → `guerre-totale.zmap`
- [x] `histoire-geo/la violence de masse touche les civils lé génocide
      arménien.zmap` → `genocide-armenien.zmap` (typo "Lé" → "Le" corrigé
      dans le titre de la carte racine, reste du contenu laissé intact pour
      le sous-projet 2)
- [x] `histoire-geo/rediger un développement construit.zmap` →
      `rediger-un-developpement-construit.zmap`

Fichiers `meta.type: "default"` à reclasser :

- [x] `.cartes-mentales/animaux.zmap` — contenu de test manifeste
      (`"qsdqsd"`, remplissage clavier), confirmé reliquat par l'utilisateur
      — **décision : laisser tel quel**, ne pas ranger ni supprimer
- [x] `histoire-geo/rediger-un-developpement-construit.zmap` — pas une
      méthode rédigée : titre racine copié de l'exercice génocide arménien,
      une seule sous-carte vide. **Décision de l'utilisateur : c'est le
      travail en cours de l'élève (il va continuer), laisser `type:
      "default"` et le contenu tels quels, ne pas reclasser**

Vérifié : aucun `.zmap` ne reste avec un dossier `.assets` orphelin après
les renommages ci-dessus (chaque `.assets` correspond à un `.zmap` du même
nom).

---

## Sous-projet 2 — Corrections des exercices existants

**Statut** : ✅ Terminé
**Dépend de** : sous-projet 1 (pour les noms finaux ci-dessous)

Aucun fichier de type `corrections` n'existe aujourd'hui dans
`.cartes-mentales/`. Exercices identifiés (type `exo`) à corriger :

- [x] `anglais/edward-hopper/influences.zmap` (ex-"hooper.zmap") — 11 cartes
      dans l'exo source au moment de la correction ; contenu déjà
      factuellement correct, corrections mineures de formulation seulement
      (indices `qcm-title` moins littéraux)
- [x] `espagnol/ejercicios/hablamos-espanol-en-el-mundo.zmap` — 4 cartes
      source. Fichier lui-même oublié par le sous-projet 1 (nom avec espaces,
      hors de sa liste) : renommé en kebab-case à cette occasion, `.assets`
      inclus. Contenu déjà correct ; images reprises telles quelles dans un
      `.assets` dédié à la correction (copie physique, pas de génération)
- [x] `espagnol/vocabulario/dias-de-la-semana.zmap` — 7 cartes source,
      contenu déjà exact, correction = version prof identique
- [x] `espagnol/vocabulario/estaciones-del-ano.zmap` — 4 cartes source,
      contenu déjà exact, correction = version prof identique
- [x] `espagnol/vocabulario/meses-del-ano.zmap` — 12 cartes source, contenu
      déjà exact, correction = version prof identique
- [x] `francais/classes-grammaticales.zmap` — 2 cartes source (exercice 1
      seulement, 2 phrases). Erreur corrigée : "l'" dans "je l'ai vu"
      classé à tort comme déterminant par l'élève, c'est un pronom
      personnel COD ; réponse manquante pour "grande" (adjectif qualificatif)
      complétée
- [x] `francais/mots-invariables.zmap` — 5 classes, 16 cartes source.
      Restructuré : le contenu était écrit en `title` de cartes filles au
      lieu de `definition` (aucune carte n'avait de `definition`), en plus
      d'être très fautif. Correction = une définition propre par classe
      grammaticale, structure aplatie (plus de niveaux 3/4 redondants)
- [x] `francais/mots-variables.zmap` — 5 classes, 16 cartes source. Même
      problème de structure que ci-dessus, avec en plus deux erreurs de fond
      chez l'élève (pronom présenté comme modifiant "le genre du verbe" au
      lieu de remplacer un nom ; déterminant réduit à "déterminer le genre").
      Correction = définitions propres et aplaties
- [x] `histoire-geo/guerre-totale.zmap` — 4 cartes source. Même problème
      structurel que les fichiers `francais/mots-*` (contenu en `title`, pas
      de `definition`) : restructuré en 4 dimensions de la guerre totale
      (violence des combats, mobilisation économique, souffrances des
      civils, propagande et censure) avec titre + définition propres
- [x] `histoire-geo/genocide-armenien.zmap` — 10 cartes source. Contenu
      déjà en Q/R correcte dans sa structure, mais très fautif et une
      erreur factuelle corrigée (les Arméniens vivaient en majorité en
      Anatolie orientale, pas « en Europe » comme écrit par l'élève) ; les
      gendarmes reclassés comme auteurs du massacre, pas victimes

Pour chacun : créer un fichier séparé `meta.type: "corrections"` dans le
même dossier de chapitre (jamais dans le fichier de l'exo lui-même —
`corrections` ≠ `corrigé`, voir la skill), nommé `<nom-exo>-corrections.zmap`
(seule exception documentée à la règle "jamais de suffixe de type", voir
la skill section « Où écrire le fichier »). Respecter les règles d'écriture
"mode quiz" (titre/définition qui se déterminent l'un l'autre, mots-clés en
gras, sœurs de longueur comparable). Tant que le sous-projet 4 n'existe pas,
noter à la main dans ce fichier, en face de chaque item coché, le nombre de
cartes de l'exercice source au moment de la correction (pour repérer plus
tard si l'exo a bougé).

---

## Sous-projet 3 — Nettoyage + ingestion de `.cours/to-injest/`

**Statut** : 🟡 En cours — tri et ingestion terminés pour les matières en
périmètre (`arts-plastiques`, `français 4e`, `histoire-geo` 3e) ;
`histoire-geo` 4e/5e/6A reste hors périmètre sauf demande explicite de
l'utilisateur (voir ci-dessous)

`to-injest` contient des centaines de fichiers sur 4 matières
(arts-plastiques, français 4e, histoire-geo 3e/4e/5e/6A) avec beaucoup de
bruit : fichiers verrouillés LibreOffice (`.~lock.*#`), fichiers
AppleDouble macOS (`._*`), fichiers `.tmp`, doublons entre dossiers "Ancien"
et "Nouveau" prof. **Ne pas convertir avant d'avoir trié.**

- [x] Tri — arts-plastiques : aucun bruit trouvé (pas de `.~lock.*#`, pas de
      `._*`, pas de `.tmp`, pas de dossiers "Ancien"/"Nouveau" dupliqués).
      Racine (`3-01` à `3-10`) = fiches élève ; `TXT/` (`3-00` à `3-10`,
      numérotation alignée) = fiches de séquence prof plus complètes
      (vocabulaire, programme) pour les mêmes séquences — vérifié sur `3-01`,
      ce sont des documents complémentaires, pas des doublons. `ref/archi/`
      et `ref/autoportrait/` = images/PDF de référence légitimes. Rien à
      supprimer ni déplacer ; dossier déjà propre, validé par l'utilisateur
- [x] Tri — français 4e : aucun bruit technique trouvé (pas de `.~lock.*#`,
      pas de `._*`, pas de `.tmp`, pas de dossiers "Ancien"/"Nouveau"
      dupliqués). Noms les plus ambigus vérifiés par contenu (`Sans nom
      2.odt`, `journal.odt`, `français.odt`) : tous du vrai travail d'élève
      (exercice de grammaire, QQOQCP actualité, analyse d'image), pas des
      fichiers vides ou perdus. Une dizaine de fichiers posés directement
      sous `4e/` sans dossier Chapitre/Séquence (contrairement à Chapitre 1
      et 2, bien structurés) — pas du bruit, juste une organisation à
      trancher au moment de l'ingestion. Rien à supprimer, validé par
      l'utilisateur
- [x] Tri — histoire-geo (3e, 4e, 5e, 6A) : terminé, voir détail ci-dessous
  - [x] 8 locks LibreOffice `.~lock.*#` et 3 fichiers `.tmp` trouvés et
        supprimés (3e, 4e ×2, 5e ×3 locks ; 3e, 5e ×2 tmp)
  - [x] Pas de vrai doublon "Ancien"/"Nouveau" prof dans `4e/` malgré les
        noms de dossiers : `Ancien professeur d'histoire M. Lorite` couvre
        H1/H2/H3 + esclavage, `Nouveau professeur d'histoire Mr. Oliveira`
        couvre d'autres chapitres (empire industriel...) — deux profs
        successifs sur des chapitres différents, pas de chevauchement,
        les deux dossiers sont gardés tels quels
  - [x] Doublon confirmé (checksum identique) dans `4e/Ancien professeur
        d'histoire M. Lorite/` : `Fiches TD/` et `L'esclavage/` contiennent
        les 3 mêmes fichiers (`CORRECTION FICHE TD 5et6.doc`, `Fiche TD
        Etre esclave dans une plantation.jpg`, `Fiche Td Les traites
        négrières.jpg`). **Décision de l'utilisateur : ne pas supprimer**
        — politique générale, les sources `.cours` sont gardées même une
        fois exploitées ou redondantes, "juste au cas où"
  - [x] `6A/Géographie` et `6A/Histoire` : pas des dossiers malgré leur nom,
        ce sont deux fichiers de 16K sans extension, contenu binaire
        illisible (pas un `.odt`/`.docx` valide), probablement corrompus.
        **Décision de l'utilisateur : laissés tels quels, non exploitables
        et sans intérêt** (l'élève concerné est maintenant en 3e, le 6e ne
        sert plus) — pas de conversion prévue pour ces deux fichiers
- [x] Une fois le tri validé, ingestion matière par matière via la skill
      `transformer-cours-en-carte-mentale`, chapitre par chapitre —
      **redéfinir le mapping niveau 2/3/4 pour chaque matière avant de
      commencer** (le mapping maths n'est pas réutilisable tel quel, voir la
      section "Adaptation à d'autres matières" de la skill). `français 4e`,
      `arts-plastiques` et `histoire-geo` (restreint à la 3e sur demande
      utilisateur) sont désormais tous traités — **4e/5e/6A d'histoire-geo
      pas oubliés, juste hors périmètre pour l'instant**, à reprendre si
      l'utilisateur le demande :
  - [x] `français/4e/Chapitre 1/Cours/Conjugaison du passé simple.odt` →
        `.cartes-mentales/francais/conjugaison-passe-simple.zmap` (`cours`,
        aife/prof). Tableau de conjugaison propre (Avoir, Être, Venir,
        Pouvoir), converti tel quel en cartes `kind: media`
  - [x] `français/4e/Chapitre 2/Exercices/Conjugaison participe passé.odt`
        (exercice 1 p 332, 15 couples infinitif/participe) →
        `.cartes-mentales/francais/conjugaison-participe-passe.zmap` (`exo`,
        zachary/eleve, erreurs d'origine conservées : "craindt" pour
        craindre, "résoulu" pour résoudre) +
        `conjugaison-participe-passe-corrections.zmap` (`corrections`,
        aife/prof, les 2 erreurs corrigées). Exercice 3 du même fichier
        (3 phrases) **non converti** : texte source trop confus/fautif pour
        être retranscrit fidèlement (voir point ci-dessous)
  - [x] **Contenu sauté, décision utilisateur "tu peux sauter tkt"** — les
        dossiers `Cours` de `français/4e/Chapitre 1` et `Chapitre 2`
        contiennent en réalité les notes/bilans de Zachary lui-même (fautes,
        et même un cas de contenu de fichier inversé avec son nom :
        `adieu.odt` correspond au poème "Je vis, je meurs" et vice versa),
        pas un vrai cours rédigé par un prof. Les convertir fidèlement
        recopierait les fautes dans une carte de révision. Fichiers
        concernés, non traités :
        `Chapitre 1/Cours/adieu 🤲.odt`, `Chapitre 1/Cours/je vis, 🤗 je
        meurs 💀.odt`, `Chapitre 1/Cours/ode a cassandre correction 🐄 🐐
        🐮 🐽 🐷.odt`, `Chapitre 1/Bilans/Bilan sur le début de la
        nouvelle.odt` (Maupassant, même problème), et la 3e partie
        ("exercice 3 p 332") de `Chapitre 2/Exercices/Conjugaison participe
        passé.odt` (phrases elles-mêmes fautives/ambiguës,
        ex. "que lui avait d'accordés mon père"). `Chapitre 2/Exercices/
        correction question le vestron ensorcelée.odt` vérifié aussi :
        vide/inexploitable (juste "1) 2) 3)")
  - [x] Reste de `français/4e` passé en revue (le dossier contient bien plus
        que Chapitre 1/2 : `Chapitre 1/Exercices`, `Chapitre 2/Cours`,
        `Séquence 5/`, et une dizaine de fichiers directement sous `4e/`).
        Même diagnostic que ci-dessus sur la quasi-totalité : ce sont des
        réponses d'exercices de Zachary (analyse grammaticale — nature des
        mots, fonction dans la phrase —, questions de compréhension sur des
        textes au programme, antonymes, écriture créative, résumés de
        lecture), donc hors périmètre de la skill ("les exercices sont de la
        pratique, pas des connaissances de cours") et/ou trop fautifs pour
        être recopiés fidèlement en carte de révision. Fichiers concernés,
        non traités : `Chapitre 1/Exercices/Ecriture.odt`, `Chapitre
        1/Exercices/exercice page 88-89 + la fiction pour interroger le
        réel.odt`, `Chapitre 1/Exercices/resumé français.odt`,
        `Chapitre 2/Cours/Rédaction + Cours.odt` (en réalité une correction
        de questions + un exercice d'écriture, mal classé dans "Cours"),
        `Chapitre 2/Cours/quand le réel vacile.odt` (une phrase, vide de
        contenu), `Sans nom 2.odt`, `antonymes et ses amis.odt`, `controle
        entrainement.odt`, `français.odt`, `grammaire.odt`, `ile au
        esclavges.odt`, `journal.odt`, `la fin explication logique ou
        surnaturelle.odt`, `le main 3ème partie.odt`, `le veston
        ensorcelée.odt`. Seule exception : `Séquence 5/Theatre Individu et
        société.odt` contenait 4 définitions de vocabulaire propres et non
        fautives (esclave, maître, servante, valet) au milieu d'une fiche
        d'analyse de mise en scène à trous (hors périmètre) — vocabulaire
        extrait vers `.cartes-mentales/francais/vocabulaire-theatre.zmap`
        (`cours`, aife/prof). **`français 4e` : terminé** — rien d'autre à
        ingérer dans ce dossier.
- [x] `arts-plastiques` (les 11 séquences `3-00` à `3-10`) : contenu source
      très pauvre en définitions (fiches d'évaluation + liste de vocabulaire
      brute, sans définitions, + compétences génériques du programme
      officiel répétées à l'identique sur les 11 séquences + références
      d'œuvres en images). **Décision utilisateur : rédiger les définitions
      du vocabulaire moi-même** (connaissance générale du champ lexical des
      arts plastiques, pas extraite du document). Converti uniquement le
      vocabulaire (seul contenu vraiment définitionnel et propre à chaque
      séquence) → un fichier `cours` par séquence,
      `.cartes-mentales/arts-plastiques/<NN>-<slug>/vocabulaire.zmap`
      (numérotation reprise du support source, `-00-` à `-10-`), 11 fichiers,
      aife/prof. Compétences du programme et références d'œuvres **non
      converties** : compétences identiques sur toutes les séquences (pas de
      connaissance propre à un chapitre) et références = juste des noms
      d'artistes + images (pas de bloc image dans le schéma)
- [x] `histoire-geo` — **périmètre restreint à la 3e sur décision
      utilisateur** ("tu injest que les cours de 3eme"), 4e/5e/6A hors
      périmètre de ce sous-projet. Le seul chapitre 3e est `Histoire/Civils
      et militaires pendant la Première Guerre mondiale/` (pas de dossier
      Géographie pour la 3e). Sur les 6 fichiers `activité *.odt` :
      activité 3 (guerre totale) et activité 4 (génocide arménien) déjà
      couverts par le sous-projet 2 (`guerre-totale.zmap`,
      `genocide-armenien.zmap` + leurs corrections). Les 4 autres n'ont
      rien à ingérer : activité 1 et activité 2 sont quasi entièrement
      des images (BD de Tardi), sans texte exploitable ; activité 5 est la
      source de `rediger-un-developpement-construit.zmap`, déjà laissé tel
      quel par décision du sous-projet 1 (travail en cours de l'élève) ;
      activité 6 est un tableau vierge à remplir (révolutions de février/
      octobre 1917), aucune réponse à convertir. **Rien de nouveau à
      ingérer pour la 3e**, ce sous-point est donc terminé
- [ ] Pour les exercices rencontrés en cours d'ingestion, appliquer la même
      logique que le sous-projet 2 (créer aussi une correction)

Ce sous-projet est volumineux : le découper en sessions par dossier plutôt
que d'essayer de tout faire d'un coup.

---

## Sous-projet 4 — Fraîcheur des corrections (dev)

**Statut** : ⬜ Pas commencé — nécessite un `/superpowers:brainstorming`
dédié avant toute implémentation

Problème à résoudre (pas de solution actée) : une correction créée pour un
exercice doit pouvoir être marquée "à jour" une fois écrite ; si l'exercice
source gagne de nouvelles cartes ensuite, la correction doit pouvoir être
détectée comme obsolète (probablement via `src/sync/cardCounts.ts`, déjà
utilisé pour comparer des jeux de cartes) et remise à jour. À concevoir : où
vit le flag, comment il se réinitialise, ce qui déclenche la détection (un
scan manuel, un passage automatique, autre).

---

## Sous-projet 5 — Politique de sync contenu vs déplacement (dev)

**Statut** : ✅ Terminé — déjà résolu par une fonctionnalité développée
séparément, repérée en reprenant ce chantier plutôt que construite pour lui

État du code (vérifié) :

- Déplacement/renommage de fichier : déjà finement géré par
  `src/sync/pathReconciliation.ts` (résolution premier-arrivé-gagne,
  égalité → le serveur gagne).
- Carte présente localement et absente du distant (ou l'inverse) : déjà
  transformée en carte volante automatiquement par `src/sync/cardMerge.ts`,
  jamais perdue.
- Contenu modifié des deux côtés depuis la dernière synchro (même `id` de
  fichier, contenus divergents) : couvert par `isConflict`
  (`src/sync/syncService.ts`) + la boîte de résolution de
  `src/sync/conflictResolution.ts`, voir
  `docs/superpowers/specs/2026-09-14-resolution-de-conflits-design.md`. Le
  contenu local est capturé dans le signalement AVANT tout écrasement, donc
  rien n'est perdu même si le tirage suivant réécrit le fichier local : trois
  choix ensuite — accepter le serveur, refuser et garder ma version (restaure
  le contenu local capturé), créer une copie liée (les deux survivent).
  Résout à l'échelle du fichier la question posée ici à l'échelle de la
  carte — plus complet qu'une simple carte volante par carte.
