import { describe, it, expect } from 'vitest'
import { buildLengthGuide } from './lengthGuide'

describe('buildLengthGuide', () => {
  it('masks every letter and keeps spaces visible', () => {
    expect(buildLengthGuide('Chat')).toBe('____')
    expect(buildLengthGuide('La photosynthèse')).toBe('__ _____________')
  })

  it('masks decimal digits but keeps exponents, operators and punctuation visible', () => {
    // (A+B)² = A² + 2AB + B² : letters and the plain digit "2" are hidden,
    // parentheses/operators/"=" and the superscript "²" (not a decimal digit
    // in Unicode) stay visible so (A+B)² reads differently from (A-B)².
    expect(buildLengthGuide('(A+B)²=A²+2AB+B²')).toBe('(_+_)²=_²+___+_²')
  })
})
