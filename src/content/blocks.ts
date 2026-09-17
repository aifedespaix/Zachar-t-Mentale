import type { Card } from '../types/card'
import type { CardBlock, CardBlockKind, TableCell } from '../types/cardBlock'

function cellText(cell: TableCell): string {
  return typeof cell === 'string' ? cell : latexToPlainText(cell.latex)
}
function cellIsEmpty(cell: TableCell): boolean {
  return typeof cell === 'string' ? cell.trim() === '' : cell.latex.trim() === ''
}
function cloneCell(cell: TableCell): TableCell {
  return typeof cell === 'string' ? cell : { ...cell }
}

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

/**
 * Every pattern ends in `(?![a-zA-Z])`. Without it a command is matched by any
 * LONGER command sharing its prefix: `\\top` became `→p`, `\\cdots` became `·s`,
 * `\\leqslant` became `≤slant` — all of them ordinary notation.
 */
const SYMBOLS: [RegExp, string][] = [
  [/\\times(?![a-zA-Z])/g, '×'],
  [/\\cdot(?![a-zA-Z])/g, '·'],
  [/\\div(?![a-zA-Z])/g, '÷'],
  [/\\leq(?![a-zA-Z])/g, '≤'],
  [/\\geq(?![a-zA-Z])/g, '≥'],
  [/\\neq(?![a-zA-Z])/g, '≠'],
  [/\\approx(?![a-zA-Z])/g, '≈'],
  [/\\infty(?![a-zA-Z])/g, '∞'],
  [/\\rightarrow(?![a-zA-Z])/g, '→'],
  [/\\to(?![a-zA-Z])/g, '→'],
  [/\\pm(?![a-zA-Z])/g, '±'],
  [/\\pi(?![a-zA-Z])/g, 'π'],
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
 *
 * Les sauts de ligne, eux, ne sont PAS de l'espacement : un `latex` multi-ligne
 * est une série de lignes de formule, et elles traversent telles quelles — le
 * miroir `definition` d'un bloc doit garder la structure que l'écran montre.
 */
export function latexToPlainText(latex: string): string {
  return latex.split('\n').map(oneLatexLineToPlainText).join('\n')
}

/** Une seule ligne de LaTeX, sans son saut de ligne — le corps partagé de `latexToPlainText`. */
function oneLatexLineToPlainText(latex: string): string {
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
    const superscript = toSuperscript(exponent)
    if (superscript !== null) return superscript
    // Returning `whole` is not enough: the brace strip further down would then
    // turn `x^{2x}` into `x^2x`, which reads as x²·x. Parenthesising keeps the
    // grouping the braces carried.
    return braced === undefined ? whole : `^(${braced})`
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
      return [block.header, ...block.rows.map(row => row.map(cellText))]
        .filter(row => row.length > 0)
        .map(row => row.join(' | '))
        .join('\n')
    case 'question':
      // Read, never dropped: it is what the lines under it answer, and a quiz
      // option or an XMind note missing that sentence would be wrong while
      // still looking plausible. `blockToPlainText` stays linear here — there
      // are no children to walk.
      return block.text.trim()
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
      // No asset is a broken reference, not an image; non-finite dimensions
      // would serialize to `null` and be dropped on the next load, leaving the
      // definition claiming a picture that no longer exists.
      return block.asset.trim() === '' || !Number.isFinite(block.width) || !Number.isFinite(block.height)
    case 'table':
      return (
        block.header.every(cell => cell.trim() === '') && block.rows.flat().every(cellIsEmpty)
      )
    case 'question':
      // An empty header groups nothing and would tint a range with no title.
      // Dropped like an empty text block, which is also what stops a header
      // that was edited down to nothing from surviving as a lone `content`
      // entry on a card that should have collapsed back to `definition`.
      return block.text.trim() === ''
  }
}

/**
 * Whether two block lists differ, for the "is there anything new to save?"
 * check that gates autosave and the local undo history alike.
 *
 * Structural rather than referential: the editor rebuilds its array on every
 * keystroke, so identity would report a change the moment a field was touched
 * at all — including by typing a character and deleting it again.
 */
export function blocksDiffer(a: CardBlock[], b: CardBlock[]): boolean {
  return JSON.stringify(a) !== JSON.stringify(b)
}

