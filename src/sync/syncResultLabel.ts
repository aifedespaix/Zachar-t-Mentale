import type { SyncResult } from './syncService'

/**
 * The one wording for a finished sync — « 3 envoyé(s), 2 reçu(s) », plus the
 * failure count when the batch had any.
 *
 * Shared by the settings panel and the sidebar's footer so the same run never
 * reads two different ways, and so the counters cannot drift apart from the
 * ones the sync service actually fills in.
 */
export function syncResultLabel(result: SyncResult): string {
  const parts = [`${result.pushed} envoyé(s)`, `${result.pulled} reçu(s)`]
  if (result.errors.length > 0) parts.push(`${result.errors.length} erreur(s)`)
  return parts.join(', ')
}
