import type { DeletePlan } from '../../hooks/useDeleteMindMap'

/**
 * Ce qu'une suppression annonce AVANT d'agir.
 *
 * Un élève qui supprime un dossier mitoyen voit exactement ce qui part et ce
 * qui reste — les cartes du prof ne disparaissent plus sans un mot.
 */
export function DeletePlanSummary({ plan }: { plan: DeletePlan }) {
  const deletedCards = plan.files.filter(file => file.kind === 'mindmap').length
  const deletedOthers = plan.files.length - deletedCards
  const nothing = plan.files.length === 0
  return (
    <div style={{ display: 'grid', gap: 6, fontSize: 13, lineHeight: 1.5 }}>
      <p style={{ margin: 0 }}>
        {nothing
          ? 'Rien ne sera supprimé : vous n’êtes pas l’auteur de ce contenu.'
          : `${deletedCards} carte(s) supprimée(s)${deletedOthers > 0 ? ` et ${deletedOthers} autre(s) fichier(s)` : ''}.`}
      </p>
      {plan.keptCards.length > 0 && (
        <p style={{ margin: 0, color: 'var(--muted-foreground)' }}>
          {plan.keptCards.length} carte(s) conservée(s) en lecture seule : vous n’en êtes pas l’auteur.
        </p>
      )}
      {plan.remainingFolders.length > 0 && (
        <p style={{ margin: 0, color: 'var(--muted-foreground)' }}>
          {plan.remainingFolders.length} dossier(s) du prof resteront.
        </p>
      )}
    </div>
  )
}
