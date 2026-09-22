import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Equal,
  Heading1,
  ImagePlus,
  MessageCircleQuestion,
  Plus,
  Sigma,
  Table2,
  Trash2,
  Type,
  X,
} from 'lucide-react'
import type { CardBlock, CardBlockKind, EquationStep, TableCell } from '../types/cardBlock'
import { blockGroups, equationToPlainText, questionLabels } from './blocks'
import { EquationBlockField } from './EquationEditor'
import { canMoveBlock, movePlan } from './blockMove'
import { renderMathToHtml } from './renderMath'
import { MathFieldEditor, type MathFieldHandle, type MathfieldElement } from './MathFieldEditor'
import { SymbolBand } from './SymbolBand'
import type { BandTabId, PaletteSymbol } from '../types/symbolBand'
import { loadBandTab, saveBandTab } from '../persistence/bandTab'
import { SYMBOL_TABS } from './symbolTabs'
import { insertCharacter, type SpecialCharacter } from './languageHelp'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { Hint } from '../components/ui/hint'
import { TooltipProvider } from '../components/ui/tooltip'
import { EmptyAreaContextMenu, type EmptyAreaMenuActions } from './EmptyAreaContextMenu'
import { BlockContextMenu } from './BlockContextMenu'
import { FieldContextMenu } from './FieldContextMenu'

/** The two kinds a block can be switched between. `table` and `image` are made, not switched to. */
export type SwitchableKind = 'text' | 'math'

/**
 * What the type switch calls each kind, for its own label.
 *
 * A `Record` rather than a chain of ternaries, and that is the whole point: the
 * chain used to end in `: 'Image'`, so every kind it did not name — a TABLE,
 * today — was announced as an image. The mistake reached the button's text and
 * its `aria-label` alike, and no test covered it because only text and formula
 * were exercised. Typing this as `Record<CardBlockKind, string>` makes a future
 * kind unrepresentable here until someone names it.
 */
export const KIND_LABEL: Record<CardBlockKind, string> = {
  text: 'Texte',
  math: 'Formule',
  equation: 'Équation',
  table: 'Tableau',
  image: 'Image',
  question: 'Question',
}

/**
 * L'ordre dans lequel Tab fait le tour des types : texte → formule → tableau →
 * question, et retour au texte.
 *
 * `image` n'y figure pas — un changement de type détruirait la référence au
 * fichier (voir `convertBlock`), donc Tab ne l'atteint jamais.
 */
const KIND_CYCLE: CardBlockKind[] = ['text', 'math', 'table', 'question']

/** The widths the image control offers, as a share of the definition's width. */
const IMAGE_WIDTH_STEPS = [160, 240, 320, 480, 640] as const

type TableBlock = Extract<CardBlock, { kind: 'table' }>

function tableCellText(cell: TableCell): string {
  return typeof cell === 'string' ? cell : cell.latex
}

/** The string a block carries, used to move content across a mode change. */
function sourceOf(block: CardBlock): string {
  switch (block.kind) {
    case 'text':
      return block.text
    case 'math':
      return block.latex
    case 'equation':
      return equationToPlainText(block.steps)
    case 'image':
      return block.alt
    case 'question':
      // A header carries prose, so it leaves as prose — exactly as a text block.
      return block.text
    case 'table':
      // Header included: dropping it loses a row of the user's data, and a
      // header is text like any other cell once flattened.
      return [block.header, ...block.rows.map(row => row.map(tableCellText))]
        .filter(row => row.length > 0)
        .map(row => row.join('\t'))
        .join('\n')
  }
}

/**
 * Une étape par ligne de `source` (même convention que texte ↔ formule : un
 * saut de ligne EST une ligne), coupée au premier « = » quand il y en a un.
 *
 * Repli honnête plutôt que magique : une ligne sans « = » devient un membre
 * gauche avec un membre droit vide, jamais une équation inventée.
 */
function equationStepsFromSource(source: string): EquationStep[] {
  const lines = source === '' ? [''] : source.split('\n')
  return lines.map(line => {
    const at = line.indexOf('=')
    return at === -1
      ? { left: line, right: '' }
      : { left: line.slice(0, at).trim(), right: line.slice(at + 1).trim() }
  })
}

/**
 * Re-kinds a block, carrying its text across.
 *
 * Reversibility is the point (règle anti-décalage 6): text → math keeps the
 * string as LaTeX source, math → text keeps the LaTeX as text. A user who
 * switches modes to see what happens can always switch back, so the switch is
 * safe to explore rather than a decision to commit to.
 */
export function convertBlock(block: CardBlock, kind: CardBlockKind): CardBlock {
  if (block.kind === kind) return block
  // An image cannot round-trip: there is no mode that produces one back, so
  // converting it away would destroy the asset reference for good (the file
  // itself would linger, orphaned). Refusing is the only behaviour consistent
  // with "switching mode never destroys content" — the user deletes the block
  // if they want it gone.
  if (block.kind === 'image') return block
  const source = sourceOf(block)
  // Le marqueur de LISTE suit le bloc : sans lui, un changement de type ferait
  // retomber dans la question un bloc que le bouton extérieur venait d'en sortir.
  const standalone = block.standalone === true ? { standalone: true } : {}
  switch (kind) {
    case 'text':
      return { kind: 'text', text: source, ...standalone }
    case 'math':
      return { kind: 'math', latex: source, ...standalone }
    case 'equation':
      return { kind: 'equation', steps: equationStepsFromSource(source), ...standalone }
    case 'question':
      // Marking a sentence as a header, and un-marking it, is the same
      // reversible gesture as text ↔ formula: the string crosses untouched.
      // La pastille ne traverse pas : elle n'a de sens que sur une question, et
      // en inventer une ici figerait une numérotation que personne n'a saisie.
      return { kind: 'question', text: source, ...standalone }
    case 'table':
      return {
        kind: 'table',
        header: [],
        rows: source === '' ? [['', '']] : source.split('\n').map(line => line.split('\t')),
        ...standalone,
      }
    case 'image':
      return block
  }
}

/**
 * The contiguous run of `math` blocks around `index` — la « zone formule » des
 * fichiers écrits par l'ancien modèle, où `Entrée` empilait un bloc par ligne.
 * `mergeMathZone` la replie en un seul texte ; l'éditeur ne la crée plus,
 * puisque ses lignes de formule vivent maintenant DANS un bloc (voir
 * `MathLinesField`). Bounded by the group `index` sits in (see `blockGroups`),
 * so a merge into text can never reach into a different question's formulas.
 * `index` itself must already be a `math` block; anything else is its own
 * one-block "run".
 */
export function mathZoneAround(blocks: CardBlock[], index: number): { start: number; end: number } {
  if (blocks[index]?.kind !== 'math') return { start: index, end: index }
  const bounds = blockGroups(blocks).find(group => group.indexes.includes(index))?.indexes ?? [index]
  let start = index
  while (start > bounds[0] && blocks[start - 1]?.kind === 'math') start -= 1
  let end = index
  const last = bounds[bounds.length - 1]
  while (end < last && blocks[end + 1]?.kind === 'math') end += 1
  return { start, end }
}

/**
 * Folds the formula zone around `index` into ONE text block, one line per
 * formula — the reverse of the conversion texte → formule, et ce qui replie un
 * ancien fichier (un bloc par ligne) en un seul bloc texte multi-ligne au lieu
 * de laisser un bloc derrière chaque ligne.
 */
export function mergeMathZone(blocks: CardBlock[], index: number): { blocks: CardBlock[]; index: number } {
  const { start, end } = mathZoneAround(blocks, index)
  const run = blocks.slice(start, end + 1)
  const standalone = run[0]?.standalone === true ? { standalone: true } : {}
  const merged: CardBlock = { kind: 'text', text: run.map(sourceOf).join('\n'), ...standalone }
  return { blocks: [...blocks.slice(0, start), merged, ...blocks.slice(end + 1)], index: start }
}

/**
 * The block as the 1×1 table it always already was.
 *
 * The user's model, and now the app's: any block of content IS a one-cell
 * table, and a real table is what you get by adding a column or a row to it.
 * `table` therefore left the type switch (see `SwitchableKind`) — you do not
 * "convert to a table", you grow one, which is the same gesture as adding the
 * second column of a table you already have.
 *
 * The cell keeps the block's own kind: a formula becomes a formula CELL, not
 * text that happens to look like LaTeX.
 *
 * Une LIGNE de contenu donne une LIGNE de tableau : c'est la même règle « un
 * passage à la ligne = une ligne » que la conversion texte ↔ formule, et c'est
 * ce qui fait qu'un texte de trois lignes arrive dans un tableau de trois
 * lignes au lieu d'être empilé dans une seule cellule.
 *
 * An image is excluded by the TYPE, not by a runtime check: there is no text to
 * put in the cell, and a table containing the picture's alt text would be a
 * silent way to lose the picture.
 */
export function blockAsTable(block: Exclude<CardBlock, { kind: 'image' }>): TableBlock {
  if (block.kind === 'table') return block
  const standalone = block.standalone === true ? { standalone: true } : {}
  const rows = sourceOf(block)
    .split('\n')
    .map((line): TableCell[] => [block.kind === 'math' ? { latex: line } : line])
  return { kind: 'table', header: [], rows, ...standalone }
}

/**
 * The kind a new block starts as, given the block it is being added after.
 *
 * A definition is usually a run of one kind — three formulas in a row, or a
 * paragraph carried on after another — and reaching for the type switch between
 * every one of them spends two gestures on the gesture that happens most.
 *
 * Only `text` and `math` are ever inherited, and that is not a shortcut: after a
 * TABLE, `Entrée` inside a cell adds a ROW rather than a block, and an IMAGE
 * carries no text for a new block to hold, so "the kind of the block above" has
 * no meaning for either of them. Anything else starts as text, as it always did.
 */
export function inheritableKind(previous: CardBlock | undefined): SwitchableKind {
  return previous !== undefined && previous.kind === 'math' ? 'math' : 'text'
}

/** An empty block of `kind` — the shape every "new block" gesture inserts. */
export function emptyBlock(kind: SwitchableKind): CardBlock {
  return kind === 'math' ? { kind: 'math', latex: '' } : { kind: 'text', text: '' }
}

/**
 * Whether typing `$$` at the end of a text block should turn the WHOLE block into
 * a formula.
 *
 * `$$` is a fast path for someone taking notes live, who should not have to reach
 * for the type switch mid-sentence. But "the text ends with `$$`" is too broad: a
 * sentence that legitimately ends in « … coûte 5$$ » was swallowed into LaTeX
 * source, and nobody meant that. The trigger is therefore narrowed to what is
 * actually meant — an empty block, or `$$` alone on its own line (leading
 * whitespace allowed) — so anything else stays the prose the user typed.
 */
export function isFormulaTrigger(text: string): boolean {
  if (!text.endsWith('$$')) return false
  // What precedes the trigger on its LINE has to be whitespace, not words. The
  // block is empty when there is no line at all, which `''` answers too.
  const lineSoFar = text.slice(0, -2).split('\n').pop() ?? ''
  return lineSoFar.trim() === ''
}

/** A copy of block `index`, inserted right after it. A shallow copy is enough: every block mutation in this file returns a new object rather than editing one in place, so the two can safely share a table's rows or an image's dimensions until one of them is next edited. */
export function duplicateBlock(blocks: CardBlock[], index: number): CardBlock[] {
  const block = blocks[index]
  if (block === undefined) return blocks
  return [...blocks.slice(0, index + 1), { ...block }, ...blocks.slice(index + 1)]
}

/**
 * Rescales an image block to a new displayed width, keeping its shape.
 *
 * `width`/`height` are the box the renderer reserves — `BlockView` puts them
 * on the `<img>` and derives its `aspect-ratio` from them — so scaling the
 * pair IS the display size, and no new field is needed on the block. The ratio
 * is taken from the values already stored, so repeated resizes do not drift.
 */
export function resizeImageBlock(block: Extract<CardBlock, { kind: 'image' }>, width: number): CardBlock {
  const ratio = block.height / block.width
  if (!Number.isFinite(ratio) || ratio <= 0) return { ...block, width }
  return { ...block, width, height: Math.max(1, Math.round(width * ratio)) }
}

/** Every row (and the header) squared to `count` columns, padding with `blank`. */
function withColumns<T>(count: number, cells: T[], blank: T): T[] {
  return Array.from({ length: count }, (_, i) => cells[i] ?? blank)
}

function insertAt<T>(cells: T[], at: number, value: T): T[] {
  const next = [...cells]
  next.splice(Math.min(Math.max(at, 0), next.length), 0, value)
  return next
}

function tableColumnCount(block: TableBlock): number {
  return Math.max(block.header.length, ...block.rows.map(row => row.length), 1)
}

/**
 * A table's header is EMPTY until the user types in it, and stays empty
 * through the column edits.
 *
 * The distinction matters outside the editor: `BlockView` — the renderer the
 * card and the PDF share — draws a bordered row for any non-empty header
 * array, so padding the header with blank strings to keep the columns aligned
 * would paint a band of empty grey cells above every table that has no
 * headings at all. Only `setTableHeaderCell` (someone actually typing) may
 * turn the empty array into a row.
 */
function growHeader(header: string[], cols: number, at: number, blank: string): string[] {
  if (header.length === 0) return header
  return insertAt(withColumns<string>(cols, header, blank), at, blank)
}

function shrinkHeader(header: string[], cols: number, cellIndex: number): string[] {
  if (header.length === 0) return header
  return withColumns<string>(cols, header, '').filter((_, i) => i !== cellIndex)
}

/**
 * The table's own pure edits, alongside `moveBlock`/`convertBlock` above.
 *
 * `afterRow`/`afterColumn` are what make the "between two rows, between two
 * columns" buttons possible: a `+` sits on every boundary, so a column is
 * inserted where the user is looking rather than always at the far end.
 * `undefined` appends, which is what the labelled button in the block's footer
 * does.
 */
