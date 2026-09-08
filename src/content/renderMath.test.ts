import { describe, it, expect } from 'vitest'
import { renderMathToHtml } from './renderMath'

describe('renderMathToHtml', () => {
  it('typesets a fraction as real markup, not the LaTeX source', () => {
    const html = renderMathToHtml('\\frac{20}{100} \\times 425 = 85', false)
    // KaTeX re-embeds the source in a MathML <annotation>, so asserting the
    // absence of "\\frac" would be wrong. What matters is that real fraction
    // markup was BUILT: an <mfrac> in the MathML and a .mfrac span in the HTML.
    expect(html).toContain('<mfrac>')
    expect(html).toContain('class="mfrac"')
  })

  it('never throws on invalid input — a half-typed formula must not tear the card down', () => {
    // The editor renders on every keystroke, so `\fra` exists as a real state.
    expect(() => renderMathToHtml('\\fra{1}{', false)).not.toThrow()
    expect(renderMathToHtml('\\fra{1}{', false)).toContain('katex')
  })

  it('renders chemistry through mhchem, which is why physics-chemistry costs no second dependency', () => {
    const html = renderMathToHtml('\\ce{2H2 + O2 -> 2H2O}', false)
    // Without mhchem, KaTeX would emit an "Undefined control sequence" error
    // node for \ce. Expansion is proved by the reaction arrow and the
    // subscripted atoms it builds.
    expect(html).not.toContain('Undefined control sequence')
    expect(html).toContain('x-arrow')
    expect(html).toContain('mathrm">H')
  })

  it('renders physics units through \\pu, same extension', () => {
    expect(() => renderMathToHtml('\\pu{9.81 m/s^2}', false)).not.toThrow()
  })

  it('marks display mode differently from inline mode', () => {
    const inline = renderMathToHtml('x^2', false)
    const display = renderMathToHtml('x^2', true)
    expect(display).not.toBe(inline)
    expect(display).toContain('katex-display')
  })

  it('escapes HTML in the source rather than emitting it', () => {
    // The LaTeX is user input and the output goes through
    // dangerouslySetInnerHTML, so this is the injection boundary. Assert on the
    // PARSED result, not on substrings: the harmless escaped text
    // "onerror=alert(1)" does legitimately appear inside an <mtext>, and a
    // substring check would either miss a real tag or fail on safe text.
    const host = document.createElement('div')
    host.innerHTML = renderMathToHtml('\\text{<img src=x onerror=alert(1)>}', false)
    expect(host.querySelectorAll('img')).toHaveLength(0)
    expect(host.querySelector('[onerror]')).toBeNull()
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('does not emit a link element for \\href, since trust is off', () => {
    const host = document.createElement('div')
    host.innerHTML = renderMathToHtml('\\href{javascript:alert(1)}{clic}', false)
    expect(host.querySelectorAll('a')).toHaveLength(0)
  })

  it('is empty for an empty formula, so the renderer can skip it', () => {
    expect(renderMathToHtml('   ', false)).toBe('')
  })
})
