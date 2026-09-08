import type { Card } from '../types/card'
import type { CardBlock } from '../types/cardBlock'

/**
 * The block model's pure core: how blocks project down to plain text, and how
 * a freshly edited list is normalized before it is written to a card.
 *
 * Everything here is deliberately dependency-free — no KaTeX, no DOM — because
 * `blocksToPlainText` runs on every content write (it produces the `definition`
 * mirror) and is what the quiz, the XMind export and the repair path ultimately
 * read.
 */

const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', n: 'ⁿ', i: 'ⁱ',
}

/** Longest command first: `\times` must not be partially eaten by a shorter pattern. */
const SYMBOLS: [RegExp, string][] = [
  [/\\times/g, '×'],
  [/\\cdot/g, '·'],
  [/\\div/g, '÷'],
  [/\\leq/g, '≤'],
  [/\\geq/g, '≥'],
  [/\\neq/g, '≠'],
  [/\\approx/g, '≈'],
  [/\\infty/g, '∞'],
  [/\\rightarrow/g, '→'],
  [/\\to/g, '→'],
  [/\\pm/g, '±'],
  [/\\pi/g, 'π'],
]

function toSuperscript(exponent: string): string | null {
  let out = ''
  for (const character of exponent) {
    const mapped = SUPERSCRIPTS[character]
    if (mapped === undefined) return null
    out += mapped
  }
  return out
}

/**
 * A LaTeX formula rendered as readable plain text.
 *
 * Deliberately partial. The contract this serves is "the `definition` mirror is
 * never empty and never silently loses content" — not "faithful typesetting",
 * which is KaTeX's job on the display path. So anything unmapped survives as
 * its bare command name (`\oint` → `oint`) rather than being dropped: a quiz
 * distractor or an XMind note reading `oint_C vecF` is poor, but a blank one
 * would be a lie.
 *
 * The mapped set is what a collège maths course actually writes: fractions,
 * powers, roots, ×, ÷, comparisons, π.
 */
export function latexToPlainText(latex: string): string {
  let out = latex

  // Fractions first, and repeatedly: `\frac{\frac{a}{b}}{c}` resolves from the
  // inside out, and the inner-brace pattern only matches once a level is flat.
  let previous: string
  do {
    previous = out
    out = out.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2')
  } while (out !== previous)

  out = out.replace(/\\sqrt\{([^{}]*)\}/g, '√$1')

  // `^{12}` and `^2` alike; an exponent with no unicode form keeps its source.
  out = out.replace(/\^\{([^{}]*)\}|\^(\S)/g, (whole, braced?: string, single?: string) => {
    const exponent = braced ?? single ?? ''
    return toSuperscript(exponent) ?? whole
  })

  for (const [pattern, replacement] of SYMBOLS) out = out.replace(pattern, replacement)

  // Whatever commands are left lose their backslash rather than their name.
  out = out.replace(/\\([a-zA-Z]+)/g, '$1')
  out = out.replace(/[{}]/g, '')

  return out.replace(/\s+/g, ' ').trim()
}

function blockToPlainText(block: CardBlock): string {
  switch (block.kind) {
    case 'text':
      return block.text.trim()
    case 'math':
      return latexToPlainText(block.latex)
    case 'image':
      // Named, never silent: this marker is what stops an image from vanishing
      // without trace from an XMind note or a QCM option.
      return `[image : ${block.alt.trim() || block.asset}]`
    case 'table':
      return [block.header, ...block.rows]
        .filter(row => row.length > 0)
        .map(row => row.join(' | '))
        .join('\n')
  }
}

/** Whether a block holds nothing a reader could use — the test for dropping it. */
function isEmptyBlock(block: CardBlock): boolean {
  switch (block.kind) {
    case 'text':
      return block.text.trim() === ''
    case 'math':
      return block.latex.trim() === ''
    case 'image':
      // An image block with no asset is a broken reference, not an image.
      return block.asset.trim() === ''
    case 'table':
      return ![...block.header, ...block.rows.flat()].some(cell => cell.trim() !== '')
  }
}

export function blocksToPlainText(blocks: CardBlock[]): string {
  return blocks
    .map(blockToPlainText)
    .filter(text => text !== '')
    .join('\n')
}

export function contentOf(card: Card): CardBlock[] {
  if (card.content !== undefined) return card.content
  if (card.definition !== undefined && card.definition !== '') {
    return [{ kind: 'text', text: card.definition }]
  }
  return []
}

/**
 * The card fields a block list should be stored as.
 *
 * Two rules, both about keeping files as plain as they already are:
 *
 * - empty blocks are dropped, so editing a formula down to nothing leaves no
 *   residue behind;
 * - a list that is *entirely* text is stored as `definition` alone, with no
 *   `content` field at all. A text block may contain newlines, so joining
 *   several of them loses nothing — and it means an existing plain-text card
 *   that is merely re-saved comes back out of the editor byte-identical,
 *   instead of quietly acquiring a `content` array.
 *
 * As soon as one block is not text, `content` is authoritative and `definition`
 * becomes its derived mirror. Callers must never write one without the other:
 * `updateContent` is the only place that does.
 */
export function normalizeContent(blocks: CardBlock[]): { content?: CardBlock[]; definition?: string } {
  const kept = blocks.filter(block => !isEmptyBlock(block))
  if (kept.length === 0) return {}

  const definition = blocksToPlainText(kept)
  if (definition === '') return {}

  if (kept.every(block => block.kind === 'text')) return { definition }
  return { content: kept, definition }
}
