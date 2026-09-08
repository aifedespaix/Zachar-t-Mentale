import { describe, it, expect } from 'vitest'
import { latexToPlainText, normalizeContent, contentOf, blocksToPlainText } from './blocks'
import type { CardBlock } from '../types/cardBlock'

const L = latexToPlainText
describe('probe', () => {
  it('latex', () => {
    const cases = [
      '\\frac{20}{100} \\times 425',
      '\\frac{\\frac{a}{b}}{c}',
      '\\frac{1}{2}\\frac{3}{4}',
      '\\frac{a+b}{c}',
      'x^',
      'x^{',
      'x^{2x}',
      'x^{10}',
      '2^{n+1}',
      '\\top',
      '\\longrightarrow',
      '\\leqslant',
      '\\divideontimes',
      'a \\\\ b',
      '\\begin{cases} x \\\\ y \\end{cases}',
      'ligne1\nligne2',
      '\\text{Aire} = c \\times c',
      '\\ce{2H2 + O2 -> 2H2O}',
      '\\oint_C \\vec{F}',
      '{}{}{}',
      '\\frac{}{}',
      '\\sqrt{\\frac{1}{2}}',
      '\\pi r^2',
      '\\times\\to',
      'a^b',
      '^2',
    ]
    for (const c of cases) console.log(JSON.stringify(c), '=>', JSON.stringify(L(c)))
    expect(true).toBe(true)
  })

  it('backtracking / perf', () => {
    const evil = '\\frac{'.repeat(2000) + 'a' + '}{b}'.repeat(2000)
    const t0 = Date.now()
    const r = L(evil)
    console.log('nested 2000 frac ms=', Date.now() - t0, 'len=', r.length, 'head=', r.slice(0, 40))
    const evil2 = '\\frac{a}{b} '.repeat(20000)
    const t1 = Date.now()
    L(evil2)
    console.log('20000 adjacent frac ms=', Date.now() - t1)
    const evil3 = '\\sqrt{' + 'a'.repeat(100000) + '}'
    const t2 = Date.now()
    L(evil3)
    console.log('huge sqrt ms=', Date.now() - t2)
    expect(true).toBe(true)
  })

  it('normalize / aliasing', () => {
    const blocks: CardBlock[] = [{ kind: 'math', latex: 'x^2' }]
    const n = normalizeContent(blocks)
    console.log('same array ref?', n.content === blocks)
    console.log('same block ref?', n.content?.[0] === blocks[0])
    console.log('multi text ->', JSON.stringify(normalizeContent([{kind:'text',text:'a'},{kind:'text',text:'b'}])))
    console.log('ws text ->', JSON.stringify(normalizeContent([{kind:'text',text:'  hello  '}])))
    console.log('empty ->', JSON.stringify(normalizeContent([])))
    console.log('image only ->', JSON.stringify(normalizeContent([{kind:'image',asset:'a.png',alt:'',width:1,height:1}])))
    // NaN dims
    console.log('nan image ->', JSON.stringify(normalizeContent([{kind:'image',asset:'a.png',alt:'x',width:NaN,height:NaN}])))
  })

  it('contentOf degradation', () => {
    const base = { id: 'a', level: 2 as const, title: 'T', parentId: 'r', order: 0 }
    const weird: any = { ...base, content: [
      { kind: 'music', abc: 'X:1', title: 'Gamme' },
      null,
      ['a','b'],
      42,
      { kind: 'image', alt: 'no asset' },
      { kind: 'table', header: ['h'], rows: [['a']] },
      { kind: 'text' },
    ] }
    const before = JSON.stringify(weird)
    const out = contentOf(weird)
    console.log('contentOf =>', JSON.stringify(out))
    console.log('input mutated?', JSON.stringify(weird) !== before)
    const tbl: any = { ...base, content: [{ kind: 'table', header: ['h'], rows: [['a']] }] }
    const got = contentOf(tbl)[0] as any
    console.log('table rows aliased?', got.rows === tbl.content[0].rows, 'header aliased?', got.header === tbl.content[0].header)
    // ordering of unknown-kind join
    const ordered: any = { ...base, content: [{ b: 'bee', kind: 'zzz', a: 'ay', '2': 'two', '1': 'one' }] }
    console.log('unknown join =>', JSON.stringify(contentOf(ordered)))
    // definition-only legacy
    console.log('legacy =>', JSON.stringify(contentOf({ ...base, definition: 'Règle' } as any)))
    console.log('empty def =>', JSON.stringify(contentOf({ ...base, definition: '' } as any)))
    console.log('content:[] =>', JSON.stringify(contentOf({ ...base, content: [], definition: 'x' } as any)))
  })

  it('divergence: content present but definition stale via contentOf', () => {
    const card: any = { id:'a', level:2, title:'T', parentId:'r', order:0,
      content: [{ kind:'music', abc:'X:1' }], definition: '[partition]' }
    console.log('displayed:', JSON.stringify(blocksToPlainText(contentOf(card))), 'definition:', JSON.stringify(card.definition))
  })
})