export function blocksToPlainText(blocks: CardBlock[]): string {
  return blocks
    .map(blockToPlainText)
    .filter(text => text !== '')
    .join('\n')
}

/**
 * A block detached from whoever handed it over. The editor holds a live draft
 * array; storing its objects by reference would let a later keystroke mutate
 * the card already written — and every undo snapshot sharing that object with
 * it — so `definition` and `content` would silently drift apart.
 */
function cloneBlock(block: CardBlock): CardBlock {
  // Recopié à la main dans la branche `table`, qui reconstruit ses champs un
  // par un ; l'autre branche l'emporte par le spread.
  const standalone = block.standalone === true ? { standalone: true } : {}
  return block.kind === 'table'
    ? { kind: 'table', header: [...block.header], rows: block.rows.map(row => row.map(cloneCell)), ...standalone }
    : { ...block }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

/**
 * A raw block as it came off disk, narrowed to something renderable — or
 * `null` when there is nothing worth showing.
 *
 * A block of a kind this version does not know (a `music` block written by a
 * later one) degrades to a text block carrying whatever strings it held, so it
 * is shown poorly rather than lost. A block of a KNOWN kind whose payload is
 * malformed is dropped instead: half an image is not an image, and rendering it
 * would throw where the whole point of validation is that it must not.
 */
function sanitizeBlock(raw: unknown): CardBlock | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const block = raw as Record<string, unknown>

  // Le seul champ qui parle de la LISTE et non du contenu du bloc. Lu une fois
  // ici pour que chaque genre accepté le rapporte ; absent veut dire « appartient
  // à la question au-dessus », ce que disent tous les fichiers antérieurs.
  const standalone = block.standalone === true ? { standalone: true } : {}

  switch (block.kind) {
    case 'text':
      return typeof block.text === 'string' ? { kind: 'text', text: block.text, ...standalone } : null
    case 'math':
      // `display` is read from nowhere any more (every math block is its own
      // line), but an older file may still carry it — dropped silently rather
      // than rejecting the block over a field that no longer means anything.
      return typeof block.latex === 'string' ? { kind: 'math', latex: block.latex, ...standalone } : null
    case 'image':
      return typeof block.asset === 'string' &&
        typeof block.alt === 'string' &&
        // `Number.isFinite`, not `typeof === 'number'`: a failed image decode
        // yields NaN, which JSON.stringify writes as `null` and this function
        // then rejects on reload — silently dropping the image while the
        // definition still claimed one.
        typeof block.width === 'number' &&
        Number.isFinite(block.width) &&
        typeof block.height === 'number' &&
        Number.isFinite(block.height)
        ? { kind: 'image', asset: block.asset, alt: block.alt, width: block.width, height: block.height, ...standalone }
        : null
    case 'table': {
      if (!isStringArray(block.header) || !Array.isArray(block.rows)) return null
      const rows: TableCell[][] = []
      for (const rawRow of block.rows as unknown[]) {
        if (!Array.isArray(rawRow)) return null
        const row: TableCell[] = []
        for (const rawCell of rawRow) {
          if (typeof rawCell === 'string') row.push(rawCell)
          else if (
            typeof rawCell === 'object' &&
            rawCell !== null &&
            typeof (rawCell as Record<string, unknown>).latex === 'string'
          ) {
            row.push({ latex: (rawCell as { latex: string }).latex })
          } else return null
        }
        rows.push(row)
      }
      return { kind: 'table', header: [...block.header], rows, ...standalone }
    }
    case 'question': {
      // Every branch below rebuilds its block field by field, so this one has
      // to name `text` explicitly: leaving it to the `default` branch would
      // keep the words but lose the KIND, and the grouped style with it.
      //
      // Une pastille blanche est JETÉE plutôt que stockée : le champ veut dire
      // « saisi à la main », donc des espaces figeraient la numérotation sur une
      // pastille vide sans qu'on puisse faire la différence.
      const label = typeof block.label === 'string' && block.label.trim() !== '' ? { label: block.label } : {}
      return typeof block.text === 'string'
        ? { kind: 'question', text: block.text, ...label, ...standalone }
        : null
    }
    default: {
      // Unknown kind: keep whatever a human could still read out of it.
      const text = Object.entries(block)
        .filter(([key, value]) => key !== 'kind' && typeof value === 'string')
        .map(([, value]) => value as string)
        .join('\n')
        .trim()
      return text === '' ? null : { kind: 'text', text, ...standalone }
    }
  }
}

