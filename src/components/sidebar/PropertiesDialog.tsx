// src/components/sidebar/PropertiesDialog.tsx
import { useEffect, useState, type ReactNode } from 'react'
import { stat, type FileInfo } from '@tauri-apps/plugin-fs'
import { ClipboardCopy, Check } from 'lucide-react'
import type { Card, MindMapMeta } from '../../types/card'
import { ALL_CARD_LEVELS } from '../../types/card'
import type { FileTreeNode } from '../../types/workspace'
import { loadMindMap, loadMindMapMeta } from '../../persistence/fileStore'
import { mindMapBaseName, parentDirOf } from '../../persistence/paths'
import { formatFileSize, formatDateTime, tallyCards, tallyTree } from '../../persistence/mindMapProperties'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { formatRelativeTime } from '../../utils/relativeTime'
import { MAP_TYPE_LABELS, isKnownMapType, type MapType } from '../../types/mapType'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { TooltipProvider } from '../ui/tooltip'
import { MapTypeBadge } from './MapTypeBadge'

/** One line of the sheet: a label on the left, the value on the right. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div data-property-row style={{ display: 'flex', gap: 12, alignItems: 'baseline', minHeight: 22 }}>
      <span style={{ flexShrink: 0, width: 150, color: 'var(--muted-foreground)', fontSize: 12 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, wordBreak: 'break-word' }}>{children}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <h3
        style={{
          margin: '4px 0 2px',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--muted-foreground)',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  )
}

/** A path (or any value) with a copy affordance, and a short « Copié » confirmation. */
function CopyableValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        title={label}
        style={{ flexShrink: 0 }}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            })
            .catch(() => {})
        }}
      >
        {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
      </Button>
    </span>
  )
}

function typeLabel(meta: MindMapMeta | null): string {
  const type: MapType | undefined = meta?.type
  if (type === undefined) return MAP_TYPE_LABELS.default
  if (isKnownMapType(type)) return MAP_TYPE_LABELS[type]
  return type
}

function roleLabel(role: MindMapMeta['role'] | undefined): string {
  if (role === 'prof') return 'Prof'
  if (role === 'eleve') return 'Élève'
  return '—'
}

/**
 * « Propriétés » — everything the app knows about ONE row, without touching the
 * database or the file: the paths, the file's real timestamps, and (for a mind
 * map) the `meta` header it carries. Everything is read once, when the sheet
 * opens, so it always describes the file as it is now rather than as the tree
 * last scanned it.
 */
