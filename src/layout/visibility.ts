export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Whether `inner` sits entirely inside `outer`, with `margin` px to spare.
 *
 * This is what decides if opening a fiche has to move the canvas. Opening the
 * panel shrinks the flow pane from the right, so a card near that edge can end
 * up behind the panel — the card you just clicked, hidden by the thing you
 * clicked it for.
 *
 * Recentring unconditionally would be simpler and worse: most cards are
 * nowhere near the edge, and moving the whole map every time a fiche opens
 * makes the canvas feel like it is fighting you. So the view moves only when
 * it must.
 *
 * The margin keeps a card that is merely GRAZING the edge from counting as
 * visible: half a card and the sibling buttons that straddle its border are
 * not a card you can work with.
 */
export function isFullyVisible(inner: Rect, outer: Rect, margin = 0): boolean {
  return (
    inner.left >= outer.left + margin &&
    inner.top >= outer.top + margin &&
    inner.right <= outer.right - margin &&
    inner.bottom <= outer.bottom - margin
  )
}