export function addTableRow(block: TableBlock, afterRow?: number): TableBlock {
  const cols = tableColumnCount(block)
  const at = afterRow === undefined ? block.rows.length : afterRow + 1
  const rows = [...block.rows]
  rows.splice(Math.min(Math.max(at, 0), rows.length), 0, withColumns<TableCell>(cols, [], ''))
  return { ...block, rows }
}
export function removeTableRow(block: TableBlock, rowIndex: number): TableBlock {
  return block.rows.length <= 1 ? block : { ...block, rows: block.rows.filter((_, i) => i !== rowIndex) }
}
export function addTableColumn(block: TableBlock, afterColumn?: number): TableBlock {
  const cols = tableColumnCount(block)
  const at = afterColumn === undefined ? cols : afterColumn + 1
  return {
    ...block,
    header: growHeader(block.header, cols, at, ''),
    rows: block.rows.map(row => insertAt(withColumns<TableCell>(cols, row, ''), at, '')),
  }
}
export function removeTableColumn(block: TableBlock, cellIndex: number): TableBlock {
  const cols = tableColumnCount(block)
  if (cols <= 1) return block
  return {
    ...block,
    header: shrinkHeader(block.header, cols, cellIndex),
    rows: block.rows.map(row => withColumns<TableCell>(cols, row, '').filter((_, i) => i !== cellIndex)),
  }
}
export function setTableCell(block: TableBlock, rowIndex: number, cellIndex: number, cell: TableCell): TableBlock {
  const cols = tableColumnCount(block)
  return {
    ...block,
    rows: block.rows.map((row, i) =>
      i === rowIndex
        ? withColumns<TableCell>(cols, row, '').map((existing, j) => (j === cellIndex ? cell : existing))
        : withColumns<TableCell>(cols, row, '')
    ),
  }
}
export function setTableHeaderCell(block: TableBlock, cellIndex: number, value: string): TableBlock {
  const cols = tableColumnCount(block)
  return { ...block, header: withColumns<string>(cols, block.header, '').map((c, i) => (i === cellIndex ? value : c)) }
}

/**
 * Text ↔ formula for one cell, carrying its content across the same way
 * `convertBlock` does, but landing on a NAMED kind rather than toggling: the
 * cell's menu offers "Texte" and "Formule" as two choices, so it says which one
 * was picked. Reading the current kind off the cell and inverting it would make
 * the menu lie the moment the two ever disagree.
 */
export function setTableCellKind(block: TableBlock, rowIndex: number, cellIndex: number, kind: SwitchableKind): TableBlock {
  const cols = tableColumnCount(block)
  const cell = withColumns<TableCell>(cols, block.rows[rowIndex] ?? [], '')[cellIndex] ?? ''
  const isMath = typeof cell !== 'string'
  if ((kind === 'math') === isMath) return block
  const next: TableCell = kind === 'math' ? { latex: tableCellText(cell) } : tableCellText(cell)
  return setTableCell(block, rowIndex, cellIndex, next)
}

export interface BlockEditorProps {
  blocks: CardBlock[]
  onChange: (blocks: CardBlock[]) => void
  resolveAsset: (asset: string) => string
  /**
   * Stores an image and yields the block referencing it, or `undefined` when
   * there is nowhere to store one (no file open). Absent entirely when the
   * host cannot handle images at all — the affordances then stay hidden rather
   * than failing on click.
   */
  onInsertImage?: (source: { bytes: Uint8Array; mime: string; name?: string }) => Promise<CardBlock | undefined>
  /** Opens the native picker; absent when the host offers no picker. */
  onPickImage?: () => Promise<CardBlock | undefined>
  onError?: (message: string) => void
  /**
   * Puts the caret in the first text field as soon as the editor mounts.
   *
   * The description modal exists so a card can be written in; without this it
   * opens with focus on the first toolbar button (Radix focuses the first
   * tabbable element of a dialog), and the user's first keystroke goes nowhere.
   * The host must also cancel Radix's own auto-focus, or it would take the
   * focus straight back.
   */
  autoFocusField?: boolean
  /**
   * Les familles de signes masquées (voir `persistence/bandFamilies`).
   *
   * Elles viennent de la MODALE, où vit le bouton qui les règle : le réglage et
   * sa commande doivent être au même endroit, et le pied de la description est un
   * support plus stable que le bandeau — qui se replie sur deux ou trois lignes,
   * donc dont la dernière ligne sort souvent de la vue.
   */
  hiddenFamilies?: string[]
  /**
   * The empty-area right-click menu's actions that belong to the DIALOG
   * rather than to this editor — width, the shortcuts panel, the symbol
   * families overlay, the description's own undo history, closing and
   * deleting the whole description. Everything the menu needs that this
   * editor already owns (adding a block, the band's open tab) is supplied
   * from here instead; see `EmptyAreaContextMenu`.
   *
   * Optional so a caller with nowhere to route these — every current test
   * harness — gets the editor with no empty-area menu at all, rather than
   * one whose actions silently do nothing.
   */
  dialogMenuActions?: Omit<EmptyAreaMenuActions, 'onAddBlock' | 'bandTab' | 'onChooseTab'>
}

/**
 * Le défaut des familles masquées, partagé et jamais recréé : un littéral `[]`
 * recréé à chaque rendu casserait la mémoïsation du bandeau (`SymbolBand`).
 */
const NO_HIDDEN_FAMILIES: string[] = []

/**
 * The one place a definition is written.
 *
 * Its shape follows one rule above all: **everything the user needs is on the
 * block they are working on**. The side panel this editor used to carry — a
 * permanent 280px column holding the mode switch, the symbol palette and the
 * character help, all acting on "whichever block is active" — is gone. In its
 * place, each block wears its own controls: reorder and delete in a gutter on
 * its left, its type switch on its right — and every writing aid lives in the
 * band ABOVE the list (`SymbolBand`), out of the blocks, so no block ever has a
 * footer whose appearance or disappearance shifts the text under the pointer.
 */
