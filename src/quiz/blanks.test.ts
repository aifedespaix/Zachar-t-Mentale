import { describe, it, expect } from 'vitest'
import {
  slotsOf,
  fillableIndices,
  revealOrder,
  baseRevealCount,
  revealedSet,
  isFullyRevealed,
  editableIndices,
  assembleAnswer,
  matchesTarget,
  remapTyped,
} from './blanks'

/** Renders a target the way the field draws it, for readable assertions. */
function mask(target: string, revealed: ReadonlySet<number>): string {
  return slotsOf(target)
    .map(slot => (slot.fillable && !revealed.has(slot.index) ? '_' : slot.char))
    .join('')
}

describe('slotsOf', () => {
  it('marks letters and digits fillable, and structure not', () => {
    expect(slotsOf("l'an 2").map(s => s.fillable)).toEqual([true, false, true, true, false, true])
  })

  it('leaves superscripts visible — they are notation, not a letter to find', () => {
    const slots = slotsOf('x²')
    expect(slots.map(s => s.fillable)).toEqual([true, false])
  })
})

describe('fillableIndices', () => {
  it('returns only the positions the user has to find', () => {
    expect(fillableIndices('a b-c')).toEqual([0, 2, 4])
  })

  it('is empty for a target with nothing to guess', () => {
    expect(fillableIndices('+ -')).toEqual([])
  })
})

