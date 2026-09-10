import { describe, it, expect } from 'vitest'
import type { Card } from '../types/card'
import {
  branchToText,
  childrenOf,
  duplicateCard,
  extractBranch,
  pasteBranch,
  siblingIndexOf,
  siblingsOf,
} from './cardsReducer'

function card(partial: Partial<Card> & { id: string; level: Card['level'] }): Card {
  return { title: partial.id, parentId: null, order: 0, ...partial }
}

/**
 *   racine
 *     ├─ a  (« def a »)
 *     │    └─ a1
 *     └─ b
 */
function tree(): Card[] {
  return [
    card({ id: 'racine', level: 1, title: 'Racine' }),
    card({ id: 'a', level: 2, title: 'A', definition: 'def a', parentId: 'racine', order: 0 }),
    card({ id: 'a1', level: 3, title: 'A1', parentId: 'a', order: 0 }),
    card({ id: 'b', level: 2, title: 'B', parentId: 'racine', order: 1 }),
  ]
}

describe('extractBranch', () => {
  it('takes the card and its descendants, and nothing else', () => {
    const branch = extractBranch(tree(), 'a')!
    expect(branch.rootId).toBe('a')
    expect(branch.cards.map(c => c.id)).toEqual(['a', 'a1'])
  })

  it('is a deep copy, so editing the original afterwards changes nothing', () => {
    const cards = tree()
    const branch = extractBranch(cards, 'a')!
    cards[1].title = 'renommé après la copie'
    expect(branch.cards[0].title).toBe('A')
  })

  it('returns null for a card that is not there', () => {
    expect(extractBranch(tree(), 'inconnue')).toBeNull()
  })
})

describe('pasteBranch', () => {
  it('issues fresh ids, so a branch can be pasted into the map it came from', () => {
    const cards = tree()
    const branch = extractBranch(cards, 'a')!
    const { cards: next, newCardId } = pasteBranch(cards, branch, 'b')

    expect(next).toHaveLength(6)
    expect(newCardId).not.toBe('a')
    expect(new Set(next.map(c => c.id)).size).toBe(next.length)
    // The copy is complete — the branch, not just its root.
    expect(childrenOf(next, newCardId)).toHaveLength(1)
  })

  it('re-levels the copy from its new parent', () => {
    const cards = tree()
    const branch = extractBranch(cards, 'a')!
    const { cards: next, newCardId } = pasteBranch(cards, branch, 'b')
    const pasted = next.find(c => c.id === newCardId)!
    expect(pasted.level).toBe(3)
    expect(childrenOf(next, newCardId)[0].level).toBe(4)
  })

  it('carries the content across, not just the titles', () => {
    const cards = tree()
    const branch = extractBranch(cards, 'a')!
    const { cards: next, newCardId } = pasteBranch(cards, branch, 'b')
    expect(next.find(c => c.id === newCardId)!.definition).toBe('def a')
  })

  it('lands at the index it is given, among its new siblings', () => {
    const cards = tree()
    const branch = extractBranch(cards, 'b')!
    const { cards: next, newCardId } = pasteBranch(cards, branch, 'racine', 0)
    expect(siblingsOf(next, newCardId).map(c => c.id)).toEqual([newCardId, 'a', 'b'])
  })

  it('keeps what falls past level 4 as floating cards rather than dropping it', () => {
    // Silently losing half a pasted branch would be the worst possible answer
    // to "the map only has four levels".
    const cards = tree()
    const branch = extractBranch(cards, 'a')!
    const { cards: next, detachedIds } = pasteBranch(cards, branch, 'a1')
    expect(detachedIds).toHaveLength(1)
    const detached = next.filter(c => c.detached)
    expect(detached).toHaveLength(1)
    // Nothing is lost: two cards in, two cards out.
    expect(next).toHaveLength(6)
  })

  it('flattens the branch when it is pasted into the floating zone', () => {
    // Floating cards may never have children — that is what makes the zone a
    // scratch area rather than a second tree.
    const cards = tree()
    const branch = extractBranch(cards, 'a')!
    const { cards: next } = pasteBranch(cards, branch, null)
    const pasted = next.filter(c => c.detached)
    expect(pasted).toHaveLength(2)
    expect(pasted.every(c => c.parentId === null)).toBe(true)
  })

  it('refuses a parent that cannot take children, rather than corrupting the tree', () => {
    const cards = [...tree(), card({ id: 'volante', level: 1, detached: true, order: 0 })]
    const branch = extractBranch(cards, 'b')!
    expect(() => pasteBranch(cards, branch, 'volante')).toThrow(/detached/)
    expect(() => pasteBranch(cards, branch, 'inconnue')).toThrow(/not found/)
  })
})

describe('duplicateCard', () => {
  it('puts the copy right after the original, among the same siblings', () => {
    const cards = tree()
    const { cards: next, newCardId } = duplicateCard(cards, 'a')
    expect(siblingsOf(next, 'a').map(c => c.id)).toEqual(['a', newCardId, 'b'])
    expect(next.find(c => c.id === newCardId)!.level).toBe(2)
  })

  it('copies the whole branch, not only the card', () => {
    const { cards: next, newCardId } = duplicateCard(tree(), 'a')
    expect(childrenOf(next, newCardId).map(c => c.title)).toEqual(['A1'])
  })

  it('duplicates a floating card as another floating card', () => {
    const cards = [...tree(), card({ id: 'volante', level: 1, title: 'V', detached: true, order: 0 })]
    const { cards: next, newCardId } = duplicateCard(cards, 'volante')
    expect(next.find(c => c.id === newCardId)!.detached).toBe(true)
  })

  it('refuses the root, which must stay the only one', () => {
    expect(() => duplicateCard(tree(), 'racine')).toThrow(/root/)
  })
})

describe('branchToText', () => {
  it('writes the branch as an indented outline, definitions included', () => {
    expect(branchToText(tree(), 'racine')).toBe(
      ['- Racine', '  - A', '    def a', '    - A1', '  - B'].join('\n')
    )
  })

  it('starts from the card it is given, not from the root', () => {
    expect(branchToText(tree(), 'a')).toBe(['- A', '  def a', '  - A1'].join('\n'))
  })
})

describe('siblingIndexOf', () => {
  it('places a card inside its own group', () => {
    expect(siblingIndexOf(tree(), 'a')).toBe(0)
    expect(siblingIndexOf(tree(), 'b')).toBe(1)
    expect(siblingIndexOf(tree(), 'inconnue')).toBe(-1)
  })
})
