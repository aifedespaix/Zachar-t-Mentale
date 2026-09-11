/**
 * The card box and the tree grid pitches, in one place.
 *
 * They are derived rather than declared independently: the column pitch is the
 * card width times a ratio, so the empty gutter between two columns can never
 * shrink relative to the cards it separates when the card is resized. Keeping
 * them in one module makes that a property of the code instead of a comment
 * nobody reads.
 */

/**
 * The card fixed width, in px.
 *
 * Fixed, not content-driven: a card used to be sized by its content, and its
 * two title states (an editor textarea and a quiz masked div) are not the same
 * kind of box, so a card being quizzed grew to two or three times the width of
 * the same card a moment earlier and pushed the rest of the map around.
 */
export const CARD_WIDTH = 300

/**
 * How many card widths fit in one column pitch.
 *
 * 1.6 is the ratio the map has always used (320 / 200) and is within 1% of the
 * golden ratio, so this encodes the proportion that was already there rather
 * than inventing one. It also lands on Graphviz's own default: a gap worth
 * roughly two thirds of the node it separates.
 *
 * The gutter it produces (CARD_WIDTH * 0.6, i.e. 180px) sits far above the only
 * hard constraint: the "add a child" button straddles the card right edge by
 * 0.85rem (13.6px).
 */
export const COLUMN_PITCH_RATIO = 1.6

/** One column = one card plus its proportional gutter. 480px at the default width. */
export const COLUMN_WIDTH = CARD_WIDTH * COLUMN_PITCH_RATIO

/**
 * The tree vertical pitch. This one is NOT a ratio, because what it separates
 * (two stacked siblings) has nothing to do with the card size: the gap has to
 * hold the two floating "+" buttons that straddle the cards facing edges
 * (0.85rem each) plus the same breath of air the map has always had.
 *
 * card height (144) + 2 x 13.6 + about 23 = 194, rounded to 200.
 */
export const ROW_HEIGHT = 200