export function BlockEditor({
  blocks,
  onChange,
  resolveAsset,
  onInsertImage,
  onPickImage,
  onError,
  autoFocusField = false,
  hiddenFamilies = NO_HIDDEN_FAMILIES,
  dialogMenuActions,
}: BlockEditorProps) {
  // Which block the band's insertion targets. Kept in state rather than derived
  // from DOM focus: the band is permanent, so it must still name a target while
  // the user is clicking inside the band itself (which takes focus away from the
  // block's own field).
  const [activeIndex, setActiveIndex] = useState(0)

  // The active math block's live handle, so the band's keys can insert into it.
  // Every math block registers itself here on mount regardless of whether it is
  // active — cheap, and it means the keys are ready the instant a block becomes
  // active rather than one render late.
  const [mathFields, setMathFields] = useState<Record<number, MathFieldHandle | null>>({})
  const activeField = mathFields[activeIndex] ?? null

  /**
   * Ce que le champ focalisé peut recevoir, et c'est ce qui décide quelles
   * familles du bandeau s'appliquent.
   *
   * Une famille « formule seulement » ne s'applique pas dans un texte : écrire
   * `\frac{}{}`  au milieu d'une phrase n'a pas de sens. Elle est donc GRISÉE
   * là où elle ne vaut rien — jamais retirée ni déplacée, sans quoi les touches
   * changeraient de place d'un bloc à l'autre et le geste ne se mémoriserait
   * plus.
   */
  const [focusedFieldKind, setFocusedFieldKind] = useState<'none' | 'text' | 'math'>('none')

  /**
   * Où le caret revient après une insertion dans une cellule de tableau.
   *
   * Une cellule est un champ CONTRÔLÉ : la nouvelle valeur n'atteint le DOM
   * qu'au rendu suivant, donc la position ne peut pas être reposée tout de
   * suite. Même raisonnement que `pendingCaret`, autre cible.
   */
  const pendingCellCaret = useRef<{ key: string; position: number } | null>(null)

  /**
   * Identités STABLES des blocs — pour le rendu et pour l'animation, jamais pour
   * le fichier : elles ne sont ni persistées ni sérialisées, et un `.zmap`
   * n'en sait rien.
   *
   * Elles existent parce que `key={index}` rend l'animation de déplacement
   * structurellement impossible : avec une clé d'index, React réutilise
   * l'élément de CHAQUE position et se contente de réécrire son contenu — aucun
   * élément ne « change de place », donc `layout` n'a rien à animer et une FLIP
   * non plus (l'ancienne et la nouvelle position d'un nœud sont les mêmes).
   * Une clé stable, au contraire, fait DÉPLACER le nœud : c'est ce mouvement que
   * `motion` anime.
   *
   * La réconciliation est volontairement simpliste — on garde les identités
   * existantes et on complète à la fin — et ce n'est pas de la paresse : c'est
   * ce qui la rend SÛRE. Une insertion au milieu fait donc remonter le DERNIER
   * bloc au lieu du nouveau, ce qui est invisible pour l'utilisateur (les champs
   * sont contrôlés, donc rien n'est perdu) alors qu'un décalage d'identités
   * ferait remonter le bloc qu'on est en train d'écrire — et donc perdre le
   * focus. Le seul cas qui exige un suivi exact est le DÉPLACEMENT, traité dans
   * `move` ci-dessous.
   */
  const blockIds = useRef<string[]>([])
  const idSeq = useRef(0)
  while (blockIds.current.length < blocks.length) {
    idSeq.current += 1
    blockIds.current = [...blockIds.current, `bloc-${idSeq.current}`]
  }
  if (blockIds.current.length > blocks.length) {
    blockIds.current = blockIds.current.slice(0, blocks.length)
  }


  const editorRef = useRef<HTMLDivElement>(null)

  /**
   * The scrolling list's own position, restored on every render this list
   * causes — adding, deleting, moving or editing a block, a table row, a
   * table column, anything that makes `blocks` a new array.
   *
   * Without this, that list can visibly snap to the top: a block removed
   * above the fold shrinks `scrollHeight` and the browser clamps `scrollTop`
   * down to fit, a group's wrapper can be dropped and recreated (React
   * unmounting a subtree the user was scrolled past), and CSS scroll
   * anchoring — meant to absorb exactly this — does not reliably survive a
   * `motion.div` reparenting itself mid-`layout` animation. Rather than
   * chase each cause, this restores the one thing the user actually cares
   * about: where they were. `useLayoutEffect`, not `useEffect` — it must run
   * BEFORE the browser paints the new layout, or the jump still flashes on
   * screen for a frame. It runs strictly before the caret/focus effect further
   * down (declared later, so it commits later), which is what lets a
   * genuinely-intended scroll — the browser's own `.focus()` bringing a new
   * field into view — still happen afterwards instead of being fought.
   */
  const blockListRef = useRef<HTMLDivElement>(null)
  const lastScrollTop = useRef(0)
  useLayoutEffect(() => {
    const el = blockListRef.current
    if (el) el.scrollTop = lastScrollTop.current
  }, [blocks])

  // Set by an insert or a new block, consumed by the effect below once the
  // change has been committed and re-rendered: a caret placed before that
  // commit is thrown away with the old value.
  const pendingCaret = useRef<{ index: number; position: number } | null>(null)
  const pendingFocusSelector = useRef<string | null>(null)
  /**
   * Which formula block's field to focus AT ITS END once a pending removal's
   * render has committed — the merge gesture backspace on an empty formula
   * LINE uses (see `deleteEmptyAt`). A math field has no DOM position a
   * `pendingCaret` could set, so it is asked through its own handle instead
   * (see `MathFieldHandle.focusEnd`).
   */
  const pendingMathFocusEnd = useRef<number | null>(null)
  /** Même chose pour le DÉBUT — le Suppr qui retire un bloc vide et rend la main au suivant (voir `deleteForwardAt`). */
  const pendingMathFocusStart = useRef<number | null>(null)

  /** The text field of block `index`, looked up in the DOM it is rendered in. */
  function textFieldAt(index: number): HTMLTextAreaElement | null {
    return editorRef.current?.querySelector<HTMLTextAreaElement>(`textarea[data-block-index="${index}"]`) ?? null
  }

  // No dependency array: the caret is restored after whatever render the insert
  // caused, and the ref makes every other run a no-op.
  useEffect(() => {
    const pending = pendingCaret.current
    if (pending !== null) {
      pendingCaret.current = null
      const field = textFieldAt(pending.index)
      field?.focus()
      field?.setSelectionRange(pending.position, pending.position)
    }

    const selector = pendingFocusSelector.current
    if (selector !== null) {
      pendingFocusSelector.current = null
      editorRef.current?.querySelector<HTMLElement>(selector)?.focus()
    }

    const cellCaret = pendingCellCaret.current
    if (cellCaret !== null) {
      pendingCellCaret.current = null
      // L'`input` À L'INTÉRIEUR de la cellule marquée : `data-cell` est sur
      // l'enveloppe, pour que `closest` la retrouve aussi bien depuis un
      // `<input>` que depuis un `<math-field>` MathLive.
      editorRef.current
        ?.querySelector<HTMLInputElement>(`[data-cell="${cellCaret.key}"] input`)
        ?.setSelectionRange(cellCaret.position, cellCaret.position)
    }

    // Un handle n'existe que si la ligne a DÉJÀ eu le focus : le bloc suivant
    // d'un bloc supprimé au Suppr n'en a aucun, et il faut alors retrouver son
    // premier champ dans le DOM plutôt que de perdre le focus.
    const mathFocusIndex = pendingMathFocusEnd.current
    if (mathFocusIndex !== null) {
      pendingMathFocusEnd.current = null
      const handle = mathFields[mathFocusIndex]
      if (handle !== null && handle !== undefined) handle.focusEnd()
      else editorRef.current?.querySelector<HTMLElement>(fieldSelector(mathFocusIndex))?.focus()
    }

    const mathFocusStartIndex = pendingMathFocusStart.current
    if (mathFocusStartIndex !== null) {
      pendingMathFocusStart.current = null
      const handle = mathFields[mathFocusStartIndex]
      if (handle !== null && handle !== undefined) handle.focusStart()
      else editorRef.current?.querySelector<HTMLElement>(fieldSelector(mathFocusStartIndex))?.focus()
    }
  })

  useEffect(() => {
    if (!autoFocusField) return
    // A TEXT block first — that is where prose is written, and where the
    // character palette inserts (`data-block-index` is only on those fields) —
    // with any field at all as the fallback, so a description whose first block
    // is a formula still opens on something typeable.
    const field =
      editorRef.current?.querySelector<HTMLElement>('textarea[data-block-index]') ??
      editorRef.current?.querySelector<HTMLElement>('textarea, input')
    field?.focus()
    if (field instanceof HTMLTextAreaElement) {
      // At the end of what is already written: focusing is for carrying on,
      // not for overwriting the definition the card already had.
      field.setSelectionRange(field.value.length, field.value.length)
    }
  }, [autoFocusField])

  function replace(index: number, block: CardBlock) {
    onChange(blocks.map((existing, i) => (i === index ? block : existing)))
  }

  /** The first focusable field of block `index`, as a selector scoped to that block. */
  function fieldSelector(index: number): string {
    return (
      `[data-row-index="${index}"] textarea, ` +
      `[data-row-index="${index}"] input, ` +
      `[data-row-index="${index}"] math-field, ` +
      `[data-row-index="${index}"] [contenteditable="true"]`
    )
  }

  /** Focuses the first field of block `index` once it exists in the DOM. */
  function focusBlockLater(index: number) {
    pendingFocusSelector.current = fieldSelector(index)
  }

  /**
   * Focuses a block's field once the dropdown that asked for it has finished
   * closing.
   *
   * Radix returns focus to the menu's trigger as the menu unmounts, and that
   * restoration does not run through React's own effects — so a focus placed by
   * `focusBlockLater` on the commit the switch causes is taken back a moment
   * later, which left the caret on the menu button rather than in the block the
   * user had just converted. Waiting for the next task is what makes it stick;
   * `onCloseAutoFocus` in `BlockKindMenu` is the other half of the same fix.
   */
  function focusBlockAfterMenu(index: number) {
    const selector = fieldSelector(index)
    window.setTimeout(() => {
      editorRef.current?.querySelector<HTMLElement>(selector)?.focus()
    }, 0)
  }

  /** A new block right after `index` — the shape every "Entrée" handler shares. */
  function insertBlockAfter(index: number, block: CardBlock) {
    onChange([...blocks.slice(0, index + 1), block, ...blocks.slice(index + 1)])
    setActiveIndex(index + 1)
    focusBlockLater(index + 1)
  }

  // Read at call time, never from the closure: the native picker can stay open
  // for a minute while the user keeps typing, and appending to the block list
  // as it was when the dialog opened would revert everything typed since.
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks

  function append(block: CardBlock) {
    const current = blocksRef.current
    onChange([...current, block])
    setActiveIndex(current.length)
    focusBlockLater(current.length)
  }

  /**
   * « Ajouter un bloc » DEPUIS L'EXTÉRIEUR du groupe : le bloc ne doit pas
   * tomber dans la question du bas. Il porte le marqueur `standalone`, qui
   * arrête la portée de cette question avant lui (voir `blockGroups`).
   *
   * Sans question au-dessus, le marqueur serait inerte : on ne l'écrit pas, et
   * un fichier sans groupe reste byte-identique à ce qu'il était.
   */
  function appendOutside() {
    const current = blocksRef.current
    const groups = blockGroups(current)
    const lastGroup = groups[groups.length - 1]
    const block = emptyBlock(inheritableKind(current[current.length - 1]))
    append(lastGroup !== undefined && lastGroup.headerIndex !== null ? { ...block, standalone: true } : block)
  }

  /** Shared by paste, drop and the picker: one place decides what a failure looks like. */
  async function insert(produce: () => Promise<CardBlock | undefined>) {
    try {
      const block = await produce()
      if (block !== undefined) append(block)
    } catch (error) {
      // Never silent: the user watched a picture not appear and is owed a
      // reason (usually "too large").
      onError?.(error instanceof Error ? error.message : 'Impossible d’insérer cette image.')
    }
  }

  /**
   * Inserts a palette character at the caret of the block being written.
   *
   * The band's keys target ONE block — the active one — so that block is where
   * the character goes, and there is no "which text block did they mean?" left
   * to guess. The band's language tabs feed this same path, paired signs and
   * all: a `¿` key is a `SpecialCharacter` like any other.
   *
   * A field that is not the focused element has no caret to respect — that is
   * the keyboard path, where focus is on the band's key — so the character
   * goes to the end of the text: degraded, never a lost click. What the
   * character writes (its closing partner, the padding, where the caret lands)
   * is the character set's business; see `insertCharacter`.
   */
  function insertText(character: SpecialCharacter) {
    const index = activeIndex
    const block = blocksRef.current[index]
    // A header is prose too: the accents and the language signs have to reach it
    // by the same caret path, or the one block a teacher is most likely to write
    // a question mark in would be the one that refuses it.
    if (block?.kind !== 'text' && block?.kind !== 'question') return

    const field = textFieldAt(index)
    const caret = field !== null && document.activeElement === field ? field : null
    const start = caret === null ? block.text.length : caret.selectionStart ?? block.text.length
    const end = caret === null ? start : caret.selectionEnd ?? start

    const insertion = insertCharacter(block.text, start, end, character)
    onChange(
      blocksRef.current.map((existing, i) => (i === index ? { kind: block.kind, text: insertion.text } : existing))
    )
    pendingCaret.current = { index, position: insertion.caret }
    setActiveIndex(index)
  }

  /**
   * Insère un signe du bandeau là où est le CARET.
   *
   * Une seule règle, et c'est elle qui permet à une touche unique de servir tous
   * les champs : **le champ qui a le focus décide de ce que le signe devient**.
   * L'Unicode dans un texte, le LaTeX dans une formule, et les taquets MathLive
   * (`#0`, `#?`) dans une cellule de formule pour que le curseur se place dans
   * ce qui vient d'être écrit. C'est PARCE QUE le signe s'adapte qu'il peut
   * garder la même place quel que soit le bloc.
   */
  function insertSymbol(symbol: PaletteSymbol) {
    if (insertIntoFocusedCell(symbol)) return

    const block = blocksRef.current[activeIndex]
    if (block?.kind === 'text' || block?.kind === 'question') {
      // Réutilise l'insertion au caret du bloc texte — paires et sélection
      // comprises : un signe du bandeau est un `SpecialCharacter` comme un autre.
      insertText({
        char: symbol.glyph,
        label: symbol.label,
        closesWith: symbol.closesWith,
        spaced: symbol.spaced,
      })
      return
    }
    if (block?.kind === 'math' || block?.kind === 'equation') {
      // Le champ VIVANT quand il est là : lui seul sait où est le caret.
      // Un caractère de langue n'a pas de forme LaTeX : sa touche est grisée
      // dans une formule, donc ce repli est une ceinture et non un chemin — il
      // écrit le glyphe plutôt que rien.
      //
      // Pour une équation, `activeField` est celui des TROIS champs de
      // l'étape qui a le focus — voir `onFieldChange` dans `EquationBlockField`.
      const latex = symbol.latex ?? symbol.glyph
      activeField?.insert(latex, symbol.plain ?? latex)
    }
  }

  /**
   * L'insertion dans la cellule de tableau qui a le focus, ou `false` s'il n'y
   * en a pas.
   *
   * La cellule est trouvée DEPUIS l'élément focalisé, à l'instant du clic, et
   * jamais mémorisée : un couple (ligne, colonne) gardé en état devient faux dès
   * qu'on insère une colonne ou qu'on supprime une ligne, et une palette qui
   * écrit dans la mauvaise cellule est pire que pas de palette.
   */
  function insertIntoFocusedCell(symbol: PaletteSymbol): boolean {
    const focused = document.activeElement
    if (!(focused instanceof HTMLElement)) return false
    const key = focused.closest<HTMLElement>('[data-cell]')?.dataset.cell
    if (key === undefined) return false

    const [rowText, colText] = key.split(',')
    const row = Number(rowText)
    const col = Number(colText)
    const block = blocksRef.current[activeIndex]
    if (block?.kind !== 'table' || !Number.isInteger(row) || !Number.isInteger(col)) return false

    const cell = withColumns<TableCell>(tableColumnCount(block), block.rows[row] ?? [], '')[col] ?? ''
    const text = tableCellText(cell)

    if (focused.tagName === 'MATH-FIELD') {
      const field = focused as MathfieldElement
      if (typeof field.insert === 'function') {
        field.insert(symbol.latex ?? symbol.glyph, { focus: true })
        // `insert()` mute l'élément sans forcément émettre `input`. Une cellule
        // formule peut avoir PLUSIEURS lignes : on ne réécrit que celle qui a
        // le focus, sinon insérer un signe effacerait les autres.
        const lineAttr = focused.closest<HTMLElement>('[data-cell-line]')?.dataset.cellLine
        const lineIndex = lineAttr === undefined ? 0 : Number(lineAttr)
        const lines = text.split('\n')
        if (Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < lines.length) lines[lineIndex] = field.value
        else lines[0] = field.value
        replace(activeIndex, setTableCell(block, row, col, { latex: lines.join('\n') }))
        return true
      }
    }

    // Une cellule TEXTE est un <textarea> (elle grandit avec ses lignes) : ne
    // tester que <input> laissait le bandeau muet dans une cellule texte.
    if (!(focused instanceof HTMLInputElement) && !(focused instanceof HTMLTextAreaElement)) return false
    const start = focused.selectionStart ?? text.length
    const end = focused.selectionEnd ?? start
    const insertion = insertCharacter(text, start, end, {
      char: symbol.glyph,
      label: symbol.label,
      closesWith: symbol.closesWith,
      spaced: symbol.spaced,
    })
    replace(
      activeIndex,
      setTableCell(block, row, col, typeof cell === 'string' ? insertion.text : { latex: insertion.text })
    )
    pendingCellCaret.current = { key, position: insertion.caret }
    return true
  }


  /**
   * Ce qu'un champ focalisé peut recevoir.
   *
   * La cellule est interrogée par `data-cell-kind`, que `TableCellField` pose :
   * une cellule de formule a beau être un `<input>` dans son chemin de repli,
   * elle attend du LaTeX et non de l'Unicode.
   */
  function fieldKindOf(target: EventTarget | null): 'none' | 'text' | 'math' {
    if (!(target instanceof HTMLElement)) return 'none'
    const holder = target.closest<HTMLElement>('[data-cell]')
    if (holder !== null) return holder.dataset.cellKind === 'math' ? 'math' : 'text'
    if (target.tagName === 'MATH-FIELD') return 'math'
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return 'text'
    return 'none'
  }

  /**
   * `Ctrl+V` of an image, anywhere in the editor.
   *
   * Only intercepted when the clipboard actually carries a file — a normal
   * text paste must keep working inside the textareas, so the handler bails
   * out (without preventing the default) when it finds no image item.
   */
  async function handlePaste(event: React.ClipboardEvent) {
    if (onInsertImage === undefined) return
    const item = [...(event.clipboardData?.items ?? [])].find(entry => entry.type.startsWith('image/'))
    if (item === undefined) return
    const file = item.getAsFile()
    if (file === null) return

    event.preventDefault()
    await insert(async () =>
      onInsertImage({ bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type, name: file.name })
    )
  }

  function removeAt(index: number) {
    if (blocks.length <= 1) return
    onChange(blocks.filter((_, i) => i !== index))
    setActiveIndex(current => Math.max(0, current - (index <= current ? 1 : 0)))
  }

  /**
   * Retire un bloc VIDE dont le champ vient de recevoir Retour arrière, et rend
   * le curseur à la fin du précédent — le geste de fusion qu'offre tout éditeur
   * de texte. Le dernier bloc n'est jamais retiré, comme pour `removeAt`.
   *
   * Sans bloc PRÉCÉDENT il n'y a rien à fusionner : le geste ne fait rien, au
   * lieu d'effacer le premier bloc sans que le curseur sache où aller.
   */
  function deleteEmptyAt(index: number) {
    if (blocks.length <= 1 || index === 0) return
    const previous = blocks[index - 1]
    onChange(blocks.filter((_, i) => i !== index))
    setActiveIndex(index - 1)
    if (previous.kind === 'text' || previous.kind === 'question') {
      pendingCaret.current = { index: index - 1, position: previous.text.length }
    } else if (previous.kind === 'math') {
      // Une formule n'a pas de position DOM à poser comme un texte : c'est le
      // champ lui-même (ou son repli LaTeX brut) qui sait se placer à la fin
      // de ce qu'il contient déjà — voir `MathFieldHandle.focusEnd`.
      pendingMathFocusEnd.current = index - 1
    } else {
      // Une image ou un tableau n'a pas de « fin » où poser un caret : on se
      // contente de ramener le focus sur son premier champ.
      focusBlockLater(index - 1)
    }
  }

  /**
   * Le geste symétrique de `deleteEmptyAt`, pour SUPPR : retire le bloc vide
   * et pose le curseur au DÉBUT du suivant. Sans bloc suivant il ne fait rien —
   * un Suppr sur le dernier élément n'a nulle part où mener.
   */
  function deleteForwardAt(index: number) {
    if (blocks.length <= 1 || index === blocks.length - 1) return
    const next = blocks[index + 1]
    onChange(blocks.filter((_, i) => i !== index))
    setActiveIndex(index)
    if (next.kind === 'text' || next.kind === 'question') {
      pendingCaret.current = { index, position: 0 }
    } else if (next.kind === 'math') {
      pendingMathFocusStart.current = index
    } else {
      focusBlockLater(index)
    }
  }

  /**
   * Applique un type à un bloc — le chemin UNIQUE du menu de type et de Tab.
   *
   * Extrait du menu pour que le clic et la touche ne puissent pas diverger : deux
   * copies de cette règle auraient fini par ne plus traiter « Tableau » de la
   * même façon, et c'est justement la conversion qui porte la sémantique du
   * projet (un bloc EST déjà un tableau 1×1 qui grandit).
   */
  function applyKind(index: number, kind: CardBlockKind) {
    const block = blocks[index]
    if (block === undefined) return
    if (kind === 'table') {
      if (block.kind !== 'image') replace(index, addTableColumn(blockAsTable(block)))
      focusBlockAfterMenu(index)
      return
    }
    // Texte ↔ formule est la seule paire qui touche à des LIGNES : les sauts de
    // ligne du texte deviennent les lignes de formule du MÊME bloc
    // (`convertBlock` croise la chaîne telle quelle), et la série de blocs
    // formule qui se touchent se replie en un seul texte multi-ligne — voir
    // `mergeMathZone`. Toute autre conversion (vers ou depuis « question »,
    // par exemple) reste le geste un-bloc d'origine.
    if (kind === 'math' && block.kind === 'text') {
      replace(index, convertBlock(block, 'math'))
      setActiveIndex(index)
      focusBlockAfterMenu(index)
      return
    }
    if (kind === 'text' && block.kind === 'math') {
      const { blocks: next, index: mergedIndex } = mergeMathZone(blocks, index)
      onChange(next)
      setActiveIndex(mergedIndex)
      focusBlockAfterMenu(mergedIndex)
      return
    }
    replace(index, convertBlock(block, kind))
    focusBlockAfterMenu(index)
  }

  /** Le type suivant (Tab) ou précédent (Maj+Tab) du bloc `index`. */
  function cycleKind(index: number, direction: 1 | -1) {
    const block = blocks[index]
    if (block === undefined) return
    const position = KIND_CYCLE.indexOf(block.kind)
    if (position === -1) return
    applyKind(index, KIND_CYCLE[(position + direction + KIND_CYCLE.length) % KIND_CYCLE.length])
  }

  /**
   * Écrit (ou efface) la pastille saisie d'une question.
   *
   * Une pastille vidée DISPARAÎT du bloc au lieu de rester vide : le champ veut
   * dire « saisi à la main », et le laisser à `''` figerait la numérotation sur
   * un blanc sans qu'on puisse revenir à l'automatique.
   */
  function setQuestionLabel(index: number, label: string) {
    const block = blocks[index]
    if (block === undefined || block.kind !== 'question') return
    const trimmed = label.trim()
    replace(
      index,
      trimmed === ''
        ? { kind: 'question', text: block.text }
        : { kind: 'question', text: block.text, label: trimmed }
    )
  }

  /**
   * Déplace un bloc, questions comprises — la règle vit dans `blockMove`.
   *
   * Le plan est suivi pour de vrai, identités comprises : sauter une question
   * décale PLUSIEURS index d'un coup, donc rejouer le `splice(from, to)` d'un
   * échange voisin ferait glisser les clés et `motion` animerait les mauvais
   * nœuds. `plan.order` est la permutation exacte, et `indexOf(from)` l'endroit où
   * le bloc déplacé a atterri — c'est lui qui reste actif.
   */
  function move(from: number, to: number) {
    const plan = movePlan(blocks, from, to)
    if (plan === null) return
    blockIds.current = plan.order.map(origin => blockIds.current[origin])
    onChange(plan.blocks)
    setActiveIndex(plan.order.indexOf(from))
  }

  /** Une flèche ne s'active que si le geste aboutit vraiment (voir `movePlan`). */
  function canMove(index: number, direction: 1 | -1): boolean {
    return canMoveBlock(blocks, index, direction)
  }

  function setActiveMathField(index: number, handle: MathFieldHandle | null) {
    setMathFields(prev => (prev[index] === handle ? prev : { ...prev, [index]: handle }))
  }

  // One stable callback per index, cached rather than built fresh in the
  // `.map()` below. `ref` props are re-invoked (detach then attach) whenever
  // their OWN identity changes, not just when the underlying instance does —
  // a fresh arrow function on every render would detach-and-reattach on every
  // render, which calls `setActiveMathField`, which re-renders `BlockEditor`,
  // which makes a fresh arrow function again: an infinite loop, not a subtle
  // slowdown.
  const fieldSetters = useRef(new Map<number, (handle: MathFieldHandle | null) => void>())
  function fieldSetterFor(index: number): (handle: MathFieldHandle | null) => void {
    let setter = fieldSetters.current.get(index)
    if (setter === undefined) {
      setter = handle => setActiveMathField(index, handle)
      fieldSetters.current.set(index, setter)
    }
    return setter
  }

  const activeKind = blocks[activeIndex]?.kind ?? 'text'
  // `motion` ne consulte PAS `prefers-reduced-motion` tout seul (son défaut est
  // `reducedMotion: "never"`), donc la garde est explicite — sinon on animerait
  // pour les utilisateurs qui ont demandé le contraire.
  const reduceMotion = useReducedMotion()
  // Une famille « formule seulement » vaut dans une formule, et dans une
  // cellule de formule d'un tableau — pas dans un texte, où `\frac{}{}`  n'a
  // aucun sens.
  const structuresApply =
    activeKind === 'math' || activeKind === 'equation' || (activeKind === 'table' && focusedFieldKind === 'math')
  // L'inverse exact : la cible accepte-t-elle du TEXTE simple ? C'est ce qui
  // décide si les familles de langue (à venir) s'appliquent.
  const textApply =
    activeKind === 'text' || activeKind === 'question' || (activeKind === 'table' && focusedFieldKind !== 'math')

  /**
   * L'onglet ouvert du bandeau — ou 
ull quand l'utilisateur l'a refermé pour
   * ne rien afficher.
   *
   * C'est un réglage d'AFFICHAGE, donc retenu (voir persistence/bandTab), et il
   * remplace la langue qui vivait ici : plus aucun bloc ne retient quoi que ce
   * soit. Lu SYNCHRONEMENT à l'initialisation, comme les familles masquées, pour
   * que le premier rendu montre déjà le bon onglet.
   */
  const [bandTab, setBandTab] = useState<BandTabId | null>(() => loadBandTab())

  /** Ouvre, referme ou change d'onglet, et retient le choix. */
  const chooseTab = useCallback((tab: BandTabId | null) => {
    setBandTab(tab)
    saveBandTab(tab)
  }, [])

  // `SymbolBand` est mémoïsé : le rappel qu'il reçoit doit garder son identité
  // d'une frappe à l'autre, sinon la mémoïsation ne sert à rien. Le corps lit
  // l'état courant (bloc actif, champ focalisé), d'où ce relais par une ref —
  // le prop reste stable, l'implémentation reste celle du dernier rendu.
  const insertSymbolRef = useRef(insertSymbol)
  insertSymbolRef.current = insertSymbol
  const handleInsertSymbol = useCallback((symbol: PaletteSymbol) => insertSymbolRef.current(symbol), [])

  // La pastille EFFECTIVE de chaque question, calculée une fois par rendu : la
  // saisie n'entre pas dans le fichier, donc tout se rejoue à l'affichage.
  const labels = questionLabels(blocks)
  // Le RANG de chaque question (1, 2, 3…), pour nommer sa pastille et le bouton
  // du groupe sans confondre « question n° 2 » avec « bloc n° 3 ».
  let questionRank = 0
  const questionNumbers = blocks.map(block => (block.kind === 'question' ? (questionRank += 1) : 0))

  const emptyAreaActions =
    dialogMenuActions === undefined
      ? undefined
      : { ...dialogMenuActions, onAddBlock: appendOutside, bandTab, onChooseTab: chooseTab }

  /**
   * Le clavier des blocs — Alt+flèches, Alt+D, Alt+Q, Alt+chiffre pour
   * l'onglet du bandeau — et le seul geste du bandeau vide qui n'a pas déjà
   * de bouton : Ctrl+Maj+Entrée pour ajouter un bloc HORS de la dernière
   * question, le même geste que le clic sur « Ajouter un bloc » en pied de
   * liste.
   *
   * Un seul gestionnaire, sur la racine, plutôt qu'un par bloc : `closest`
   * retrouve la ligne visée depuis n'importe quel champ qu'elle contient.
   * `event.ctrlKey` exclut la touche AltGr d'un clavier AZERTY, qui compose un
   * caractère (`€`, `@`…) en posant CTRL et ALT ensemble sous Windows — sans
   * cette garde, écrire un caractère AltGr dans un bloc l'aurait déplacé ou
   * dupliqué à la place.
   */
  function handleEditorKeyDown(event: React.KeyboardEvent) {
    if (event.ctrlKey || event.metaKey) {
      if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault()
        appendOutside()
      }
      return
    }
    if (!event.altKey) return

    // Alt+1…Alt+5 et Alt+0 : les onglets du bandeau, dans l'ordre de
    // `SYMBOL_TABS`, et « aucun » pour le refermer — le même sous-menu que le
    // clic droit dans le vide. `event.code` plutôt que `event.key` : sur un
    // clavier AZERTY, la touche « 1 » n'écrit `1` qu'avec Majuscule, alors que
    // `Digit1` nomme la touche physique quel que soit l'état de Majuscule
    // (même raison que `bindingFromEvent`, dans `shortcuts/keys.ts`).
    const digit = /^Digit([0-9])$/.exec(event.code)
    if (digit !== null) {
      event.preventDefault()
      const n = Number(digit[1])
      if (n === 0) chooseTab(null)
      else if (SYMBOL_TABS[n - 1] !== undefined) chooseTab(SYMBOL_TABS[n - 1].id)
      return
    }

    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-row-index]')
    const index = row === null || row === undefined ? NaN : Number(row.dataset.rowIndex)
    if (!Number.isInteger(index)) return

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault()
        move(index, index - 1)
        return
      case 'ArrowDown':
        event.preventDefault()
        move(index, index + 1)
        return
      case 'd':
      case 'D':
        event.preventDefault()
        onChange(duplicateBlock(blocks, index))
        setActiveIndex(index + 1)
        return
      case 'q':
      case 'Q':
        event.preventDefault()
        if (blocks[index]?.kind !== 'image') applyKind(index, 'question')
        return
    }
  }

  return (
    // ONE provider for the whole editor. The app's tooltip defaults are used
    // unchanged, so a hint on a block's controls behaves like a hint anywhere
    // else in the app. Radix renders a provider as context alone, so it adds no
    // element here; a provider per button would give each one its own
    // skip-delay state, which is what makes a column of instant tooltips flicker
    // as the pointer runs down the gutter.
    <TooltipProvider>
    <div
      ref={editorRef}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      onPaste={handlePaste}
      onKeyDown={handleEditorKeyDown}
      // Un seul couple focus/blur sur la racine : React les fait remonter, donc
      // il couvre tous les champs de l'éditeur sans câbler chaque bloc.
      onFocus={event => setFocusedFieldKind(fieldKindOf(event.target))}
      onBlur={event => {
        const next = event.relatedTarget
        if (next instanceof Node && editorRef.current?.contains(next) === true) return
        setFocusedFieldKind('none')
      }}
    >
      {/* Le bandeau est HORS de la zone qui défile, et toujours de la même
          hauteur : c'est ce qui fait qu'aucun changement de bloc ne déplace le
          contenu. Un `position: sticky` n'aurait rien corrigé — un élément
          collant garde sa place dans le flux. */}
      {/* Plus de trait ici : le bandeau dessine son propre cadre — rail et
          panneau — et deux traits collés en feraient un de 2 px. */}
      <div style={{ flex: '0 0 auto', paddingBottom: 'var(--be-band-wrap-space, 12px)', marginBottom: 'var(--be-band-wrap-space, 12px)' }}>
        <SymbolBand
          targetLabel={`Bloc ${activeIndex + 1} · ${KIND_LABEL[activeKind]}`}
          kind={activeKind}
          symbolsApply={activeKind !== 'image'}
          structuresApply={structuresApply}
          textApply={textApply}
          activeTab={bandTab}
          onChooseTab={chooseTab}
          hiddenFamilies={hiddenFamilies}
          onInsert={handleInsertSymbol}
        />
      </div>

      <EmptyAreaContextMenu actions={emptyAreaActions}>
      <div
        ref={blockListRef}
        onScroll={() => {
          lastScrollTop.current = blockListRef.current?.scrollTop ?? 0
        }}
        data-testid="block-list"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--be-list-gap, 10px)',
          // De l'air pour la croix, qui est posée SUR le coin haut-droit du bloc :
          // la moitié d'elle déborde au-dessus et à droite. Sans ce `padding`,
          // `overflow-y: auto` — qui force aussi l'axe X à `auto` — la rognait à
          // la moitié et faisait apparaître une barre de défilement horizontale.
          padding: 'var(--be-list-pad, 12px 14px 0)',
        }}
      >
        {blockGroups(blocks).map(group => (
          <div
            key={group.indexes[0]}
            data-group={group.headerIndex === null ? undefined : 'question'}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--be-list-gap, 10px)',
              // Sans ceci, la zone qui défile (un flex-column de hauteur bornée)
              // comprime le groupe au lieu de la faire défiler : le groupe se
              // rogne (`overflow: hidden`) et ses blocs sont coupés.
              flexShrink: 0,
              ...(group.headerIndex === null ? {} : GROUP_STYLE),
            }}
          >
            {group.indexes.map(index => {
              const block = blocks[index]
              const isActive = index === activeIndex
              // La question d'un groupe se dessine en BANDEAU, pas en bloc : elle
              // coiffe ceux du dessous, et c'est le groupe qui porte le cadre.
              const isHeader = index === group.headerIndex
              const isQuestionGroup = group.headerIndex !== null
              return (
                <BlockContextMenu
                  // Une clé STABLE, pas l'index : c'est ce qui fait que React déplace
                  // le nœud au lieu de réécrire son contenu, donc ce qui rend
                  // l'animation possible (voir `blockIds`).
                  key={blockIds.current[index]}
                  index={index}
                  kind={block.kind}
                  blockCount={blocks.length}
                  canMoveUp={canMove(index, -1)}
                  canMoveDown={canMove(index, 1)}
                  onMove={move}
                  onDuplicate={() => {
                    onChange(duplicateBlock(blocks, index))
                    setActiveIndex(index + 1)
                  }}
                  onDelete={() => removeAt(index)}
                  onChangeKind={kind => applyKind(index, kind)}
                >
                <motion.div
                  // `data-row-index` reste l'INDEX : les recherches DOM et
                  // l'insertion au caret en dépendent, et c'est une coordonnée,
                  // pas une identité.
                  data-row-index={index}
                  data-block-kind={block.kind}
                  data-question-banner={isHeader ? '' : undefined}
                  // L'animation du déplacement : `layout="position"` anime les blocs
                  // qui CHANGENT DE PLACE — « lequel prend la place de l'autre » — et
                  // rien d'autre. `layout` seul animerait aussi les changements de
                  // taille, donc chaque zone de texte qui s'allonge pendant la frappe,
                  // ce qui donnerait une page qui tremble au lieu d'un déplacement
                  // qu'on suit.
                  //
                  // Elle ne fonctionne QUE grâce aux clés stables ci-dessus : avec
                  // `key={index}`, aucun élément ne se déplace et il n'y aurait rien
                  // à animer.
                  layout={reduceMotion ? undefined : 'position'}
                  transition={{ layout: { duration: 0.18, ease: 'easeOut' } }}
                  onFocus={() => setActiveIndex(index)}
                  onMouseDown={() => setActiveIndex(index)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    // Un bloc ne se comprime jamais non plus : sa hauteur est son
                    // contenu, et c'est la zone qui défile qui l'absorbe.
                    flexShrink: 0,
                    // Le repère de la croix de suppression, posée à cheval sur le
                    // coin haut-droit (voir `BlockRemoveButton`).
                    position: 'relative',
                    // `--ring`, not `--accent`: `--accent` is a SURFACE token
                    // (`oklch(0.97)` in the light theme, i.e. lighter than
                    // `--border` at `0.922`, on a `--popover` of `1`), so painting
                    // the active block and the drop target with it drew both in
                    // something fainter than the border they replace — invisible in
                    // the light theme. `--ring` is the token the rest of the app
                    // already uses for exactly this, at `oklch(0.708)`.
                    ...(isHeader
                      ? {
                          // Le bandeau du groupe : la question n'est pas un bloc
                          // encadré, elle coiffe ceux du dessous.
                          borderRadius: 0,
                          background: 'color-mix(in oklch, var(--info-border), transparent 84%)',
                          borderBottom: '1px solid color-mix(in oklch, var(--info-border), transparent 50%)',
                          boxShadow: isActive ? 'inset 3px 0 0 var(--ring, currentColor)' : undefined,
                        }
                      : {
                          borderRadius: 10,
                          border: `1px solid ${isActive ? 'var(--ring, currentColor)' : 'var(--border)'}`,
                          borderLeft: `3px solid ${isActive ? 'var(--ring, currentColor)' : 'var(--border)'}`,
                          background: isActive ? 'color-mix(in oklch, var(--border), transparent 88%)' : 'transparent',
                          // Un bloc DANS un groupe laisse le fond bleu respirer
                          // sur ses côtés : c'est le groupe qui fait la bordure.
                          // 12 et non 10 : c'est aussi la place de la moitié de
                          // la croix, que `overflow: hidden` (voir
                          // `GROUP_STYLE`) rognerait sur le bord droit du bloc.
                          ...(isQuestionGroup ? { margin: '0 12px' } : {}),
                        }),
    
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, padding: isHeader ? 'var(--be-row-pad-header, 10px 12px)' : 'var(--be-row-pad-block, 8px 10px 8px 3px)' }}>
                    {isHeader ? (
                      <QuestionBadge
                        number={questionNumbers[index]}
                        label={labels[index]}
                        manual={block.kind === 'question' ? block.label ?? '' : ''}
                        onCommit={label => setQuestionLabel(index, label)}
                      />
                    ) : (
                      <BlockGutter
                        index={index}
                        canMoveUp={canMove(index, -1)}
                        canMoveDown={canMove(index, 1)}
                        onMove={move}
                      />
                    )}
    
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <BlockField
                        block={block}
                        index={index}
                        resolveAsset={resolveAsset}
                        onChange={next => replace(index, next)}
                        onEnterBlock={() => insertBlockAfter(index, emptyBlock(inheritableKind(block)))}
                        onSwitchKind={direction => cycleKind(index, direction)}
                        onDeleteEmpty={() => deleteEmptyAt(index)}
                        onDeleteForward={() => deleteForwardAt(index)}
                        onFieldChange={fieldSetterFor(index)}
                      />
                    </div>
    
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: isHeader ? 'row' : 'column',
                        alignItems: isHeader ? 'center' : undefined,
                        gap: 4,
                        flex: '0 0 auto',
                      }}
                    >
                      {isHeader && (
                        <BlockGutter
                          index={index}
                          canMoveUp={canMove(index, -1)}
                          canMoveDown={canMove(index, 1)}
                          onMove={move}
                          horizontal
                        />
                      )}
                      <BlockKindMenu
                        index={index}
                        kind={block.kind}
                        disabled={block.kind === 'image'}
                        onChange={kind => applyKind(index, kind)}
                      />
                      {/* « Supprimer » est descendu du gutter : il est maintenant sous
                          le menu de type, du même côté. Le gutter ne garde que le
                          déplacement, et la corbeille garde la règle « jamais le
                          dernier bloc » (`removeAt` la refuse).

                          Un vrai BLOC n'en a plus ici : sa suppression est la croix
                          posée sur son coin haut-droit (`BlockRemoveButton`). Seul
                          le BANDEAU d'une question la garde — il n'est pas un
                          « bloc », et le cadre arrondi du groupe, qui le rogne
                          (`overflow: hidden`, `GROUP_STYLE`), couperait une croix
                          à cheval sur son coin. */}
                      {isHeader && blocks.length > 1 && (
                        <GutterIcon
                          label={`Supprimer le bloc ${index + 1}`}
                          destructive
                          onClick={() => removeAt(index)}
                          icon={<Trash2 size={14} />}
                        />
                      )}
                    </div>
                  </div>

                  {/* La croix de suppression d'un bloc, à cheval sur son coin
                      haut-droit — la position et les transitions vivent dans
                      `.block-remove` (`index.css`). `removeAt` refuse de retirer le
                      dernier bloc, et l'appelant le sait : elle n'est pas dessinée
                      quand il ne reste qu'un bloc. */}
                  {!isHeader && blocks.length > 1 && (
                    <BlockRemoveButton index={index} onRemove={() => removeAt(index)} />
                  )}
                </motion.div>
                </BlockContextMenu>
              )
            })}

            {group.headerIndex !== null && (
              <div style={ADD_INSIDE_ROW_STYLE}>
                <button
                  type="button"
                  aria-label={`Ajouter un bloc dans la question ${questionNumbers[group.headerIndex]}`}
                  onClick={() =>
                    insertBlockAfter(
                      group.indexes[group.indexes.length - 1],
                      emptyBlock(inheritableKind(blocks[group.indexes[group.indexes.length - 1]]))
                    )
                  }
                  style={{ ...ADD_INSIDE_STYLE, flex: 1 }}
                >
                  <Plus size={13} />
                  Ajouter un bloc dans la question
                </button>
                {/* Une question ouvre toujours son propre groupe : insérée après
                    le DERNIER bloc de celui-ci, elle en prend la place SUIVANTE
                    sans réassigner les blocs déjà écrits. */}
                <button
                  type="button"
                  aria-label={`Nouvelle question après la question ${questionNumbers[group.headerIndex]}`}
                  onClick={() =>
                    insertBlockAfter(group.indexes[group.indexes.length - 1], { kind: 'question', text: '' })
                  }
                  style={{ ...ADD_INSIDE_STYLE, flex: 1 }}
                >
                  <MessageCircleQuestion size={13} />
                  Nouvelle question
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      </EmptyAreaContextMenu>

      <div style={{ display: 'flex', gap: 8, paddingTop: 10, flex: '0 0 auto' }}>
        <button
          type="button"
          aria-label="Ajouter un bloc"
          // The same inheritance as Ctrl+Entrée: "the block above" the button at
          // the end of the list is the last block, so a run of formulas continues
          // through the button as well as through the keyboard. Only the PLACE
          // differs — this one lands OUTSIDE the last question (appendOutside).
          onClick={appendOutside}
          style={ADD_BUTTON}
        >
          <Plus size={13} />
          Ajouter un bloc
        </button>
        {onPickImage !== undefined && (
          // The ONLY affordance here that carries a visible word, so its hint
          // has to add something the word does not. It adds the `Ctrl+V` route:
          // pasting an image works anywhere in the editor, and nothing on screen
          // says so — which is why a student who needed a figure every week
          // never used it.
          <Hint label="Insérer une image — ou collez-la avec Ctrl+V">
          <button
            type="button"
            aria-label="Insérer une image"
            onClick={() => insert(onPickImage)}
            style={ADD_BUTTON}
          >
            <ImagePlus size={13} />
            Image
          </button>
          </Hint>
        )}
      </div>

    </div>
    </TooltipProvider>
  )
}