/**
 * The blocks of a card, ready to render.
 *
 * This is the ONLY read adapter — `BlockView`, the export's `StaticCardView`
 * and the quiz all go through it — which is what lets the degradation live
 * here rather than at load time. That placement is deliberate: the load path
 * validates without transforming, so merely OPENING a map written by a newer
 * version leaves its unknown blocks untouched on disk. This function never
 * mutates the card.
 *
 * It does not make them survive forever, and the distinction matters: the
 * first `updateContent` on that card — including one triggered by something
 * unrelated, like dropping an image into it — writes back the degraded list
 * and the unknown KIND is gone for good (its text survives as a text block).
 * Making that lossless would mean carrying opaque blocks through the editor,
 * which is a larger design than this lot took on.
 */
export function contentOf(card: Card): CardBlock[] {
  const blocks = sanitizeBlocks(card.content)
  // An empty result is not the same as "no definition": `content: []`, or a
  // content array whose every block was unreadable, would otherwise render
  // blank while the quiz and the export still showed `definition`. Falling
  // back keeps the two in agreement, which is the whole point of the mirror.
  if (blocks.length > 0) return blocks
  if (card.definition !== undefined && card.definition !== '') {
    return [{ kind: 'text', text: card.definition }]
  }
  return []
}

/**
 * Which non-text kinds a definition holds, in a stable order.
 *
 * Drives the badges on the card's description button and on a collapsed fiche
 * header. Text is excluded because it is the default: a badge on every card
 * that merely has words would carry no information and cost a row of chrome.
 *
 * The order is fixed rather than first-seen so two cards with the same kinds
 * always show the same badges in the same places — a card is scanned, not
 * read, and a badge that moves between cards is a badge that has to be read.
 *
 * A `question` header is excluded as well, and the TYPE says so: these badges
 * answer « what is in there? » and drive the « À quel titre correspond… ? »
 * heading. A header is structure, so counting it would advertise a grouping
 * as content — and would demand a heading neither record has an entry for.
 */
export function nonTextKinds(blocks: CardBlock[]): Exclude<CardBlockKind, 'text' | 'question'>[] {
  const order: Exclude<CardBlockKind, 'text' | 'question'>[] = ['math', 'image', 'table']
  return order.filter(kind => blocks.some(block => block.kind === kind))
}

/** A run of consecutive blocks sitting under one header, in reading order. */
export interface BlockGroup {
  /**
   * The index of the `question` header that owns the run, or `null` for the
   * blocks that come before the first header.
   */
  headerIndex: number | null
  indexes: number[]
}

/**
 * Cuts a block list into the ranges a group header owns.
 *
 * The whole grouping feature is this function plus a tinted wrapper: a
 * `question` block owns itself and every following block up to the next
 * header. Deriving a RANGE rather than nesting children is what keeps the
 * model flat — no other part of the app has to learn about groups.
 *
 * Shared by the read-only renderer and the editor, for the same reason those
 * two already share `BlockView`: a screen that drew the group boundary
 * differently from the printed page would only ever be noticed by a user
 * printing a revision sheet the night before a test.
 */
export function blockGroups(blocks: CardBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = []
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    // A header ALWAYS opens a range, even directly after another header: the
    // second question answers nothing here, so absorbing it into the first
    // range would tint its title as though it belonged to its predecessor.
    if (block.kind === 'question') {
      groups.push({ headerIndex: index, indexes: [index] })
      continue
    }
    const current = groups[groups.length - 1]
    // Un bloc marqué `standalone` vient du bouton EXTÉRIEUR au groupe : il ferme
    // la question au-dessus de lui au lieu de s'y faire absorber, et ouvre une
    // portée sans en-tête — exactement ce que le geste promettait.
    if (current !== undefined && current.headerIndex !== null && block.standalone !== true) {
      current.indexes.push(index)
    } else if (current !== undefined && current.headerIndex === null) {
      // Déjà dans une portée sans en-tête : elle se continue.
      current.indexes.push(index)
    } else {
      groups.push({ headerIndex: null, indexes: [index] })
    }
  }
  return groups
}

