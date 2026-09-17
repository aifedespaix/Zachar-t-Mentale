import type { SyncConflict, SyncResult } from './syncService'
import type { UserRole } from '../types/card'

/**
 * Ce qu'une exécution de synchronisation laisse sur le SERVEUR, pour que le
 * prof puisse la lire depuis l'interface d'administration.
 *
 * Le journal local (`sync-debug.log`) reste le plus détaillé — et il reste la
 * référence pour un vrai diagnostic. Mais il est sur la machine de l'élève,
 * c'est-à-dire exactement là où le prof n'est pas. Ce module produit la version
 * courte qui voyage : une ligne par exécution, plus les conflits, avec la
 * version locale attachée pour qu'on puisse trancher à distance.
 *
 * RIEN ici ne doit pouvoir faire échouer une synchronisation. Le rapport est un
 * effet de bord : un serveur qui n'a pas encore reçu les nouvelles collections
 * répond 404, et la synchronisation qui vient de réussir doit rester une
 * réussite. `reportSyncRun` avale donc tout — c'est un contrat, pas une
 * négligence, et c'est ce qui rend la mise à jour du serveur facultative.
 */

export type SyncEventLevel = 'info' | 'warning' | 'error'
export type SyncTrigger = 'manual' | 'auto'

export interface SyncEventPayload {
  username: string
  role: UserRole
  level: SyncEventLevel
  trigger: SyncTrigger
  summary: string
  pushed: number
  pulled: number
  conflicts: number
  failures: number
  cancelled: boolean
  detail: SyncEventDetail
  device: string
}

export interface SyncEventDetail {
  errors: { fileId: string; message: string }[]
  transferred: { fileId: string; path: string; direction: 'push' | 'pull' }[]
  moved: { fileId: string; from: string; to: string }[]
  notices: { fileId: string; message: string }[]
  merged: { fileId: string; path: string; floatedCount: number }[]
  relocated: number
  reclassified: number
  published: number
  localDeleted: number
  remoteDeleted: number
  /** Ce que les listes ci-dessus ont perdu au plafonnement, pour ne pas mentir par omission. */
  truncated?: number
}

export interface SyncConflictPayload {
  file_id: string
  path: string
  username: string
  local_modified: string
  remote_updated: string
  local_content: string
  status: 'open'
}

/**
 * Combien d'entrées de chaque liste partent dans `detail`.
 *
 * Le champ JSON est plafonné à 200 000 caractères côté serveur
 * (`SYNC_EVENT_FIELDS` dans `infra/pocketbase-schema.mjs`). Une première
 * synchronisation d'un gros dossier transfère des centaines de fichiers, et un
 * `detail` refusé ferait perdre la ligne ENTIÈRE — y compris les compteurs, qui
 * sont la partie qu'on vient lire. On préfère une liste tronquée et honnête à
 * un événement manquant.
 */
export const MAX_DETAIL_ENTRIES = 100

/**
 * La gravité telle qu'un tableau de bord veut la trier.
 *
 * `error` est réservé à un vrai échec de fichier. Un conflit n'est PAS une
 * erreur — il est déjà résolu au moment où il arrive ici (voir
 * `2026-09-15-autorite-prof-conflits-design.md`) — et la confondre avec une
 * panne ferait clignoter en rouge un serveur qui fonctionne parfaitement. Une
 * exécution
 * interrompue est également un avertissement : rien n'a cassé, mais le dossier
 * n'a pas été parcouru en entier, donc « tout va bien » serait faux.
 */
export function levelOf(result: SyncResult): SyncEventLevel {
  if (result.errors.length > 0) return 'error'
  if (result.conflicts.length > 0 || result.cancelled) return 'warning'
  return 'info'
}

function cap<T>(entries: readonly T[] | undefined): { kept: T[]; dropped: number } {
  const all = entries ?? []
  if (all.length <= MAX_DETAIL_ENTRIES) return { kept: [...all], dropped: 0 }
  return { kept: all.slice(0, MAX_DETAIL_ENTRIES), dropped: all.length - MAX_DETAIL_ENTRIES }
}

/** Le détail brut, plafonné — voir `MAX_DETAIL_ENTRIES`. */
export function buildDetail(result: SyncResult): SyncEventDetail {
  const errors = cap(result.errors)
  const transferred = cap(result.transferred)
  const moved = cap(result.moved)
  const notices = cap(result.notices)
  const merged = cap(result.merged)
  const dropped =
    errors.dropped + transferred.dropped + moved.dropped + notices.dropped + merged.dropped
  return {
    errors: errors.kept,
    transferred: transferred.kept,
    moved: moved.kept,
    notices: notices.kept,
    merged: merged.kept,
    relocated: result.relocated ?? 0,
    reclassified: result.reclassified ?? 0,
    published: result.published ?? 0,
    localDeleted: result.localDeleted ?? 0,
    remoteDeleted: result.remoteDeleted ?? 0,
    ...(dropped === 0 ? {} : { truncated: dropped }),
  }
}

