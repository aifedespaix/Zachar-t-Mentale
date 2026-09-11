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
  if (result.conflicts.length > 0) parts.push(`${result.conflicts.length} conflit(s)`)
  if ((result.notices ?? []).length > 0) parts.push(`${(result.notices ?? []).length} remarque(s)`)
  if (result.errors.length > 0) parts.push(`${result.errors.length} erreur(s)`)
  // The counts of an interrupted run are partial by definition: the suffix is
  // what keeps them from reading as a complete result.
  return `${parts.join(', ')}${result.cancelled ? ' (interrompue)' : ''}`
}
