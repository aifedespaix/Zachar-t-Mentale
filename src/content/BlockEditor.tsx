import { useState } from 'react'
import { Type, Sigma, Table2, Plus, Trash2, ImagePlus } from 'lucide-react'
import type { CardBlock, CardBlockKind } from '../types/cardBlock'
import { renderMathToHtml } from './renderMath'
import { MathFieldEditor } from './MathFieldEditor'

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
      return block.rows.map(row => row.join('\t')).join('\n')
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

  function append(block: CardBlock) {
    onChange([...blocks, block])
    setActiveIndex(blocks.length)
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }} onPaste={handlePaste}>
      {/* The selector sits in a row of its own, always present and always the
          same height, so revealing or changing it never moves the content
          below (règle anti-décalage 8). */}
      <div role="group" aria-label="Mode de saisie" style={{ display: 'flex', gap: 2 }}>
        {MODES.map(({ kind, icon: Icon, label }) => {
          const selected = active?.kind === kind
          return (
            <button
              key={kind}
              type="button"
              aria-label={label}
              aria-pressed={selected}
              onClick={() => {
                if (blocks.length === 0) onChange([convertBlock({ kind: 'text', text: '' }, kind)])
                else replace(activeIndex, convertBlock(blocks[activeIndex], kind))
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                padding: '2px 6px',
                fontSize: 11,
                borderRadius: 4,
                cursor: 'pointer',
                border: '1px solid var(--border)',
                background: selected ? 'var(--accent, rgba(0,0,0,0.08))' : 'transparent',
                color: 'inherit',
              }}
            >
              <Icon size={12} />
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
              gap: 3,
              padding: '2px 6px',
              fontSize: 11,
              borderRadius: 4,
              cursor: 'pointer',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'inherit',
            }}
          >
            <ImagePlus size={12} />
            Image
          </button>
        )}
      </div>

      {blocks.map((block, index) => (
        <div key={index} style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }} onFocus={() => setActiveIndex(index)}>
            <BlockField
              block={block}
              index={index}
              resolveAsset={resolveAsset}
              onChange={next => replace(index, next)}
            />
          </div>
          {blocks.length > 1 && (
            <button
              type="button"
              aria-label={`Supprimer le bloc ${index + 1}`}
              onClick={() => removeAt(index)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, padding: 2 }}
            >
              <Trash2 size={12} />
            </button>
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
          gap: 4,
          padding: '2px 0',
          fontSize: 11,
          opacity: 0.55,
          border: '1px dashed var(--border)',
          borderRadius: 4,
          background: 'none',
          color: 'inherit',
          cursor: 'pointer',
        }}
      >
        <Plus size={12} />
      </button>
    </div>
  )
}

interface BlockFieldProps {
  block: CardBlock
  index: number
  resolveAsset: (asset: string) => string
  onChange: (block: CardBlock) => void
}

const FIELD_STYLE = {
  width: '100%',
  boxSizing: 'border-box' as const,
  font: 'inherit',
  fontSize: 13,
  padding: '2px 4px',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'inherit',
}

function BlockField({ block, index, resolveAsset, onChange }: BlockFieldProps) {
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
          style={{ ...FIELD_STYLE, minHeight: 48, resize: 'vertical' }}
        />
      )

    case 'math':
      return (
        <div>
          {/* WYSIWYG when MathLive is available, the raw LaTeX field until
              then — and permanently if it never loads. Both edit the same
              string, so neither is a dead end: someone who knows LaTeX can
              still type it, and someone who does not never has to. */}
          <MathFieldEditor
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
                style={{ ...FIELD_STYLE, minHeight: 34, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
              />
            }
          />
          {/* Live preview, rendered synchronously so it cannot reflow after
              paint. It is what makes raw LaTeX usable at all until MathLive
              lands on top of this same block. */}
          <div
            data-testid={`math-preview-${index}`}
            style={{ minHeight: 24, padding: '2px 0', overflowX: 'auto' }}
            dangerouslySetInnerHTML={{ __html: renderMathToHtml(block.latex, false) }}
          />
        </div>
      )

    case 'image': {
      const src = resolveAsset(block.asset)
      return (
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          {src !== '' && (
            <img
              src={src}
              alt={block.alt}
              width={block.width}
              height={block.height}
              style={{ aspectRatio: `${block.width} / ${block.height}`, width: 64, height: 'auto', borderRadius: 4 }}
            />
          )}
          <input
            aria-label={`Description de l’image du bloc ${index + 1}`}
            placeholder="Décrire l’image"
            value={block.alt}
            onChange={event => onChange({ ...block, alt: event.target.value })}
            style={FIELD_STYLE}
          />
        </div>
      )
    }

    case 'table':
      return (
        <TableField block={block} index={index} onChange={onChange} />
      )
  }
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
                      style={{ ...FIELD_STYLE, fontSize: 12, fontWeight: rowIndex === -1 ? 600 : 400 }}
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
          style={{ fontSize: 11, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'inherit' }}
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
          style={{ fontSize: 11, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'inherit' }}
        >
          + colonne
        </button>
      </div>
    </div>
  )
}