/**
 * Le lavis qui marque la plage d'un en-tête.
 *
 * Un filet à gauche et un fond teinté, pas un cadre : la plage doit se voir sans
 * ajouter une deuxième bordure autour de blocs qui en portent déjà une (le cadre
 * du bloc actif, celui d'une image, les filets d'un tableau). C'est le jeton
 * `--border` et non `--ring` : `--ring` veut dire « ce bloc est actif », et
 * confondre les deux ferait passer tout un groupe pour sélectionné.
 */
const GROUP_STYLE: CSSProperties = {
  border: '1px solid color-mix(in oklch, var(--info-border), transparent 30%)',
  borderLeft: '3px solid var(--info-border)',
  borderRadius: 12,
  // Rogne le bandeau d'en-tête aux coins du groupe. Sans lui, le fond du
  // bandeau dépasserait des coins arrondis.
  overflow: 'hidden',
  background: 'color-mix(in oklch, var(--info-bg), transparent 40%)',
}

/**
 * Le bouton d'ajout PROPRE au groupe, sous ses blocs.
 *
 * Il existe parce que le bouton général ajoute DÉSORMAIS en dehors de la
 * question : sans celui-ci, il n'y aurait plus aucun geste pour écrire un bloc
 * de plus sous une question une fois qu'elle a un premier bloc extérieur.
 */
