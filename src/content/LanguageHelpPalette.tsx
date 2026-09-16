import { useId } from 'react'
import { Languages } from 'lucide-react'
import { Hint } from '../components/ui/hint'
import { LANGUAGES, languageHelp, type LanguageId, type SpecialCharacter } from './languageHelp'

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
  // `useId` rather than a fixed id: the flag is rendered twice at once (on the
  // closed button and inside the open panel's language row), and two identical
  // clip-path ids in one document is the kind of thing that silently starts
  // resolving against the wrong element.
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

/**
 * What the button shows: the closing sign the click brings along, so the
 * palette reads as the text it writes — [¿ ?], [« »] — rather than a lone ¿
 * whose partner has to be found among the other buttons.
 */
function faceOf(character: SpecialCharacter): string {
  return character.closesWith === undefined ? character.char : `${character.char} ${character.closesWith}`
}

export interface LanguageCharacterPaletteProps {
  /** The language whose characters are showing, or `null` before one is chosen. */
  language: LanguageId | null
  onChooseLanguage: (id: LanguageId) => void
  /** Inserts at the caret of the text block this palette belongs to. */
  onInsert: (character: SpecialCharacter) => void
}

/**
 * The special characters of one language, as the footer of the block being
 * written in.
 *
 * It used to live in a side panel, next to a flag button that had to be clicked
 * open first. It is now the block's own footer (see `BlockEditor`): the
 * characters appear under the very field they write into, and they follow the
 * selection — switching to another block hides them here and shows them there,
 * with that block's own palette. Nothing has to be opened, and nothing has to
 * be remembered about which block is "current".
 *
 * The languages themselves stay a row of buttons rather than a menu: the whole
 * point is that the pupil can see, without clicking, that the help exists in
 * three languages, and which one is currently showing.
 */
export function LanguageCharacterPalette({
  language,
  onChooseLanguage,
  onInsert,
}: LanguageCharacterPaletteProps) {
  const selected = language === null ? null : languageHelp(language)

  return (
    // A labelled region, like the math palette's: what this is has to be
    // announced, not only seen — the language buttons alone read as a row of
    // flags with no idea what they are for.
    <div role="group" aria-label="Caractères spéciaux" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div role="group" aria-label="Choix de la langue" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {LANGUAGES.map(entry => {
          const active = entry.id === language
          return (
            <button
              key={entry.id}
              type="button"
              aria-label={`Langue : ${entry.label}`}
              aria-pressed={active}
              // Keeps the caret — and any selection — in the text being
              // written. The character clicked next is inserted AT that caret,
              // and choosing a language is a step of writing a sentence, not a
              // reason to lose the place in it.
              onMouseDown={event => event.preventDefault()}
              onClick={() => onChooseLanguage(entry.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 11px',
                fontSize: 13,
                borderRadius: 999,
                cursor: 'pointer',
                border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                background: active ? 'var(--accent, rgba(0,0,0,0.08))' : 'transparent',
                color: 'inherit',
                fontWeight: active ? 600 : 400,
              }}
            >
              <LanguageFlag id={entry.id} />
              {entry.label}
            </button>
          )
        })}
      </div>

      {selected === null ? (
        <p style={{ margin: 0, fontSize: 12.5, opacity: 0.7 }}>
          <Languages size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} aria-hidden />
          Choisis une langue pour afficher les caractères qu’elle demande.
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', alignItems: 'flex-start' }}>
          {selected.groups.map((group, groupIndex) => {
            const hue = GROUP_TONES[groupIndex % GROUP_TONES.length]
            return (
              <div key={group.name} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    padding: '2px 8px',
                    borderRadius: 999,
                    alignSelf: 'flex-start',
                    background: tint(hue, 16),
                    border: `1px solid ${tint(hue, 34)}`,
                  }}
                >
                  {group.name}
                </span>
                <div role="group" aria-label={group.name} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {group.characters.map(character => (
                    // The key shows the GLYPH — `¿`, `»`, `œ` — and the label is
                    // what names it. That is the case a hint is for; a `title`
                    // only ever reached pointer users, and never on keyboard
                    // focus, which is exactly how these keys are meant to be
                    // reached.
                    <Hint key={character.char} label={character.label}>
                    <button
                      type="button"
                      aria-label={character.label}
                      // Same reasoning as the language buttons, plus the insert
                      // itself is left to `onClick` so the keyboard (Enter/Space,
                      // which never fire a mousedown) reaches every character too.
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => onInsert(character)}
                      style={{
                        // Sized to be hit without aiming: this is the whole
                        // reason the palette exists, and the old 28px buttons
                        // were the smallest targets in the dialog.
                        minWidth: 40,
                        height: 38,
                        padding: '0 10px',
                        fontSize: 17,
                        lineHeight: 1,
                        borderRadius: 9,
                        cursor: 'pointer',
                        border: `1px solid ${tint(hue, 38)}`,
                        background: tint(hue, 13),
                        color: 'inherit',
                      }}
                    >
                      {faceOf(character)}
                    </button>
                    </Hint>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
