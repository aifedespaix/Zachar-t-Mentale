import { describe, it, expect } from 'vitest'
import { CARD_WIDTH, COLUMN_PITCH_RATIO, COLUMN_WIDTH, ROW_HEIGHT } from './cardGeometry'

// The card's real height: 4 title lines + the centred action row + the minimal
// top and bottom paddings. Kept here rather than in the module because nothing
// in the layout depends on it — only this test, which is exactly the point.
const CARD_HEIGHT = 144

/**
 * The two pitches of the tree grid are DERIVED from the card's own box, and
 * these tests are what keeps them derived.
 *
 * The failure they pin down: the gutter between two columns used to be an
 * absolute 120px, which happened to read well against a 200px card. Widening
 * the card to 300px without touching it silently changed the proportion from
 * 0.6 to 0.4, and the columns started to look glued together.
 */
describe('card geometry', () => {
  it('derives the column pitch from the card width, so the gutter cannot shrink relative to the card', () => {
    expect(COLUMN_WIDTH).toBe(CARD_WIDTH * COLUMN_PITCH_RATIO)
    // The gutter still has to clear the "add a child" button that straddles the
    // card's right edge by 0.85rem — the only hard constraint, and the
    // proportional gutter is far above it.
    expect(COLUMN_WIDTH - CARD_WIDTH).toBeGreaterThan(2 * 13.6)
  })

  it('keeps the gutter proportional rather than absolute', () => {
    // 1.6 is the ratio the map has always used (320 / 200) and sits within 1%
    // of the golden ratio: keeping the ratio is what makes the card resizable.
    expect(COLUMN_PITCH_RATIO).toBeGreaterThan(1.4)
    expect(COLUMN_WIDTH).toBeGreaterThan(CARD_WIDTH)
  })

  it('leaves the row pitch room for the two floating buttons that straddle a card', () => {
    expect(ROW_HEIGHT - CARD_HEIGHT).toBeGreaterThan(2 * 13.6)
  })
})
