import type { Oklch } from './contrast'

/**
 * The fill behind a card's mnemonic icon.
 *
 * The badge is deliberately built out of the card's OWN border colour — border
 * in that colour, icon in that colour, and this lighter wash of it in between
 * — so an icon reads as part of its card rather than as a sticker dropped on
 * top of it. Derived from the border rather than from the card background
 * because the background is nearly colourless at every level (l: 0.96 in
 * light), which would leave the badge's centre indistinguishable from the card
 * around it.
 *
 * Chroma is capped rather than kept: at the border's full chroma this wash
 * turns into a second coloured block competing with the card, and the icon
 * drawn on it loses contrast.
 */
export function iconBadgeFill(border: Oklch, theme: 'light' | 'dark'): Oklch {
  return theme === 'dark'
    ? // "Lighter" in a dark theme means a raised surface, not a bright one: a
      // near-white centre would glare on a dark canvas.
      { l: 0.32, c: Math.min(border.c, 0.05), h: border.h }
    : { l: 0.97, c: Math.min(border.c, 0.04), h: border.h }
}
