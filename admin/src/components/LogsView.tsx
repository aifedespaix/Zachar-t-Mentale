import { useMemo, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, CircleAlert, RefreshCw, ScrollText, TriangleAlert } from 'lucide-react'
import { useLibrary } from '@/state/useLibrary'
import type { RemoteSyncEvent } from '@/lib/api'
import { Badge, EmptyState, ErrorBanner, IconButton, Sheet, Spinner } from './ui/primitives'
import { fullDate, relativeTime } from '@/lib/format'

/**
 * Le journal de synchronisation, côté serveur.
 *
 * Il répond à une seule question, celle qu'on se pose quand quelque chose
 * cloche : « est-ce que ça passe, chez lui ? ». L'application de bureau tient
 * un journal bien plus détaillé (`sync-debug.log`), mais il est sur la machine
 * de l'élève — c'est-à-dire à l'endroit exact où le prof n'est pas.
 *
 * Le tri par gravité est donc le filtre par défaut du haut : on ne lit pas ce
 * journal pour se réjouir des succès.
 */
export function LogsView() {
  const { events, loadingEvents, eventsError, refreshEvents } = useLibrary()
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [selected, setSelected] = useState<RemoteSyncEvent | null>(null)

  const shown = useMemo(
    () => (onlyProblems ? events.filter(entry => entry.level !== 'info') : events),
    [events, onlyProblems]
  )

  const problemCount = events.filter(entry => entry.level !== 'info').length

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-ink-850 bg-ink-950/95 px-4 py-2 backdrop-blur">
        <label className="tap flex items-center gap-2 text-sm text-ink-300">
          <input
            type="checkbox"
            checked={onlyProblems}
            onChange={event => setOnlyProblems(event.target.checked)}
            className="size-4 accent-[oklch(0.68_0.16_265)]"
          />
          Problèmes seulement
          {problemCount > 0 && <Badge tone="warn">{problemCount}</Badge>}
        </label>
        <IconButton label="Rafraîchir" onClick={() => void refreshEvents()} disabled={loadingEvents} className="ml-auto">
          <RefreshCw size={20} className={loadingEvents ? 'animate-spin' : ''} />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {eventsError !== null ? (
          <div className="p-4">
            <ErrorBanner message={eventsError} onRetry={() => void refreshEvents()} />
          </div>
        ) : loadingEvents && events.length === 0 ? (
          <div className="p-6">
            <Spinner label="Chargement du journal…" />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<ScrollText size={40} />}
            title={onlyProblems ? 'Aucun problème signalé' : 'Le journal est vide'}
            hint={
              onlyProblems
                ? 'Toutes les synchronisations enregistrées se sont bien passées.'
                : 'Une ligne apparaîtra ici à chaque synchronisation d’un appareil. Les versions de l’application antérieures à ce journal ne remontent rien.'
            }
          />
        ) : (
          <ul>
            {shown.map(event => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => setSelected(event)}
                  className="tap flex w-full items-center gap-3 border-b border-ink-900 px-4 py-2 text-left transition-colors hover:bg-ink-900"
                >
                  <LevelIcon level={event.level} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium">{event.username}</span>
                      <span className="shrink-0 text-[11px] text-ink-500" title={fullDate(event.created)}>
                        {relativeTime(event.created)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-500">{event.summary}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[11px] text-ink-500">
                    {event.pushed > 0 && (
                      <span className="flex items-center gap-0.5" title={`${event.pushed} envoyée(s)`}>
                        <ArrowUpFromLine size={12} />
                        {event.pushed}
                      </span>
                    )}
                    {event.pulled > 0 && (
                      <span className="flex items-center gap-0.5" title={`${event.pulled} reçue(s)`}>
                        <ArrowDownToLine size={12} />
                        {event.pulled}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected !== null && <EventSheet event={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function LevelIcon({ level }: { level: RemoteSyncEvent['level'] }) {
  if (level === 'error') return <CircleAlert size={18} className="shrink-0 text-danger" />
  if (level === 'warning') return <TriangleAlert size={18} className="shrink-0 text-warn" />
  return <ScrollText size={18} className="shrink-0 text-ink-700" />
}

function EventSheet({ event, onClose }: { event: RemoteSyncEvent; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title={`${event.username} — ${relativeTime(event.created)}`}>
      <div className="flex flex-col gap-4">
        <p className="text-sm">{event.summary}</p>

        <div className="flex flex-wrap gap-1.5">
          <Badge tone={event.level === 'error' ? 'danger' : event.level === 'warning' ? 'warn' : 'neutral'}>
            {event.level === 'error' ? 'erreur' : event.level === 'warning' ? 'avertissement' : 'info'}
          </Badge>
          <Badge>{event.trigger === 'auto' ? 'automatique' : 'manuelle'}</Badge>
          {event.device !== '' && <Badge>{event.device}</Badge>}
          {event.cancelled && <Badge tone="warn">interrompue</Badge>}
        </div>

        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Stat label="Envoyées" value={event.pushed} />
          <Stat label="Reçues" value={event.pulled} />
          <Stat label="Conflits" value={event.conflicts} tone={event.conflicts > 0 ? 'warn' : undefined} />
          <Stat label="Échecs" value={event.failures} tone={event.failures > 0 ? 'danger' : undefined} />
        </dl>

        <p className="text-xs text-ink-500" title={fullDate(event.created)}>
          {fullDate(event.created)}
        </p>

        {/* Le détail brut. Replié par défaut : c'est du matériel de diagnostic,
            pas quelque chose qu'on lit à chaque ouverture. */}
        <details className="rounded-xl border border-ink-800 bg-ink-900/60">
          <summary className="tap flex cursor-pointer items-center px-3.5 text-sm text-ink-300">
            Détail technique
          </summary>
          <pre className="overflow-x-auto border-t border-ink-850 px-3.5 py-3 font-mono text-[11px] leading-relaxed text-ink-500">
            {safeJson(event.detail)}
          </pre>
        </details>
      </div>
    </Sheet>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'danger' }) {
  const colour = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ink-100'
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/60 px-3 py-2">
      <dt className="text-[11px] text-ink-500">{label}</dt>
      <dd className={`text-lg font-semibold ${colour}`}>{value ?? 0}</dd>
    </div>
  )
}

/** Le champ `detail` vient du serveur : il peut être vide, ou déjà une chaîne. */
function safeJson(value: unknown): string {
  if (value === null || value === undefined) return '(aucun détail)'
  if (typeof value === 'string') return value === '' ? '(aucun détail)' : value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