export interface ReportContext {
  username: string
  role: UserRole
  trigger: SyncTrigger
  /** La phrase déjà montrée à l'utilisateur — on n'en réécrit pas une seconde, qui divergerait. */
  summary: string
  device: string
}

export function buildSyncEvent(result: SyncResult, context: ReportContext): SyncEventPayload {
  return {
    username: context.username,
    role: context.role,
    level: levelOf(result),
    trigger: context.trigger,
    summary: context.summary,
    pushed: result.pushed,
    pulled: result.pulled,
    conflicts: result.conflicts.length,
    failures: result.errors.length,
    cancelled: result.cancelled,
    detail: buildDetail(result),
    device: context.device,
  }
}

/**
 * Un conflit, prêt à être enregistré.
 *
 * `local_content` vaut `''` quand la lecture du fichier a échoué : le conflit
 * se signale quand même, et l'interface dira « version locale indisponible »
 * plutôt que de faire disparaître le problème.
 */
export function buildConflictPayload(conflict: SyncConflict, username: string): SyncConflictPayload {
  return {
    file_id: conflict.fileId,
    path: conflict.path,
    username,
    local_modified: conflict.localModified,
    remote_updated: conflict.remoteUpdated,
    // `detail` porte tout ce qu'une résolution demande, la version locale
    // comprise — c'est `sync()` qui la monte, au seul instant où les deux
    // versions sont sous la main.
    local_content: conflict.detail?.localContent ?? '',
    status: 'open',
  }
}

/** L'enregistrement d'un conflit déjà ouvert, tel que le client sait le retrouver. */
export interface OpenConflictRecord {
  id: string
  file_id: string
}

/**
 * Le strict nécessaire pour rapporter — une interface étroite, pour que les
 * tests n'aient pas besoin d'un PocketBase.
 */
export interface ReportingClient {
  createEvent(data: SyncEventPayload): Promise<unknown>
  /** Les conflits ENCORE OUVERTS de ce compte, pour ne pas en empiler un par exécution. */
  listOpenConflicts(username: string): Promise<OpenConflictRecord[]>
  createConflict(data: SyncConflictPayload): Promise<unknown>
  updateConflict(id: string, data: SyncConflictPayload): Promise<unknown>
  /** Classe un conflit que cette exécution n'a plus rencontré. */
  closeConflict(id: string, resolution: string, by: string): Promise<unknown>
}

export interface ReportOutcome {
  /** L'événement est parti. */
  event: boolean
  /** Conflits nouvellement ouverts. */
  opened: number
  /** Conflits déjà ouverts, simplement rafraîchis. */
  refreshed: number
  /** Conflits classés d'office parce qu'ils n'existent plus. */
  closed: number
  /** Ce qui n'est pas passé, en clair — pour le journal local, jamais pour l'utilisateur. */
  failures: string[]
}

/** Comment un conflit disparu est classé — « plus de désaccord », pas « j'ai choisi ». */
export const RESOLVED_ELSEWHERE = 'resolved-elsewhere'

/**
 * Pousse le rapport d'une exécution. Ne lève JAMAIS — voir l'en-tête du module.
 *
 * Les conflits sont RAFRAÎCHIS plutôt qu'empilés : une synchronisation
 * automatique toutes les cinq minutes sur un fichier que personne n'a encore
 * tranché créerait sinon une centaine de lignes identiques dans la journée, et
 * la liste du prof deviendrait illisible exactement le jour où elle compte. Un
 * conflit ouvert pour ce fichier et ce compte est donc mis à jour sur place ;
 * l'historique des conflits RÉSOLUS, lui, est conservé intact.
 */
