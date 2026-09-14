/**
 * Une date que deux versions d'un même fichier peuvent se faire comparer.
 *
 * PocketBase écrit son `updated` comme `2026-09-10 19:00:00.000Z` — une espace
 * au lieu du `T` que certains moteurs exigent — donc la valeur est normalisée
 * avant d'atteindre `Date`. Une date illisible ressort TELLE QUELLE plutôt que
 * comme « Invalid Date » : l'utilisateur qui la lit dans un message d'erreur a
 * plus besoin de la valeur brute que d'un aveu d'échec.
 */
export function formatSyncMoment(value: string): string {
  const parsed = new Date(value.replace(' ', 'T'))
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('fr-FR')
}
