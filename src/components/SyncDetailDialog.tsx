import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogFooter, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'

interface SyncDetailDialogProps {
  /** Le résumé déjà affiché dans le bandeau — on n'en réécrit pas un second. */
  summary: string
  /** Une ligne par fait : conflits tranchés, erreurs par fichier, remarques. */
  lines: string[]
  onClose: () => void
}

/**
 * La modale « Détails » d'une synchronisation.
 *
 * Le bandeau du bandeau latéral ne peut pas porter le détail par fichier : une
 * colonne de 240 px tronque chaque message. Ici le résumé reste en tête et les
 * faits s'empilent, lisibles en entier — c'est ce qu'on ouvre quand le « X non
 * synchronisés » ne suffit pas.
 */
export function SyncDetailDialog({ summary, lines, onClose }: SyncDetailDialogProps) {
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="sync-detail-dialog">
        <DialogHeader>
          <DialogTitle>Détails de la synchronisation</DialogTitle>
          <DialogDescription>{summary}</DialogDescription>
        </DialogHeader>

        {lines.length === 0 ? (
          <p style={{ margin: 0, opacity: 0.7 }}>Rien à détailler pour cette exécution.</p>
        ) : (
          <ul
            data-testid="sync-detail-lines"
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              maxHeight: 320,
              overflowY: 'auto',
            }}
          >
            {lines.map((line, index) => (
              <li
                key={index}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  lineHeight: 1.5,
                  padding: '6px 8px',
                  borderRadius: 8,
                  background: 'var(--muted)',
                  wordBreak: 'break-word',
                }}
              >
                {line}
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