describe('revealOrder', () => {
  it('always offers the first letter first', () => {
    expect(revealOrder('Bonsoir')[0]).toBe(0)
  })

  it('spreads help across the answer instead of unveiling one end', () => {
    // After the first letter, the furthest position is the last one, then the
    // middle — so three letters of help already frame the whole word.
    expect(revealOrder('Bonsoir').slice(0, 3)).toEqual([0, 6, 3])
  })

  it('skips non-fillable positions entirely', () => {
    expect(revealOrder('a b').sort()).toEqual([0, 2])
  })

  it('is deterministic — the same target always reveals in the same order', () => {
    expect(revealOrder('Photosynthèse')).toEqual(revealOrder('Photosynthèse'))
  })

  it('eventually covers every fillable position', () => {
    expect([...revealOrder('Bonsoir')].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('returns nothing when there is nothing to guess', () => {
    expect(revealOrder('+ -')).toEqual([])
  })
})

describe('baseRevealCount', () => {
  it('gives away half the letters on facile', () => {
    expect(baseRevealCount('Bonsoir', 'facile')).toBe(4)
  })

  it('gives away a quarter on moyen', () => {
    expect(baseRevealCount('Bonsoir', 'moyen')).toBe(2)
  })

  it('concedes only the first letter on difficile', () => {
    expect(baseRevealCount('Bonsoir', 'difficile')).toBe(1)
  })

  it('never promises more letters than the answer has', () => {
    expect(baseRevealCount('a', 'facile')).toBe(1)
  })

  it('is zero when there is nothing to guess', () => {
    expect(baseRevealCount('+ -', 'facile')).toBe(0)
  })
})

describe('revealedSet', () => {
  it('shows the first letter only on difficile', () => {
    expect(mask('Bonsoir', revealedSet('Bonsoir', 'difficile'))).toBe('B______')
  })

  it('shows a spread half of the letters on facile', () => {
    expect(mask('Bonsoir', revealedSet('Bonsoir', 'facile'))).toBe('Bo_s__r')
  })

  it('keeps spaces and punctuation visible so the answer keeps its shape', () => {
    expect(mask("Théorème de Pythagore", revealedSet('Théorème de Pythagore', 'difficile'))).toBe(
      'T_______ __ _________'
    )
  })

  it('hands over one more letter per failed attempt', () => {
    expect(mask('Bonsoir', revealedSet('Bonsoir', 'difficile', 1))).toBe('B_____r')
    expect(mask('Bonsoir', revealedSet('Bonsoir', 'difficile', 2))).toBe('B__s__r')
  })

  it('saturates at the full answer rather than overflowing', () => {
    expect(mask('Bonsoir', revealedSet('Bonsoir', 'difficile', 99))).toBe('Bonsoir')
  })

  it('treats a negative extra reveal count as no extra help', () => {
    expect(mask('Bonsoir', revealedSet('Bonsoir', 'difficile', -3))).toBe('B______')
  })
})

describe('isFullyRevealed', () => {
  it('is false while letters are still hidden', () => {
    expect(isFullyRevealed('Bonsoir', revealedSet('Bonsoir', 'facile'))).toBe(false)
  })

  it('is true once help has covered everything', () => {
    expect(isFullyRevealed('Bonsoir', revealedSet('Bonsoir', 'difficile', 99))).toBe(true)
  })

  it('is true when there was never anything to guess', () => {
    expect(isFullyRevealed('+ -', new Set())).toBe(true)
  })
})

describe('editableIndices', () => {
  it('excludes both structure and already-revealed letters', () => {
    expect(editableIndices('Bonsoir', revealedSet('Bonsoir', 'difficile'))).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('is empty once everything is revealed', () => {
    expect(editableIndices('Bonsoir', revealedSet('Bonsoir', 'difficile', 99))).toEqual([])
  })
})

describe('assembleAnswer', () => {
  const revealed = revealedSet('Bonsoir', 'difficile')

  it('weaves typed letters into the revealed structure', () => {
    expect(assembleAnswer('Bonsoir', revealed, ['o', 'n', 's', 'o', 'i', 'r'])).toBe('Bonsoir')
  })

  it('keeps spaces and punctuation from the target, never from the user', () => {
    const spaced = revealedSet('le mot', 'difficile')
    expect(assembleAnswer('le mot', spaced, ['e', 'm', 'o', 't'])).toBe('le mot')
  })

  it('leaves unfilled boxes empty so a partial answer scores as incomplete', () => {
    expect(assembleAnswer('Bonsoir', revealed, ['o', 'n'])).toBe('Bon')
  })

  it('ignores typed characters past the last editable box', () => {
    expect(assembleAnswer('Bonsoir', revealed, ['o', 'n', 's', 'o', 'i', 'r', 'z'])).toBe('Bonsoir')
  })

  it('returns the target untouched when nothing was ever hidden', () => {
    expect(assembleAnswer('Bonsoir', revealedSet('Bonsoir', 'difficile', 99), [])).toBe('Bonsoir')
  })
})

describe('matchesTarget', () => {
  it('ignores case', () => {
    expect(matchesTarget('b', 'B')).toBe(true)
  })

  it('ignores accents, so a missing accent is not scored as a wrong letter', () => {
    expect(matchesTarget('e', 'è')).toBe(true)
  })

  it('rejects a genuinely different letter', () => {
    expect(matchesTarget('a', 'b')).toBe(false)
  })
})

describe('remapTyped', () => {
  const target = 'Bonsoir'
  const before = revealedSet(target, 'difficile') // "B______"
  const after = revealedSet(target, 'difficile', 1) // "B_____r"

  it('keeps the letters the user already typed at the positions they belong to', () => {
    expect(remapTyped(target, before, ['o', 'n', 'j', 'o', 'u', 'r'], after)).toEqual(['o', 'n', 'j', 'o', 'u'])
  })

  it('drops only the letter the app has just filled in', () => {
    // Index 6 ("r") became revealed, so its box is gone; nothing else moves.
    expect(remapTyped(target, before, ['o', 'n', 's', 'o', 'i', 'r'], after)).toEqual(['o', 'n', 's', 'o', 'i'])
  })

  it('carries a partial answer without inventing empty boxes at the end', () => {
    expect(remapTyped(target, before, ['o', 'n'], after)).toEqual(['o', 'n'])
  })

  it('stays dense when the revealed letter sat in the middle of what was typed', () => {
    const mid = new Set([0, 2])
    expect(remapTyped(target, before, ['o', 'n', 's'], mid)).toEqual(['o', 's'])
  })

  it('returns nothing when the answer is now fully revealed', () => {
    expect(remapTyped(target, before, ['o', 'n', 's'], revealedSet(target, 'difficile', 99))).toEqual([])
  })
})
