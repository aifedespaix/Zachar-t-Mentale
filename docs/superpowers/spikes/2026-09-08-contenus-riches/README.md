# Spike — contenus riches dans le pipeline d'export

Vérifie ce que `html-to-image` fait subir à KaTeX, à abcjs et à une image,
avec **exactement les options de `src/export/captureElement.ts`** :

```js
toPng(element, { pixelRatio: 2, style: { position: 'static', left: '0px', top: '0px' } })
```

Motivation : la littérature signale que les `@font-face` ne résolvent pas de
façon fiable dans le `<foreignObject>` SVG qu'`html-to-image` fabrique, ce qui
ferait disparaître les glyphes KaTeX. Il fallait savoir si le problème existe
dans **cette** configuration avant de choisir entre un moteur math et deux.

## Lancer

```sh
bun add katex abcjs          # dépendances des blocs testés
bun add -d playwright        # pilote le navigateur (n'installe pas de binaire
                             # si PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1)
node docs/superpowers/spikes/2026-09-08-contenus-riches/run.mjs
```

`SPIKE_CHROMIUM=/chemin/vers/chrome` force un binaire précis ; sans lui,
Playwright prend le sien.

Le script sert le dépôt sur trois origines HTTP distinctes (la page, un
« serveur d'assets » sans CORS, le même avec CORS) pour reproduire le rapport
entre la page Tauri et le protocole `asset:` de `convertFileSrc()`. Il écrit
ses captures dans `resultats/` et son rapport sur la sortie standard.

## Ce que mesure chaque page

- **`page-katex.html`** — compte les pixels d'encre d'une capture, en
  contrôle (texte seul), à froid, à chaud (2ᵉ et 3ᵉ capture du même élément),
  et après un `document.fonts.load()` explicite sur les fontes KaTeX. Une
  formule dont les glyphes manquent ne laisse que le trait de fraction, donc
  un compte d'encre effondré.
- **`page-blocs.html`** — compte les `<path>` et les `<text>` du SVG abcjs
  (des `<path>` survivent toujours, des `<text>` dépendent d'une police
  externe), tente la capture d'une image selon son origine, et chronomètre
  deux captures successives.

## Résultats (2026-09-08, Chromium 1194)

```json
{
  "katex":  { "textCold": 4186, "mathCold": 3056, "mathWarm": 3056,
              "mathThird": 3056, "mathPreloaded": 3056 },
  "abcjs":  { "paths": 26, "texts": 0, "textFonts": [] },
  "image":  { "memeOrigine":          { "captureReussie": true  },
              "autreOrigineSansCors": { "captureReussie": false },
              "autreOrigineAvecCors": { "captureReussie": true  } },
  "coutPolices": { "mathPremiereCaptureMs": 153, "mathSecondeCaptureMs": 68 }
}
```

1. **KaTeX passe, dès la première capture.** Encre identique à froid, à chaud
   et après préchargement — donc aucune variation à expliquer. Vérifié aussi à
   l'œil : `resultats/katex-capture-toPng.png` est visuellement identique à
   `resultats/katex-oracle-navigateur.png` (rendu natif du navigateur, hors
   `foreignObject`). Fraction empilée, `×`, `=`, chiffres : tout est là.
   **Condition** : la CSS KaTeX est chargée depuis la **même origine** (c'est
   ce que produit le bundle Vite). `html-to-image` peut alors lire ses
   `cssRules` et embarquer les `.woff2`/`.woff`/`.ttf` en data URI — les 13
   requêtes de polices sont visibles côté serveur. Depuis un CDN, l'accès aux
   `cssRules` lève et les polices ne sont pas embarquées : **ne jamais charger
   KaTeX depuis un CDN.**
2. **abcjs passe trivialement** : 26 `<path>`, **zéro `<text>`**. Le SVG est
   purement vectoriel, il n'a aucune police à résoudre. Voir
   `resultats/abcjs-capture-toPng.png`.
3. **Une image d'une autre origine sans en-tête CORS fait échouer toute la
   capture.** L'image s'affiche pourtant normalement dans le DOM
   (`imageAfficheeDansLeDom: true`) : c'est `html-to-image` qui, en tentant de
   la ré-encoder en data URI, se heurte à la politique d'origine et **rejette
   la promesse entière**. Ce n'est donc pas « l'image manque sur la page
   exportée », c'est « l'export lève ». Deux correctifs, tous deux validés
   ici : inliner l'asset en data URI avant la capture, ou servir le protocole
   `asset:` avec `Access-Control-Allow-Origin`.
4. **Le cache de polices se réchauffe** : 153 ms pour la première capture,
   68 ms pour la suivante. C'est un gain de perf sur un export multi-pages,
   pas une question de correction — la première capture est déjà correcte.
   (`mathPngOctets` / `plainPngOctets` mesurent le PNG de sortie, pas le
   volume de polices embarquées : ne rien en conclure.)

## Portée : ce spike a tourné sous Chromium, pas dans le webview de Tauri

Limite à connaître avant de s'appuyer sur le résultat 1. Tauri n'embarque pas
de navigateur : il utilise celui du système, et ce n'est pas le même moteur
partout.

| Plateforme | Webview | Couvert par ce spike |
|---|---|---|
| Windows | WebView2 (**Chromium**) | ✅ directement |
| macOS | WKWebView (**WebKit**) | ❌ non vérifié |
| Linux | WebKitGTK (**WebKit**) | ❌ non vérifié |

`tauri.conf.json` déclare `"targets": "all"` : les trois sont donc concernées.

Les trois résultats ne se transposent pas également :

- **Résultat 2 (abcjs) — transposable tel quel.** Un SVG sans aucun `<text>`
  n'a rien à résoudre : il n'y a pas de police en jeu, donc pas de moteur qui
  puisse s'en tirer différemment.
- **Résultat 3 (image cross-origin) — transposable.** C'est le modèle de
  sécurité des origines, pas une particularité de rendu ; le comportement est
  standard d'un moteur à l'autre. À confirmer tout de même, l'implémentation
  du protocole `asset:` de Tauri variant par plateforme.
- **Résultat 1 (KaTeX) — le moins transposable, et c'est le plus important.**
  C'est précisément sur WebKit que la résolution des `@font-face` dans un
  `<foreignObject>` a historiquement été la plus fragile. Rien ici ne dit
  qu'elle échoue sous WebKit — simplement que ce spike ne l'a pas testée.

**À faire avant de considérer le risque « moteur math » comme définitivement
levé : rejouer `page-katex.html` dans l'app Tauri réelle, sous macOS et sous
Linux.** Si les glyphes manquent là-bas, les correctifs déjà écartés
redeviennent la réponse (préchargement `document.fonts.load` + capture
d'échauffement, puis repli MathJax en sortie SVG `fontCache: 'local'`) — mais
sur ces plateformes seulement.

## Conséquence

Sous réserve de la portée ci-dessus, le contournement « double `toPng` » et le
repli « MathJax en sortie SVG » envisagés dans
`../../specs/2026-09-08-contenus-riches-cartes-design.md`
sont **inutiles** : un seul moteur d'affichage (KaTeX), pas de dérive visuelle
à craindre. Le vrai travail d'export est ailleurs — l'inlining des assets
image, et les hauteurs fixes de la mise en page — et celui-là ne dépend
d'aucun moteur.
