import { useMemo, useState } from 'react'
import { Search, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'
import { CardIconBadge } from './CardIconBadge'
import { iconLabel, searchIcons } from '../content/icons'
import type { Oklch } from '../colors/contrast'

/** How many results the grid shows at once — enough to browse, few enough to scan. */
const RESULT_LIMIT = 120

interface IconPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The card's current icon, highlighted in the grid when it is on screen. */
  current?: string
  /** The card's border colour: every icon is previewed in the colours it will take. */
  border: Oklch
  theme: 'light' | 'dark'
  /** `undefined` clears the card's icon. */
  onSelect: (icon: string | undefined) => void
}

/**
 * Search-and-pick over the whole Lucide catalogue, previewing every result in
 * the colours the icon will actually have on the card — the choice is about
 * how the card will look, so the grid shows exactly that rather than a row of
 * neutral glyphs.
 */
export function IconPickerDialog({ open, onOpenChange, current, border, theme, onSelect }: IconPickerDialogProps) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => searchIcons(query, RESULT_LIMIT), [query])

  function choose(name: string | undefined) {
    onSelect(name)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choisir une icône</DialogTitle>
        </DialogHeader>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search size={16} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
          <input
            autoFocus
            type="search"
            aria-label="Rechercher une icône"
            placeholder="Rechercher (cerveau, atome, book…)"
            value={query}
            onChange={event => setQuery(event.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              font: 'inherit',
              color: 'inherit',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '0.3rem 0.5rem',
              outline: 'none',
            }}
          />
        </label>

        {/* The one line of guidance the search box needs: the catalogue is in
            English, and nothing on screen would otherwise say that typing a
            French word works too. */}
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted-foreground)' }}>
          {query.trim() === ''
            ? 'Suggestions — ou tapez un mot, en français ou en anglais.'
            : `${results.length}${results.length === RESULT_LIMIT ? '+' : ''} résultat${results.length > 1 ? 's' : ''}`}
        </p>

        <div
          role="listbox"
          aria-label="Icônes disponibles"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))',
            gap: 6,
            maxHeight: 280,
            overflowY: 'auto',
            padding: 2,
          }}
        >
          {results.map(name => {
            const selected = name === current
            return (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={iconLabel(name)}
                title={iconLabel(name)}
                onClick={() => choose(name)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 6,
                  borderRadius: 8,
                  border: '1px solid',
                  borderColor: selected ? 'var(--ring)' : 'transparent',
                  background: selected ? 'var(--muted)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <CardIconBadge name={name} border={border} theme={theme} size={28} />
              </button>
            )
          })}
        </div>

        {results.length === 0 && (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted-foreground)' }}>
            Aucune icône ne correspond à « {query.trim()} ». Essayez un mot plus général, ou son équivalent
            anglais.
          </p>
        )}

        <DialogFooter>
          {/* Only offered when there is something to remove: on a card with no
              icon it would be a button that does nothing. */}
          {current !== undefined && (
            <Button variant="outline" onClick={() => choose(undefined)}>
              <Trash2 />
              Retirer l’icône
            </Button>
          )}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
