import PocketBase from 'pocketbase'
import type { UserRole } from '@app/types/card'

/**
 * Le client PocketBase de l'interface d'administration.
 *
 * L'URL est celle de la page elle-même, et ce n'est pas un raccourci : le SPA
 * est déposé dans le `/pb_public` du serveur PocketBase, donc il est servi par
 * l'API qu'il appelle. Même origine, donc pas de CORS à ouvrir, pas d'URL à
 * configurer, et aucun moyen de pointer par erreur sur le serveur de quelqu'un
 * d'autre.
 *
 * La session vit dans le `localStorage` (le magasin par défaut du SDK, qui
 * existe ici — contrairement à la webview Tauri de l'application de bureau, qui
 * a dû s'en écrire un). Recharger la page, ou revenir le lendemain, ne demande
 * donc pas de se reconnecter.
 */
export const pb = new PocketBase(typeof window === 'undefined' ? '/' : window.location.origin)

export interface AdminUser {
  id: string
  username: string
  role: UserRole
}

/** Ce que porte l'enregistrement `users` une fois authentifié. */
interface AuthRecord {
  id: string
  username: string
  role: string
}

/**
 * Le compte connecté, ou `null`.
 *
 * Lit le magasin d'authentification plutôt qu'un état React : c'est lui la
 * source de vérité, et il survit au rechargement de la page.
 */
export function currentUser(): AdminUser | null {
  const record = pb.authStore.record as AuthRecord | null
  if (record === null || !pb.authStore.isValid) return null
  return {
    id: record.id,
    username: record.username,
    role: record.role === 'prof' ? 'prof' : 'eleve',
  }
}

/** Ce que la connexion peut refuser, en français, sans jamais dire lequel des deux champs est faux. */
export class LoginError extends Error {}

/**
 * Connecte un compte, et REFUSE tout ce qui n'est pas un prof.
 *
 * Ce refus est une politesse, pas une sécurité : l'interface n'a d'utilité que
 * pour un prof, et laisser entrer un élève dans un écran où chaque bouton
 * répondra « 403 » serait une mauvaise expérience. La vraie protection est
 * ailleurs — dans les règles de PocketBase, qui ne consultent rien de ce que
 * ce code décide (voir `infra/pocketbase-schema.mjs`). Un élève qui
 * contournerait cet écran n'obtiendrait toujours que ses propres droits.
 */
export async function login(username: string, password: string): Promise<AdminUser> {
  try {
    await pb.collection('users').authWithPassword(username.trim(), password)
  } catch (error) {
    throw new LoginError(describeAuthError(error))
  }
  const user = currentUser()
  if (user === null) {
    throw new LoginError('Connexion acceptée mais session illisible. Réessayez.')
  }
  if (user.role !== 'prof') {
    pb.authStore.clear()
    throw new LoginError(
      'Ce compte est un compte élève. L’espace d’administration est réservé aux comptes professeur.'
    )
  }
  return user
}

export function logout(): void {
  pb.authStore.clear()
}

function statusOf(error: unknown): number {
  if (error !== null && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number') return status
  }
  return 0
}

function describeAuthError(error: unknown): string {
  const status = statusOf(error)
  // 0 = la requête n'a jamais atteint le serveur. C'est la panne la plus
  // fréquente sur un téléphone, et la seule que l'utilisateur peut corriger
  // lui-même — elle mérite donc sa propre phrase.
  if (status === 0) return 'Serveur injoignable. Vérifiez votre connexion.'
  if (status === 400) return 'Pseudo ou mot de passe incorrect.'
  if (status === 403) return 'Ce compte n’a pas le droit de se connecter ici.'
  return `La connexion a échoué (erreur ${status}).`
}

/**
 * Un message d'erreur en français pour n'importe quel échec d'API.
 *
 * Le 404 a droit à sa propre phrase parce qu'il a une cause précise et une
 * solution précise : le serveur n'a pas encore reçu les collections de
 * l'espace professeur, et une seule commande les installe. Sans cette phrase,
 * l'écran des conflits afficherait « erreur 404 » à quelqu'un qui n'a aucune
 * raison de deviner qu'il lui manque une migration.
 */
export function describeApiError(error: unknown, what: string): string {
  const status = statusOf(error)
  if (status === 0) return `${what} : serveur injoignable.`
  if (status === 401 || status === 403) return `${what} : accès refusé par le serveur.`
  if (status === 404) {
    return `${what} : collection absente du serveur. Lancez « bun run infra/setup-pocketbase.mjs » pour la créer.`
  }
  const detail = error instanceof Error && error.message !== '' ? ` (${error.message})` : ''
  return `${what} : erreur ${status}${detail}.`
}
