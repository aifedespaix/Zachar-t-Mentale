import { useCallback, useEffect, useState } from 'react'
import { CheckCheck, GitCompareArrows, RefreshCw, ShieldCheck } from 'lucide-react'
import { fetchMap, type RemoteConflict } from '@/lib/api'
import { describeApiError, pb, type AdminUser } from '@/lib/pb'
import { useLibrary } from '@/state/useLibrary'
import { Badge, Button, EmptyState, ErrorBanner, IconButton, Sheet, Spinner } from './ui/primitives'
import { compareMindMaps, summarizeComparison, type MindMapComparison } from '@/lib/compare'
import { fullDate, relativeTime } from '@/lib/format'

/**
 * Les conflits, et leur arbitrage.
 *
 * Un conflit est signalé par `sync()` quand les DEUX côtés ont modifié le même
 * fichier depuis la dernière synchronisation. L'algorithme n'en résout aucun —
 * les deux versions contiennent du travail que quelqu'un a fait, et seul un
 * humain peut décider lequel compte. Jusqu'ici cet humain devait être devant la
 * machine de l'élève, parce que la version locale n'existait que là. Le client
 * la joint désormais au signalement (`local_content`), et c'est ce qui rend cet
 * écran possible.
 */
export function ConflictsView({ user }: { user: AdminUser }) {
  const { conflicts, loadingConflicts, conflictsError, refreshConflicts, settleConflict } = useLibrary()
  const [selected, setSelected] = useState<RemoteConflict | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  const open = conflicts.filter(entry => entry.status === 'open')
  const resolved = conflicts.filter(entry => entry.status !== 'open')
  const shown = showResolved ? resolved : open

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-ink-850 bg-ink-950/95 px-4 py-2 backdrop-blur">
        <div className="flex gap-1">
          <Tab active={!showResolved} onClick={() => setShowResolved(false)}>
            À trancher {open.length > 0 && <Badge tone="danger">{open.length}</Badge>}
          </Tab>
          <Tab active={showResolved} onClick={() => setShowResolved(true)}>
            Classés {resolved.length > 0 && <Badge>{resolved.length}</Badge>}
          </Tab>
        </div>
        <IconButton
          label="Rafraîchir"
          onClick={() => void refreshConflicts()}
          disabled={loadingConflicts}
          className="ml-auto"
        >
          <RefreshCw size={20} className={loadingConflicts ? 'animate-spin' : ''} />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {conflictsError !== null ? (
          <div className="p-4">
            <ErrorBanner message={conflictsError} onRetry={() => void refreshConflicts()} />
          </div>
        ) : loadingConflicts && conflicts.length === 0 ? (
          <div className="p-6">
            <Spinner label="Chargement des conflits…" />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={40} />}
            title={showResolved ? 'Aucun conflit classé' : 'Aucun conflit en attente'}
            hint={
              showResolved
                ? 'Les conflits tranchés apparaîtront ici.'
                : 'Tout le monde est d’accord avec le serveur. C’est l’état normal.'
            }
          />
        ) : (
          <ul>
            {shown.map(conflict => (
              <li key={conflict.id}>
                <button
                  type="button"
                  onClick={() => setSelected(conflict)}
                  className="tap flex w-full items-center gap-3 border-b border-ink-900 px-4 py-2 text-left transition-colors hover:bg-ink-900"
                >
                  <GitCompareArrows
                    size={18}
                    className={`shrink-0 ${conflict.status === 'open' ? 'text-danger' : 'text-ink-700'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{conflict.path}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-500">
                      {conflict.username} · signalé {relativeTime(conflict.created)}
                    </span>
                  </span>
                  {conflict.status !== 'open' && <Badge tone="ok">{resolutionLabel(conflict.resolution)}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected !== null && (
        <ConflictSheet
          conflict={selected}
          user={user}
          onClose={() => setSelected(null)}
          onSettle={async resolution => {
            await settleConflict(selected, resolution, user.username)
            setSelected(null)
          }}
        />
      )}
    </div>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tap flex items-center gap-1.5 rounded-xl px-3 text-sm transition-colors ${
        active ? 'bg-ink-800 text-ink-100' : 'text-ink-500 hover:text-ink-300'
      }`}
    >
      {children}
    </button>
  )
}

function resolutionLabel(resolution: string | undefined): string {
  if (resolution === 'took-local') return 'version élève'
  if (resolution === 'kept-remote') return 'version serveur'
  return 'classé'
}

function ConflictSheet({
  conflict,
  user,
  onClose,
  onSettle,
}: {
  conflict: RemoteConflict
  user: AdminUser
  onClose: () => void
  onSettle: (resolution: 'kept-remote' | 'took-local' | 'dismissed') => Promise<void>
}) {
  const [comparison, setComparison] = useState<MindMapComparison | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Le conflit ne connaît que le `file_id` — l'identité du FICHIER, stable
      // d'un bout à l'autre. L'identifiant d'enregistrement, lui, change si la
      // carte a été supprimée puis republiée entre-temps : c'est donc par
      // `file_id` qu'on retrouve la version serveur, jamais par l'autre.
      const record = await fetchMap(await findRecordId(conflict.file_id))
      setComparison(compareMindMaps(conflict.local_content, record.content))
    } catch (caught) {
      setError(describeApiError(caught, 'Lecture de la version serveur'))
    } finally {
      setLoading(false)
    }
  }, [conflict])

  useEffect(() => {
    void load()
  }, [load])

  const settled = conflict.status !== 'open'
  const hasLocal = conflict.local_content.trim() !== ''

  async function settle(resolution: 'kept-remote' | 'took-local' | 'dismissed') {
    setWorking(true)
    setError(null)
    try {
      await onSettle(resolution)
    } catch (caught) {
      setError(describeApiError(caught, 'Enregistrement de la décision'))
      setWorking(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={conflict.path.split('/').pop() ?? conflict.path}
      footer={
        settled ? (
          <Button tone="ghost" onClick={onClose} className="w-full">
            Fermer
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <Button tone="primary" disabled={working || !hasLocal} onClick={() => void settle('took-local')}>
              Adopter la version de {conflict.username}
            </Button>
            <Button tone="neutral" disabled={working} onClick={() => void settle('kept-remote')}>
              Garder la version du serveur
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3.5 text-xs text-ink-300">
          <p className="mb-1 font-mono text-[11px] text-ink-500">{conflict.path}</p>
          <p>
            <strong>{conflict.username}</strong> a modifié ce fichier de son côté pendant qu’il changeait aussi sur le
            serveur. Rien n’a été écrasé.
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-ink-500">
            <dt>Version locale</dt>
            <dd title={fullDate(conflict.local_modified)}>{relativeTime(conflict.local_modified)}</dd>
            <dt>Version serveur</dt>
            <dd title={fullDate(conflict.remote_updated)}>{relativeTime(conflict.remote_updated)}</dd>
          </dl>
        </div>

        {error !== null && <ErrorBanner message={error} onRetry={() => void load()} />}

        {!hasLocal && (
          <p className="rounded-xl border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-sm text-warn">
            La version locale n’a pas pu être jointe au signalement (fichier illisible au moment de la
            synchronisation). Seule la version du serveur peut être conservée.
          </p>
        )}

        {loading ? (
          <Spinner label="Comparaison…" />
        ) : comparison !== null ? (
          <ComparisonPanel comparison={comparison} who={conflict.username} />
        ) : null}

        {settled && (
          <p className="flex items-center gap-2 rounded-xl border border-ok/30 bg-ok/10 px-3.5 py-2.5 text-sm text-ok">
            <CheckCheck size={16} />
            Classé par {conflict.resolved_by ?? user.username} — {resolutionLabel(conflict.resolution)}.
          </p>
        )}
      </div>
    </Sheet>
  )
}

function ComparisonPanel({ comparison, who }: { comparison: MindMapComparison; who: string }) {
  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-ink-300">{summarizeComparison(comparison)}</p>
      <ChangeList
        title={`Seulement chez ${who}`}
        hint="Perdues si vous gardez la version du serveur."
        entries={comparison.onlyLocal}
        tone="warn"
      />
      <ChangeList
        title="Seulement sur le serveur"
        hint={`Perdues si vous adoptez la version de ${who}.`}
        entries={comparison.onlyRemote}
        tone="warn"
      />
      <ChangeList title="Modifiées des deux côtés" entries={comparison.changed} tone="neutral" />
    </section>
  )
}

function ChangeList({
  title,
  hint,
  entries,
  tone,
}: {
  title: string
  hint?: string
  entries: { id: string; title: string; otherTitle?: string }[]
  tone: 'warn' | 'neutral'
}) {
  if (entries.length === 0) return null
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3.5">
      <h3 className={`text-xs font-semibold uppercase tracking-wide ${tone === 'warn' ? 'text-warn' : 'text-ink-500'}`}>
        {title} ({entries.length})
      </h3>
      {hint !== undefined && <p className="mt-1 text-[11px] text-ink-500">{hint}</p>}
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {entries.slice(0, 30).map(entry => (
          <li key={entry.id} className="truncate">
            {entry.title === '' ? <span className="text-ink-500">(sans titre)</span> : entry.title}
            {entry.otherTitle !== undefined && (
              <span className="text-ink-500"> → {entry.otherTitle === '' ? '(sans titre)' : entry.otherTitle}</span>
            )}
          </li>
        ))}
      </ul>
      {entries.length > 30 && <p className="mt-1 text-[11px] text-ink-500">… et {entries.length - 30} de plus</p>}
    </div>
  )
}

/** L'identifiant d'enregistrement de la carte portant ce `file_id`. */
async function findRecordId(fileId: string): Promise<string> {
  const record = await pb
    .collection('cartes_mentales')
    .getFirstListItem<{ id: string }>(pb.filter('file_id = {:fileId}', { fileId }), { fields: 'id' })
  return record.id
}
