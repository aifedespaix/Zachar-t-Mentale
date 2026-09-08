import { icons, type LucideIcon } from 'lucide-react'

/**
 * The whole Lucide set (~1800 icons), keyed by the PascalCase name stored in
 * `Card.icon`.
 *
 * Imported as one map rather than icon by icon on purpose: the picker searches
 * the entire catalogue, so there is no subset to import, and the app is an
 * offline desktop build where pulling the set into the bundle costs a one-off
 * download at install time and nothing at runtime — an online icon API would
 * simply not work here.
 */
const CATALOG = icons as unknown as Record<string, LucideIcon>

/** Every available icon name, alphabetically — the picker's search space. */
export const ICON_NAMES: readonly string[] = Object.keys(CATALOG).sort()

/**
 * The component for a stored icon name, or `null` when the name is unknown.
 *
 * `null` rather than a throw or a placeholder: `Card.icon` is a plain string in
 * a JSON file the user can hand-edit and that a later version of the app may
 * write names into, and none of that is worth breaking a card's render over.
 */
export function iconComponent(name: string | undefined | null): LucideIcon | null {
  if (!name) return null
  return CATALOG[name] ?? null
}

/** `'BookOpen'` -> `'book open'`: what the user reads, and what search matches on. */
export function iconLabel(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
}

/** Lowercase, accent-free: « École » and « ecole » have to search the same. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * French -> English bridge for the search box.
 *
 * Lucide names are English and the app is French, so without this typing
 * « cerveau » in the picker returns nothing at all. This is deliberately NOT a
 * translation layer: it is a short list of the words someone building a course
 * mind map actually reaches for, each mapped to the fragments that appear in
 * the relevant icon names. Anything missing still works — the raw English name
 * is always searchable too.
 */
const FRENCH_TERMS: Record<string, string[]> = {
  alerte: ['alert', 'triangle-alert'],
  ampoule: ['lightbulb'],
  animal: ['paw', 'dog', 'cat', 'bird', 'fish', 'rabbit'],
  arbre: ['tree'],
  argent: ['coins', 'wallet', 'banknote', 'euro', 'dollar'],
  atome: ['atom'],
  avion: ['plane'],
  balance: ['scale'],
  bateau: ['ship', 'sailboat', 'anchor'],
  bibliotheque: ['library', 'book'],
  biologie: ['dna', 'leaf', 'microscope'],
  calcul: ['calculator', 'sigma', 'divide', 'percent'],
  calendrier: ['calendar'],
  carte: ['map', 'compass'],
  cerveau: ['brain'],
  chimie: ['flask', 'test-tube', 'beaker', 'atom'],
  cle: ['key'],
  cloche: ['bell'],
  coeur: ['heart'],
  corps: ['bone', 'brain', 'heart', 'person-standing'],
  couleur: ['palette', 'paint'],
  crayon: ['pencil'],
  date: ['calendar', 'clock'],
  dessin: ['pencil', 'palette', 'brush'],
  drapeau: ['flag'],
  droit: ['scale', 'gavel', 'landmark'],
  eau: ['droplet', 'waves', 'wave'],
  ecole: ['school', 'graduation-cap', 'backpack'],
  eclair: ['zap'],
  economie: ['trending-up', 'coins', 'chart'],
  energie: ['zap', 'battery', 'flame'],
  etoile: ['star'],
  feu: ['flame'],
  fleche: ['arrow'],
  formule: ['sigma', 'function', 'square-radical'],
  geographie: ['globe', 'map', 'mountain'],
  graphique: ['chart', 'trending-up'],
  guerre: ['swords', 'shield'],
  histoire: ['landmark', 'scroll', 'hourglass', 'castle'],
  horloge: ['clock', 'timer'],
  idee: ['lightbulb', 'sparkles'],
  image: ['image', 'camera'],
  important: ['star', 'flag', 'triangle-alert', 'bookmark'],
  langue: ['languages', 'message', 'speech'],
  lien: ['link', 'network'],
  livre: ['book'],
  loupe: ['search', 'zoom'],
  lune: ['moon'],
  maison: ['house'],
  maths: ['calculator', 'sigma', 'divide', 'percent', 'square-radical'],
  medecine: ['stethoscope', 'pill', 'syringe', 'hospital'],
  memoire: ['brain', 'bookmark'],
  microscope: ['microscope'],
  montagne: ['mountain'],
  monde: ['globe', 'earth'],
  mot: ['type', 'text', 'quote'],
  musique: ['music', 'audio'],
  note: ['notebook', 'sticky-note', 'file-text'],
  nuage: ['cloud'],
  oeil: ['eye'],
  ordinateur: ['cpu', 'monitor', 'laptop', 'code'],
  personne: ['user', 'person-standing', 'users'],
  physique: ['atom', 'magnet', 'orbit', 'zap'],
  plante: ['sprout', 'leaf', 'flower'],
  poids: ['weight', 'scale'],
  politique: ['landmark', 'vote', 'flag'],
  question: ['circle-question-mark', 'help'],
  reseau: ['network', 'share', 'git-branch'],
  sante: ['heart-pulse', 'stethoscope', 'activity'],
  science: ['atom', 'flask', 'microscope', 'telescope'],
  soleil: ['sun'],
  son: ['volume', 'audio', 'music'],
  temperature: ['thermometer'],
  temps: ['clock', 'hourglass', 'timer', 'calendar'],
  terre: ['earth', 'globe', 'mountain'],
  texte: ['text', 'type', 'align-left'],
  travail: ['briefcase', 'hammer', 'wrench'],
  usine: ['factory'],
  ville: ['building', 'store', 'landmark'],
  voiture: ['car'],
  vitesse: ['gauge', 'timer', 'zap'],
}

