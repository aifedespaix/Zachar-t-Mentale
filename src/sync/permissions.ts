import type { MindMapMeta, SyncUser } from '../types/card'

/**
 * Whether `user` may change the LAYOUT of a map — its path, its name, and by
 * extension the `path` of its remote record.
 *
 * This is the ONE definition of that permission, shared by the interface (what
 * may be dragged, renamed, deleted) and by the sync (whose path change may be
 * pushed). Two definitions would let the tree offer a gesture the sync then
 * refuses to publish.
 *
 * A map with no `meta` belongs to nobody: it has never been published, has no
 * remote record, and rearranging it is a purely local act.
 *
 * Deliberately NOT about content: a prof rearranges an eleve's chapter without
 * ever gaining the right to edit it — that is what keeps "l'auteur est le seul
 * éditeur" standing.
 */
export function canReorder(meta: MindMapMeta | null, user: SyncUser): boolean {
  if (meta === null) return true
  return meta.author === user.username || user.role === 'prof'
}

/**
 * Whether `user` may change the TYPE of a map.
 *
 * Même règle que `canReorder` (auteur ou prof), PLUS une exigence de
 * `meta` non nul : le type vit dans `meta`, qu'un brouillon local n'a
 * pas encore. Nommée séparément parce qu'elle décide d'autre chose, et parce
 * que l'interface et la synchronisation doivent lire la MÊME définition — sans
 * quoi l'arborescence offrirait un geste que le sync refuserait.
 *
 * Le contenu, lui, n'est jamais concerné : un prof classe la carte d'un élève
 * sans gagner le droit d'en écrire le contenu.
 */
export function canClassify(meta: MindMapMeta | null, user: SyncUser): boolean {
  if (meta === null) return false
  return meta.author === user.username || user.role === 'prof'
}