const ADD_INSIDE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  margin: 0,
  padding: '7px 0',
  fontSize: 12.5,
  border: '1px dashed color-mix(in oklch, var(--info-border), transparent 35%)',
  borderRadius: 8,
  background: 'color-mix(in oklch, var(--info-border), transparent 93%)',
  color: 'var(--info-fg)',
  cursor: 'pointer',
}

/**
 * La rangée de création du groupe : « ajouter un bloc ici » et « commencer la
 * question suivante » sont deux gestes voisins, donc une seule rangée — deux
 * barres empilées allongeraient encore le groupe.
 */
const ADD_INSIDE_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexShrink: 0,
  gap: 8,
  margin: '0 10px 10px',
}

const GHOST_BUTTON: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
  minWidth: 30,
  height: 26,
  padding: '0 7px',
  fontSize: 12,
  borderRadius: 6,
  background: 'none',
  border: '1px solid var(--border)',
  color: 'inherit',
  opacity: 0.7,
  cursor: 'pointer',
}

const ADD_BUTTON: CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '7px 0',
  fontSize: 12.5,
  opacity: 0.6,
  border: '1px dashed var(--border)',
  borderRadius: 8,
  background: 'none',
  color: 'inherit',
  cursor: 'pointer',
}

/**
 * The block's own controls, in a gutter on its left.
 *
 * They used to sit in the side panel, where "Monter le bloc en cours" named a
 * relation between a button and a block the user had to keep track of. On the
 * block itself, each control names the block it acts on and is where the eye
 * already is. The grip is a real handle: dragging it moves the block (the
 * arrows stay for the keyboard and for one-step nudges).
 */
/**
 * La pastille d'une question — « 1 », « b », « Ex 3 » — cliquable pour la saisir.
 *
 * Elle affiche la valeur EFFECTIVE (saisie, sinon déduite — voir
 * `questionLabels`), et le remplissage dit laquelle des deux c'est : pleine
 * quand elle est automatique, cerclée quand quelqu'un l'a tapée. Cliquer ouvre
 * un champ ; le vider rend la main à l'automatique.
 */
function QuestionBadge({
  number,
  label,
  manual,
  onCommit,
}: {
  /** Le rang de la question — « 2 » pour la deuxième, quel que soit son bloc. */
  number: number
  label: string
  /** La valeur saisie, vide quand la pastille est automatique. */
  manual: string
  onCommit: (label: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(manual)
  const name = `Pastille de la question ${number}`

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={name}
        title="Changer la pastille"
        onClick={() => {
          setDraft(manual)
          setEditing(true)
        }}
        style={{
          flex: '0 0 auto',
          minWidth: 24,
          height: 24,
          padding: '0 7px',
          borderRadius: 999,
          background: manual === '' ? 'var(--info-border)' : 'var(--background)',
          color: manual === '' ? '#fff' : 'var(--info-fg)',
          border: manual === '' ? '1px solid transparent' : '1px solid var(--info-border)',
          fontSize: 12,
          fontWeight: 700,
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        {label === '' ? '·' : label}
      </button>
    )
  }

  function commit() {
    setEditing(false)
    onCommit(draft)
  }

  return (
    <input
      aria-label={name}
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
        if (event.key === 'Escape') setEditing(false)
      }}
      style={{
        flex: '0 0 auto',
        width: 46,
        height: 24,
        borderRadius: 999,
        border: '1px solid var(--info-border)',
        background: 'var(--background)',
        color: 'var(--info-fg)',
        textAlign: 'center',
        fontSize: 12,
        fontWeight: 700,
      }}
    />
  )
}

function BlockGutter({
  index,
  canMoveUp,
  canMoveDown,
  onMove,
  horizontal = false,
}: {
  index: number
  /**
   * Une flèche grisée quand le geste n'a pas de destination — et pas seulement
   * en bout de liste : le premier bloc d'une question ne peut pas monter
   * au-dessus de son en-tête, et l'en-tête lui-même n'a rien à qui se comparer
   * dans sa propre question. Le calcul vit dans `canMove` (voir `movePlan`),
   * pour que le bouton et l'action ne puissent jamais se contredire.
   */
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (from: number, to: number) => void
  /** En bandeau, les deux flèches s'alignent à droite plutôt que de tenir une colonne. */
  horizontal?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: horizontal ? 'row' : 'column',
        alignItems: 'center',
        gap: 2,
        width: horizontal ? undefined : 26,
        flex: '0 0 auto',
        paddingTop: horizontal ? 0 : 1,
      }}
    >
      <GutterIcon
        label={`Monter le bloc ${index + 1}`}
        disabled={!canMoveUp}
        onClick={() => onMove(index, index - 1)}
        icon={<ChevronUp size={14} />}
      />
      <GutterIcon
        label={`Descendre le bloc ${index + 1}`}
        disabled={!canMoveDown}
        onClick={() => onMove(index, index + 1)}
        icon={<ChevronDown size={14} />}
      />
    </div>
  )
}

function GutterIcon({
  label,
  icon,
  onClick,
  disabled = false,
  destructive = false,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <Hint label={label}>
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...GHOST_BUTTON,
        width: 24,
        minWidth: 24,
        height: 24,
        padding: 0,
        border: '1px solid transparent',
        color: destructive ? 'var(--destructive)' : 'inherit',
        opacity: disabled ? 0.18 : 0.55,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {icon}
    </button>
    </Hint>
  )
}

/**
 * La croix rouge qui retire un bloc, à cheval sur son coin haut-droit.
 *
 * Elle a remplacé la corbeille de la colonne de droite : celle-ci obligeait à
 * viser l'INTÉRIEUR du bloc, et partageait sa colonne avec le menu de type —
 * deux cibles voisines dont une destructive. La croix se pose au même endroit
 * sur TOUS les blocs, quel que soit leur type, et c'est sa position qui dit
 * qu'elle ferme le bloc entier.
 *
 * Tout son dessin vit dans `.block-remove` (`index.css`), jamais en ligne :
 * un style en ligne l'emporterait sur `:hover`, et la croix ne pourrait plus
 * rougir (même piège que le « + » d'une frontière de tableau).
 *
 * `removeAt` refuse de retirer le DERNIER bloc ; c'est l'appelant qui décide de
 * ne pas dessiner la croix dans ce cas (voir `blocks.length > 1`), exactement
 * comme le faisait la corbeille qu'elle remplace.
 */
function BlockRemoveButton({ index, onRemove }: { index: number; onRemove: () => void }) {
  const label = `Supprimer le bloc ${index + 1}`
  return (
    <Hint label={label}>
      <button type="button" aria-label={label} onClick={onRemove} className="block-remove">
        <X size={12} strokeWidth={3} />
      </button>
    </Hint>
  )
}

/**
 * The block's type, as a button that SHOWS the current type and opens the menu
 * of the other ones.
 *
 * Showing the state rather than the action is the whole point: a description
 * made of several blocks is read top to bottom, and "which of these is a
 * formula?" has to be answerable at a glance, without opening anything.
 */
