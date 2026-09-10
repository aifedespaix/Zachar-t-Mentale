import { useMemo, useState } from 'react'
import { RotateCcw, Search, X } from 'lucide-react'
import { Button } from '../ui/button'
import { SettingsSection } from './SettingsSection'
import { ShortcutRecorder } from './ShortcutRecorder'
import { CATEGORY_LABELS, COMMAND_LIST, DEFAULT_BINDINGS, commandsByCategory, type CommandId } from '../../types/commands'
import { formatBinding } from '../../shortcuts/keys'
import { conflictsIn, useShortcutSettingsStore } from '../../state/useShortcutSettingsStore'

/** Accent- and case-insensitive, so « Créer » is found by typing "creer". */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * The keyboard shortcuts tab.
 *
 * Every action the app has, with what it does and the key that runs it, in one
 * list you can search — and change. Two things make it worth the space:
 *
 *  - It is the app's own documentation. The catalogue that feeds the menus and
 *    the tooltips feeds this list, so nothing here can go out of date.
 *  - Rebinding is a real need, not a luxury: this app is used on an AZERTY
 *    keyboard, some chords are taken by the window manager, and a shortcut you
 *    cannot press is a feature you do not have.
 *
 * Edits are live but unsaved, like the other tabs: they take effect as you make
 * them (so you can test the chord immediately) and « Annuler » puts back the
 * snapshot the window took when it opened.
 */
export function ShortcutSettingsPanel() {
  const bindings = useShortcutSettingsStore(s => s.bindings)
  const overrides = useShortcutSettingsStore(s => s.overrides)
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<CommandId | null>(null)
  /** « Ctrl+D était sur "Dupliquer la carte" » — the last displacement, so it is never silent. */
  const [displaced, setDisplaced] = useState<{ command: string; binding: string } | null>(null)

  const conflicts = useMemo(() => conflictsIn(bindings), [bindings])
  const customisedCount = Object.keys(overrides).length

  const groups = useMemo(() => {
    const needle = fold(query.trim())
    return commandsByCategory()
      .map(group => ({
        ...group,
        commands: group.commands.filter(command => {
          if (needle === '') return true
          const binding = bindings[command.id as CommandId]
          return fold(
            `${command.label} ${command.description} ${CATEGORY_LABELS[command.category]} ${
              binding === null ? '' : formatBinding(binding)
            }`
          ).includes(needle)
        }),
      }))
      .filter(group => group.commands.length > 0)
  }, [query, bindings])

  function assign(id: CommandId, binding: string) {
    const store = useShortcutSettingsStore.getState()
    const holder = store.commandHolding(binding, id)
    store.setBinding(id, binding)
    setRecording(null)
    // Two commands on one chord would make the loser silently dead. It is taken
    // away instead — and said out loud, with the name of what just lost it.
    setDisplaced(
      holder === null
        ? null
        : { command: COMMAND_LIST.find(command => command.id === holder)?.label ?? holder, binding }
    )
  }

  return (
    <div>
      <SettingsSection
        title="Raccourcis clavier"
        description="Clique sur un raccourci puis appuie sur la combinaison voulue. Échap annule la saisie. Les changements s’appliquent tout de suite et ne sont conservés qu’après « Enregistrer »."
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
            <Search
              size={14}
              aria-hidden
              style={{ position: 'absolute', left: 10, color: 'var(--muted-foreground)' }}
            />
            <input
              aria-label="Rechercher un raccourci"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Rechercher une action ou une touche…"
              style={{
                width: '100%',
                padding: '8px 10px 8px 30px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--background)',
                color: 'inherit',
                fontSize: 13,
              }}
            />
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={customisedCount === 0}
            onClick={() => {
              useShortcutSettingsStore.getState().resetAll()
              setDisplaced(null)
            }}
          >
            <RotateCcw />
            Tout réinitialiser
          </Button>
        </div>

        <p style={{ margin: '0 0 12px', fontSize: 11.5, color: 'var(--muted-foreground)' }}>
          {customisedCount === 0
            ? 'Tous les raccourcis sont ceux d’origine.'
            : `${customisedCount} raccourci${customisedCount > 1 ? 's' : ''} personnalisé${customisedCount > 1 ? 's' : ''}.`}
        </p>

        {displaced !== null && (
          <p role="status" className="status-banner" style={{ marginBottom: 12 }}>
            {formatBinding(displaced.binding)} appartenait à « {displaced.command} » : cette action n’a plus de
            raccourci.
          </p>
        )}
      </SettingsSection>

      {groups.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
          Aucune action ne correspond à « {query} ».
        </p>
      )}

      {groups.map(group => (
        <SettingsSection key={group.category} title={CATEGORY_LABELS[group.category]}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {group.commands.map(command => {
              const id = command.id as CommandId
              const binding = bindings[id]
              const isDefault = binding === DEFAULT_BINDINGS[id]
              const conflicting = binding !== null && (conflicts.get(binding)?.length ?? 0) > 1

              return (
                <li
                  key={id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: `1px solid ${conflicting ? 'var(--destructive)' : 'var(--border)'}`,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{command.label}</span>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 11.5,
                        color: 'var(--muted-foreground)',
                        marginTop: 2,
                        lineHeight: 1.45,
                      }}
                    >
                      {command.description}
                    </span>
                    {conflicting && (
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--destructive)', marginTop: 2 }}>
                        Ce raccourci est utilisé par plusieurs actions.
                      </span>
                    )}
                  </span>

                  <ShortcutRecorder
                    commandLabel={command.label}
                    binding={binding}
                    recording={recording === id}
                    onStartRecording={() => {
                      setDisplaced(null)
                      setRecording(id)
                    }}
                    onCancel={() => setRecording(null)}
                    onCapture={captured => assign(id, captured)}
                  />

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Supprimer le raccourci de « ${command.label} »`}
                    disabled={binding === null}
                    onClick={() => useShortcutSettingsStore.getState().setBinding(id, null)}
                  >
                    <X />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Réinitialiser le raccourci de « ${command.label} »`}
                    disabled={isDefault}
                    onClick={() => useShortcutSettingsStore.getState().resetCommand(id)}
                  >
                    <RotateCcw />
                  </Button>
                </li>
              )
            })}
          </ul>
        </SettingsSection>
      ))}
    </div>
  )
}