/**
 * What the picker shows before anything is typed. A grid of 1800 icons is a
 * wall, not a choice, so the empty state offers the handful a course mind map
 * actually reaches for — and every one of them is checked to exist against the
 * real catalogue by `icons.test.ts`, so a Lucide rename can never leave a hole
 * here.
 */
export const SUGGESTED_ICONS: readonly string[] = [
  'Star',
  'Heart',
  'Lightbulb',
  'Brain',
  'BookOpen',
  'GraduationCap',
  'Atom',
  'FlaskConical',
  'Microscope',
  'Dna',
  'Calculator',
  'Sigma',
  'Globe',
  'Map',
  'Mountain',
  'Leaf',
  'TreeDeciduous',
  'Flame',
  'Droplet',
  'Zap',
  'Sun',
  'Moon',
  'Clock',
  'Hourglass',
  'Calendar',
  'Landmark',
  'Scale',
  'Gavel',
  'Users',
  'Stethoscope',
  'Pill',
  'Cpu',
  'Code',
  'Languages',
  'Music',
  'Palette',
  'Trophy',
  'Flag',
  'Rocket',
  'Target',
  'Key',
  'Shield',
  'Bookmark',
  'TriangleAlert',
  'CircleQuestionMark',
  'Quote',
  'NotebookPen',
  'Sparkles',
]

/** How well a name matches one search term — lower is better, `null` is "not a match". */
function termRank(label: string, term: string): number | null {
  const variants = [term, ...(FRENCH_TERMS[term] ?? [])]
  let best: number | null = null
  for (const variant of variants) {
    // The label is space-separated ('book open'), the French table's fragments
    // are the kebab ones Lucide uses ('test-tube'), so both spellings are tried.
    const index = label.indexOf(variant.replace(/-/g, ' '))
    if (index === -1) continue
    // A match at the start of the name ('book' in 'book open') is what the user
    // most likely meant; anything else is a valid but weaker hit.
    const rank = index === 0 ? 0 : 1
    if (best === null || rank < best) best = rank
  }
  return best
}

/**
 * Icon names matching a free-text query, best first.
 *
 * Every term must match (typing two words narrows the results rather than
 * widening them), in English or through the French bridge above. An empty
 * query returns the suggestions, so the picker always opens on something
 * usable rather than on an empty grid.
 */
export function searchIcons(query: string, limit = 120): string[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return SUGGESTED_ICONS.slice(0, limit)

  const matches: { name: string; rank: number }[] = []
  for (const name of ICON_NAMES) {
    const label = iconLabel(name)
    let total = 0
    let matchesAll = true
    for (const term of terms) {
      const rank = termRank(label, term)
      if (rank === null) {
        matchesAll = false
        break
      }
      total += rank
    }
    if (matchesAll) matches.push({ name, rank: total })
  }
  // Ties keep the alphabetical order `ICON_NAMES` is already in, so the same
  // query always produces the same grid.
  matches.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
  return matches.slice(0, limit).map(match => match.name)
}