function BlockKindMenu({
  index,
  kind,
  disabled,
  onChange,
}: {
  index: number
  kind: CardBlockKind
  disabled: boolean
  onChange: (kind: CardBlockKind) => void
}) {
  const current = KIND_LABEL[kind]
  // Set only when the user actually picks a type. Radix returns focus to the
  // trigger as the menu closes, which would land on the button a moment AFTER
  // the switch has moved the caret into the field it just created — undoing it.
  // Cancelling that restoration on the selection path is what lets the caret
  // stay in the block; dismissing with Échap still returns focus to the trigger,
  // which is where it belongs.
  const pickedType = useRef(false)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`Type du bloc ${index + 1} : ${current}`}
          title={
            disabled
              ? 'Une image ne peut pas devenir du texte sans perdre le fichier'
              : `Ce bloc est en ${current.toLowerCase()} — en choisir un autre type`
          }
          style={{ ...GHOST_BUTTON, opacity: disabled ? 0.4 : 0.85, cursor: disabled ? 'default' : 'pointer' }}
        >
          {kind === 'math' ? (
            <Sigma size={13} />
          ) : kind === 'equation' ? (
            <Equal size={13} />
          ) : kind === 'table' ? (
            <Table2 size={13} />
          ) : kind === 'image' ? (
            <ImagePlus size={13} />
          ) : kind === 'question' ? (
            <Heading1 size={13} />
          ) : (
            <Type size={13} />
          )}
          {current}
          <ChevronDown size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={event => {
          if (!pickedType.current) return
          pickedType.current = false
          event.preventDefault()
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            pickedType.current = true
            onChange('text')
          }}
        >
          <Type size={14} />
          Texte
          <span style={{ marginLeft: 'auto', opacity: 0.8 }}>{kind === 'text' && <Check size={13} />}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            pickedType.current = true
            onChange('math')
          }}
        >
          <Sigma size={14} />
          Formule
          <span style={{ marginLeft: 'auto', opacity: 0.8 }}>{kind === 'math' && <Check size={13} />}</span>
        </DropdownMenuItem>
        {/* « Équation » suit exactement la même règle que « Tableau » juste en
            dessous : ce n'est pas un mode réversible comme texte ↔ formule,
            c'est une structure qu'on fait grandir depuis le bloc courant (voir
            `equationStepsFromSource` dans `convertBlock`). */}
        <DropdownMenuItem
          onSelect={() => {
            pickedType.current = true
            onChange('equation')
          }}
          disabled={kind === 'equation'}
        >
          <Equal size={14} />
          Équation
          <span style={{ marginLeft: 'auto', opacity: 0.8 }}>{kind === 'equation' && <Check size={13} />}</span>
        </DropdownMenuItem>
        {/* « Tableau » est revenu dans le sélecteur de type. Il en était sorti
            quand un bloc est devenu « un tableau 1×1 qui grandit », mais c'est le
            seul endroit qui permette AUSSI d'en sortir : sans lui, plus rien ne
            ramenait un tableau à son contenu (le pied de tableau, qui le faisait,
            a disparu avec le reste). */}
        <DropdownMenuItem
          onSelect={() => {
            pickedType.current = true
            onChange('table')
          }}
          disabled={kind === 'table'}
        >
          <Table2 size={14} />
          Tableau
          <span style={{ marginLeft: 'auto', opacity: 0.8 }}>{kind === 'table' && <Check size={13} />}</span>
        </DropdownMenuItem>
        {/* Marquer un texte comme question est le geste qui CRÉE le groupe : il
            n'y a pas d'insertion de groupe séparée, parce qu'un en-tête naît
            toujours de la phrase qu'on vient d'écrire dans ce bloc. */}
        <DropdownMenuItem
          onSelect={() => {
            pickedType.current = true
            onChange('question')
          }}
        >
          <Heading1 size={14} />
          Question
          <span style={{ marginLeft: 'auto', opacity: 0.8 }}>{kind === 'question' && <Check size={13} />}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}


const FIELD_STYLE = {
  width: '100%',
  boxSizing: 'border-box' as const,
  font: 'inherit',
  fontSize: 14,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'inherit',
}

interface BlockFieldProps {
  block: CardBlock
  index: number
  resolveAsset: (asset: string) => string
  onChange: (block: CardBlock) => void
  /** Ctrl+Entrée — insère un nouveau bloc juste après celui-ci. */
  onEnterBlock: () => void
  /** Tab / Maj+Tab — passe au type suivant ou précédent. */
  onSwitchKind: (direction: 1 | -1) => void
  /** Retour arrière sur un bloc vide — le retire et rend le curseur au précédent. */
  onDeleteEmpty: () => void
  /** Suppr sur un bloc vide — le retire et rend le curseur au début du suivant. */
  onDeleteForward: () => void
  /** Reports the block's live math handle, for the band's keys. Called with `null` when the block is not a formula (or unmounts as one). */
  onFieldChange: (handle: MathFieldHandle | null) => void
  /** For `FieldContextMenu`'s « Coller » — never silent about a failed paste, same convention as `BlockEditor`'s own `onError`. */
  onError?: (message: string) => void
}

function BlockField({
  block,
  index,
  resolveAsset,
  onChange,
  onEnterBlock,
  onSwitchKind,
  onDeleteEmpty,
  onDeleteForward,
  onFieldChange,
  onError,
}: BlockFieldProps) {
  switch (block.kind) {
    case 'text':
      return (
        <FieldContextMenu kind="text" onError={onError}>
        <AutoGrowTextarea
          aria-label={`Texte du bloc ${index + 1}`}
          // How the character palette finds this field to insert at its caret —
          // see `textFieldAt`. An attribute rather than a ref map: the editor
          // renders its own markup, so the lookup can be a query against it.
          data-block-index={index}
          value={block.text}
          onChange={text => {
            // `$$` converts in place: the fast path for someone taking notes
            // live, who should not have to reach for the selector mid-sentence.
            // The trigger is deliberately narrow (see `isFormulaTrigger`): a
            // sentence that ends in « … coûte 5$$ » is prose, not a formula.
            //
            // ONE call, not an onChange followed by a convert: both would read
            // the same stale `blocks` closure, so the conversion would run on
            // the pre-keystroke block and swallow the last character.
            if (isFormulaTrigger(text)) {
              onChange({ kind: 'math', latex: text.slice(0, -2) })
              return
            }
            onChange({ kind: 'text', text })
          }}
          onEnter={onEnterBlock}
          onSwitchKind={onSwitchKind}
          onDeleteEmpty={onDeleteEmpty}
          onDeleteForward={onDeleteForward}
        />
        </FieldContextMenu>
      )

    case 'question':
      // The same field as a text block, minus the `$$` fast path: a header is a
      // title, and a title that turned into a formula because it happened to end
      // in `$$` would take its whole group with it.
      return (
        <FieldContextMenu kind="text" onError={onError}>
        <AutoGrowTextarea
          aria-label={`Question du bloc ${index + 1}`}
          data-block-index={index}
          value={block.text}
          onChange={text => onChange({ kind: 'question', text })}
          onEnter={onEnterBlock}
          onSwitchKind={onSwitchKind}
          onDeleteEmpty={onDeleteEmpty}
          onDeleteForward={onDeleteForward}
          // Sans bordure ni fond : la question vit dans le bandeau du groupe,
          // pas dans un cadre de bloc.
          style={{ border: 'none', background: 'transparent', padding: '2px 0', minHeight: 24, fontSize: 15, fontWeight: 650, color: 'var(--info-fg)' }}
        />
        </FieldContextMenu>
      )

    case 'math':
      return (
        <FieldContextMenu kind="math" onError={onError}>
        <MathBlockField
          block={block}
          index={index}
          onChange={onChange}
          onEnterBlock={onEnterBlock}
          onSwitchKind={onSwitchKind}
          onDeleteEmpty={onDeleteEmpty}
          onDeleteForward={onDeleteForward}
          onFieldChange={onFieldChange}
        />
        </FieldContextMenu>
      )

    case 'equation':
      return (
        <FieldContextMenu kind="math" onError={onError}>
        <EquationBlockField
          block={block}
          index={index}
          onChange={onChange}
          onEnterBlock={onEnterBlock}
          onDeleteEmpty={onDeleteEmpty}
          onDeleteForward={onDeleteForward}
          onFieldChange={onFieldChange}
        />
        </FieldContextMenu>
      )

    case 'image':
      return <ImageBlockField block={block} index={index} resolveAsset={resolveAsset} onChange={onChange} />

    case 'table':
      return <TableField block={block} index={index} onChange={onChange} />
  }
}

/**
 * A text zone that grows with what is written in it.
 *
 * A definition is written, not consulted: a field that scrolls its own content
 * hides the beginning of the sentence the user is still working on, and the
 * scrollbar appears exactly when the text gets long enough that seeing all of
 * it matters most. Growing pushes the blocks below down instead, which is what
 * reading order already implies.
 */
