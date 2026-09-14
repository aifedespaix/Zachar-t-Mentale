import { useState } from 'react'
import { ArrowDownToLine, Copy, FolderTree, PencilLine, ShieldAlert } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { ALL_CARD_LEVELS } from '../../types/card'
import type { SyncConflict } from '../../sync/syncService'
import { countDelta, type CardCounts } from '../../sync/cardCounts'
import { describePathChange, type ConflictChoice } from '../../sync/conflictResolution'
import { fileNameOf, isSameFilePath, mindMapBaseName } from '../../persistence/paths'
import { formatSyncMoment } from '../../utils/syncMoment'

export interface ConflictResolutionDialogProps {
  /** La file d'attente, telle que le dernier résultat de synchronisation la donne. */
  conflicts: SyncConflict[]
  /** Le fichier ouvert dans le canevas, s'il y en a un : un tirage ne le réécrit jamais. */
  openFilePath?: string | null
  /** Enregistre la décision. `false` = elle n'a pas pu l'être, on reste sur ce conflit. */
  onResolve: (fileId: string, choice: ConflictChoice) => Promise<boolean>
  /** Rejoue une synchronisation, qui est ce qui APPLIQUE les décisions prises. */
  onApply: () => Promise<void>
  onClose: () => void
}

/** Une ligne du comparatif : un intitulé, et ce qu'en dit chaque côté. */
function ComparisonRow({
  label,
  local,
  remote,
  differs,
}: {
  label: string
  local: React.ReactNode
  remote: React.ReactNode
  differs?: boolean
}) {
  return (
    <>
      <div style={{ color: 'var(--muted-foreground)', fontSize: 12 }}>{label}</div>
      <div style={{ fontWeight: differs === true ? 600 : 400, color: differs === true ? 'var(--warning-fg)' : 'inherit' }}>
        {local}
      </div>
      <div style={{ fontWeight: differs === true ? 600 : 400, color: differs === true ? 'var(--warning-fg)' : 'inherit' }}>
        {remote}
      </div>
    </>
  )
}

/** Les niveaux, puis les volantes — ces dernières seulement s'il y en a quelque part. */
function levelRows(local: CardCounts, remote: CardCounts) {
  const rows = ALL_CARD_LEVELS.map(level => ({
    label: `Niveau ${level}`,
    local: local.byLevel[level],
    remote: remote.byLevel[level],
  }))
  if (local.detached > 0 || remote.detached > 0) {
    rows.push({ label: 'Cartes volantes', local: local.detached, remote: remote.detached })
  }
  return rows
}

/**
 * La résolution de conflits, un fichier à la fois.
 *
 * Un conflit est le seul moment où la synchronisation ne peut pas décider
 * seule : les deux versions contiennent du travail que quelqu'un a fait. Cette
 * boîte ne tranche donc rien — elle MONTRE (quand, quel nom, quel dossier,
 * combien de cartes à chaque niveau) et propose les trois seules issues
 * honnêtes : prendre celle du serveur, imposer la sienne, ou garder les deux.
 *
 * Aucun transfert n'a lieu ici. Chaque décision est enregistrée, et c'est la
 * synchronisation lancée à la fin qui l'exécute — c'est elle qui sait
 * télécharger les images et mettre les cartes absentes de côté au lieu de les
 * perdre. Voir `resolvedStateEntry`.
 */
