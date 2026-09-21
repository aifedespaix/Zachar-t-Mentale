import { useEffect, useMemo, useState } from 'react'
import {
  ChevronsDownUp,
  FolderPlus,
  FolderTree,
  Pencil,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  FolderInput,
  FileCode2,
  X,
} from 'lucide-react'
import { FileTree } from './FileTree'
import { MapContentSheet } from './MapContentSheet'
import { Badge, Button, EmptyState, ErrorBanner, Field, IconButton, Sheet, Spinner, inputClass } from './ui/primitives'
import { useLibrary } from '@/state/useLibrary'
import {
  allFolderPaths,
  countMaps,
  filterTree,
  isValidSegment,
  joinPath,
  movedTo,
  moveObjection,
  nameOf,
  normalizePath,
  parentOf,
  renamedTo,
  type TreeNode,
} from '@/lib/tree'
import { MAP_TYPES, MAP_TYPE_LABELS, mapTypeOf } from '@app/types/mapType'
import { plural } from '@/lib/format'
import type { AdminUser } from '@/lib/pb'
import { withMindMapExtension } from '@app/persistence/paths'
import { kebabCase } from '@app/utils/kebabCase'

/**
 * L'écran principal : tout le contenu du serveur, et tous les gestes dessus.
 *
 * Les dossiers ouverts sont mémorisés dans le `localStorage`. Ce n'est pas du
 * confort : sur un téléphone, on quitte l'application pour lire un message et
 * on revient trente secondes plus tard, et retrouver l'arbre entièrement replié
 * à chaque fois rend l'outil pénible exactement dans la situation où il doit
 * être rapide.
 */
const EXPANDED_KEY = 'zm-admin:expanded'

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    return new Set(raw === null ? [] : (JSON.parse(raw) as string[]))
  } catch {
    return new Set()
  }
}

type Pending =
  | { kind: 'rename'; node: TreeNode }
  | { kind: 'move'; node: TreeNode }
  | { kind: 'delete'; node: TreeNode }
  | { kind: 'type'; node: Extract<TreeNode, { kind: 'map' }> }
  | { kind: 'new-folder'; parent: string }