export async function reportSyncRun(
  client: ReportingClient,
  result: SyncResult,
  context: ReportContext
): Promise<ReportOutcome> {
  const outcome: ReportOutcome = { event: false, opened: 0, refreshed: 0, closed: 0, failures: [] }

  try {
    await client.createEvent(buildSyncEvent(result, context))
    outcome.event = true
  } catch (error) {
    outcome.failures.push(`journal : ${describe(error)}`)
  }

  // On consulte les conflits ouverts MÊME quand cette exécution n'en signale
  // aucun : c'est justement le cas où il y a quelque chose à classer.
  let openByFileId = new Map<string, string>()
  try {
    const open = await client.listOpenConflicts(context.username)
    openByFileId = new Map(open.map(record => [record.file_id, record.id]))
  } catch (error) {
    // On continue sans : au pire on crée un doublon, ce qui vaut mieux que de
    // perdre le signalement d'un conflit.
    outcome.failures.push(`conflits déjà ouverts : ${describe(error)}`)
  }

  for (const conflict of result.conflicts) {
    const payload = buildConflictPayload(conflict, context.username)
    const existing = openByFileId.get(conflict.fileId)
    try {
      if (existing === undefined) {
        await client.createConflict(payload)
        outcome.opened += 1
      } else {
        await client.updateConflict(existing, payload)
        outcome.refreshed += 1
      }
    } catch (error) {
      outcome.failures.push(`conflit « ${conflict.path} » : ${describe(error)}`)
    }
  }

  await closeVanished()

  return outcome

  /**
   * Classe les conflits ouverts que cette exécution n'a PLUS rencontrés.
   *
   * Un conflit est désormais TOUJOURS déjà tranché quand il est signalé (voir
   * `2026-09-15-autorite-prof-conflits-design.md`) : dès le prochain sync, le
   * contenu ne diverge plus et `isConflict` ne le revoit pas. Sans cette
   * passe, son enregistrement resterait `open` pour toujours. La liste du
   * prof accumulerait alors des fantômes, et deviendrait illisible exactement
   * là où elle doit être fiable.
   *
   * Cette passe ne demande pas COMMENT il a été résolu : elle constate qu'il
   * n'y a plus de désaccord, ce que la synchronisation qui vient de tourner est
   * la mieux placée pour savoir. D'où `resolved-elsewhere`, qui ne prétend pas
   * qu'une décision a été prise ici.
   *
   * Une exécution INTERROMPUE ne classe rien : elle n'a pas parcouru tout le
   * dossier, donc « ce fichier n'est plus en conflit » y voudrait seulement
   * dire « je ne suis pas allé voir ».
   */
  async function closeVanished(): Promise<void> {
    if (result.cancelled) return
    const stillConflicted = new Set(result.conflicts.map(entry => entry.fileId))
    for (const [fileId, recordId] of openByFileId) {
      if (stillConflicted.has(fileId)) continue
      try {
        await client.closeConflict(recordId, RESOLVED_ELSEWHERE, context.username)
        outcome.closed += 1
      } catch (error) {
        outcome.failures.push(`classement du conflit « ${fileId} » : ${describe(error)}`)
      }
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export interface SyncFailureReport {
  username: string
  role: UserRole
  trigger: SyncTrigger
  /** La phrase française déjà montrée à l'utilisateur. */
  message: string
  /** L'erreur brute — texte SDK anglais compris : c'est ce qu'un diagnostic lit. */
  detail: unknown
  device: string
}

/**
 * Signale un échec qui n'a produit AUCUN résultat — réseau coupé, serveur
 * injoignable, sync ciblée refusée. Ces cas n'ont pas de resultat a rapporter,
 * donc ils n'atteignaient jamais le serveur : tout finissait dans
 * sync-debug.log, c'est-a-dire sur la machine ou le prof n'est pas.
 *
 * Ne lève JAMAIS, comme reportSyncRun — le rapport est un effet de bord.
 *
 * @returns true quand la ligne est partie.
 */
export async function reportSyncFailure(
  client: ReportingClient,
  failure: SyncFailureReport
): Promise<boolean> {
  try {
    await client.createEvent(buildSyncFailureEvent(failure))
    return true
  } catch {
    return false
  }
}

export function buildSyncFailureEvent(failure: SyncFailureReport): SyncEventPayload {
  return {
    username: failure.username,
    role: failure.role,
    level: 'error',
    trigger: failure.trigger,
    summary: failure.message,
    pushed: 0,
    pulled: 0,
    conflicts: 0,
    failures: 1,
    cancelled: false,
    detail: {
      errors: [{ fileId: '', message: describeSyncFailure(failure.detail) }],
      transferred: [],
      moved: [],
      notices: [],
      merged: [],
      relocated: 0,
      reclassified: 0,
      published: 0,
      localDeleted: 0,
      remoteDeleted: 0,
    },
    device: failure.device,
  }
}

/**
 * Le même texte que le journal local : nom, message, et le status du SDK quand
 * il existe (0 = la requête n'a jamais atteint le serveur).
 */
export function describeSyncFailure(detail: unknown): string {
  if (detail instanceof Error) {
    const status = (detail as { status?: unknown }).status
    const suffix = status === undefined ? '' : ' (status ' + String(status) + ')'
    return detail.name + ': ' + detail.message + suffix
  }
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail) ?? String(detail)
  } catch {
    return String(detail)
  }
}
