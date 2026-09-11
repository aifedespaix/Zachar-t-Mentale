/**
 * L'empreinte du contenu sérialisé d'une carte, telle qu'elle a été poussée ou
 * tirée. Elle sert à une seule chose, mais décisive : distinguer « le serveur a
 * bougé » de « le serveur a bougé SEULEMENT son chemin ». Un déplacement de prof
 * bumpe `updated` ; sans cette empreinte, l'élève resterait bloqué en conflit à
 * chaque sync, indéfiniment, pour un simple rangement.
 *
 * Même recette que les assets (`assets.ts`) : SHA-256, tronqué à 8 octets en
 * hexadécimal — assez pour détecter un changement, pas de quoi pavoiser
 * cryptographiquement.
 */
export async function hashContent(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest).slice(0, 8)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
