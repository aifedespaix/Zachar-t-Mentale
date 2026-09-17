import { useCallback, useState } from 'react'
import { Copy, RefreshCw, ScanSearch, ShieldCheck, Trash2 } from 'lucide-react'
import { fetchMapContents } from '@/lib/api'
import { describeApiError } from '@/lib/pb'
import { findDuplicateGroups, type DuplicateGroup } from '@/lib/duplicates'
import { fullDate, plural } from '@/lib/format'
import { nameOf, parentOf } from '@/lib/tree'
import { MAP_TYPE_LABELS, mapTypeOf } from '@app/types/mapType'
import { useLibrary } from '@/state/useLibrary'
import { Badge, Button, EmptyState, ErrorBanner, IconButton, Sheet, Spinner } from './ui/primitives'

/**
 * Les doublons de contenu, et leur arbitrage.
 *
 * Le serveur accumule des copies : un prof republie un chapitre sous un autre
 * nom, une synchronisation crée une copie, un élève colle deux fois le même
 * cours. Ces fichiers ne sont pas en conflit — personne n'a divergé — ils sont
 * simplement IDENTIQUES, et chacun occupe une place et une entrée dans
 * l'arborescence.
 *
 * C'est `duplicates.ts` qui décide ce qu'« identique » veut dire : les cartes,
 * et rien d'autre. Cette vue ne fait que montrer les groupes, afficher de quoi
 * reconnaître chaque fichier (chemin, auteur, type, date de création, date de
 * modification), laisser choisir celui qu'on garde, et exécuter la suppression
 * des autres — jamais sans une confirmation qui les nomme.
 */
