/**
 * The special characters a language course actually needs, and that a French
 * keyboard has no key for.
 *
 * Pure data with no React and no DOM, so the sets themselves — which character
 * is in which language, and what each one is called — are unit-testable without
 * rendering anything. The flags live with the components (see
 * `LanguageHelpPalette`): they are SVG, and a test of the character lists has
 * no business importing a component.
 */

export type LanguageId = 'en' | 'es'

export interface SpecialCharacter {
  /** The character the button inserts. */
  char: string
  /**
   * Read aloud and shown on hover. In French, like every other label in the
   * app — the pupil is French, it is the language being LEARNED that changes.
   */
  label: string
}

/** Characters grouped under a heading, so a palette stays scannable. */
export interface CharacterGroup {
  name: string
  characters: SpecialCharacter[]
}

export interface LanguageHelp {
  id: LanguageId
  /** The language's name, in French. */
  label: string
  groups: CharacterGroup[]
}

export const LANGUAGES: LanguageHelp[] = [
  {
    id: 'en',
    // English wears no accents. What a French pupil actually gets wrong is the
    // typography: the keyboard's typewriter `'` and `"` are not what an English
    // text is written with, and « don't » on a French keyboard is a different
    // character from the apostrophe in « don’t ».
    label: 'Anglais',
    groups: [
      {
        name: 'Apostrophe et guillemets',
        characters: [
          { char: '’', label: 'Apostrophe anglaise (don’t)' },
          { char: '‘', label: 'Guillemet simple ouvrant' },
          { char: '“', label: 'Guillemet double ouvrant' },
          { char: '”', label: 'Guillemet double fermant' },
        ],
      },
      {
        name: 'Tirets et signes',
        characters: [
          { char: '–', label: 'Tiret demi-cadratin' },
          { char: '—', label: 'Tiret cadratin' },
          { char: '…', label: 'Points de suspension' },
          { char: '°', label: 'Degré' },
        ],
      },
      {
        name: 'Monnaie',
        characters: [
          { char: '£', label: 'Livre sterling' },
          { char: '$', label: 'Dollar' },
          { char: '€', label: 'Euro' },
        ],
      },
    ],
  },
  {
    id: 'es',
    // The two signs that make Spanish look « bizarre » to a French reader, and
    // that no French keyboard can produce: the inverted question and
    // exclamation marks that OPEN a Spanish sentence.
    label: 'Espagnol',
    groups: [
      {
        name: 'Ponctuation inversée',
        characters: [
          { char: '¿', label: 'Point d’interrogation inversé' },
          { char: '¡', label: 'Point d’exclamation inversé' },
          { char: '«', label: 'Guillemet ouvrant' },
          { char: '»', label: 'Guillemet fermant' },
        ],
      },
      {
        name: 'Accents et tréma',
        characters: [
          { char: 'á', label: 'a accent aigu' },
          { char: 'é', label: 'e accent aigu' },
          { char: 'í', label: 'i accent aigu' },
          { char: 'ó', label: 'o accent aigu' },
          { char: 'ú', label: 'u accent aigu' },
          { char: 'ü', label: 'u tréma (güe)' },
          { char: 'ñ', label: 'eñe' },
          { char: 'Ñ', label: 'Eñe majuscule' },
        ],
      },
    ],
  },
]

/** The help set of one language. `id` is a closed union, so this always resolves. */
export function languageHelp(id: LanguageId): LanguageHelp {
  const found = LANGUAGES.find(language => language.id === id)
  if (found === undefined) throw new Error(`Langue inconnue : ${id}`)
  return found
}