export function LibraryView({ user }: { user: AdminUser }) {
  const {
    tree,
    maps,
    conflicts,
    loadingLibrary,
    libraryError,
    busy,
    refreshLibrary,
    addFolder,
    relocate,
    remove,
    setMapType,
  } = useLibrary()

  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded)
  const [actionsFor, setActionsFor] = useState<TreeNode | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [openMapId, setOpenMapId] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]))
    } catch {
      // Un navigateur en navigation privée refuse d'écrire : l'arbre repart
      // replié au prochain chargement, et rien d'autre ne change.
    }
  }, [expanded])

  const filtered = useMemo(() => filterTree(tree, query), [tree, query])

  /**
   * Une recherche déplie tout ce qu'elle a trouvé.
   *
   * Sans ça, filtrer sur « équations » afficherait un dossier « Maths » replié
   * — c'est-à-dire un écran qui dit « j'ai trouvé quelque chose » sans montrer
   * quoi, et qui demande encore deux appuis.
   */
  const searchExpanded = useMemo(() => {
    if (query.trim() === '') return null
    const paths = new Set<string>()
    const visit = (node: TreeNode) => {
      if (node.kind !== 'folder') return
      paths.add(node.path)
      node.children.forEach(visit)
    }
    filtered.forEach(visit)
    return paths
  }, [filtered, query])

  const conflictedFileIds = useMemo(
    () => new Set(conflicts.filter(entry => entry.status === 'open').map(entry => entry.file_id)),
    [conflicts]
  )

  const folderPaths = useMemo(() => allFolderPaths(tree), [tree])

  function toggle(path: string) {
    setExpanded(previous => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const openMap = openMapId === null ? null : maps.find(entry => entry.id === openMapId) ?? null

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-ink-850 bg-ink-950/95 backdrop-blur">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="relative min-w-0 flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Rechercher un chapitre, un élève…"
              type="search"
              className={`${inputClass} pl-9 pr-9`}
            />
            {query !== '' && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Effacer la recherche"
                className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-ink-500 hover:text-ink-100"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <IconButton label="Nouveau dossier" onClick={() => setPending({ kind: 'new-folder', parent: '' })}>
            <FolderPlus size={20} />
          </IconButton>
          <IconButton label="Tout replier" onClick={() => setExpanded(new Set())}>
            <ChevronsDownUp size={20} />
          </IconButton>
          <IconButton label="Rafraîchir" onClick={() => void refreshLibrary()} disabled={loadingLibrary}>
            <RefreshCw size={20} className={loadingLibrary ? 'animate-spin' : ''} />
          </IconButton>
        </div>

        <div className="flex items-center gap-2 px-4 pb-2 text-xs text-ink-500">
          <span>{plural(maps.length, 'carte')}</span>
          <span aria-hidden="true">·</span>
          <span>{plural(folderPaths.length, 'dossier')}</span>
          {conflictedFileIds.size > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <Badge tone="danger">{plural(conflictedFileIds.size, 'conflit')}</Badge>
            </>
          )}
          {busy !== null && (
            <span className="ml-auto">
              {busy.label} {busy.done}/{busy.total}
            </span>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {libraryError !== null ? (
          <div className="p-4">
            <ErrorBanner message={libraryError} onRetry={() => void refreshLibrary()} />
          </div>
        ) : loadingLibrary && maps.length === 0 ? (
          <div className="p-6">
            <Spinner label="Chargement de la bibliothèque…" />
          </div>
        ) : filtered.length === 0 ? (
          query !== '' ? (
            <EmptyState icon={<Search size={40} />} title="Aucun résultat" hint={`Rien ne correspond à « ${query} ».`} />
          ) : (
            <EmptyState
              icon={<FolderTree size={40} />}
              title="La bibliothèque est vide"
              hint="Créez une carte depuis l’onglet « Nouvelle », ou attendez la première synchronisation d’un élève."
            />
          )
        ) : (
          <FileTree
            nodes={filtered}
            callbacks={{
              onOpenMap: node => setOpenMapId(node.map.id),
              onActions: node => setActionsFor(node),
              isExpanded: path => (searchExpanded ?? expanded).has(path),
              toggle,
              conflictedFileIds,
            }}
          />
        )}
      </div>

      <ActionsSheet
        node={actionsFor}
        onClose={() => setActionsFor(null)}
        onPick={action => {
          const node = actionsFor
          setActionsFor(null)
          if (node === null) return
          if (action === 'open' && node.kind === 'map') setOpenMapId(node.map.id)
          else if (action === 'new-folder') setPending({ kind: 'new-folder', parent: node.path })
          else if (action === 'type' && node.kind === 'map') setPending({ kind: 'type', node })
          else if (action === 'rename' || action === 'move' || action === 'delete') {
            setPending({ kind: action, node })
          }
        }}
      />

      {pending?.kind === 'rename' && (
        <RenameSheet
          node={pending.node}
          onClose={() => setPending(null)}
          onSubmit={async name => {
            const target = renamedTo(pending.node.path, name)
            await relocate(pending.node.path, target, 'Renommage')
            setPending(null)
          }}
        />
      )}

      {pending?.kind === 'move' && (
        <MoveSheet
          node={pending.node}
          folderPaths={folderPaths}
          onClose={() => setPending(null)}
          onSubmit={async destination => {
            const target =
              pending.node.kind === 'folder'
                ? joinPath(destination, nameOf(pending.node.path))
                : movedTo(pending.node.path, destination)
            await relocate(pending.node.path, target, 'Déplacement')
            setPending(null)
          }}
        />
      )}

      {pending?.kind === 'delete' && (
        <DeleteSheet
          node={pending.node}
          onClose={() => setPending(null)}
          onConfirm={async () => {
            await remove(pending.node.path)
            setPending(null)
          }}
        />
      )}

      {pending?.kind === 'type' && (
        <TypeSheet
          current={pending.node.map.type}
          onClose={() => setPending(null)}
          onPick={async type => {
            await setMapType(pending.node.map.id, type)
            setPending(null)
          }}
        />
      )}

      {pending?.kind === 'new-folder' && (
        <NewFolderSheet
          parent={pending.parent}
          onClose={() => setPending(null)}
          onSubmit={async name => {
            await addFolder(joinPath(pending.parent, name), user.username)
            setExpanded(previous => new Set(previous).add(pending.parent))
            setPending(null)
          }}
        />
      )}

      {openMap !== null && <MapContentSheet map={openMap} user={user} onClose={() => setOpenMapId(null)} />}
    </div>
  )
}

type Action = 'open' | 'rename' | 'move' | 'delete' | 'type' | 'new-folder'

function ActionsSheet({
  node,
  onClose,
  onPick,
}: {
  node: TreeNode | null
  onClose: () => void
  onPick: (action: Action) => void
}) {
  if (node === null) return null
  const rows: { action: Action; icon: React.ReactNode; label: string; danger?: boolean }[] = [
    ...(node.kind === 'map'
      ? ([
          { action: 'open', icon: <FileCode2 size={18} />, label: 'Ouvrir / modifier le contenu' },
          { action: 'type', icon: <Tag size={18} />, label: 'Changer le type' },
        ] as const)
      : ([{ action: 'new-folder', icon: <FolderPlus size={18} />, label: 'Nouveau sous-dossier' }] as const)),
    { action: 'rename', icon: <Pencil size={18} />, label: 'Renommer' },
    { action: 'move', icon: <FolderInput size={18} />, label: 'Déplacer vers…' },
    { action: 'delete', icon: <Trash2 size={18} />, label: 'Supprimer', danger: true },
  ]

  return (
    <Sheet open onClose={onClose} title={node.name}>
      <ul className="flex flex-col gap-1">
        {rows.map(row => (
          <li key={row.action}>
            <button
              type="button"
              onClick={() => onPick(row.action)}
              className={`tap flex w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors hover:bg-ink-850 ${
                row.danger === true ? 'text-danger' : 'text-ink-100'
              }`}
            >
              {row.icon}
              {row.label}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

function RenameSheet({
  node,
  onClose,
  onSubmit,
}: {
  node: TreeNode
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(node.name)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit() {
    const trimmed = name.trim()
    if (!isValidSegment(trimmed)) {
      setError('Nom invalide : évitez / \\ : * ? " < > | et les noms « . » ou « .. ».')
      return
    }
    // Un `.zmap` renommé en « Chapitre 2 » cesserait d'être une carte mentale
    // pour l'application : l'extension est ce qui la rend ouvrable.
    const final = node.kind === 'map' ? withMindMapExtension(trimmed) : trimmed
    if (final === node.name) {
      onClose()
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit(final)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Le renommage a échoué.')
      setSaving(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Renommer"
      footer={
        <div className="flex gap-2">
          <Button tone="ghost" onClick={onClose} className="flex-1">
            Annuler
          </Button>
          <Button tone="primary" onClick={() => void submit()} disabled={saving} className="flex-1">
            {saving ? 'Enregistrement…' : 'Renommer'}
          </Button>
        </div>
      }
    >
      <Field
        label={node.kind === 'folder' ? 'Nom du dossier' : 'Nom du fichier'}
        error={error}
        hint={node.kind === 'map' ? 'L’extension .zmap est ajoutée si vous l’omettez.' : undefined}
      >
        <input
          autoFocus
          value={name}
          onChange={event => setName(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') void submit()
          }}
          className={inputClass}
        />
      </Field>
      {node.kind === 'folder' && countMaps(node) > 0 && (
        <p className="mt-3 text-xs text-ink-500">
          {plural(countMaps(node), 'carte')} suivra ce dossier : leur chemin sera réécrit.
        </p>
      )}
    </Sheet>
  )
}

function MoveSheet({
  node,
  folderPaths,
  onClose,
  onSubmit,
}: {
  node: TreeNode
  folderPaths: readonly string[]
  onClose: () => void
  onSubmit: (destination: string) => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const current = parentOf(node.path)

  /**
   * Les destinations offertes, objections comprises.
   *
   * On AFFICHE les destinations impossibles, désactivées et expliquées, plutôt
   * que de les cacher : un dossier absent de la liste ressemble à un bug, un
   * dossier grisé qui dit pourquoi ne ressemble à rien d'autre qu'à la vérité.
   */
  const destinations = useMemo(
    () =>
      ['', ...folderPaths].map(path => ({
        path,
        label: path === '' ? 'Racine' : path,
        objection: moveObjection(node.path, path, node.kind),
      })),
    [folderPaths, node]
  )

  async function pick(destination: string) {
    setSaving(true)
    setError(null)
    try {
      await onSubmit(destination)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Le déplacement a échoué.')
      setSaving(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={`Déplacer « ${node.name} »`}>
      {error !== null && <div className="mb-3"><ErrorBanner message={error} /></div>}
      <p className="mb-3 text-xs text-ink-500">
        Actuellement dans {current === '' ? 'la racine' : `« ${current} »`}.
      </p>
      <ul className="flex flex-col gap-1">
        {destinations.map(destination => (
          <li key={destination.path}>
            <button
              type="button"
              disabled={destination.objection !== null || saving}
              onClick={() => void pick(destination.path)}
              className="tap flex w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors enabled:hover:bg-ink-850 disabled:opacity-35"
            >
              <FolderInput size={18} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{destination.label}</span>
                {destination.objection !== null && (
                  <span className="block truncate text-[11px] text-ink-500">{destination.objection}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

function DeleteSheet({ node, onClose, onConfirm }: { node: TreeNode; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const count = countMaps(node)

  return (
    <Sheet
      open
      onClose={onClose}
      title="Supprimer"
      footer={
        <div className="flex gap-2">
          <Button tone="ghost" onClick={onClose} className="flex-1">
            Annuler
          </Button>
          <Button
            tone="danger"
            disabled={deleting}
            className="flex-1"
            onClick={() => {
              setDeleting(true)
              setError(null)
              onConfirm().catch((caught: unknown) => {
                setError(caught instanceof Error ? caught.message : 'La suppression a échoué.')
                setDeleting(false)
              })
            }}
          >
            {deleting ? 'Suppression…' : 'Supprimer'}
          </Button>
        </div>
      }
    >
      {error !== null && <div className="mb-3"><ErrorBanner message={error} /></div>}
      <p className="text-sm">
        Supprimer <strong>« {node.name} »</strong> du serveur&nbsp;?
      </p>
      {node.kind === 'folder' && count > 0 && (
        <p className="mt-2 text-sm text-danger">
          Ce dossier contient {plural(count, 'carte')}. Tout sera supprimé.
        </p>
      )}
      {/* La précision qui évite une mauvaise surprise : la suppression côté
          serveur ne repasse PAS sur les postes des élèves. */}
      <p className="mt-3 text-xs text-ink-500">
        La suppression ne touche que le serveur. Les copies déjà présentes sur les appareils des élèves restent en
        place jusqu’à ce qu’ils les suppriment eux-mêmes.
      </p>
    </Sheet>
  )
}

function TypeSheet({
  current,
  onClose,
  onPick,
}: {
  current: string
  onClose: () => void
  onPick: (type: string) => Promise<void>
}) {
  const active = mapTypeOf(current)
  return (
    <Sheet open onClose={onClose} title="Type de la carte">
      <ul className="flex flex-col gap-1">
        {(['default', ...MAP_TYPES] as const).map(type => (
          <li key={type}>
            <button
              type="button"
              onClick={() => void onPick(type)}
              className={`tap flex w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors hover:bg-ink-850 ${
                active === type ? 'bg-accent-soft/30 text-ink-100' : 'text-ink-300'
              }`}
            >
              <Tag size={18} className="shrink-0" />
              {MAP_TYPE_LABELS[type]}
              {active === type && <span className="ml-auto text-accent">✓</span>}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

function NewFolderSheet({
  parent,
  onClose,
  onSubmit,
}: {
  parent: string
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Toujours kebab-case, quoi que le prof tape : c'est le format que
  // l'application desktop impose déjà aux FICHIERS (`mindMapFileNameFor`), et
  // le laisser diverger pour les dossiers est précisément ce qui produit deux
  // matières qui ne diffèrent que par la casse d'une machine à l'autre.
  const slug = name.trim() === '' ? '' : kebabCase(name.trim())

  async function submit() {
    if (slug === '') {
      setError('Entrez un nom de dossier.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit(slug)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'La création a échoué.')
      setSaving(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Nouveau dossier"
      footer={
        <div className="flex gap-2">
          <Button tone="ghost" onClick={onClose} className="flex-1">
            Annuler
          </Button>
          <Button tone="primary" onClick={() => void submit()} disabled={saving} className="flex-1">
            {saving ? 'Création…' : 'Créer'}
          </Button>
        </div>
      }
    >
      <Field
        label="Nom du dossier"
        error={error}
        hint={parent === '' ? 'À la racine.' : `Dans « ${normalizePath(parent)} ».`}
      >
        <input
          autoFocus
          value={name}
          onChange={event => setName(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') void submit()
          }}
          placeholder="Chapitre 5"
          className={inputClass}
        />
      </Field>
      {slug !== '' && (
        <p className="mt-2 text-xs text-ink-500">
          Sera créé sous <span className="font-mono text-ink-300">{slug}</span>
        </p>
      )}
      {/* Dit franchement ce qu'un dossier vide peut et ne peut pas faire, plutôt
          que de laisser découvrir la limite. */}
      <p className="mt-3 text-xs text-ink-500">
        Un dossier vide est enregistré tel quel sur le serveur : il survivra au rechargement et descendra chez les
        élèves à leur prochaine synchronisation.
      </p>
    </Sheet>
  )
}
