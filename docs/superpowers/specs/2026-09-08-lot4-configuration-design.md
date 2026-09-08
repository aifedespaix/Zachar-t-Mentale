# Configuration (apparence) — Design

**Date** : 2026-09-08
**Statut** : Validé, en attente du plan d'implémentation
**Lot** : 4 (Configuration)

## Contexte

Lot 4 de la feuille de route à 6 lots. Les lots 1 (éditeur), 2 (quiz), 3
(import/export), et 5 (navigation fichiers, fait hors ordre) sont terminés.
Ce lot rend éditables les libellés et couleurs des 4 niveaux de carte, la
police de l'app, et ajoute un thème clair/sombre — ce dernier point était
initialement prévu au lot 6 (packaging) mais est intégré ici : les tokens
CSS `.dark` de shadcn existent déjà en scaffold inutilisé, et toucher aux
couleurs de niveau sans y penser aurait obligé à retoucher le data model une
seconde fois au lot 6.

**Explicitement hors périmètre** : le nombre de niveaux reste fixé à 4
(Rouge/Orange/Bleu/Jaune). Aucune refonte de la hiérarchie de carte,
`CardLevel` reste `1 | 2 | 3 | 4`. La police reste globale à toute l'app (pas
de police par niveau). Les cartes volantes (`detachedColors`) restent
délibérément hors personnalisation utilisateur — seules leurs variantes
light/dark par défaut sont ajoutées.

## Vue d'ensemble

Un nouveau fichier de réglages global (même mécanisme que `QuizSettings` :
JSON sous `appConfigDir()`, store zustand, dialogue accessible depuis le
header) couvre :

1. **Par niveau (1 à 4)** : libellé texte, couleur OKLCH (fond/bordure/texte),
   en variantes **light** et **dark**.
2. **Police** : une police globale unique pour toute l'app.
3. **Thème** : `clair` / `sombre` / `système`, avec un bouton de bascule
   rapide dans le header animé d'une transition circulaire.

## Data model

`src/types/appearanceSettings.ts` :

```ts
export type ThemeMode = 'light' | 'dark' | 'system'

export interface LevelAppearance {
  label: string
  color: {
    light: LevelColor
    dark: LevelColor
  }
}

export interface AppearanceSettings {
  levels: Record<CardLevel, LevelAppearance>
  fontFamily: string
  themeMode: ThemeMode
}

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings
```

`DEFAULT_APPEARANCE_SETTINGS.levels[n].color.light` reprend les valeurs
actuelles de `src/colors/levelColors.ts`. Les valeurs `.dark` par défaut
gardent la même teinte (`h`) et un chroma (`c`) proche, avec la luminosité
(`l`) inversée pour rester lisible sur fond sombre (ex. fond `l:0.96` →
`l:0.20-0.24`, texte `l:0.3-0.34` → `l:0.85-0.9`) — chaque paire, light et
dark, est vérifiée par `oklchWcagContrast` (déjà implémenté dans
`src/colors/contrast.ts`) contre le seuil AA existant. `detachedColors`
(cartes volantes) devient de la même forme `{ light, dark }`, toujours
hardcodé, non exposé dans le dialogue de réglages.

## Persistence

`src/persistence/appearanceSettings.ts`, calqué exactement sur
`src/persistence/quizSettings.ts` :

