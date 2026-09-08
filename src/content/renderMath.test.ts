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
    // Asserting the ABSENCE of an error message proves nothing: without
    // mhchem, `throwOnError: false` renders an unknown command as red text,
    // never as that message. These two go false without mhchem.
    expect(html).toContain('x-arrow')
    expect(html).toContain('mathrm">H')
  })

  it('renders physics units through \\pu, same extension', () => {
    // `not.toThrow()` proved nothing — an unknown command does not throw
    // either. mhchem's \pu builds a real unit group with a thin space.
    const html = renderMathToHtml('\\pu{9.81 m/s^2}', false)
    expect(html).toContain('mathrm">m')
    expect(html).not.toContain('#cc0000')
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

  describe('inputs that could reach it from a shared file', () => {
    it('does not throw on deep nesting — a RangeError here would tear down the canvas', () => {
      // `throwOnError: false` covers ParseError ONLY; KaTeX rethrows the rest,
      // and this runs inside React's render.
      const deep = '\\sqrt{'.repeat(2000) + 'a' + '}'.repeat(2000)
      expect(() => renderMathToHtml(deep, false)).not.toThrow()
      expect(renderMathToHtml(deep, false)).toContain('katex-fallback')
    })

    it('does not throw on unbalanced braces at depth', () => {
      const bombe = '{'.repeat(20000) + 'a' + '}'.repeat(20000)
      expect(() => renderMathToHtml(bombe, false)).not.toThrow()
    })

    it('refuses to typeset an absurdly long formula instead of freezing', () => {
      // Measured before the cap: 100k chars took 22s and produced 32MB of
      // markup, synchronously, during commit.
      const long = 'x+'.repeat(50000) + '1'
      const started = Date.now()
      const html = renderMathToHtml(long, false)
      expect(Date.now() - started).toBeLessThan(500)
      expect(html).toContain('katex-fallback')
      expect(html).toContain('trop longue')
    })

    it('shows the source rather than a blank gap when it cannot typeset', () => {
      const html = renderMathToHtml('y'.repeat(6000), false)
      expect(html).toContain('yyy')
    })

    it('clamps sizes so one formula cannot blow the card out of shape', () => {
      // Assert on the STYLES, not on substrings: KaTeX echoes the source
      // verbatim inside a MathML <annotation>, so "99999em" legitimately
      // appears in the output while the rendered box is clamped to 10em.
      const styles = (latex: string) => {
        const host = document.createElement('div')
        host.innerHTML = renderMathToHtml(latex, false)
        return [...host.querySelectorAll<HTMLElement>('[style]')].map(el => el.getAttribute('style')!)
      }
      // Compare VALUES, not digit counts: a naive /\d{4,}em/ matches the
      // "4306" inside a perfectly ordinary "0.4306em".
      const emLengths = (latex: string) =>
        styles(latex).flatMap(style => [...style.matchAll(/([\d.]+)em/g)].map(match => parseFloat(match[1])))
      expect(Math.max(...emLengths('\\rule{99999em}{99999em}'))).toBeLessThanOrEqual(10)
      expect(Math.max(...emLengths('\\kern99999em x'))).toBeLessThanOrEqual(10)
    })

    it('honours trust:false for every element-producing command', () => {
      // `trust`, not `strict`, is the load-bearing setting. Each of these
      // renders as red error text; the source text still echoes inside the
      // MathML <annotation>, which is inert — so assert on the DOM, never on
      // substrings of the markup.
      const host = document.createElement('div')
      for (const source of [
        '\\htmlStyle{position:fixed;inset:0}{x}',
        '\\htmlId{cible}{x}',
        '\\htmlData{a=b}{x}',
        '\\htmlClass{intrus}{x}',
        '\\includegraphics{x.png}',
        '\\url{javascript:alert(1)}',
      ]) {
        host.innerHTML = renderMathToHtml(source, false)
        expect(host.querySelectorAll('a, img, iframe, object, script')).toHaveLength(0)
        expect(host.querySelector('#cible')).toBeNull()
        expect(host.querySelector('.intrus')).toBeNull()
        const applied = [...host.querySelectorAll<HTMLElement>('[style]')].map(el => el.style.position)
        expect(applied).not.toContain('fixed')
      }
    })
  })
})
