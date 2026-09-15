import { useEffect, useRef, useState } from 'react'
import { Type, Sigma, Table2, Plus, Trash2, ImagePlus, ChevronUp, ChevronDown } from 'lucide-react'
import type { CardBlock, CardBlockKind, TableCell } from '../types/cardBlock'
import { renderMathToHtml } from './renderMath'
import { MathFieldEditor, type MathFieldHandle } from './MathFieldEditor'
import { MathPalette } from './MathPalette'
import { LanguageHelpButton, LanguageHelpPanel } from './LanguageHelpPalette'
import { insertCharacter, type LanguageId, type SpecialCharacter } from './languageHelp'

/**
 * Editing modes the selector offers. `image` is deliberately absent: an image
 * block cannot be produced by switching a mode, only by supplying a file
 * (paste, drop, picker), so offering it here would be a button that cannot do
 * anything on its own.
 */
const MODES: { kind: Exclude<CardBlockKind, 'image'>; icon: typeof Type; label: string }[] = [
  { kind: 'text', icon: Type, label: 'Texte' },
  { kind: 'math', icon: Sigma, label: 'Formule' },
  { kind: 'table', icon: Table2, label: 'Tableau' },
]

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
    case 'image':
      return block.alt
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
 * Re-kinds a block, carrying its text across.
 *
 * Reversibility is the point (règle anti-décalage 6): text → math keeps the
 * string as LaTeX source, math → text keeps the LaTeX as text. A user who
 * switches modes to see what happens can always switch back, so the selector
 * is safe to explore rather than a decision to commit to.
 */
export function convertBlock(block: CardBlock, kind: Exclude<CardBlockKind, 'image'>): CardBlock {
  if (block.kind === kind) return block
  // An image cannot round-trip: there is no mode that produces one back, so
  // converting it away would destroy the asset reference for good (the file
  // itself would linger, orphaned). Refusing is the only behaviour consistent
  // with "switching mode never destroys content" — the user deletes the block
  // if they want it gone.
  if (block.kind === 'image') return block
  const source = sourceOf(block)
  switch (kind) {
    case 'text':
      return { kind: 'text', text: source }
    case 'math':
      return { kind: 'math', latex: source }
    case 'table':
      return {
        kind: 'table',
        header: [],
        rows: source === '' ? [['', '']] : source.split('\n').map(line => line.split('\t')),
      }
  }
}

/**
 * Moves one block, returning a new list. Out-of-range targets return the list
 * unchanged rather than wrapping around: the first block's "up" is a no-op, not
 * a jump to the bottom.
 */
