import type { MathFieldHandle } from './MathFieldEditor'

/**
 * One insertable fragment.
 *
 * `rich` is what MathLive receives, and may carry its placeholder tokens
 * (`#0` = where the selection lands, `#?` = the next tab stop) — that is what
 * makes « fraction » leave the caret in the numerator instead of after the
 * whole thing. `plain` is the same fragment as literal LaTeX for the raw-field
 * path, where those tokens would be typed out verbatim.
 */
interface Entry {
  /** What the button shows. Unicode where one exists, so the button reads as the result. */
  face: string
  /** Read aloud, and shown on hover. In French, like every other label in the app. */
  label: string
  rich: string
  plain?: string
}

interface Group {
  name: string
  entries: Entry[]
}

/**
 * What a collège course actually writes, and nothing else.
 *
 * The selection is the whole point of this component. The target user is a
 * collégien for whom `\frac{a}{b}` is not "simple, pratique, intuitif" — the
 * adoption risk the rich-content design named explicitly. A palette that tried
 * to cover LaTeX would miss it just as badly as no palette at all: what is
 * needed is the dozen constructs that appear in a maths, physics or chemistry
 * exercise, reachable without knowing they are called `\frac` or `\ce`.
 */
const GROUPS: Group[] = [
  {
    name: 'Structures',
    entries: [
      { face: '⅟', label: 'Fraction', rich: '\\frac{#0}{#?}', plain: '\\frac{}{}' },
      { face: 'x²', label: 'Puissance', rich: '#0^{#?}', plain: '^{}' },
      { face: 'xₙ', label: 'Indice', rich: '#0_{#?}', plain: '_{}' },
      { face: '√', label: 'Racine carrée', rich: '\\sqrt{#0}', plain: '\\sqrt{}' },
      { face: 'ⁿ√', label: 'Racine n-ième', rich: '\\sqrt[#?]{#0}', plain: '\\sqrt[]{}' },
      { face: '( )', label: 'Parenthèses', rich: '\\left(#0\\right)', plain: '\\left(\\right)' },
    ],
  },
  {
    name: 'Opérateurs',
    entries: [
      { face: '×', label: 'Multiplié par', rich: '\\times ' },
      { face: '÷', label: 'Divisé par', rich: '\\div ' },
      { face: '±', label: 'Plus ou moins', rich: '\\pm ' },
      { face: '≠', label: 'Différent de', rich: '\\neq ' },
      { face: '≤', label: 'Inférieur ou égal', rich: '\\leq ' },
      { face: '≥', label: 'Supérieur ou égal', rich: '\\geq ' },
      { face: '≈', label: 'Environ égal', rich: '\\approx ' },
      { face: '→', label: 'Flèche', rich: '\\rightarrow ' },
      { face: 'π', label: 'Pi', rich: '\\pi ' },
      { face: '∞', label: 'Infini', rich: '\\infty ' },
    ],
  },
  {
    // Free, in the sense that costs nothing extra: mhchem is already imported
    // alongside KaTeX in `renderMath.ts`, so chemistry and physics units ship
    // with the maths rather than as a second dependency.
    name: 'Chimie et unités',
    entries: [
      { face: '⚗', label: 'Équation chimique', rich: '\\ce{#0}', plain: '\\ce{}' },
      { face: 'm/s', label: 'Grandeur avec unité', rich: '\\pu{#0}', plain: '\\pu{}' },
    ],
  },
]

export interface MathPaletteProps {
  /** The field to insert into. Null while the block has not mounted its editor yet. */
  field: MathFieldHandle | null
}

/**
 * Clickable symbols for the formula block.
 *
 * Deliberately NOT a replacement for typing: MathLive's own shortcuts still
 * work, `$$` still converts a text block on the spot, and someone who knows
 * LaTeX never has to come here. It exists so that not knowing LaTeX is not a
 * wall — the button is the discoverable path, not the mandatory one.
 */
export function MathPalette({ field }: MathPaletteProps) {
  return (
    <div
      role="group"
      aria-label="Symboles mathématiques"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}
    >
      {GROUPS.map(group => (
        <div key={group.name} style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }} aria-label={group.name}>
          {group.entries.map(entry => (
            <button
              key={entry.label}
              type="button"
              aria-label={entry.label}
              title={entry.label}
              // `onMouseDown` + preventDefault rather than `onClick`: a click
              // moves focus to the button first, which takes the caret out of
              // the formula — and the caret is the whole point of inserting.
              onMouseDown={event => {
                event.preventDefault()
                field?.insert(entry.rich, entry.plain)
              }}
              disabled={field === null}
              style={{
                minWidth: 30,
                height: 28,
                padding: '0 6px',
                fontSize: 14,
                lineHeight: 1,
                borderRadius: 6,
                cursor: field === null ? 'default' : 'pointer',
                border: '1px solid var(--border)',
                background: 'var(--background)',
                color: 'inherit',
                opacity: field === null ? 0.4 : 1,
              }}
            >
              {entry.face}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
