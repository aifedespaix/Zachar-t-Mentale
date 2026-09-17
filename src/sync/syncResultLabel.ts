import type { SyncResult } from './syncService'

/**
 * The one wording for a finished sync — « 3 envoyé(s), 2 reçu(s) », plus what
 * happened beside the transfers: relocations, conflict count, remarks and
 * failures, and the « (interrompue) » suffix of a run that did not finish.
 *
 * Shared by the settings panel and the sidebar's footer so the same run never
 * reads two different ways, and so the counters cannot drift apart from the
 * ones the sync service actually fills in.
 */
export function syncResultLabel(result: SyncResult): string {
  const parts = [`${result.pushed} envoyé(s)`, `${result.pulled} reçu(s)`]
  // Un déplacement n'est ni un envoi ni une réception : sans cette ligne, une
  // sync qui n'a fait que replacer des fichiers se lirait « 0 envoyé(s) », soit
  // exactement la confusion que le compteur « à envoyer » évite par ailleurs.
  if ((result.relocated ?? 0) > 0) parts.push(`${result.relocated ?? 0} déplacé(s)`)
  // Une adoption de type n'est ni un envoi ni une réception : comme un
  // déplacement, elle doit se lire même quand les deux compteurs sont à zéro.
  if ((result.reclassified ?? 0) > 0) parts.push(`${result.reclassified ?? 0} reclassé(s)`)
  // Une publication automatique n'est pas non plus un envoi : c'est ce qui a
  // rendu l'envoi possible, un pas de plus qui mérite sa propre ligne.
  if ((result.published ?? 0) > 0) parts.push(`${result.published ?? 0} publié(s)`)
  const floated = (result.merged ?? []).reduce((sum, entry) => sum + entry.floatedCount, 0)
  if (floated > 0) parts.push(`${floated} carte(s) mise(s) de côté`)
  if ((result.localDeleted ?? 0) > 0) parts.push(`${result.localDeleted ?? 0} supprimé(s) ici`)
  if ((result.remoteDeleted ?? 0) > 0) parts.push(`${result.remoteDeleted ?? 0} supprimé(s) sur le serveur`)
  // Un conflit est déjà TRANCHÉ quand `sync()` revient (voir
  // `2026-09-15-autorite-prof-conflits-design.md`) : le mot le dit, pour ne
  // pas laisser croire qu'une décision attend encore quelque part.
  if (result.conflicts.length > 0) parts.push(`${result.conflicts.length} conflit(s) résolu(s)`)
  if ((result.notices ?? []).length > 0) parts.push(`${(result.notices ?? []).length} remarque(s)`)
  if (result.errors.length > 0) parts.push(`${result.errors.length} erreur(s)`)
  // The counts of an interrupted run are partial by definition: the suffix is
  // what keeps them from reading as a complete result.
  return `${parts.join(', ')}${result.cancelled ? ' (interrompue)' : ''}`
}

/**
 * Le résumé que l'utilisateur lit quand un lot a des ratés : deux nombres, pas
 * la liste. « X fichiers synchronisés, Y non synchronisés » répond à la seule
 * question qu'on se pose devant un bandeau d'erreur — est-ce que quelque chose
 * est passé ? — et le détail par fichier vit dans la modale, pas dans une
 * colonne de 240 px.
 *
 * `synchronisés` = ce qui a effectivement bougé (envoyé + reçu) ; `non
 * synchronisés` = les échecs par fichier. Un conflit n'entre dans aucun des
 * deux : il est déjà tranché, donc le fichier, lui, est passé.
 */
export function syncOutcomeSummary(result: SyncResult): string {
  const synced = result.pushed + result.pulled
  const failed = result.errors.length
  return `${synced} fichier${synced > 1 ? 's' : ''} synchronisé${synced > 1 ? 's' : ''}, ${failed} non synchronisé${failed > 1 ? 's' : ''}`
}

/**
 * Le détail d'une exécution, une ligne par fait — la matière de la modale
 * ouverte par « Détails ». L'ordre suit la gravité : conflits (tranchés mais
 * notables), erreurs, puis remarques.
 */
export function syncResultDetailLines(result: SyncResult): string[] {
  return [
    ...result.conflicts.map(conflict => `conflit résolu : ${conflict.path}`),
    ...result.errors.map(error => `${error.fileId} : ${error.message}`),
    ...(result.notices ?? []).map(notice => notice.message),
  ]
}
