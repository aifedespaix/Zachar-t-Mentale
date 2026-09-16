import { useId } from 'react'
import type { LanguageId } from './languageHelp'

/** Small enough to sit inside a toolbar button without enlarging it. */
const FLAG_WIDTH = 18
const FLAG_HEIGHT = 12

/**
 * Flags drawn as SVG rather than written as emoji.
 *
 * A regional-indicator pair (🇬🇧) is a flag on macOS and a pair of letters —
 * « GB » — on Windows, which is where this app runs: the one glyph the user was
 * told to click would arrive as two capitals. Drawing them costs a handful of
 * rects and looks the same everywhere.
 */
export function LanguageFlag({ id }: { id: LanguageId }) {
  if (id === 'es') return <SpainFlag />
  if (id === 'fr') return <FranceFlag />
  return <UnionJack />
}

/** Blue, white, red — three vertical bands, the whole flag at this size. */
function FranceFlag() {
  return (
    <svg
      viewBox="0 0 60 40"
      width={FLAG_WIDTH}
      height={FLAG_HEIGHT}
      aria-hidden
      focusable="false"
      style={{ display: 'block', borderRadius: 2 }}
    >
      <rect width="20" height="40" fill="#002395" />
      <rect x="20" width="20" height="40" fill="#FDFDFD" />
      <rect x="40" width="20" height="40" fill="#ED2939" />
    </svg>
  )
}

/** Red over yellow over red, the simplified civil ensign. */
function SpainFlag() {
  return (
    <svg
      viewBox="0 0 60 40"
      width={FLAG_WIDTH}
      height={FLAG_HEIGHT}
      aria-hidden
      focusable="false"
      style={{ display: 'block', borderRadius: 2 }}
    >
      <rect width="60" height="40" fill="#AA151B" />
      <rect y="10" width="60" height="20" fill="#F1BF00" />
    </svg>
  )
}

/** The Union Jack, in its simplified two-diagonal form. */
function UnionJack() {
  // `useId` rather than a fixed id: more than one editor can be mounted at
  // once, and two identical clip-path ids in one document is the kind of thing
  // that silently starts resolving against the wrong element.
  const clipId = `flag-en-${useId().replace(/:/g, '')}`
  return (
    <svg
      viewBox="0 0 60 40"
      width={FLAG_WIDTH}
      height={FLAG_HEIGHT}
      aria-hidden
      focusable="false"
      style={{ display: 'block', borderRadius: 2 }}
    >
      <clipPath id={clipId}>
        <path d="M30,20 h30 v20 z v20 h-30 z h-30 v-20 z v-20 h30 z" />
      </clipPath>
      <rect width="60" height="40" fill="#012169" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#fff" strokeWidth="8" />
      <path d="M0,0 L60,40 M60,0 L0,40" clipPath={`url(#${clipId})`} stroke="#C8102E" strokeWidth="5" />
      <path d="M30,0 v40 M0,20 h60" stroke="#fff" strokeWidth="13" />
      <path d="M30,0 v40 M0,20 h60" stroke="#C8102E" strokeWidth="8" />
    </svg>
  )
}

/**
 * One hue per character group, so the groups of a language are told apart at a
 * glance rather than by reading their headings.
 *
 * Written as `color-mix(… , transparent 88%)` on purpose: the result is a thin
 * tint laid over whatever is behind it, which means the SAME constant reads as
 * a pale wash on the light theme and as a deep one on the dark theme. A colour
 * mixed with white would have been unreadable in the dark, and vice versa.
 */
export const GROUP_TONES = [
  'oklch(0.6 0.17 250)',
  'oklch(0.66 0.16 75)',
  'oklch(0.62 0.15 155)',
  'oklch(0.62 0.17 20)',
] as const

/** A tinted surface: `share` is how much of the hue survives the mix. */
export function tint(hue: string, share: number): string {
  return `color-mix(in oklch, ${hue}, transparent ${100 - share}%)`
}
