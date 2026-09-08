/**
 * A human-readable cause for an export failure.
 *
 * `html-to-image` does not reject with an `Error`. When it cannot embed a
 * resource it rejects with the DOM `Event` from the failed load — so the
 * ordinary `error instanceof Error ? error.message : 'erreur inconnue'` shape
 * reports "erreur inconnue" for the single most likely export failure there
 * is: an image the capture could not re-encode.
 *
 * Naming that case matters because the user can act on it, and because the
 * app's standing rule is that no state is hidden without explanation.
 */
export function describeExportError(error: unknown): string {
  if (error instanceof Error) return error.message

  if (typeof Event !== 'undefined' && error instanceof Event) {
    const target = error.target as { tagName?: string; src?: string } | null
    if (target?.tagName === 'IMG') {
      const name = target.src ? ` (${target.src.split('/').pop()})` : ''
      return `une image n’a pas pu être intégrée à la capture${name}`
    }
    return `échec du chargement d’une ressource pendant la capture (${error.type})`
  }

  if (typeof error === 'string' && error !== '') return error
  return 'erreur inconnue'
}
