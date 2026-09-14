/**
 * Mise en forme : dates, tailles, pluriels. Pur, donc testable — ce qui compte
 * surtout pour les dates relatives, dont les seuils sont des choix arbitraires
 * qu'on veut pouvoir vérifier plutôt que redécouvrir à l'usage.
 */

/**
 * Une date PocketBase, en `Date`.
 *
 * PocketBase renvoie `2026-09-14 08:00:00.000Z` — un espace là où ISO 8601 met
 * un `T`. Safari refuse cette forme et rend `Invalid Date`, ce qui se voit sur
 * le téléphone et pas sur le poste de développement : exactement le bug qu'on
 * ne trouve jamais. On normalise donc avant de parser.
 */
export function parseServerDate(value: string): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const iso = value.trim().replace(' ', 'T')
  const date = new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * « il y a 12 min », « hier », « le 3 sept. ».
 *
 * Bascule vers une date absolue au-delà d'une semaine : « il y a 23 jours » est
 * une information qu'on doit reconvertir mentalement, alors qu'une date ne se
 * reconvertit pas.
 */
export function relativeTime(value: string, now = new Date()): string {
  const date = parseServerDate(value)
  if (date === null) return '—'
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000)

  if (seconds < 0) return 'à l’instant'
  if (seconds < 60) return 'à l’instant'
  if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)} min`
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600)
    return `il y a ${hours} h`
  }
  const days = Math.floor(seconds / 86400)
  if (days === 1) return 'hier'
  if (days < 7) return `il y a ${days} jours`
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}

/** La date complète, pour un `title` au survol — le détail que le relatif cache. */
export function fullDate(value: string): string {
  const date = parseServerDate(value)
  if (date === null) return '—'
  return date.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })
}

/** « 1 carte » / « 3 cartes » — le pluriel français d'un mot qui en prend un. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`
}

/** Une taille d'octets lisible, pour le poids d'un contenu collé. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} Kio`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mio`
}
