import katex from 'katex'
// mhchem registers `\ce` and `\pu` on the katex instance imported above, as a
// side effect. It is why maths, chemistry and physics units are covered by a
// single dependency — and it must be imported AFTER katex itself.
import 'katex/contrib/mhchem'

/**
 * A LaTeX formula as KaTeX markup.
 *
 * Two deliberate choices:
 *
 * - **`throwOnError: false`.** The editor re-renders on every keystroke, so
 *   `\fra` and `\frac{1}{` are real intermediate states, not corrupt data. A
 *   throw here would unmount the card mid-edit; KaTeX's own error markup
 *   (the formula in red) is the right feedback instead.
 * - **Synchronous.** KaTeX renders during React's commit, so a formula never
 *   repaints after layout. That is what keeps the card and the popover from
 *   jumping — an async engine (MathJax, Mermaid) would reflow after paint,
 *   which the design rules out explicitly.
 *
 * The output is injected with `dangerouslySetInnerHTML`. That is safe because
 * KaTeX escapes the text it emits (see the injection test), and it is the only
 * way to hand React the markup KaTeX builds.
 */
export function renderMathToHtml(latex: string, display: boolean): string {
  if (latex.trim() === '') return ''
  return katex.renderToString(latex, {
    displayMode: display,
    throwOnError: false,
    // `\ce` and friends are macros KaTeX does not know natively; trusting the
    // input is not required for them, and staying untrusted keeps `\url` and
    // `\includegraphics` disabled.
    trust: false,
    strict: false,
  })
}
