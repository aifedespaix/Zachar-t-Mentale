import { useId } from 'react'
import { Languages } from 'lucide-react'
import { LANGUAGES, languageHelp, type LanguageId } from './languageHelp'

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
  if (id === 'es') {
    return (
      <svg viewBox="0 0 60 40" width={FLAG_WIDTH} height={FLAG_HEIGHT} aria-hidden focusable="false" style={{ display: 'block', borderRadius: 2 }}>
        <rect width="60" height="40" fill="#AA151B" />
        <rect y="10" width="60" height="20" fill="#F1BF00" />
      </svg>
    )
  }
  return <UnionJack />
}

/** The Union Jack, in its simplified two-diagonal form. */
function UnionJack() {
  // `useId` rather than a fixed id: the flag is rendered twice at once (on the
  // closed button and inside the open panel's language row), and two identical
  // clip-path ids in one document is the kind of thing that silently starts
  // resolving against the wrong element.
  const clipId = `flag-en-${useId().replace(/:/g, '')}`
  return (
    <svg viewBox="0 0 60 40" width={FLAG_WIDTH} height={FLAG_HEIGHT} aria-hidden focusable="false" style={{ display: 'block', borderRadius: 2 }}>
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

export interface LanguageHelpButtonProps {
  /** The language whose help is showing, or `null` before one is chosen. */
  language: LanguageId | null
  open: boolean
  /** Nothing to insert into: the description has no text block to type in. */
  disabled?: boolean
  onToggle: () => void
}

/**
 * The clickable flag that opens the special-character palette.
 *
 * It shows the language it is helping with — the flag IS the state, so there is
 * no separate "current language" to read elsewhere in the toolbar — and falls
 * back to a neutral glyph while none is chosen.
 */
export function LanguageHelpButton({ language, open, disabled = false, onToggle }: LanguageHelpButtonProps) {
  const selected = language === null ? null : languageHelp(language)
  return (
    <button
      type="button"
      aria-label={selected === null ? 'Aide à la saisie : choisir une langue' : `Caractères spéciaux en ${selected.label}`}
      aria-expanded={open}
      aria-pressed={open}
      disabled={disabled}
      title={
        disabled
          ? 'Ajoute ou sélectionne un bloc de texte pour insérer des caractères'
          : 'Caractères spéciaux (anglais, espagnol)'
      }
      // Keeps the caret in the text being written: without it, clicking the
      // flag moves focus here and a later insert would have to guess where the
      // caret was. Keyboard focus (Tab) is untouched — this only cancels the
      // pointer's focus grab, and the click still fires.
      onMouseDown={event => event.preventDefault()}
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 10px',
        fontSize: 13,
        borderRadius: 6,
        cursor: disabled ? 'default' : 'pointer',
        border: '1px solid var(--border)',
        background: open ? 'var(--accent, rgba(0,0,0,0.08))' : 'transparent',
        color: 'inherit',
        opacity: disabled ? 0.4 : 1,
        // Pushed to the far end of the mode row: it acts on the text being
        // written, not on which kind of block is selected.
        marginLeft: 'auto',
      }}
    >
      {selected === null ? <Languages size={14} /> : <LanguageFlag id={selected.id} />}
      {selected?.label ?? 'Langue'}
    </button>
  )
}

export interface LanguageHelpPanelProps {
  language: LanguageId | null
  onChooseLanguage: (id: LanguageId) => void
  /** Inserts at the caret of the text block being written. */
  onInsert: (text: string) => void
}

/**
 * The palette itself: choose a language, then click the characters it needs.
 *
 * Rendered in the flow rather than as a floating popover — it is something the
 * user keeps open while typing, and a panel hovering over the very field being
 * written in would hide the sentence the accents belong to.
 */
export function LanguageHelpPanel({ language, onChooseLanguage, onInsert }: LanguageHelpPanelProps) {
  const selected = language === null ? null : languageHelp(language)
  return (
    <div
      role="group"
      aria-label="Caractères spéciaux"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '8px 10px',
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'color-mix(in oklch, var(--border), transparent 88%)',
      }}
    >
      <div role="group" aria-label="Choix de la langue" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {LANGUAGES.map(entry => {
          const active = entry.id === language
          return (
            <button
              key={entry.id}
              type="button"
              aria-label={`Langue : ${entry.label}`}
              aria-pressed={active}
              onClick={() => onChooseLanguage(entry.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 9px',
                fontSize: 13,
                borderRadius: 6,
                cursor: 'pointer',
                border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                background: active ? 'var(--accent, rgba(0,0,0,0.08))' : 'var(--background)',
                color: 'inherit',
              }}
            >
              <LanguageFlag id={entry.id} />
              {entry.label}
            </button>
          )
        })}
      </div>

      {selected === null ? (
        <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
          Choisis une langue pour afficher les caractères qu’elle demande.
        </p>
      ) : (
        selected.groups.map(group => (
          <div key={group.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                opacity: 0.6,
              }}
            >
              {group.name}
            </span>
            <div role="group" aria-label={group.name} style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {group.characters.map(character => (
                <button
                  key={character.char}
                  type="button"
                  aria-label={character.label}
                  title={character.label}
                  // Same reasoning as the flag button, plus the insert itself is
                  // left to `onClick` so the keyboard (Enter/Space, which never
                  // fire a mousedown) reaches every character too.
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => onInsert(character.char)}
                  style={{
                    minWidth: 28,
                    height: 28,
                    padding: '0 6px',
                    fontSize: 15,
                    lineHeight: 1,
                    borderRadius: 6,
                    cursor: 'pointer',
                    border: '1px solid var(--border)',
                    background: 'var(--background)',
                    color: 'inherit',
                  }}
                >
                  {character.char}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
