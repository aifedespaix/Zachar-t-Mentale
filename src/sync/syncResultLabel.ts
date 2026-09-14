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
  // Une adoption n'est pas un envoi non plus : elle dit « ces cartes n'avaient
  // pas d'identité de synchronisation, elles en ont une maintenant » — et c'est
  // la seule trace de ce que la passe 0 a fait au dossier.
  if ((result.published ?? 0) > 0) parts.push(`${result.published ?? 0} publiée(s)`)
  const floated = (result.merged ?? []).reduce((sum, entry) => sum + entry.floatedCount, 0)
  if (floated > 0) parts.push(`${floated} carte(s) mise(s) de côté`)
  if (result.conflicts.length > 0) parts.push(`${result.conflicts.length} conflit(s)`)
  if ((result.notices ?? []).length > 0) parts.push(`${(result.notices ?? []).length} remarque(s)`)
  if (result.errors.length > 0) parts.push(`${result.errors.length} erreur(s)`)
  // The counts of an interrupted run are partial by definition: the suffix is
  // what keeps them from reading as a complete result.
  return `${parts.join(', ')}${result.cancelled ? ' (interrompue)' : ''}`
}
