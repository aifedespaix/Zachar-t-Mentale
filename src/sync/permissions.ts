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
 * Deliberately NOT about content: rearranging is allowed even where editing
 * content is not (an eleve's OWN unrelated files stay unreorderable to a
 * classmate). Content itself now follows `canEditContent`, the same author-or-
 * prof rule — see that function.
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
 * Le contenu suit désormais la même règle, mais via `canEditContent` — les
 * deux fonctions restent séparées parce qu'elles décident de choses
 * différentes (le type vit dans `meta`, un brouillon local n'en a pas).
 */
export function canClassify(meta: MindMapMeta | null, user: SyncUser): boolean {
  if (meta === null) return false
  return meta.author === user.username || user.role === 'prof'
}

/**
 * Whether `user` may change the CONTENT of a map — its cards.
 *
 * Même règle que `canReorder`/`canClassify` (auteur ou prof), mais celle-ci
 * décide du contenu lui-même : un prof peut corriger la carte d'un élève sans
 * jamais en devenir l'auteur — `meta.author` ne change pas, l'élève reste
 * propriétaire, seul son contenu diffère après correction.
 */
export function canEditContent(meta: MindMapMeta | null, user: SyncUser): boolean {
  if (meta === null) return true
  return meta.author === user.username || user.role === 'prof'
}
