/**
 * « il y a 12 min » — how long ago something happened, in the one phrasing the
 * sidebar and the settings both use.
 *
 * Returns `null` for "never" or for a timestamp that does not parse, so a
 * caller never has to invent a fallback sentence: it decides what "never"
 * means in its own context.
 */
export function formatRelativeTime(iso: string | null, now: Date = new Date()): string | null {
  if (iso === null || iso === '') return null
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null

  const seconds = Math.round((now.getTime() - then) / 1000)
  // A clock that jumped backwards (or a timestamp a second in the future) reads
  // as "just now" rather than as a negative age.
  if (seconds < 60) return 'à l’instant'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `il y a ${minutes} min`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`

  return `il y a ${Math.round(hours / 24)} j`
}