function AutoGrowTextarea({
  value,
  onChange,
  onEnter,
  onSwitchKind,
  onDeleteEmpty,
  onDeleteForward,
  style,
  ...rest
}: {
  value: string
  onChange: (text: string) => void
  /** Ctrl+Entrée : un nouveau bloc après celui-ci. */
  onEnter: () => void
  /** Tab / Maj+Tab : le type suivant ou précédent. */
  onSwitchKind: (direction: 1 | -1) => void
  /** Retour arrière sur un champ vide : le bloc demande à disparaître. */
  onDeleteEmpty: () => void
  /** Suppr sur un champ vide : le bloc demande à disparaître vers le suivant. */
  onDeleteForward: () => void
  /** Ce qui distingue le champ d'une question de celui d'un texte. */
  style?: CSSProperties
  'aria-label': string
  'data-block-index': number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // No dependency array: the height has to be recomputed after EVERY render,
  // including the ones caused by a palette insert or an undo, which change the
  // value without going through `onChange` here. `scrollHeight` is the only
  // measurement that knows the answer, and setting it twice in a row is free.
  useEffect(() => {
    const field = ref.current
    if (field === null) return
    // Back to `auto` first: without it, `scrollHeight` never shrinks below the
    // height a longer version of the text already set.
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight}px`
  })

  return (
    <textarea
      {...rest}
      ref={ref}
      value={value}
      rows={1}
      onChange={event => onChange(event.target.value)}
      onKeyDown={event => {
        // Entrée écrit une ligne : c'est le défaut du champ, on n'y touche pas.
        // Ctrl+Entrée est le geste « un bloc après celui-ci ».
        if (event.key === 'Enter') {
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault()
            onEnter()
          }
          return
        }
        if (event.key === 'Backspace' && value === '') {
          event.preventDefault()
          onDeleteEmpty()
          return
        }
        if (event.key === 'Delete' && value === '') {
          event.preventDefault()
          onDeleteForward()
          return
        }
        // Tab appartient au TYPE du bloc — sauf quand une combinaison est tenue,
        // où c'est un raccourci de l'application ou du système, pas le nôtre.
        if (event.key === 'Tab') {
          if (event.ctrlKey || event.metaKey || event.altKey) return
          event.preventDefault()
          onSwitchKind(event.shiftKey ? -1 : 1)
        }
      }}
      style={{
        ...FIELD_STYLE,
        fontSize: 'var(--be-text-fs, 14.5px)',
        lineHeight: 1.5,
        minHeight: 'var(--be-text-min-h, 60px)',
        resize: 'none',
        overflow: 'hidden',
        ...style,
      }}
    />
  )
}

/**
 * Les lignes d'un `latex` : un saut de ligne EST une ligne de formule.
 */
function latexLines(latex: string): string[] {
  return latex.split('\n')
}

function joinLatexLines(lines: string[]): string {
  return lines.join('\n')
}

/** Ce qu'un champ brut de ligne peut demander — le pendant clavier de `MathFieldEditor`. */
interface MathLineActions {
  setValue: (next: string) => void
  /** Entrée : ce qui reste dans la ligne courante, et ce qui part dans une nouvelle ligne après elle. */
  addLine: (before: string, after: string) => void
  /** Ctrl/Cmd+Entrée : un nouveau bloc. Absent dans une cellule de tableau. */
  addBlock?: () => void
  /** Retour arrière en tout début de ligne : ce qu'elle contient encore, à fusionner avec la précédente. */
  backspace: (rest: string) => void
  /** Suppr en toute fin de ligne : ce qu'elle contient encore, à fusionner avec la suivante. */
  remove: (rest: string) => void
  /** Flèche haut : la ligne de formule PRÉCÉDENTE, dans le même bloc. Absent quand il n'y a qu'une ligne. */
  arrowUp?: () => void
  /** Flèche bas : la ligne de formule SUIVANTE, dans le même bloc. Absent quand il n'y a qu'une ligne. */
  arrowDown?: () => void
  /** Tab / Maj+Tab : le type du bloc. Absent dans une cellule de tableau. */
  switchKind?: (direction: 1 | -1) => void
}

/**
 * Le clavier d'un champ brut de ligne, partagé par le bloc et la cellule.
 *
 * Un vrai `<textarea>`/`<input>` donne toujours `selectionStart`/`selectionEnd`
 * exacts, contrairement au champ MathLive : pas de repli défensif nécessaire
 * ici, Entrée/Retour arrière/Suppr lisent directement la position du curseur.
 */
function mathLineKeyDown(actions: MathLineActions, value: string) {
  return (event: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const field = event.currentTarget
    if (event.key === 'Enter') {
      if (event.shiftKey) return
      event.preventDefault()
      if ((event.ctrlKey || event.metaKey) && actions.addBlock !== undefined) {
        actions.addBlock()
        return
      }
      const at = field.selectionStart ?? value.length
      actions.addLine(value.slice(0, at), value.slice(field.selectionEnd ?? at))
      return
    }
    if (event.key === 'Backspace' && field.selectionStart === 0 && field.selectionEnd === 0) {
      event.preventDefault()
      actions.backspace(value)
      return
    }
    if (event.key === 'Delete' && field.selectionStart === value.length && field.selectionEnd === value.length) {
      event.preventDefault()
      actions.remove(value)
      return
    }
    if (event.key === 'ArrowUp' && actions.arrowUp !== undefined) {
      event.preventDefault()
      actions.arrowUp()
      return
    }
    if (event.key === 'ArrowDown' && actions.arrowDown !== undefined) {
      event.preventDefault()
      actions.arrowDown()
      return
    }
    if (event.key === 'Tab' && actions.switchKind !== undefined) {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      event.preventDefault()
      actions.switchKind(event.shiftKey ? -1 : 1)
    }
  }
}

/**
 * Une suite de lignes de formule éditables, empilées.
 *
 * Le cœur de la « formule multi-ligne » : chaque ligne a SON champ, mais les
 * lignes vivent dans le même bloc (ou la même cellule), et le `\n` qui les
 * sépare est exactement ce que la conversion texte ↔ formule fait traverser.
 * Un conteneur à une seule ligne se comporte donc comme l'ancien champ unique.
 *
 * Le clavier s'y comporte comme dans un textarea classique : Entrée coupe la
 * ligne en deux à la position du curseur : Retour arrière en tout début de
 * ligne la fusionne avec la précédente (curseur à l'ancienne frontière) ; Suppr
 * en toute fin la fusionne avec la suivante. Voir `actionsFor`.
 */
function MathLinesField({
  latex,
  onChange,
  label,
  onEnterBlock,
  onEmptyBackspace,
  onEmptyDelete,
  onFocusHandle,
  renderFallback,
  lineAttribute,
}: {
  latex: string
  onChange: (latex: string) => void
  label: (line: number, count: number) => string
  onEnterBlock?: () => void
  onEmptyBackspace?: () => void
  onEmptyDelete?: () => void
  onFocusHandle?: (handle: MathFieldHandle | null) => void
  renderFallback: (line: number, count: number, actions: MathLineActions) => ReactNode
  lineAttribute?: (line: number) => Record<string, string | number> | undefined
}) {
  const lines = latexLines(latex)
  const handles = useRef<(MathFieldHandle | null)[]>([])
  const pending = useRef<{ line: number; at: 'start' | 'end' | 'offset'; offset?: number } | null>(null)

  // Le focus est posé APRÈS le rendu qui a ajouté ou retiré la ligne : c'est le
  // seul moment où le handle de la ligne visée existe.
  useEffect(() => {
    const target = pending.current
    if (target === null) return
    pending.current = null
    const handle = handles.current[target.line]
    if (handle === null || handle === undefined) return
    if (target.at === 'end') handle.focusEnd()
    else if (target.at === 'start') handle.focusStart()
    else handle.focusAt(target.offset ?? 0)
  })

  // Le bandeau cible la ligne FOCALISÉE, jamais une ligne mémorisée : insérer
  // une ligne décale toutes les suivantes.
  useEffect(() => () => onFocusHandle?.(null), [onFocusHandle])

  function write(next: string[]) {
    onChange(joinLatexLines(next))
  }

  /**
   * Donne le focus à une ligne DÉJÀ montée. Pas de `pending` ici : un simple
   * déplacement de focus ne change pas le contenu, donc il ne provoque aucun
   * rendu — et `pending` n'est consommé qu'après un rendu.
   */
  function focusLine(target: number, at: 'start' | 'end') {
    if (target < 0 || target >= lines.length) return
    const handle = handles.current[target]
    if (handle === null || handle === undefined) return
    if (at === 'end') handle.focusEnd()
    else handle.focusStart()
  }

  function actionsFor(line: number): MathLineActions {
    return {
      setValue: next => write(lines.map((current, i) => (i === line ? next : current))),
      // Coupe la ligne en deux à la position du curseur — `before` y reste,
      // `after` part dans une nouvelle ligne juste après, curseur à son début.
      // Un curseur en bout de ligne donne `after === ''` : l'ancien geste
      // « une ligne vide de plus ».
      addLine: (before, after) => {
        write([...lines.slice(0, line), before, after, ...lines.slice(line + 1)])
        pending.current = { line: line + 1, at: 'start' }
      },
      addBlock: onEnterBlock,
      // Retour arrière avec rien avant le curseur : `rest` (tout ce qui suit,
      // donc toute la ligne) rejoint la fin de la précédente, et le curseur se
      // pose exactement à l'ancienne frontière entre les deux.
      backspace: rest => {
        if (line > 0) {
          const previous = lines[line - 1]
          write([...lines.slice(0, line - 1), previous + rest, ...lines.slice(line + 1)])
          pending.current = { line: line - 1, at: 'offset', offset: previous.length }
          return
        }
        // Première ligne, rien avant : sans contenu à perdre (`rest === ''`),
        // c'est le conteneur (bloc, ou cellule) qui demande à se retirer — et
        // sans précédent, il ne fait rien. Avec du contenu, rien à fusionner
        // (pas de ligne au-dessus) : comme un textarea en tout début de texte,
        // la touche ne fait rien.
        if (rest === '') onEmptyBackspace?.()
      },
      // Suppr avec rien après le curseur : symétrique, `rest` (toute la ligne)
      // reçoit le contenu de la suivante, curseur inchangé à l'ancienne fin.
      remove: rest => {
        if (line < lines.length - 1) {
          const next = lines[line + 1]
          write([...lines.slice(0, line), rest + next, ...lines.slice(line + 2)])
          pending.current = { line, at: 'offset', offset: rest.length }
          return
        }
        if (rest === '') onEmptyDelete?.()
      },
      // Les flèches ne passent d'une ligne à l'autre que s'il y en a
      // PLUSIEURS : une formule mono-ligne les laisse à MathLive, qui s'en sert
      // dans une fraction. Aux extrémités, la touche est avalée — jamais un
      // autre bloc.
      arrowUp: lines.length > 1 ? () => focusLine(line - 1, 'end') : undefined,
      arrowDown: lines.length > 1 ? () => focusLine(line + 1, 'start') : undefined,
    }
  }

  return (
    <>
      {lines.map((line, i) => {
        const actions = actionsFor(i)
        return (
          <div
            key={i}
            {...(lineAttribute?.(i) ?? {})}
            // Le focus REMONTE depuis le champ : un seul point d'écoute suffit à
            // dire au bandeau quelle ligne est vivante.
            onFocus={() => onFocusHandle?.(handles.current[i] ?? null)}
          >
            <MathFieldEditor
              ref={handle => {
                handles.current[i] = handle
              }}
              latex={line}
              onChange={next => actions.setValue(next)}
              onEnter={actions.addLine}
              onEnterBlock={onEnterBlock}
              onBackspaceAtStart={actions.backspace}
              onDeleteAtEnd={actions.remove}
              onArrowUp={actions.arrowUp}
              onArrowDown={actions.arrowDown}
              ariaLabel={label(i, lines.length)}
              fallback={renderFallback(i, lines.length, actions)}
            />
          </div>
        )
      })}
    </>
  )
}

function MathBlockField({
  block,
  index,
  onChange,
  onEnterBlock,
  onSwitchKind,
  onDeleteEmpty,
  onDeleteForward,
  onFieldChange,
}: {
  block: Extract<CardBlock, { kind: 'math' }>
  index: number
  onChange: (block: CardBlock) => void
  onEnterBlock: () => void
  onSwitchKind: (direction: 1 | -1) => void
  onDeleteEmpty: () => void
  onDeleteForward: () => void
  onFieldChange: (handle: MathFieldHandle | null) => void
}) {
  // WYSIWYG when MathLive is available, the raw LaTeX field until then — and
  // permanently if it never loads. The raw-LaTeX fallback stays the one case
  // where the field and the result really differ, so its preview stays next to
  // the source it renders.
  const lines = latexLines(block.latex)
  return (
    <MathLinesField
      latex={block.latex}
      onChange={latex => onChange({ ...block, latex })}
      label={(line, count) =>
        count > 1 ? `Formule du bloc ${index + 1}, ligne ${line + 1}` : `Formule du bloc ${index + 1}`
      }
      onEnterBlock={onEnterBlock}
      onEmptyBackspace={onDeleteEmpty}
      onEmptyDelete={onDeleteForward}
      onFocusHandle={onFieldChange}
      renderFallback={(line, count, actions) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <textarea
            // Distinct from the WYSIWYG field's label: both are text
            // inputs for the same value, and sharing one name makes them
            // indistinguishable to assistive tech and to tests alike.
            aria-label={
              count > 1
                ? `Formule du bloc ${index + 1}, ligne ${line + 1} (LaTeX)`
                : `Formule du bloc ${index + 1} (LaTeX)`
            }
            value={lines[line] ?? ''}
            onChange={event => actions.setValue(event.target.value)}
            onKeyDown={mathLineKeyDown({ ...actions, switchKind: onSwitchKind }, lines[line] ?? '')}
            spellCheck={false}
            style={{ ...FIELD_STYLE, minHeight: 44, resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }}
          />
          <div
            data-testid={count > 1 ? `math-preview-${index}-${line}` : `math-preview-${index}`}
            style={{ minHeight: 22, padding: '2px 0', overflowX: 'auto' }}
            // Safe: `renderMathToHtml` escapes the text it emits, and
            // `trust: false` keeps it from building links or embedding
            // resources (see its own tests).
            dangerouslySetInnerHTML={{ __html: renderMathToHtml(lines[line] ?? '', true) }}
          />
        </div>
      )}
    />
  )
}

function ImageBlockField({
  block,
  index,
  resolveAsset,
  onChange,
}: {
  block: Extract<CardBlock, { kind: 'image' }>
  index: number
  resolveAsset: (asset: string) => string
  onChange: (block: CardBlock) => void
}) {
  const src = resolveAsset(block.asset)
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      {src !== '' ? (
        <img
          src={src}
          alt={block.alt}
          width={block.width}
          height={block.height}
          style={{ aspectRatio: `${block.width} / ${block.height}`, width: 96, height: 'auto', borderRadius: 4 }}
        />
      ) : (
        // Named rather than a blank gap, same rule as `BlockView`: a picture
        // that cannot be resolved is a state the user is owed an explanation
        // for, and here they can still fix its description.
        <div
          style={{
            width: 96,
            minHeight: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: 4,
            fontSize: 11,
            borderRadius: 4,
            border: '1px dashed currentColor',
            opacity: 0.6,
          }}
        >
          Image introuvable
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* The alt text is not decoration: it is what `blocksToPlainText`
            projects into the quiz's options, the XMind note and the PDF's
            plain mirror, so an unnamed picture is a hole in all three. */}
        <input
          aria-label={`Description de l’image du bloc ${index + 1}`}
          placeholder="Décrire l’image"
          value={block.alt}
          onChange={event => onChange({ ...block, alt: event.target.value })}
          style={FIELD_STYLE}
        />
        <div
          role="group"
          aria-label={`Largeur de l’image du bloc ${index + 1}`}
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
        >
          <span style={{ opacity: 0.7 }}>Largeur</span>
          {IMAGE_WIDTH_STEPS.map(step => (
            <button
              key={step}
              type="button"
              aria-label={`${step} pixels`}
              aria-pressed={block.width === step}
              onClick={() => onChange(resizeImageBlock(block, step))}
              style={{
                padding: '2px 7px',
                fontSize: 12,
                borderRadius: 4,
                cursor: 'pointer',
                border: '1px solid var(--border)',
                background: block.width === step ? 'var(--accent, rgba(0,0,0,0.08))' : 'transparent',
                color: 'inherit',
              }}
            >
              {step}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const CELL_BUTTON: CSSProperties = {
  flex: '0 0 auto',
  width: 28,
  height: 30,
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  opacity: 0.7,
  cursor: 'pointer',
}

/**
 * The table, laid out so that growing it is a gesture on the table itself.
 *
 * A `+` sits on every boundary — above each column, left of each row — and a
 * bin next to it. That is the whole editing model: click where you want the new
 * cell to appear. The alternative the user was offered ("add a column" as an
 * action on the block somewhere else) made you translate "I want a column
 * between these two" into "add a column at the end, then drag it" — two steps
 * and a guess.
 *
 * The grid is CSS rather than a `<table>`: the handles live BETWEEN the cells
 * rather than in a cell of their own, and a `<td>` cannot sit between two rows.
 */
function TableField({
  block,
  index,
  onChange,
}: {
  block: TableBlock
  index: number
  onChange: (block: CardBlock) => void
}) {
  const columnCount = tableColumnCount(block)
  const headerCells = withColumns<string>(columnCount, block.header, '')
  const canRemoveColumn = columnCount > 1

  // La palette de signes qui vivait ici est partie dans le bandeau, au-dessus de
  // la zone qui défile : un seul endroit à connaître, toujours à la même place,
  // et plus rien qui pousse les lignes du tableau quand une cellule prend le
  // focus. Ce qui reste ici, c'est `data-cell` sur chaque cellule — c'est par lui
  // que le bandeau retrouve la cellule focalisée, et par lui aussi que la
  // poubelle sait quelle ligne et quelle colonne on survole.

  /**
   * La ligne et la colonne survolées, et — séparément — celles dont une
   * cellule a le focus.
   *
   * Les garder séparés est ce qui répare le clic sur la poubelle : cliquer
   * dessus déplace le focus depuis la cellule qui l'avait, donc déclenche un
   * `blur` — et un SEUL état partagé entre survol et focus se faisait remettre
   * à `null` par ce `blur`, cachant la poubelle (et coupant son
   * `pointer-events`) entre le `mousedown` et le `click` qui devait la
   * déclencher. Avec deux états, le `blur` ne touche plus que `focused`, et
   * seulement quand le focus quitte le tableau (`relatedTarget` hors de la
   * grille) — jamais quand il se pose sur la poubelle elle-même, qui est
   * dedans.
   *
   * `active` est celle qu'on affiche : la survolée tant que la souris est
   * dans le tableau, sinon celle qui a le focus — exactement le modèle
   * demandé : le survol mène tant qu'on reste dans le tableau, et ne cède la
   * place qu'à la sortie ; le focus, lui, garde une cellule "sélectionnée"
   * même quand la souris est repartie ailleurs.
   */
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null)
  const [focused, setFocused] = useState<{ row: number; col: number } | null>(null)
  const active = hovered ?? focused
  const gridRef = useRef<HTMLDivElement>(null)

  function cellOf(target: EventTarget | null): { row: number; col: number } | null {
    if (!(target instanceof HTMLElement)) return null
    const key = target.closest<HTMLElement>('[data-cell]')?.dataset.cell
    if (key === undefined) return null
    const [rowText, colText] = key.split(',')
    const row = Number(rowText)
    const col = Number(colText)
    return Number.isInteger(row) && Number.isInteger(col) ? { row, col } : null
  }

  return (
    <div
      ref={gridRef}
      data-testid={`table-grid-${index}`}
      onMouseOver={event => {
        const cell = cellOf(event.target)
        if (cell) setHovered(cell)
      }}
      onMouseLeave={() => setHovered(null)}
      onFocus={event => {
        const cell = cellOf(event.target)
        if (cell) setFocused(cell)
      }}
      onBlur={event => {
        const next = event.relatedTarget
        if (next instanceof Node && gridRef.current?.contains(next) === true) return
        setFocused(null)
      }}
      style={{
        display: 'grid',
        // 52px de gouttière : la largeur qu'il faut au `+` de frontière ET à la
        // poubelle de la ligne, qui ne se chevauchent pas parce que l'un est
        // collé au bord droit et l'autre au bord gauche. La poubelle d'une
        // COLONNE, elle, est centrée sur sa colonne, donc hors de ce calcul.
        gridTemplateColumns: `52px repeat(${columnCount}, minmax(84px, 1fr))`,
        gap: TABLE_GRID_GAP,
        alignItems: 'stretch',
      }}
    >
      {/* Column boundaries, above the header. The corner holds the boundary
          BEFORE the first column, which no per-column handle can reach: handle
          `i` inserts AFTER column `i`, and now sits on exactly that boundary. */}
      <div style={HANDLE_ROW}>
        <TableHandle
          label={`Insérer une colonne avant la colonne 1 du tableau ${index + 1}`}
          onActivate={() => onChange(addTableColumn(block, -1))}
          icon={<Plus size={13} />}
          straddle="col"
        />
      </div>
      {headerCells.map((_, columnIndex) => (
        <div key={`h${columnIndex}`} style={{ ...HANDLE_ROW, position: 'relative' }}>
          <TableHandle
            label={`Insérer une colonne après la colonne ${columnIndex + 1} du tableau ${index + 1}`}
            onActivate={() => onChange(addTableColumn(block, columnIndex))}
            icon={<Plus size={12} />}
            straddle="col"
          />
          {canRemoveColumn && (
            // Centrée SUR la colonne, parce que c'est la colonne qu'elle
            // supprime — alors que le `+` reste sur la frontière, au bord droit.
            <span
              style={{
                ...revealedTrash(active?.col === columnIndex),
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            >
              <TableHandle
                destructive
                label={`Supprimer la colonne ${columnIndex + 1} du tableau ${index + 1}`}
                onActivate={() => onChange(removeTableColumn(block, columnIndex))}
                icon={<Trash2 size={12} />}
              />
            </span>
          )}
        </div>
      ))}

      {/* The header row. Always present in the editor, never in the data until
          something is typed in it — `BlockView` only draws a `<thead>` when the
          header is not empty.

          Its gutter carries the boundary BEFORE the first row, for the same
          reason the corner above carries the one before the first column. */}
      <div style={HANDLE_ROW}>
        <TableHandle
          label={`Insérer une ligne avant la ligne 1 du tableau ${index + 1}`}
          onActivate={() => onChange(addTableRow(block, -1))}
          icon={<Plus size={13} />}
          straddle="row"
        />
      </div>
      {headerCells.map((cell, columnIndex) => (
        <input
          key={`head${columnIndex}`}
          // La ligne d'en-tête est une "case" comme les autres pour la
          // sélection de colonne : sans ce `data-cell`, focaliser ou survoler
          // l'en-tête ne révélait jamais la poubelle de sa colonne. `-1` comme
          // ligne : ce n'est celle d'aucune ligne du corps, donc ne déclenche
          // jamais de poubelle de LIGNE par erreur.
          data-cell={`-1,${columnIndex}`}
          aria-label={`En-tête ${columnIndex + 1} du tableau ${index + 1}`}
          placeholder={`En-tête ${columnIndex + 1}`}
          value={cell}
          onChange={event => onChange(setTableHeaderCell(block, columnIndex, event.target.value))}
          style={{ ...FIELD_STYLE, fontSize: 13, fontWeight: 600, background: 'var(--muted, transparent)' }}
        />
      ))}

      {block.rows.map((row, rowIndex) => {
        const cells = withColumns<TableCell>(columnCount, row, '')
        return (
          <TableRow
            key={rowIndex}
            block={block}
            tableIndex={index}
            rowIndex={rowIndex}
            cells={cells}
            canRemoveRow={block.rows.length > 1}
            revealTrash={active?.row === rowIndex}
            onChange={onChange}
          />
        )
      })}
    </div>
  )
}

/**
 * The strip a row's or a column's handles sit in.
 *
 * `flex-end` on both axes is what puts a handle ON the boundary it acts on
 * rather than in the middle of the cell it belongs to. A column handle inserts
 * AFTER its column, so it is aligned to that column's trailing edge, and a row
 * handle likewise to the row's bottom edge. Centred — which is what these were —
 * every one of them read as "insert here" while inserting half a cell away.
 *
 * The 6px `gap` and the opacity are accessibility rather than taste. These used
 * to be 18px targets at 42% opacity with the DESTRUCTIVE trash 1px from the `+`:
 * below the 24px of WCAG 2.5.8, hard to see, and a near-miss next to it deleted
 * a row or a column of the user's data.
 */
const HANDLE_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'flex-end',
  gap: 6,
  opacity: 0.72,
}

/** The grid's own `gap` (see `TableField`) — the boundary handles straddle it. */
const TABLE_GRID_GAP = 4

const HANDLE_SIZE = 22

/**
 * How far a boundary `+` must shift to sit ON the line it inserts at, instead
 * of hugging it from one side.
 *
 * `HANDLE_ROW` packs each `+` flush against the trailing edge of its own grid
 * cell — the same edge the neighbouring cell's border starts at — so at rest
 * the button's own right (or bottom) edge already sits exactly on the
 * boundary, with the whole 22px of it on the near side. Moving it by half its
 * OWN size is what centres it on that edge instead of hugging it; the extra
 * half of the grid's `gap` centres it on the thin seam between the two cells'
 * borders rather than on the inner one of the two.
 */
const HANDLE_STRADDLE = HANDLE_SIZE / 2 + TABLE_GRID_GAP / 2

const HANDLE_BUTTON: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  // Plus petits qu'avant (28 → 22) : la demande était explicite, et ils n'ont
  // plus besoin de porter deux boutons côte à côte puisque la poubelle est
  // maintenant révélée au survol de sa ligne ou de sa colonne.
  width: HANDLE_SIZE,
  height: HANDLE_SIZE,
  padding: 0,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'inherit',
  cursor: 'pointer',
}

/**
 * La poubelle d'une ligne ou d'une colonne, révélée au survol de cette ligne ou
 * de cette colonne — ou quand une de ses cellules a le focus.
 *
 * `opacity: 0` plutôt que `display: none`, et ce n'est pas un détail : un bouton
 * invisible reste FOCALISABLE, donc une suppression de ligne ou de colonne reste
 * possible au clavier. Le focus le révèle, donc l'utilisateur voit ce qu'il
 * s'apprête à déclencher. `pointerEvents` est ce qui empêche un clic de tomber
 * sur une poubelle qu'on ne voyait pas.
 */
function revealedTrash(revealed: boolean): CSSProperties {
  return {
    position: 'absolute',
    display: 'flex',
    opacity: revealed ? 1 : 0,
    pointerEvents: revealed ? 'auto' : 'none',
    transition: 'opacity 120ms ease-in-out',
  }
}

/**
 * One `+` or trash on a table's row/column boundaries.
 *
 * Extracted so the four places that draw one — every column boundary, every row
 * boundary, and the two that insert BEFORE the first row and column — share a
 * single target size and a single naming scheme, which is exactly what drifted
 * when each was a hand-written button.
 */
/**
 * Un `+` de frontière est **nu** : ni bordure ni fond au repos, juste le glyphe,
 * et il ne prend l'apparence d'un bouton qu'au survol ou au focus clavier (voir
 * `.table-handle`, dans `index.css`). Le glyphe reste visible au repos — c'est la
 * *chrome* qui disparaît, pas le signe —, sinon la poignée deviendrait
 * introuvable, ce que l'audit reprochait déjà à l'opacité de 42 %.
 *
 * Seule la corbeille garde la sienne : elle est destructive, et elle ne doit
 * jamais pouvoir se confondre avec le `+` qui la jouxte.
 */
const BARE_HANDLE: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  width: HANDLE_SIZE,
  height: HANDLE_SIZE,
  padding: 0,
  borderRadius: 6,
  cursor: 'pointer',
  // `border` et `background` sont volontairement ABSENTS : écrits ici, ils
  // l'emporteraient sur la règle `:hover` de la classe — un style en ligne gagne
  // toujours contre une feuille de style — et le bouton ne pourrait plus jamais
  // apparaître.
}

function TableHandle({
  label,
  onActivate,
  destructive = false,
  icon,
  straddle,
}: {
  label: string
  onActivate: () => void
  destructive?: boolean
  icon: ReactNode
  /**
   * For a boundary `+` only: which line it straddles — `"col"` shifts it
   * right onto the vertical line after its column, `"row"` shifts it down
   * onto the horizontal line after its row. See `HANDLE_STRADDLE`.
   */
  straddle?: 'col' | 'row'
}) {
  const straddleStyle: CSSProperties | undefined =
    straddle === 'col'
      ? { transform: `translateX(${HANDLE_STRADDLE}px)` }
      : straddle === 'row'
        ? { transform: `translateY(${HANDLE_STRADDLE}px)` }
        : undefined

  return (
    <Hint label={label}>
    <button
      type="button"
      aria-label={label}
      onClick={onActivate}
      // Le survol passe par une CLASSE, pas par un état React : il y a une
      // poignée par frontière, et un `useState` par poignée coûterait un rendu à
      // chaque déplacement de souris au-dessus d'un tableau.
      className={destructive ? undefined : 'table-handle'}
      style={{
        ...(destructive ? { ...HANDLE_BUTTON, color: 'var(--destructive)' } : BARE_HANDLE),
        ...straddleStyle,
      }}
    >
      {icon}
    </button>
    </Hint>
  )
}

function TableRow({
  block,
  tableIndex,
  rowIndex,
  cells,
  canRemoveRow,
  revealTrash,
  onChange,
}: {
  block: TableBlock
  tableIndex: number
  rowIndex: number
  cells: TableCell[]
  canRemoveRow: boolean
  /** Vrai quand une cellule de CETTE ligne est survolée ou a le focus. */
  revealTrash: boolean
  onChange: (block: CardBlock) => void
}) {
  return (
    <>
      <div style={{ ...HANDLE_ROW, position: 'relative' }}>
        <TableHandle
          label={`Insérer une ligne après la ligne ${rowIndex + 1} du tableau ${tableIndex + 1}`}
          onActivate={() => onChange(addTableRow(block, rowIndex))}
          icon={<Plus size={12} />}
          straddle="row"
        />
        {canRemoveRow && (
          // Centrée SUR la ligne (verticalement) et collée au bord GAUCHE : c'est
          // ce qui la sépare du `+`, qui est au bord droit ET sur la frontière du
          // bas. Deux positions distinctes, donc aucun chevauchement même quand
          // la ligne est courte.
          <span
            style={{
              ...revealedTrash(revealTrash),
              left: 0,
              top: '50%',
              transform: 'translateY(-50%)',
            }}
          >
            <TableHandle
              destructive
              label={`Supprimer la ligne ${rowIndex + 1} du tableau ${tableIndex + 1}`}
              onActivate={() => onChange(removeTableRow(block, rowIndex))}
              icon={<Trash2 size={12} />}
            />
          </span>
        )}
      </div>

      {cells.map((cell, columnIndex) => (
        <TableCellField
          key={columnIndex}
          cell={cell}
          cellKey={`${rowIndex},${columnIndex}`}
          label={`ligne ${rowIndex + 1} colonne ${columnIndex + 1} du tableau ${tableIndex + 1}`}
          onChange={next => onChange(setTableCell(block, rowIndex, columnIndex, next))}
          onKind={kind => onChange(setTableCellKind(block, rowIndex, columnIndex, kind))}
        />
      ))}
    </>
  )
}

/** Une cellule TEXTE qui grandit avec ses lignes — Entrée y écrit un saut de ligne, comme dans un bloc. */
function AutoGrowCellTextarea({
  value,
  onChange,
  ...rest
}: {
  value: string
  onChange: (text: string) => void
  'aria-label': string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const field = ref.current
    if (field === null) return
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight}px`
  })
  return (
    <textarea
      {...rest}
      ref={ref}
      value={value}
      rows={1}
      onChange={event => onChange(event.target.value)}
      style={{ ...FIELD_STYLE, fontSize: 13, resize: 'none', overflow: 'hidden', minHeight: 28 }}
    />
  )
}

