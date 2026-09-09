import { memo } from 'react'
import type { CardBlock } from '../types/cardBlock'
import { renderMathToHtml } from './renderMath'
import { renderHighlighted, stripHighlightMarkers } from './highlight'

/**
 * Dimensions good enough to reserve a box with.
 *
 * `aspect-ratio: 0 / 0`, `NaN / NaN`, `-5 / 10` and `Infinity / 1` are all
 * invalid values the CSS parser drops — leaving `height: auto` with nothing to
 * derive from, so the box collapses to zero and jumps to full size the instant
 * the file decodes. That is the exact reflow the reserved box exists to
 * prevent, and the data can arrive from a shared `.json`, so the renderer
 * checks rather than trusts.
 */
function usableRatio(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
}

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
  /**
   * Whether a `**mot-clé**` marker renders as a coloured `<mark>` (the
   * reading panel) or is silently stripped to plain text (every quiz-facing
   * render — see `highlight.tsx`). Defaults to `true`.
   */
  highlightKeywords?: boolean
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
export function BlockView({ blocks, resolveAsset, highlightKeywords = true }: BlockViewProps) {
  if (blocks.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {blocks.map((block, index) => (
        // Blocks have no stable identity of their own — they are a positional
        // list the user reorders wholesale — so the index is the honest key.
        //
        // The horizontal scroll container is here, in the SHARED renderer, not
        // in the popover: KaTeX display math sets `white-space: nowrap` and
        // ships no scroller of its own, and a wide table would otherwise blow
        // the popover's fixed width apart. Fixing it only on one side is the
        // screen/PDF drift this component exists to prevent.
        <div key={index} style={{ maxWidth: '100%', overflowX: 'auto' }}>
          <BlockItem block={block} resolveAsset={resolveAsset} highlightKeywords={highlightKeywords} />
        </div>
      ))}
    </div>
  )
}

const BlockItem = memo(function BlockItem({
  block,
  resolveAsset,
  highlightKeywords,
}: {
  block: CardBlock
  resolveAsset: (asset: string) => string
  highlightKeywords: boolean
}) {
  switch (block.kind) {
    case 'text':
      // `pre-wrap`, not a set of <p>: a definition's line breaks are the
      // user's own, and collapsing them would change what they wrote.
      return (
        <div style={{ whiteSpace: 'pre-wrap' }}>
          {highlightKeywords ? renderHighlighted(block.text) : stripHighlightMarkers(block.text)}
        </div>
      )

    case 'math': {
      const html = renderMathToHtml(block.latex, block.display === true)
      if (html === '') return null
      // Safe: KaTeX escapes the text it emits, and `trust: false` keeps it
      // from building links or embedding resources (see renderMath tests).
      return <div dangerouslySetInnerHTML={{ __html: html }} />
    }

    case 'image': {
      const src = resolveAsset(block.asset)
      const ratio = usableRatio(block.width, block.height)
      if (src === '') {
        // Named, never a blank gap — the app's standing rule that no state is
        // hidden without explanation.
        return (
          <div
            style={{
              // Same box the resolved <img> will take, or the day an asset
              // becomes loadable after first paint the placeholder's
              // full-width stretch jumps down to the image's own width.
              width: ratio ? block.width : undefined,
              maxWidth: '100%',
              aspectRatio: ratio ? `${block.width} / ${block.height}` : undefined,
              minHeight: ratio ? undefined : '2.5rem',
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
          style={{
            aspectRatio: ratio ? `${block.width} / ${block.height}` : undefined,
            maxWidth: '100%',
            height: 'auto',
            // Keeps a thumbnailed export card from squashing the picture when
            // a parent caps the height while the width attribute stays
            // definite (see the export's card-height cap).
            objectFit: 'contain',
          }}
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
})
