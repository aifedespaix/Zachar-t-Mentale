import katex from 'katex'
// mhchem registers `\ce` and `\pu` on the katex instance imported above, as a
// side effect. It is why maths, chemistry and physics units are covered by a
// single dependency — and it must be imported AFTER katex itself.
import 'katex/contrib/mhchem'

/**
 * Beyond this, a formula is not typeset at all.
 *
 * KaTeX is synchronous and unbounded: measured, `'x+'.repeat(100000)` takes
 * 22 seconds and emits 32 MB of markup. Since this runs during React's commit,
 * that is a frozen window, and the input can arrive from a shared `.json`
 * rather than from the keyboard. No real collège formula comes near this.
 */
const MAX_LATEX_LENGTH = 5000

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Shown in place of typesetting, so a formula that cannot render is never a blank gap. */
function fallbackMarkup(latex: string, reason: string): string {
  return `<code class="katex-fallback" title="${escapeHtml(reason)}" style="white-space:pre-wrap;word-break:break-word">${escapeHtml(latex)}</code>`
}

/**
 * A LaTeX formula as KaTeX markup.
 *
 * Four deliberate choices:
 *
 * - **`throwOnError: false` AND a try/catch.** The flag alone is not enough:
 *   KaTeX honours it only for `ParseError`, and rethrows everything else —
 *   deep nesting (`'\\sqrt{'.repeat(2000)`) raises a `RangeError` that would
 *   escape into React's render and tear the whole canvas down through the
 *   error boundary, closing the user's file.
 * - **A length cap.** See `MAX_LATEX_LENGTH`.
 * - **`maxSize: 10`.** KaTeX defaults to `Infinity`, which lets
 *   `\rule{99999em}{99999em}` or `\kern99999em` emit those lengths as inline
 *   styles — enough for one formula to blow the card and the popover out of
 *   shape, defeating the design's own anti-layout-shift rules from inside the
 *   content.
 * - **Synchronous.** KaTeX renders during React's commit, so a formula never
 *   repaints after layout. An async engine (MathJax, Mermaid) would reflow
 *   after paint, which the design rules out explicitly.
 *
 * The output is injected with `dangerouslySetInnerHTML`. That is safe because
 * KaTeX escapes the text it emits and, with `trust: false`, refuses to build
 * links, embed resources, or honour `\html*` — the load-bearing setting is
 * `trust`, NOT `strict` (which only controls cosmetic warnings).
 */
export function renderMathToHtml(latex: string, display: boolean): string {
  if (latex.trim() === '') return ''
  if (latex.length > MAX_LATEX_LENGTH) {
    return fallbackMarkup(latex.slice(0, 200) + '…', 'Formule trop longue pour être affichée')
  }
  try {
    return katex.renderToString(latex, {
      displayMode: display,
      throwOnError: false,
      trust: false,
      strict: false,
      maxSize: 10,
    })
  } catch (error) {
    // Never propagates: this runs inside render.
    return fallbackMarkup(latex, error instanceof Error ? error.message : 'Formule illisible')
  }
}