export function moveBlock(blocks: CardBlock[], from: number, to: number): CardBlock[] {
  if (to < 0 || to >= blocks.length || from === to) return blocks
  const next = [...blocks]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Rescales an image block to a new displayed width, keeping its shape.
 *
 * `width`/`height` are the box the renderer reserves — `BlockView` puts them
 * on the `<img>` and derives its `aspect-ratio` from them — so scaling the
 * pair IS the display size, and no new field is needed on the block. The ratio
 * is taken from the values already stored, so repeated resizes do not drift.
 */
export function resizeImageBlock(
  block: Extract<CardBlock, { kind: 'image' }>,
  width: number
): CardBlock {
  const ratio = block.height / block.width
  if (!Number.isFinite(ratio) || ratio <= 0) return { ...block, width }
  return { ...block, width, height: Math.max(1, Math.round(width * ratio)) }
}

/** Every row (and the header) squared to `count` columns, padding with `blank`. */
function withColumns<T>(count: number, cells: T[], blank: T): T[] {
  return Array.from({ length: count }, (_, i) => cells[i] ?? blank)
}

function tableColumnCount(block: TableBlock): number {
  return Math.max(block.header.length, ...block.rows.map(row => row.length), 1)
}

/**
 * The table's own pure edits, alongside `moveBlock`/`convertBlock` above.
 *
 * Exported so the side panel — which acts on "whichever block is active",
 * not on a `TableField` instance it does not have a handle to — can call the
 * exact same functions the table's own row/column buttons use.
 */
export function addTableRow(block: TableBlock, afterRow: number): TableBlock {
  const cols = tableColumnCount(block)
  const rows = [...block.rows]
  rows.splice(afterRow + 1, 0, withColumns<TableCell>(cols, [], ''))
  return { ...block, rows }
}
export function removeTableRow(block: TableBlock, rowIndex: number): TableBlock {
  return block.rows.length <= 1 ? block : { ...block, rows: block.rows.filter((_, i) => i !== rowIndex) }
}
export function addTableColumn(block: TableBlock): TableBlock {
  const cols = tableColumnCount(block) + 1
  return {
    ...block,
    header: withColumns<string>(cols, block.header, ''),
    rows: block.rows.map(row => withColumns<TableCell>(cols, row, '')),
  }
}
export function removeTableColumn(block: TableBlock, cellIndex: number): TableBlock {
  const cols = tableColumnCount(block)
  if (cols <= 1) return block
  return {
    ...block,
    header: withColumns<string>(cols, block.header, '').filter((_, i) => i !== cellIndex),
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
/** Text ↔ formula for one cell, carrying its content across the same way `convertBlock` does. */
export function toggleTableCellKind(block: TableBlock, rowIndex: number, cellIndex: number): TableBlock {
  const cols = tableColumnCount(block)
  const cell = withColumns<TableCell>(cols, block.rows[rowIndex] ?? [], '')[cellIndex] ?? ''
  const next: TableCell = typeof cell === 'string' ? { latex: cell } : cell.latex
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
}

export function BlockEditor({
  blocks,
  onChange,
  resolveAsset,
  onInsertImage,
  onPickImage,
  onError,
  autoFocusField = false,
}: BlockEditorProps) {
  // Which block the panel's tools act on. Kept here rather than derived from
  // DOM focus so the panel still shows the right tools while the user is
  // clicking the panel itself (which takes focus away from the block).
  const [activeIndex, setActiveIndex] = useState(0)
  const active = blocks[activeIndex] ?? blocks[blocks.length - 1]

  // The active math block's live handle, so the panel's palette can insert
  // into it. Every math block registers itself here on mount regardless of
  // whether it is active — cheap, and it means the palette is ready the
  // instant a block becomes active rather than one render late.
  const [mathFields, setMathFields] = useState<Record<number, MathFieldHandle | null>>({})
  const activeField = mathFields[activeIndex] ?? null

  // The special-character palette: which language it is helping with, and
  // whether it is showing at all. Local to the editor on purpose — it is a
  // writing aid for the description open right now, not a document setting.
  const [language, setLanguage] = useState<LanguageId | null>(null)
  const [languageHelpOpen, setLanguageHelpOpen] = useState(false)

  const editorRef = useRef<HTMLDivElement>(null)
  // Set by an insert or a new block, consumed by the effect below once the
  // change has been committed and re-rendered: a caret placed before that
  // commit is thrown away with the old value.
  const pendingCaret = useRef<{ index: number; position: number } | null>(null)
  const pendingFocusSelector = useRef<string | null>(null)

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
  })

  useEffect(() => {
    if (!autoFocusField) return
    // A TEXT block first — that is where prose is written, and where the
    // language palette inserts (`data-block-index` is only on those fields) —
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

  /** Focuses the first field of block `index` once it exists in the DOM. */
  function focusBlockLater(index: number) {
    pendingFocusSelector.current =
      `[data-row-index="${index}"] textarea, ` +
      `[data-row-index="${index}"] input, ` +
      `[data-row-index="${index}"] math-field, ` +
      `[data-row-index="${index}"] [contenteditable="true"]`
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
   * Which block the language palette writes into.
   *
   * The block being edited when that block is text — the same rule the mode
   * selector follows — and the description's first text block otherwise, so the
   * palette still works while a formula or an image is the selected block.
   * `-1` means this description has no text block at all, and the flag is
   * offered disabled rather than inserting into nowhere.
   */
  const firstTextIndex = blocks.findIndex(block => block.kind === 'text')
  const languageTargetIndex = active?.kind === 'text' ? activeIndex : firstTextIndex

  /**
   * Inserts a palette character at the caret of the block being written.
   *
   * A field that is not the focused element has no caret to respect — that is
   * the keyboard path, where focus is on the palette button — so the character
   * goes to the end of the text: degraded, never a lost click. What the
   * character writes (its closing partner, the padding, where the caret lands)
   * is the character set's business; see `insertCharacter`.
   */
  function insertText(character: SpecialCharacter) {
    const index = languageTargetIndex
    if (index < 0) return
    const block = blocksRef.current[index]
    if (block?.kind !== 'text') return

    const field = textFieldAt(index)
    const caret = field !== null && document.activeElement === field ? field : null
    const start = caret === null ? block.text.length : caret.selectionStart ?? block.text.length
    const end = caret === null ? start : caret.selectionEnd ?? start

    const insertion = insertCharacter(block.text, start, end, character)
    onChange(
      blocksRef.current.map((existing, i) => (i === index ? { kind: 'text', text: insertion.text } : existing))
    )
    pendingCaret.current = { index, position: insertion.caret }
    setActiveIndex(index)
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

  function removeActive() {
    if (blocks.length <= 1) return
    const index = activeIndex
    onChange(blocks.filter((_, i) => i !== index))
    setActiveIndex(current => Math.max(0, current - (index <= current ? 1 : 0)))
  }

  /** Keeps the moved block selected, so a run of clicks walks it up the list. */
  function move(to: number) {
    const next = moveBlock(blocks, activeIndex, to)
    if (next === blocks) return
    onChange(next)
    setActiveIndex(to)
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

  return (
    <div
      ref={editorRef}
      style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 16, height: '100%', minHeight: 0 }}
      onPaste={handlePaste}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', paddingRight: 2 }}>
        {blocks.map((block, index) => (
          <div
            key={index}
            data-row-index={index}
            onFocus={() => setActiveIndex(index)}
            onMouseDown={() => setActiveIndex(index)}
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${index === activeIndex ? 'var(--accent, currentColor)' : 'var(--border)'}`,
              borderLeft: `3px solid ${index === activeIndex ? 'var(--accent, currentColor)' : 'var(--border)'}`,
              background:
                index === activeIndex ? 'color-mix(in oklch, var(--border), transparent 85%)' : 'transparent',
            }}
          >
            <BlockField
              block={block}
              index={index}
              resolveAsset={resolveAsset}
              onChange={next => replace(index, next)}
              onEnterBlock={() => insertBlockAfter(index, { kind: 'text', text: '' })}
              onFieldChange={fieldSetterFor(index)}
            />
          </div>
        ))}

        {/* A permanent gutter, never a toolbar revealed on hover: a control that
            appears on hover shifts whatever sits under it (règle 7). */}
        <button
          type="button"
          aria-label="Ajouter un bloc"
          onClick={() => append({ kind: 'text', text: '' })}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '6px 0',
            fontSize: 12,
            opacity: 0.55,
            border: '1px dashed var(--border)',
            borderRadius: 6,
            background: 'none',
            color: 'inherit',
            cursor: 'pointer',
          }}
        >
          <Plus size={13} />
        </button>
      </div>

      <aside
        aria-label="Actions du bloc en cours"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          overflowY: 'auto',
          paddingLeft: 14,
          borderLeft: '1px solid var(--border)',
        }}
      >
        <div role="group" aria-label="Mode de saisie" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {MODES.map(({ kind, icon: Icon, label }) => {
              const selected = active?.kind === kind
              return (
                <button
                  key={kind}
                  type="button"
                  aria-label={label}
                  aria-pressed={selected}
                  // An image block has no text form to convert to, so the selector
                  // is inert on one rather than silently dropping the picture.
                  disabled={active?.kind === 'image'}
                  onClick={() => {
                    if (blocks.length === 0) onChange([convertBlock({ kind: 'text', text: '' }, kind)])
                    else replace(activeIndex, convertBlock(blocks[activeIndex], kind))
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 10px',
                    fontSize: 13,
                    borderRadius: 6,
                    cursor: 'pointer',
                    border: '1px solid var(--border)',
                    background: selected ? 'var(--accent, rgba(0,0,0,0.08))' : 'transparent',
                    color: 'inherit',
                    opacity: active?.kind === 'image' ? 0.4 : 1,
                  }}
                >
                  <Icon size={14} />
                  {label}
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <IconButton label="Monter le bloc en cours" disabled={activeIndex === 0} onClick={() => move(activeIndex - 1)}>
              <ChevronUp size={14} />
            </IconButton>
            <IconButton
              label="Descendre le bloc en cours"
              disabled={activeIndex === blocks.length - 1}
              onClick={() => move(activeIndex + 1)}
            >
              <ChevronDown size={14} />
            </IconButton>
            {blocks.length > 1 && (
              <IconButton label={`Supprimer le bloc ${activeIndex + 1}`} onClick={removeActive}>
                <Trash2 size={14} />
              </IconButton>
            )}
            {onPickImage !== undefined && (
              <IconButton label="Insérer une image" onClick={() => insert(onPickImage)}>
                <ImagePlus size={14} />
              </IconButton>
            )}
          </div>
        </div>

        {/* Reordering has moved from a per-row gutter to these two buttons: with
            the block itself now the thing that is highlighted, "move" reads as
            an action on the current block rather than on a specific row. */}
        {active?.kind === 'math' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <SectionLabel>Structures et symboles</SectionLabel>
            <MathPalette field={activeField} />
          </div>
        )}

        {active?.kind === 'table' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <SectionLabel>Tableau</SectionLabel>
            <div style={{ display: 'flex', gap: 6 }}>
              <SmallButton
                label="Ajouter une ligne"
                onClick={() => replace(activeIndex, addTableRow(active as TableBlock, (active as TableBlock).rows.length - 1))}
              />
              <SmallButton label="Ajouter une colonne" onClick={() => replace(activeIndex, addTableColumn(active as TableBlock))} />
            </div>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.65, lineHeight: 1.4 }}>
              Chaque cellule bascule texte ↔ formule avec le bouton « fx » à côté d’elle. La colonne la plus longue
              impose sa largeur.
            </p>
          </div>
        )}

        {/* Reachable regardless of the active block's kind — switching to a
            formula or a table must not hide the only way back to the language
            palette when the description also has prose in it. Disabled, never
            hidden, when there is no text block anywhere to insert into. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SectionLabel>Caractères spéciaux</SectionLabel>
          <LanguageHelpButton
            language={language}
            open={languageHelpOpen}
            disabled={languageTargetIndex < 0}
            onToggle={() => setLanguageHelpOpen(open => !open)}
          />
          {languageHelpOpen && (
            <LanguageHelpPanel language={language} onChooseLanguage={setLanguage} onInsert={insertText} />
          )}
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10 }}>
          <SectionLabel>Raccourcis</SectionLabel>
          <ShortcutRow keys="Entrée" label="Nouveau bloc" />
          <ShortcutRow keys="Maj + Entrée" label="Retour à la ligne" />
          <ShortcutRow keys="Ctrl/Cmd + Z" label="Annuler" />
          <ShortcutRow keys="Ctrl/Cmd + Maj + Z" label="Rétablir" />
        </div>
      </aside>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', opacity: 0.6 }}>
      {children}
    </p>
  )
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, opacity: 0.7 }}>
      <span>{label}</span>
      <kbd style={{ font: 'inherit', border: '1px solid var(--border)', borderRadius: 4, padding: '0 5px' }}>{keys}</kbd>
    </div>
  )
}

function SmallButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        fontSize: 12,
        padding: '4px 10px',
        cursor: 'pointer',
        background: 'none',
        border: '1px solid var(--border)',
        borderRadius: 999,
        color: 'inherit',
      }}
    >
      {label}
    </button>
  )
}

function IconButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        padding: 0,
        borderRadius: 6,
        background: 'none',
        border: '1px solid var(--border)',
        color: 'inherit',
        opacity: disabled ? 0.3 : 0.75,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

interface BlockFieldProps {
  block: CardBlock
  index: number
  resolveAsset: (asset: string) => string
  onChange: (block: CardBlock) => void
  /** Plain Enter anywhere in the block — inserts a new block right after this one. */
  onEnterBlock: () => void
  /** Reports the block's live math handle, for the side panel's palette. Called with `null` when the block is not a formula (or unmounts as one). */
  onFieldChange: (handle: MathFieldHandle | null) => void
}

const FIELD_STYLE = {
  width: '100%',
  boxSizing: 'border-box' as const,
  font: 'inherit',
  fontSize: 14,
  padding: '4px 6px',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'inherit',
}

function BlockField({ block, index, resolveAsset, onChange, onEnterBlock, onFieldChange }: BlockFieldProps) {
  switch (block.kind) {
    case 'text':
      return (
        <textarea
          aria-label={`Texte du bloc ${index + 1}`}
          // How the language palette finds this field to insert at its caret —
          // see `textFieldAt`. An attribute rather than a ref map: the editor
          // renders its own markup, so the lookup can be a query against it.
          data-block-index={index}
          value={block.text}
          onChange={event => {
            const text = event.target.value
            // `$$` converts in place: the fast path for someone taking notes
            // live, who should not have to reach for the selector mid-sentence.
            //
            // ONE call, not an onChange followed by a convert: both would read
            // the same stale `blocks` closure, so the conversion would run on
            // the pre-keystroke block and swallow the last character.
            if (text.endsWith('$$')) {
              onChange({ kind: 'math', latex: text.slice(0, -2) })
              return
            }
            onChange({ kind: 'text', text })
          }}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            onEnterBlock()
          }}
          style={{ ...FIELD_STYLE, minHeight: 72, resize: 'vertical' }}
        />
      )

    case 'math':
      return <MathBlockField block={block} index={index} onChange={onChange} onEnterBlock={onEnterBlock} onFieldChange={onFieldChange} />

    case 'image':
      return <ImageBlockField block={block} index={index} resolveAsset={resolveAsset} onChange={onChange} />

    case 'table':
      return <TableField block={block} index={index} onChange={onChange} />
  }
}

function MathBlockField({
  block,
  index,
  onChange,
  onEnterBlock,
  onFieldChange,
}: {
  block: Extract<CardBlock, { kind: 'math' }>
  index: number
  onChange: (block: CardBlock) => void
  onEnterBlock: () => void
  onFieldChange: (handle: MathFieldHandle | null) => void
}) {
  return (
    <div>
      {/* WYSIWYG when MathLive is available, the raw LaTeX field until
          then — and permanently if it never loads. Both edit the same
          string, so neither is a dead end: someone who knows LaTeX can
          still type it, and someone who does not never has to. Its live
          handle is reported up so the side panel's palette — shown only
          for the block currently being worked on — can insert into it. */}
      <MathFieldEditor
        ref={onFieldChange}
        latex={block.latex}
        onChange={latex => onChange({ ...block, latex })}
        onEnter={onEnterBlock}
        ariaLabel={`Formule du bloc ${index + 1}`}
        fallback={
          <textarea
            // Distinct from the WYSIWYG field's label: both are text
            // inputs for the same value, and sharing one name makes them
            // indistinguishable to assistive tech and to tests alike.
            aria-label={`Formule du bloc ${index + 1} (LaTeX)`}
            value={block.latex}
            onChange={event => onChange({ ...block, latex: event.target.value })}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.shiftKey) return
              event.preventDefault()
              onEnterBlock()
            }}
            spellCheck={false}
            style={{ ...FIELD_STYLE, minHeight: 44, resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }}
          />
        }
      />

      {/* Every formula is its own block, hence its own line — always
          typeset centred, the way `BlockView` renders it. */}
      <div
        data-testid={`math-preview-${index}`}
        style={{ minHeight: 24, padding: '2px 0', overflowX: 'auto' }}
        dangerouslySetInnerHTML={{ __html: renderMathToHtml(block.latex, true) }}
      />
    </div>
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ width: 18 }} />
            {headerCells.map((cell, cellIndex) => (
              <th key={cellIndex} style={{ padding: 1, position: 'relative' }}>
                <input
                  aria-label={`En-tête ${cellIndex + 1} du tableau ${index + 1}`}
                  value={cell}
                  onChange={event => onChange(setTableHeaderCell(block, cellIndex, event.target.value))}
                  style={{ ...FIELD_STYLE, fontSize: 13, fontWeight: 600 }}
                />
                {columnCount > 1 && (
                  <IconButton
                    label={`Supprimer la colonne ${cellIndex + 1} du tableau ${index + 1}`}
                    onClick={() => onChange(removeTableColumn(block, cellIndex))}
                  >
                    <Trash2 size={11} />
                  </IconButton>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => {
            const cells = withColumns<TableCell>(columnCount, row, '')
            return (
              <tr key={rowIndex} data-table-row={rowIndex}>
                <td style={{ padding: 1, verticalAlign: 'top' }}>
                  {block.rows.length > 1 && (
                    <IconButton
                      label={`Supprimer la ligne ${rowIndex + 1} du tableau ${index + 1}`}
                      onClick={() => onChange(removeTableRow(block, rowIndex))}
                    >
                      <Trash2 size={11} />
                    </IconButton>
                  )}
                </td>
                {cells.map((cell, cellIndex) => (
                  <TableCellField
                    key={cellIndex}
                    cell={cell}
                    label={`Ligne ${rowIndex + 1} colonne ${cellIndex + 1} du tableau ${index + 1}`}
                    onChange={next => onChange(setTableCell(block, rowIndex, cellIndex, next))}
                    onToggleKind={() => onChange(toggleTableCellKind(block, rowIndex, cellIndex))}
                    onEnter={() => onChange(addTableRow(block, rowIndex))}
                  />
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** One table cell, in either of its two modes. */
function TableCellField({
  cell,
  label,
  onChange,
  onToggleKind,
  onEnter,
}: {
  cell: TableCell
  label: string
  onChange: (cell: TableCell) => void
  onToggleKind: () => void
  onEnter: () => void
}) {
  const isMath = typeof cell !== 'string'
  return (
    <td style={{ padding: 1, position: 'relative' }}>
      {isMath ? (
        <MathFieldEditor
          ref={() => {}}
          latex={cell.latex}
          onChange={latex => onChange({ latex })}
          onEnter={onEnter}
          ariaLabel={label}
          fallback={
            <input
              aria-label={`${label} (LaTeX)`}
              value={cell.latex}
              onChange={event => onChange({ latex: event.target.value })}
              onKeyDown={event => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                onEnter()
              }}
              spellCheck={false}
              style={{ ...FIELD_STYLE, fontSize: 13, fontFamily: 'monospace' }}
            />
          }
        />
      ) : (
        <input
          aria-label={label}
          value={cell}
          onChange={event => onChange(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            onEnter()
          }}
          style={{ ...FIELD_STYLE, fontSize: 13 }}
        />
      )}
      <button
        type="button"
        aria-label={isMath ? `Passer « ${label} » en texte` : `Passer « ${label} » en formule`}
        title={isMath ? 'Passer en texte' : 'Passer en formule'}
        onClick={onToggleKind}
        style={{
          position: 'absolute',
          top: -7,
          right: -2,
          fontSize: 9,
          fontWeight: 700,
          lineHeight: 1,
          padding: '2px 4px',
          borderRadius: 999,
          border: '1px solid var(--border)',
          background: 'var(--background)',
          color: 'inherit',
          opacity: 0.7,
          cursor: 'pointer',
        }}
      >
        {isMath ? 'Aa' : 'fx'}
      </button>
    </td>
  )
}