- Fichier `appearance-settings.json` sous `appConfigDir()`.
- `loadAppearanceSettings()` : fichier absent → `DEFAULT_APPEARANCE_SETTINGS`
  intact ; fichier présent → merge superficiel sur les defaults (un champ
  manquant ou un fichier d'une version antérieure du schéma ne casse rien).
- `saveAppearanceSettings()` : crée le dossier si besoin, écrit le JSON
  formaté.

## State

`src/state/useAppearanceSettingsStore.ts`, calqué sur
`useQuizSettingsStore.ts` : store zustand chargé au démarrage, actions
`setLevelLabel(level, label)`, `setLevelColor(level, mode, patch)`,
`setFontFamily(name)`, `setThemeMode(mode)`, chacune persistant
immédiatement via `saveAppearanceSettings`.

### Résolution du thème

`src/hooks/useResolvedTheme.ts` : dérive le thème effectif (`'light' |
'dark'`) à partir de `themeMode` :

- `'light'` / `'dark'` → valeur directe.
- `'system'` → écoute `matchMedia('(prefers-color-scheme: dark)')`, se
  réabonne/nettoie l'écouteur au changement.

Applique/retire la classe `dark` sur `document.documentElement` en effet de
bord à chaque résolution. `CardNode` et `QuizConfigModal` lisent
`useResolvedTheme()` pour choisir `.light`/`.dark` dans
`useAppearanceSettingsStore(s => s.levels[level].color)`.

## Consommation dans l'UI existante

- `src/colors/levelColors.ts` : conserve `levelColors`/`detachedColors`
  comme **valeurs par défaut uniquement** (source de `DEFAULT_APPEARANCE_
  SETTINGS`). `levelColor(level)` n'est plus appelé directement par les
  composants ; remplacé par un sélecteur du store.
- `CardNode.tsx` : `levelColor(card.level)` / `detachedColors` → lecture du
  store + `useResolvedTheme()`.
- `QuizConfigModal.tsx` : la constante locale `LEVEL_LABELS` disparaît,
  remplacée par `useAppearanceSettingsStore(s => s.levels[level].label)`
  (les icônes/couleurs de difficulté ne changent pas).
- Police : `fontFamily` appliqué via
  `document.documentElement.style.setProperty('--font-sans', fontFamily)`
  au chargement du store et à chaque changement — même variable déjà
  consommée par `--font-heading` dans `@theme inline` de `index.css`.

## Mise en cohérence de l'app shell pour le dark mode

L'app n'est aujourd'hui pas prête pour un thème sombre piloté :

- `App.css` a des couleurs en dur (`#f6f6f6`, `#ffffff`, `#e8e8e8`, et les
  bandeaux `#fef3c7` dans `App.tsx`) au lieu des tokens shadcn
  (`--background`, `--card`, etc.) que `.dark` sait déjà redéfinir —
  remplacés par les classes Tailwind correspondantes (`bg-background`,
  `bg-card`, ...) pour que le toggle ait un effet réel sur tout le shell.
- Le bloc `@media (prefers-color-scheme: dark)` résiduel du template Tauri
  (`App.css`, un auto-dark non contrôlé par l'app) est supprimé — remplacé
  entièrement par la classe `.dark` pilotée par `useResolvedTheme`.
- `<Background />` de React Flow (grille de points du canevas,
  `MindMapCanvas.tsx`) reçoit une couleur explicite dérivée du thème résolu
  plutôt que sa couleur par défaut (illisible en sombre).

## Bouton de bascule et transition circulaire

`src/theme/circularReveal.ts` — helper isolé, sans dépendance UI :

```ts
function startCircularThemeTransition(opts: { x: number; y: number; apply: () => void }): void
```

- Si `document.startViewTransition` n'existe pas (WebView plus ancien, ou
  environnement de test) **ou** si
  `matchMedia('(prefers-reduced-motion: reduce)').matches` → appelle
  `apply()` directement, sans animation.
- Sinon : rayon `Math.hypot(Math.max(x, innerWidth - x), Math.max(y,
  innerHeight - y))` (distance jusqu'au coin le plus éloigné du point de
  clic) ; `document.startViewTransition(apply)` ; sur `transition.ready`,
  `document.documentElement.animate({ clipPath: ['circle(0px at
  ${x}px ${y}px)', 'circle(${radius}px at ${x}px ${y}px)'] }, { duration:
  500, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)'
  })`.

CSS globale ajoutée (`index.css`) pour désactiver le fondu croisé par
défaut de la View Transitions API, qui parasiterait le cercle :

```css
::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
  mix-blend-mode: normal;
}
```

`src/components/ThemeToggleButton.tsx` : bouton icône (soleil/lune) dans le
header, à côté de `QuizSettingsButton`/`AppearanceSettingsButton`. Au clic :
cible = opposé du thème résolu actuel (un clic sort explicitement du mode
`'système'` vers un choix ferme) ; appelle
`startCircularThemeTransition({ x: e.clientX, y: e.clientY, apply: () =>
setThemeMode(target) })`.

Le sélecteur `Clair`/`Sombre`/`Système` dans `AppearanceSettingsDialog`
reste un contrôle séparé, sans animation (change d'état sans point de clic
pertinent pour l'option `'Système'`).

## Dialogue de réglages

`src/components/appearance/AppearanceSettingsDialog.tsx` +
`AppearanceSettingsButton.tsx`, dans le header, calqués sur `QuizSettings
Dialog`/`QuizSettingsButton` :

- Un bloc par niveau : pastille de couleur (aperçu live), sliders L/C/H
  (réutilisent `Slider` déjà ajouté au lot 2) pour `bg`/`border`/`text`, en
  light et dark, champ de libellé texte.
- Garde-fou : si la combinaison texte/fond choisie tombe sous le seuil AA
  (`oklchWcagContrast`), avertissement visuel inline — la sauvegarde reste
  possible (pas de blocage dur), cohérent avec le principe TSA de ne jamais
  faire échouer une action sur un carton d'erreur bloquant.
- Sélecteur de police (liste courte : police actuelle + 2-3 alternatives
  lisibles, pas de champ libre arbitraire).
- Sélecteur Clair/Sombre/Système.

## Gestion d'erreurs

Mêmes garanties que `quizSettings.ts` : fichier de réglages absent, partiel,
ou provenant d'une version antérieure du schéma → merge sur les defaults,
jamais de crash. Une police indisponible dans le système retombe sur la
pile `sans-serif` du navigateur (comportement CSS natif, rien à coder).

## Tests

- `appearanceSettings.ts` (persistence) : aller-retour JSON, merge sur
  defaults avec fichier partiel/absent.
- `useAppearanceSettingsStore.ts` : chaque action persiste bien, état
  initial = defaults avant chargement.
- `useResolvedTheme.ts` : mode explicite (`light`/`dark`) ignore le média
  query ; mode `'system'` suit `matchMedia` et se désabonne au démontage ;
  applique/retire la classe `dark` sur la racine.
- Contraste : les 8 paires (4 niveaux × light/dark) des defaults passent le
  seuil AA via `oklchWcagContrast`.
- `circularReveal.ts` : `startViewTransition` mocké — vérifie l'appel à
  `animate()` avec le bon rayon (`Math.hypot`) et les bonnes keyframes ;
  fallback si `startViewTransition` absent ; fallback si
  `prefers-reduced-motion: reduce`.
- `ThemeToggleButton.test.tsx` : clic bascule le thème résolu et déclenche
  la transition (helper mocké).
- `CardNode`/`QuizConfigModal` : retombent sur les defaults si le store
  appearance n'a pas encore chargé (pas de flash de couleurs cassées).

## Hors périmètre (rappel)

- Nombre de niveaux variable (reste fixé à 4).
- Police par niveau (reste une police globale unique).
- Personnalisation des couleurs des cartes volantes (`detachedColors` reste
  hardcodé, seules ses variantes light/dark par défaut sont ajoutées).
- Edition manuelle du fichier JSON comme flux principal (le fichier existe
  et reste portable, mais l'UI est le chemin attendu).