export function PropertiesDialog({
  node,
  isRoot = false,
  onClose,
}: {
  node: FileTreeNode
  isRoot?: boolean
  onClose: () => void
}) {
  const recentFiles = useWorkspaceStore(s => s.recentFiles)
  const [info, setInfo] = useState<FileInfo | null>(null)
  const [meta, setMeta] = useState<MindMapMeta | null>(null)
  const [cards, setCards] = useState<Card[] | null>(null)
  const [loading, setLoading] = useState(true)

  const isMap = node.type === 'mindmap'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setInfo(null)
    setMeta(null)
    setCards(null)
    void Promise.all([
      stat(node.path).catch(() => null),
      isMap ? loadMindMapMeta(node.path).catch(() => null) : Promise.resolve(null),
      isMap ? loadMindMap(node.path).catch(() => null) : Promise.resolve(null),
    ]).then(([fileInfo, loadedMeta, loadedCards]) => {
      if (cancelled) return
      setInfo(fileInfo)
      setMeta(loadedMeta)
      setCards(loadedCards)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [node.path, isMap])

  const cardTally = cards === null ? null : tallyCards(cards)
  const treeTally = node.type === 'folder' ? tallyTree(node) : null
  const lastOpened = recentFiles.find(file => file.path === node.path)?.openedAt ?? null

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ overflowWrap: 'anywhere' }}>
              {isMap ? mindMapBaseName(node.name) : node.name}
            </span>
            {/* The badge owns a Tooltip, so the sheet brings its own provider rather
                than relying on the sidebar's: this dialog may be opened from anywhere,
                and a component that only works inside one ambient provider is a trap. */}
            {isMap && meta?.type !== undefined && (
              <TooltipProvider>
                <MapTypeBadge type={meta.type} />
              </TooltipProvider>
            )}
          </DialogTitle>
        </DialogHeader>

        <div
          data-testid="properties-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '60vh', overflowY: 'auto' }}
        >
          {loading && <p style={{ margin: 0, fontSize: 12, color: 'var(--muted-foreground)' }}>Lecture des informations…</p>}

          <Section title="Identité">
            <Row label="Nom du fichier">{node.name}</Row>
            {isMap && <Row label="Nom affiché">{mindMapBaseName(node.name)}</Row>}
            <Row label="Type">{isMap ? typeLabel(meta) : node.type === 'folder' ? 'Dossier' : 'Fichier non pris en charge'}</Row>
            {isMap && meta?.type !== undefined && meta.type !== 'default' && (
              <Row label="Valeur du type">{meta.type}</Row>
            )}
            <Row label="Emplacement">
              <CopyableValue value={parentDirOf(node.path)} label="Copier l’emplacement" />
            </Row>
            <Row label="Chemin complet">
              <CopyableValue value={node.path} label="Copier le chemin" />
            </Row>
            {isRoot && <Row label="Rôle">Dossier racine de l’espace de travail</Row>}
          </Section>

          {node.type === 'folder' && treeTally !== null && (
            <Section title="Contenu">
              <Row label="Éléments">{treeTally.total}</Row>
              <Row label="Sous-dossiers">{treeTally.folders}</Row>
              <Row label="Cartes mentales">{treeTally.mindmaps}</Row>
              <Row label="Autres fichiers">{treeTally.others}</Row>
            </Section>
          )}

          {isMap && cardTally !== null && (
            <Section title="Contenu">
              <Row label="Nœuds (cartes)">{cardTally.total}</Row>
              {ALL_CARD_LEVELS.map(level => (
                <Row key={level} label={`Cartes de niveau ${level}`}>
                  {cardTally.byLevel[level]}
                </Row>
              ))}
            </Section>
          )}

          <Section title="Fichier">
            <Row label="Taille">{info === null ? '—' : formatFileSize(info.size)}</Row>
            <Row label="Créé le">
              {formatDateTime(info?.birthtime) ?? '—'}
            </Row>
          </Section>

          <Section title="Historique">
            <Row label={isMap ? 'Dernière sauvegarde' : 'Modifié sur le disque'}>
              {(() => {
                const absolute = formatDateTime(info?.mtime)
                if (absolute === null) return '—'
                const relative = info?.mtime == null ? null : formatRelativeTime(info.mtime.toISOString())
                return relative === null ? absolute : `${absolute} (${relative})`
              })()}
            </Row>
            {isMap && (
              <Row label="Modification déclarée">
                {(() => {
                  const absolute = formatDateTime(meta?.lastModified)
                  if (absolute === null) return '—'
                  const relative = formatRelativeTime(meta?.lastModified ?? null)
                  return relative === null ? absolute : `${absolute} (${relative})`
                })()}
              </Row>
            )}
            <Row label="Dernière ouverture">
              {(() => {
                const absolute = formatDateTime(lastOpened)
                if (absolute === null) return 'Jamais ouverte dans l’app'
                const relative = formatRelativeTime(lastOpened)
                return relative === null ? absolute : `${absolute} (${relative})`
              })()}
            </Row>
          </Section>

          {isMap && meta !== null && (
            <Section title="Auteur et synchronisation">
              <Row label="Auteur">
                {meta.author !== '' ? meta.author : '—'}
                {meta.role !== undefined && ` (${roleLabel(meta.role)})`}
              </Row>
              <Row label="Identifiant">
                <CopyableValue value={meta.id} label="Copier l’identifiant" />
              </Row>
              {meta.copyLink !== undefined && (
                <Row label="Lien de copie">
                  {meta.copyLink.role === 'source' ? 'Carte originale' : 'Copie'}
                </Row>
              )}
              <Row label="Référence d’exercice">{meta.correctsId ?? '—'}</Row>
            </Section>
          )}

          {isMap && meta === null && !loading && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted-foreground)' }}>
              Cette carte n’a jamais été synchronisée : elle n’a donc ni auteur ni identifiant.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
