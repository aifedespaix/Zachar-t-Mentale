import { useRef, useState } from 'react'
import { Type, Sigma, Table2, Plus, Trash2, ImagePlus, ChevronUp, ChevronDown } from 'lucide-react'
import type { CardBlock, CardBlockKind } from '../types/cardBlock'
import { renderMathToHtml } from './renderMath'
import { MathFieldEditor, type MathFieldHandle } from './MathFieldEditor'
import { MathPalette } from './MathPalette'

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
      return [block.header, ...block.rows]
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
}

export function BlockEditor({
  blocks,
  onChange,
  resolveAsset,
  onInsertImage,
  onPickImage,
  onError,
}: BlockEditorProps) {
  // Which block the header's mode selector acts on. Kept here rather than
  // derived from DOM focus so the selector still shows the right mode while
  // the user is clicking the selector itself (which takes focus away).
  const [activeIndex, setActiveIndex] = useState(0)
  const active = blocks[activeIndex] ?? blocks[blocks.length - 1]

  function replace(index: number, block: CardBlock) {
    onChange(blocks.map((existing, i) => (i === index ? block : existing)))
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
    onChange(blocks.filter((_, i) => i !== index))
    setActiveIndex(current => Math.max(0, current - (index <= current ? 1 : 0)))
  }

  /** Keeps the moved block selected, so a run of clicks walks it up the list. */
  function move(index: number, to: number) {
    const next = moveBlock(blocks, index, to)
    if (next === blocks) return
    onChange(next)
    setActiveIndex(to)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }} onPaste={handlePaste}>
      {/* A row of its own, of fixed height, so CHANGING mode never moves the
          content below it (règle anti-décalage 8). */}
      <div
        role="group"
        aria-label="Mode de saisie"
        style={{
          display: 'flex',
          gap: 4,
          alignItems: 'center',
          paddingBottom: 8,
          borderBottom: '1px solid var(--border)',
        }}
      >
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
        {onPickImage !== undefined && (
          <button
            type="button"
            aria-label="Insérer une image"
            onClick={() => insert(onPickImage)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 10px',
              fontSize: 13,
              borderRadius: 6,
              cursor: 'pointer',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'inherit',
            }}
          >
            <ImagePlus size={14} />
            Image
          </button>
        )}
      </div>

      {blocks.map((block, index) => (
        <div
          key={index}
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'flex-start',
            padding: 6,
            borderRadius: 6,
            border: `1px solid ${index === activeIndex ? 'var(--border)' : 'transparent'}`,
            background: index === activeIndex ? 'color-mix(in oklch, var(--border), transparent 80%)' : 'transparent',
          }}
        >
          {/* Reordering is a permanent gutter rather than a drag handle: a
              definition is a short list read top to bottom, and two buttons
              are reachable by keyboard, which a drag never is. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 2 }}>
            <IconButton
              label={`Monter le bloc ${index + 1}`}
              disabled={index === 0}
              onClick={() => move(index, index - 1)}
            >
              <ChevronUp size={13} />
            </IconButton>
            <IconButton
              label={`Descendre le bloc ${index + 1}`}
              disabled={index === blocks.length - 1}
              onClick={() => move(index, index + 1)}
            >
              <ChevronDown size={13} />
            </IconButton>
          </div>

          <div style={{ flex: 1, minWidth: 0 }} onFocus={() => setActiveIndex(index)}>
            <BlockField
              block={block}
              index={index}
              isActive={index === activeIndex}
              resolveAsset={resolveAsset}
              onChange={next => replace(index, next)}
            />
          </div>

          {blocks.length > 1 && (
            <IconButton label={`Supprimer le bloc ${index + 1}`} onClick={() => removeAt(index)}>
              <Trash2 size={13} />
            </IconButton>
          )}
        </div>
      ))}

      {/* A permanent gutter, never a toolbar revealed on hover: a control that
          appears on hover shifts whatever sits under it (règle 7). */}
      <button
        type="button"
        aria-label="Ajouter un bloc"
        onClick={() => {
          onChange([...blocks, { kind: 'text', text: '' }])
          setActiveIndex(blocks.length)
        }}
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
        width: 20,
        height: 20,
        padding: 0,
        borderRadius: 4,
        background: 'none',
        border: 'none',
        color: 'inherit',
        opacity: disabled ? 0.25 : 0.6,
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
  /** Drives the per-block tooling that would be noise on every block at once. */
  isActive: boolean
  resolveAsset: (asset: string) => string
  onChange: (block: CardBlock) => void
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

function BlockField({ block, index, isActive, resolveAsset, onChange }: BlockFieldProps) {
  switch (block.kind) {
    case 'text':
      return (
        <textarea
          aria-label={`Texte du bloc ${index + 1}`}
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
          style={{ ...FIELD_STYLE, minHeight: 72, resize: 'vertical' }}
        />
      )

    case 'math':
      return <MathBlockField block={block} index={index} isActive={isActive} onChange={onChange} />

    case 'image':
      return <ImageBlockField block={block} index={index} resolveAsset={resolveAsset} onChange={onChange} />

    case 'table':
      return <TableField block={block} index={index} onChange={onChange} />
  }
}

function MathBlockField({
  block,
  index,
  isActive,
  onChange,
}: {
  block: Extract<CardBlock, { kind: 'math' }>
  index: number
  isActive: boolean
  onChange: (block: CardBlock) => void
}) {
  // Held in state, not a ref: the palette must re-render once the handle
  // exists, and a ref assignment alone would leave its buttons disabled until
  // something else happened to re-render.
  const [field, setField] = useState<MathFieldHandle | null>(null)

  return (
    <div>
      {/* WYSIWYG when MathLive is available, the raw LaTeX field until
          then — and permanently if it never loads. Both edit the same
          string, so neither is a dead end: someone who knows LaTeX can
          still type it, and someone who does not never has to. */}
      <MathFieldEditor
        ref={setField}
        latex={block.latex}
        onChange={latex => onChange({ ...block, latex })}
        ariaLabel={`Formule du bloc ${index + 1}`}
        fallback={
          <textarea
            // Distinct from the WYSIWYG field's label: both are text
            // inputs for the same value, and sharing one name makes them
            // indistinguishable to assistive tech and to tests alike.
            aria-label={`Formule du bloc ${index + 1} (LaTeX)`}
            value={block.latex}
            onChange={event => onChange({ ...block, latex: event.target.value })}
            spellCheck={false}
            style={{ ...FIELD_STYLE, minHeight: 44, resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }}
          />
        }
      />

      {/* Only under the block being edited. Showing every formula's palette at
          once would put three identical toolbars on screen and bury the
          formulas between them. */}
      {isActive && (
        <div style={{ padding: '6px 0' }}>
          <MathPalette field={field} />
        </div>
      )}

      {/* Live preview, rendered synchronously so it cannot reflow after
          paint. It is what makes raw LaTeX usable at all until MathLive
          lands on top of this same block. */}
      <div
        data-testid={`math-preview-${index}`}
        style={{ minHeight: 24, padding: '2px 0', overflowX: 'auto' }}
        dangerouslySetInnerHTML={{ __html: renderMathToHtml(block.latex, false) }}
      />

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.75 }}>
        <input
          type="checkbox"
          checked={block.display === true}
          onChange={event => onChange({ ...block, display: event.target.checked })}
        />
        Formule centrée sur sa propre ligne
      </label>
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
  block: Extract<CardBlock, { kind: 'table' }>
  index: number
  onChange: (block: CardBlock) => void
}) {
  const columnCount = Math.max(block.header.length, ...block.rows.map(row => row.length), 1)

  /** Every row keeps the same length as the header — a ragged table renders wrong. */
  function withColumns(count: number, cells: string[]): string[] {
    return Array.from({ length: count }, (_, i) => cells[i] ?? '')
  }

  /** `rowIndex === -1` addresses the header row, which is displayed above the body. */
  function setCell(rowIndex: number, cellIndex: number, value: string) {
    const edited = (cells: string[]) =>
      withColumns(columnCount, cells).map((cell, i) => (i === cellIndex ? value : cell))

    if (rowIndex === -1) {
      onChange({ ...block, header: edited(block.header) })
      return
    }
    // Every row is squared to the current width on the way through, so a
    // ragged table arriving from a file cannot stay ragged once touched.
    onChange({
      ...block,
      rows: block.rows.map((row, i) => (i === rowIndex ? edited(row) : withColumns(columnCount, row))),
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {[block.header, ...block.rows].map((row, displayIndex) => {
            const rowIndex = displayIndex - 1
            return (
              <tr key={displayIndex}>
                {withColumns(columnCount, row).map((cell, cellIndex) => (
                  <td key={cellIndex} style={{ padding: 1 }}>
                    <input
                      aria-label={
                        rowIndex === -1
                          ? `En-tête ${cellIndex + 1} du tableau ${index + 1}`
                          : `Ligne ${rowIndex + 1} colonne ${cellIndex + 1} du tableau ${index + 1}`
                      }
                      value={cell}
                      onChange={event => setCell(rowIndex, cellIndex, event.target.value)}
                      style={{ ...FIELD_STYLE, fontSize: 13, fontWeight: rowIndex === -1 ? 600 : 400 }}
                    />
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          aria-label="Ajouter une ligne"
          onClick={() => onChange({ ...block, rows: [...block.rows, withColumns(columnCount, [])] })}
          style={{ fontSize: 12, padding: '2px 8px', cursor: 'pointer', background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'inherit' }}
        >
          + ligne
        </button>
        <button
          type="button"
          aria-label="Ajouter une colonne"
          onClick={() =>
            onChange({
              ...block,
              header: withColumns(columnCount + 1, block.header),
              rows: block.rows.map(row => withColumns(columnCount + 1, row)),
            })
          }
          style={{ fontSize: 12, padding: '2px 8px', cursor: 'pointer', background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'inherit' }}
        >
          + colonne
        </button>
      </div>
    </div>
  )
}