/** One table cell, in either of its two modes, with its type switch beside it. */
function TableCellField({
  cell,
  cellKey,
  label,
  onChange,
  onKind,
}: {
  cell: TableCell
  /** `"row,column"` — how the palette finds this cell back from the focused element. */
  cellKey: string
  label: string
  onChange: (cell: TableCell) => void
  onKind: (kind: SwitchableKind) => void
}) {
  const isMath = typeof cell !== 'string'
  const latex = isMath ? cell.latex : ''

  return (
    <div data-cell={cellKey} data-cell-kind={isMath ? 'math' : 'text'} style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
      {isMath ? (
        <MathLinesField
          latex={latex}
          onChange={next => onChange({ latex: next })}
          label={(line, count) => (count > 1 ? `${label}, ligne ${line + 1}` : label)}
          // Le bandeau retrouve la CELLULE par `data-cell`, et la LIGNE par
          // `data-cell-line` : sans ce second repère, insérer un symbole n'écrirait
          // que la ligne focalisée et effacerait les autres.
          lineAttribute={line => ({ 'data-cell-line': line })}
          renderFallback={(line, count, actions) => (
            <input
              aria-label={count > 1 ? `${label}, ligne ${line + 1} (LaTeX)` : `${label} (LaTeX)`}
              value={latexLines(latex)[line] ?? ''}
              onChange={event => actions.setValue(event.target.value)}
              onKeyDown={mathLineKeyDown(actions, latexLines(latex)[line] ?? '')}
              spellCheck={false}
              style={{ ...FIELD_STYLE, fontSize: 13, fontFamily: 'monospace' }}
            />
          )}
        />
      ) : (
        <AutoGrowCellTextarea aria-label={label} value={cell} onChange={onChange} />
      )}

      {/* Beside the field, never floating over its corner: the old badge sat on
          top of the cell's own text at the exact place a long value ends. */}
      <DropdownMenu>
        <Hint label={`Cette cellule est en ${isMath ? 'formule' : 'texte'} — changer`}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Format de la cellule ${label} : ${isMath ? 'formule' : 'texte'}`}
            style={{ ...CELL_BUTTON, color: isMath ? 'var(--primary)' : 'inherit' }}
          >
            {isMath ? <Sigma size={13} /> : 'Aa'}
          </button>
        </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onKind('text')}>
            <Type size={14} />
            Texte
            <span style={{ marginLeft: 'auto', opacity: 0.8 }}>{!isMath && <Check size={13} />}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onKind('math')}>
            <Sigma size={14} />
            Formule
            <span style={{ marginLeft: 'auto', opacity: 0.8 }}>{isMath && <Check size={13} />}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}