/**
 * La lettre suivante, sur la règle d'un tableur : `a` → `b`, `z` → `aa`.
 * Reçoit toujours une minuscule ; la casse est reposée par l'appelant.
 */
function bumpLetter(letter: string): string {
  if (letter < 'z') return String.fromCharCode(letter.charCodeAt(0) + 1)
  return 'aa'
}

/**
 * La pastille SUIVANTE, déduite de la précédente.
 *
 * Deux formes se continuent : un nombre arabe final (`1` → `2`, `Ex 3` →
 * `Ex 4`) et une lettre latine finale (`a` → `b`, `A` → `B`, `z` → `aa`).
 * Tout le reste rend une chaîne vide — un nombre romain de plusieurs lettres
 * finit bien par une lettre, mais `IV` → `IW` serait une suite absurde, et la
 * règle du projet est de ne rien inventer plutôt que d'inventer faux.
 */
export function nextQuestionLabel(previous: string): string {
  const label = previous.trim()
  if (label === '') return ''
  if (label.length > 1 && /^[ivxlcdm]+$/i.test(label)) return ''
  const digits = /[0-9]+$/.exec(label)
  if (digits !== null) return label.slice(0, -digits[0].length) + String(Number(digits[0]) + 1)
  const last = label[label.length - 1]
  if (last >= 'a' && last <= 'z') return label.slice(0, -1) + bumpLetter(last)
  if (last >= 'A' && last <= 'Z') return label.slice(0, -1) + bumpLetter(last.toLowerCase()).toUpperCase()
  return ''
}

/**
 * La pastille EFFECTIVE de chaque question, indexée comme la liste de blocs —
 * chaîne vide pour tout ce qui n'est pas une question.
 *
 * Une pastille saisie à la main gagne toujours, et sert de base à la suivante.
 * Sans saisie elle se déduit de la précédente, la toute première valant « 1 ».
 * Rien de tout cela n'est écrit dans le fichier — seule la saisie l'est — donc
 * corriger une pastille en amont renumérote la suite au rendu suivant.
 */
export function questionLabels(blocks: CardBlock[]): string[] {
  const labels: string[] = []
  let previous = ''
  let seen = false
  for (const block of blocks) {
    if (block.kind !== 'question') {
      labels.push('')
      continue
    }
    const typed = (block.label ?? '').trim()
    if (typed !== '') {
      labels.push(typed)
      previous = typed
    } else {
      const derived = seen ? nextQuestionLabel(previous) : '1'
      labels.push(derived)
      // Une déduction vide N'ÉCRASE pas la précédente : sans quoi la question
      // d'après repartirait de « 1 » alors qu'elle suit toujours la même.
      if (derived !== '') previous = derived
    }
    seen = true
  }
  return labels
}

/** Every readable block of a raw `content` array. Exported for the repair path. */
export function sanitizeBlocks(raw: unknown): CardBlock[] {
  if (!Array.isArray(raw)) return []
  return raw.map(sanitizeBlock).filter((block): block is CardBlock => block !== null)
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
  return { content: kept.map(cloneBlock), definition }
}

/**
 * Re-derives every card's `definition` from its `content`.
 *
 * The invariant is enforced on the WRITE path (`updateContent` is the single
 * writer), but nothing enforced it on the way IN — and a `.json` is not
 * necessarily written by the app. The skill now hands both fields to an LLM to
 * fill in, which makes a hand-computed projection the most likely source of a
 * mismatch in the wild; a card could render a stacked fraction on screen while
 * the quiz, the XMind note and the PDF all repeated a stale line of text.
 *
 * Reconciling at load makes the two agree everywhere, and only ever rewrites
 * the DERIVED field — `content` is authoritative and untouched.
 */
export function reconcileCards(cards: Card[]): Card[] {
  return cards.map(card => {
    if (card.content === undefined) return card
    const derived = blocksToPlainText(contentOf(card))
    if (derived === (card.definition ?? '')) return card

    const next: Card = { ...card }
    if (derived === '') delete next.definition
    else next.definition = derived
    return next
  })
}