export function ConflictResolutionDialog({
  conflicts,
  openFilePath,
  onResolve,
  onApply,
  onClose,
}: ConflictResolutionDialogProps) {
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [decided, setDecided] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)

  const total = conflicts.length + decided
  const current = conflicts[0]

  /** Ferme, en appliquant d'abord ce qui a déjà été décidé — sinon rien ne bouge. */
  async function finish() {
    if (decided > 0) {
      setApplying(true)
      try {
        await onApply()
      } finally {
        setApplying(false)
      }
    }
    onClose()
  }

  async function choose(choice: ConflictChoice) {
    if (current === undefined) return
    setBusy(true)
    setFailure(null)
    try {
      const resolved = await onResolve(current.fileId, choice)
      if (!resolved) {
        // On RESTE sur ce conflit : passer au suivant après un échec laisserait
        // croire que la décision est prise alors que rien n'a été enregistré.
        setFailure('Cette décision n’a pas pu être enregistrée. Le détail est dans le message de synchronisation.')
        return
      }
      setDecided(count => count + 1)
      // `conflicts` est la liste d'AVANT cette résolution : un seul élément
      // dedans veut dire « c'était le dernier », et il est temps d'appliquer.
      if (conflicts.length <= 1) {
        setApplying(true)
        try {
          await onApply()
        } finally {
          setApplying(false)
        }
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  if (current === undefined) {
    // Rien à résoudre : la boîte n'a aucune raison d'exister. Le cas arrive
    // quand une synchronisation de fond vide la liste pendant qu'elle est
    // ouverte.
    return (
      <Dialog open onOpenChange={open => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Plus aucun conflit</DialogTitle>
            <DialogDescription>Les versions locales et celles du serveur sont de nouveau d’accord.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => void finish()} disabled={applying}>
              {applying ? 'Application…' : 'Fermer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  const detail = current.detail
  const change = detail === undefined ? null : describePathChange(current.path, detail.remotePath)
  const isOpenInCanvas =
    detail !== undefined && openFilePath != null && isSameFilePath(detail.localPath, openFilePath)

  return (
    <Dialog open onOpenChange={open => !open && void finish()}>
      <DialogContent className="sm:max-w-2xl" data-testid="conflict-resolution-dialog">
        <DialogHeader>
          <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldAlert size={16} aria-hidden />
            Conflit {decided + 1} sur {total} — {mindMapBaseName(fileNameOf(current.path))}
          </DialogTitle>
          <DialogDescription>
            Cette carte a changé ici ET sur le serveur depuis la dernière synchronisation. Rien n’a été écrasé :
            choisissez la version à garder.
          </DialogDescription>
        </DialogHeader>

        {detail === undefined ? (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--warning-fg)' }}>
            ⚠ Ce conflit vient d’une synchronisation trop ancienne pour être comparée. Relancez une synchronisation
            pour le revoir en détail.
          </p>
        ) : (
          <>
            {(change?.nameChanged === true || change?.folderChanged === true) && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {change.nameChanged && (
                  <span className="conflict-flag">
                    <PencilLine size={12} aria-hidden /> Nom différent
                  </span>
                )}
                {change.folderChanged && (
                  <span className="conflict-flag">
                    <FolderTree size={12} aria-hidden /> Dossier différent
                  </span>
                )}
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(90px, auto) 1fr 1fr',
                gap: '6px 12px',
                alignItems: 'baseline',
                fontSize: 13,
              }}
            >
              <div />
              <div style={{ fontWeight: 600 }}>Ma version</div>
              <div style={{ fontWeight: 600 }}>Version du serveur</div>

              <ComparisonRow
                label="Modifiée le"
                local={formatSyncMoment(current.localModified)}
                remote={formatSyncMoment(current.remoteUpdated)}
              />
              <ComparisonRow
                label="Nom"
                local={change?.localName}
                remote={change?.remoteName}
                differs={change?.nameChanged}
              />
              <ComparisonRow
                label="Dossier"
                local={change?.localFolder === '' ? 'à la racine' : change?.localFolder}
                remote={change?.remoteFolder === '' ? 'à la racine' : change?.remoteFolder}
                differs={change?.folderChanged}
              />
              <ComparisonRow
                label="Cartes (total)"
                local={
                  <>
                    <strong>{detail.localCounts.total}</strong>{' '}
                    {countDelta(detail.localCounts.total, detail.remoteCounts.total) !== null && (
                      <span style={{ color: 'var(--muted-foreground)' }}>
                        ({countDelta(detail.localCounts.total, detail.remoteCounts.total)})
                      </span>
                    )}
                  </>
                }
                remote={<strong>{detail.remoteCounts.total}</strong>}
              />
              {levelRows(detail.localCounts, detail.remoteCounts).map(row => (
                <ComparisonRow
                  key={row.label}
                  label={row.label}
                  local={
                    <>
                      {row.local}{' '}
                      {countDelta(row.local, row.remote) !== null && (
                        <span style={{ color: 'var(--muted-foreground)' }}>({countDelta(row.local, row.remote)})</span>
                      )}
                    </>
                  }
                  remote={row.remote}
                  differs={row.local !== row.remote}
                />
              ))}
            </div>

            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
              Les cartes que le serveur n’a pas ne sont jamais supprimées : elles sont mises de côté en cartes
              volantes dans la carte reçue.
            </p>

            {isOpenInCanvas && (
              <p role="status" style={{ margin: 0, fontSize: 12.5, color: 'var(--warning-fg)' }}>
                ⚠ Cette carte est ouverte : fermez-la pour que la version du serveur puisse être écrite. Une
                synchronisation ne réécrit jamais le fichier en cours d’édition.
              </p>
            )}
          </>
        )}

        {failure !== null && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--warning-fg)' }}>
            ⚠ {failure}
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => void finish()} disabled={busy || applying}>
            {applying ? 'Application…' : 'Plus tard'}
          </Button>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Button
              className="conflict-choice conflict-choice--accept"
              onClick={() => void choose('accept-remote')}
              disabled={busy || applying || detail === undefined}
            >
              <ArrowDownToLine size={14} /> Accepter le changement
            </Button>
            <Button
              className="conflict-choice conflict-choice--keep"
              onClick={() => void choose('keep-local')}
              disabled={busy || applying || detail === undefined}
            >
              <ShieldAlert size={14} /> Refuser et garder ma version
            </Button>
            <Button
              className="conflict-choice conflict-choice--copy"
              onClick={() => void choose('copy')}
              disabled={busy || applying || detail === undefined}
            >
              <Copy size={14} /> Créer une copie
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
