import type { CardBlock } from '../types/cardBlock'
import { renderMathToHtml } from './renderMath'

export interface BlockViewProps {
  blocks: CardBlock[]
  /**
   * How an image block's `asset` name becomes a usable `src`.
   *
   * This parameter is the whole point of the component. On screen it is
   * `convertFileSrc`; in the export it is a lookup into a map of data URIs,
   * because `html-to-image` cannot re-encode a cross-origin image and rejects
   * the ENTIRE page capture when it meets one (see the spike's résultat 3).
   * Returning `''` means "not available", and renders a named placeholder.
   */
  resolveAsset: (asset: string) => string
}

/**
 * The single read-only renderer for card content, shared by the definition
 * popover and the export's `StaticCardView`.
 *
 * Sharing it is not DRY for its own sake: it is what guarantees the PDF looks
 * like the screen. Two renderers would drift the first time one of them gained
 * a style the other did not, and the drift would only ever be discovered by a
 * user printing a revision sheet the night before a test.
 */
export function BlockView({ blocks, resolveAsset }: BlockViewProps) {
  if (blocks.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {blocks.map((block, index) => (
        // Blocks have no stable identity of their own — they are a positional
        // list the user reorders wholesale — so the index is the honest key.
        <BlockItem key={index} block={block} resolveAsset={resolveAsset} />
      ))}
    </div>
  )
}

function BlockItem({ block, resolveAsset }: { block: CardBlock; resolveAsset: (asset: string) => string }) {
  switch (block.kind) {
    case 'text':
      // `pre-wrap`, not a set of <p>: a definition's line breaks are the
      // user's own, and collapsing them would change what they wrote.
      return <div style={{ whiteSpace: 'pre-wrap' }}>{block.text}</div>

    case 'math': {
      const html = renderMathToHtml(block.latex, block.display === true)
      if (html === '') return null
      // Safe: KaTeX escapes the text it emits, and `trust: false` keeps it
      // from building links or embedding resources (see renderMath tests).
      return <div dangerouslySetInnerHTML={{ __html: html }} />
    }

    case 'image': {
      const src = resolveAsset(block.asset)
      if (src === '') {
        // Named, never a blank gap — the app's standing rule that no state is
        // hidden without explanation.
        return (
          <div
            style={{
              aspectRatio: `${block.width} / ${block.height}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px dashed currentColor',
              borderRadius: 4,
              opacity: 0.6,
              fontSize: '0.75em',
              padding: '0.5rem',
              textAlign: 'center',
            }}
          >
            Image introuvable : {block.asset}
          </div>
        )
      }
      return (
        <img
          src={src}
          alt={block.alt}
          width={block.width}
          height={block.height}
          // `aspectRatio` plus `height: auto` keeps the box reserved at the
          // right shape while still letting the image shrink to the container.
          // Without it the layout jumps the moment the file decodes.
          style={{ aspectRatio: `${block.width} / ${block.height}`, maxWidth: '100%', height: 'auto' }}
        />
      )
    }

    case 'table':
      return (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9em' }}>
          {block.header.length > 0 && (
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index} style={{ border: '1px solid currentColor', padding: '2px 6px', textAlign: 'left' }}>
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} style={{ border: '1px solid currentColor', padding: '2px 6px' }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
  }
}