export function DuplicatesView() {
  const removeMaps = useLibrary(state => state.removeMaps)
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keep, setKeep] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<DuplicateGroup | null>(null)

  const analyse = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const found = findDuplicateGroups(await fetchMapContents())
      setGroups(found)
      // Le fichier gardé par défaut est la copie la PLUS RÉCENTE : c'est celle
      // qui a le plus de chances de porter la dernière correction. Un choix
      // déjà fait par l'utilisateur survit à une réanalyse.
      setKeep(previous => {
        const next: Record<string, string> = {}
        for (const group of found) next[group.fingerprint] = previous[group.fingerprint] ?? group.files[0].id
        return next
      })
    } catch (caught) {
      setError(describeApiError(caught, 'Analyse des doublons'))
    } finally {
      setLoading(false)
    }
  }, [])

  const surplus = groups?.reduce((total, group) => total + group.files.length - 1, 0) ?? 0

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-ink-850 bg-ink-950/95 px-4 py-2 backdrop-blur">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Doublons de contenu</p>
          <p className="truncate text-[11px] text-ink-500">
            {groups === null
              ? 'Compare les cartes, jamais les métadonnées.'
              : groups.length === 0
                ? 'Aucun contenu en double.'
                : `${plural(groups.length, 'groupe')} · ${plural(surplus, 'fichier')} en trop`}
          </p>
        </div>
        <IconButton label="Relancer l’analyse" onClick={() => void analyse()} disabled={loading}>
          <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error !== null ? (
          <div className="p-4">
            <ErrorBanner message={error} onRetry={() => void analyse()} />
          </div>
        ) : groups === null ? (
          loading ? (
            <div className="p-6">
              <Spinner label="Lecture de toute la bibliothèque…" />
            </div>
          ) : (
            <div>
              <EmptyState
                icon={<ScanSearch size={40} />}
                title="Chercher les doublons"
                hint="L’analyse lit le contenu de toutes les cartes mentales et regroupe celles qui portent exactement les mêmes cartes. Seul le contenu compte : ni l’auteur, ni le type, ni les noms de fichiers n’entrent en jeu."
              />
              <div className="flex justify-center px-6 pb-10">
                <Button tone="primary" onClick={() => void analyse()}>
                  Lancer l’analyse
                </Button>
              </div>
            </div>
          )
        ) : loading ? (
          <div className="p-6">
            <Spinner label="Analyse en cours…" />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={40} />}
            title="Aucun doublon"
            hint="Chaque carte mentale du serveur porte un contenu unique. C’est l’état normal."
          />
        ) : (
          <>
            <p className="px-4 pb-1 pt-3 text-[11px] text-ink-500">
              Choisissez le fichier à garder dans chaque groupe, puis supprimez les autres.
            </p>
            <ul className="flex flex-col">
              {groups.map(group => (
                <GroupCard
                  key={group.fingerprint}
                  group={group}
                  keepId={keep[group.fingerprint] ?? group.files[0].id}
                  onPick={id => setKeep(previous => ({ ...previous, [group.fingerprint]: id }))}
                  onArbitrate={() => setConfirming(group)}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {confirming !== null && (
        <ArbitrateSheet
          group={confirming}
          keepId={keep[confirming.fingerprint] ?? confirming.files[0].id}
          onClose={() => setConfirming(null)}
          onSubmit={async ids => {
            await removeMaps(ids)
            setConfirming(null)
            await analyse()
          }}
        />
      )}
    </div>
  )
}

function GroupCard({
  group,
  keepId,
  onPick,
  onArbitrate,
}: {
  group: DuplicateGroup
  keepId: string
  onPick: (id: string) => void
  onArbitrate: () => void
}) {
  const others = group.files.length - 1

  return (
    <li className="border-b border-ink-900 px-4 py-4">
      <div className="mb-2 flex items-center gap-2">
        <Copy size={16} className="shrink-0 text-warn" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{plural(group.cardCount, 'carte')} identiques</h2>
        <Badge tone="warn">{plural(group.files.length, 'fichier')}</Badge>
      </div>

      <ul className="flex flex-col gap-2">
        {group.files.map(file => {
          const kept = file.id === keepId
          return (
            <li key={file.id}>
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                  kept ? 'border-accent/60 bg-accent-soft/20' : 'border-ink-800 bg-ink-900/60 hover:bg-ink-850'
                }`}
              >
                <input
                  type="radio"
                  name={group.files[0].id}
                  checked={kept}
                  onChange={() => onPick(file.id)}
                  className="mt-1 size-4 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{nameOf(file.path)}</span>
                  <span className="block truncate text-[11px] text-ink-500">
                    {parentOf(file.path) === '' ? 'À la racine' : `Dans « ${parentOf(file.path)} »`}
                  </span>
                  <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
                    <dt className="text-ink-500">Auteur</dt>
                    <dd className="truncate text-ink-300">{file.author}</dd>
                    <dt className="text-ink-500">Type</dt>
                    <dd className="text-ink-300">{MAP_TYPE_LABELS[mapTypeOf(file.type)]}</dd>
                    <dt className="text-ink-500">Créé le</dt>
                    <dd className="text-ink-300">{fullDate(file.created)}</dd>
                    <dt className="text-ink-500">Modifié le</dt>
                    <dd className="text-ink-300">{fullDate(file.updated)}</dd>
                  </dl>
                </span>
                {kept && <Badge tone="accent">Conservé</Badge>}
              </label>
            </li>
          )
        })}
      </ul>

      <div className="mt-3 flex justify-end">
        <Button tone="danger" onClick={onArbitrate} disabled={others < 1}>
          <Trash2 size={16} />
          {others > 1 ? `Garder celui-ci et supprimer les ${others} autres` : 'Garder celui-ci et supprimer l’autre'}
        </Button>
      </div>
    </li>
  )
}

function ArbitrateSheet({
  group,
  keepId,
  onClose,
  onSubmit,
}: {
  group: DuplicateGroup
  keepId: string
  onClose: () => void
  onSubmit: (ids: readonly string[]) => Promise<void>
}) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const kept = group.files.find(file => file.id === keepId) ?? group.files[0]
  const doomed = group.files.filter(file => file.id !== kept.id)

  async function submit() {
    setWorking(true)
    setError(null)
    try {
      await onSubmit(doomed.map(file => file.id))
    } catch (caught) {
      setError(describeApiError(caught, 'Suppression des doublons'))
      setWorking(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Arbitrer ce doublon"
      footer={
        <div className="flex gap-2">
          <Button tone="ghost" onClick={onClose} className="flex-1" disabled={working}>
            Annuler
          </Button>
          <Button tone="danger" onClick={() => void submit()} disabled={working} className="flex-1">
            {working ? 'Suppression…' : `Supprimer ${doomed.length}`}
          </Button>
        </div>
      }
    >
      {error !== null && (
        <div className="mb-3">
          <ErrorBanner message={error} />
        </div>
      )}

      <p className="text-sm">
        Conserver <strong>« {nameOf(kept.path)} »</strong> et supprimer&nbsp;:
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {doomed.map(file => (
          <li key={file.id} className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2">
            <span className="block truncate text-sm text-ink-100">{file.path}</span>
            <span className="mt-0.5 block text-[11px] text-ink-500">
              {file.author} · {MAP_TYPE_LABELS[mapTypeOf(file.type)]} · modifié le {fullDate(file.updated)}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-ink-500">
        La suppression ne touche que le serveur. Les copies déjà présentes sur les appareils des élèves restent en place
        jusqu’à ce qu’ils les suppriment eux-mêmes.
      </p>
    </Sheet>
  )
}
