import { blockGroups, type BlockGroup } from './blocks'
import type { CardBlock } from '../types/cardBlock'

/**
 * Le déplacement d'un bloc dans une liste qui porte des questions.
 *
 * Une question n'est PAS un bloc comme un autre : elle possède les blocs qui la
 * suivent (modèle plat, voir « blockGroups »). Déplacer au simple index voisin
 * ferait donc changer des blocs de propriétaire sans le dire — un bloc de la
 * question éjecté dehors, un bloc du dehors avalé dedans. Trois règles, et c'est
 * « blockGroups » qui les rend vraies :
 *
 * - l'en-tête d'une question emmène TOUTE sa question : il n'est pas mobile
 *   seul, sinon ses propres blocs resteraient sur place et se feraient absorber
 *   par la question voisine ;
 * - un bloc DANS une question glisse entre l'en-tête et la fin de son groupe, et
 *   bute sur ces deux bornes — il n'en sort jamais ;
 * - un bloc DEHORS saute d'un coup la question qu'il rencontrait, au-dessus en
 *   montant et en dessous en descendant, et reçoit le marqueur « standalone »
 *   que sa nouvelle place exige.
 */

export interface BlockMovePlan {
  /** La liste réordonnée, marqueurs remis d'aplomb. */
  blocks: CardBlock[]
  /**
   * L'index D'ORIGINE de chaque position du nouvel ordre. Les identités stables
   * de l'éditeur suivent ce plan : sans lui, React réutiliserait les mêmes
   * éléments aux mêmes positions et « motion » n'aurait rien à animer.
   */
  order: number[]
}

/** L'identité : l'index d'origine de chaque position, dans l'ordre. */
function identityOrder(length: number): number[] {
  return Array.from({ length }, (_, index) => index)
}

/**
 * Un déplacement par échange de deux positions voisines.
 *
 * « to » est un index de la liste D'ORIGINE, comme dans l'ancien « moveBlock » :
 * on retire « from » puis on insère à « to », donc l'élément se retrouve à
 * l'index « to » de la liste neuve.
 */
function splicePlan(blocks: CardBlock[], from: number, to: number): BlockMovePlan {
  const order = identityOrder(blocks.length)
  const [origin] = order.splice(from, 1)
  order.splice(to, 0, origin)
  const next = [...blocks]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return { blocks: next, order }
}

/**
 * Pose « standalone » là où la place l'exige, et le laisse ailleurs.
 *
 * Le marqueur ne s'EFFACE jamais d'un bloc qui le porte : au-dessus de la
 * première question il est inerte (rien à fermer pour « blockGroups »), alors que
 * le retirer à tort ferait rentrer le bloc dans la première question qu'on
 * insérerait devant lui.
 */
function standaloneAt(blocks: CardBlock[], indexes: number[]): CardBlock[] {
  if (indexes.length === 0) return blocks
  const wanted = new Set(indexes)
  let changed = false
  const next = blocks.map((block, index) => {
    if (!wanted.has(index) || block.standalone === true || block.kind === 'question') return block
    const owned = blocks.slice(0, index).some(other => other.kind === 'question')
    if (!owned) return block
    changed = true
    return { ...block, standalone: true }
  })
  return changed ? next : blocks
}

/**
 * L'échange de deux groupes voisins — le geste de l'en-tête.
 *
 * Deux groupes adjacents qui échangent donnent toujours le plus haut en premier,
 * donc c'est un simple [upper, lower] : « lower » est le groupe que la question
 * dépasse, et ses blocs, s'il n'a pas d'en-tête, se retrouvent APRÈS une
 * question — d'où le marqueur reposé, sans quoi la relecture les avalerait.
 */
function groupSwapPlan(
  blocks: CardBlock[],
  groups: BlockGroup[],
  position: number,
  direction: 1 | -1,
): BlockMovePlan | null {
  const neighbour = groups[position + direction]
  if (neighbour === undefined) return null
  const lower = direction === 1 ? groups[position] : neighbour
  const upper = direction === 1 ? neighbour : groups[position]
  const head = lower.indexes[0]
  const tailStart = upper.indexes[upper.indexes.length - 1] + 1
  const next = [
    ...blocks.slice(0, head),
    ...upper.indexes.map(index => blocks[index]),
    ...lower.indexes.map(index => blocks[index]),
    ...blocks.slice(tailStart),
  ]
  const order = [
    ...identityOrder(head),
    ...upper.indexes,
    ...lower.indexes,
    ...identityOrder(blocks.length).slice(tailStart),
  ]
  const rehomed =
    lower.headerIndex === null && upper.headerIndex !== null
      ? lower.indexes.map((_, offset) => head + upper.indexes.length + offset)
      : []
  return { blocks: standaloneAt(next, rehomed), order }
}

/**
 * Le plan d'un déplacement, ou « null » quand il n'y a rien à faire — borne de la
 * liste, cible identique, ou geste que la question interdit.
 *
 * « null » plutôt qu'une liste inchangée : c'est ainsi que l'appelant apprend à
 * la fois qu'il n'a rien à écrire ET rien à animer.
 */
export function movePlan(blocks: CardBlock[], from: number, to: number): BlockMovePlan | null {
  if (to < 0 || to >= blocks.length || from === to) return null
  const groups = blockGroups(blocks)
  const fromGroup = groups.find(group => group.indexes.includes(from))
  const toGroup = groups.find(group => group.indexes.includes(to))
  if (fromGroup === undefined || toGroup === undefined) return null

  // L'en-tête emmène sa question : c'est le groupe entier qui change de place.
  if (fromGroup.headerIndex === from) {
    return groupSwapPlan(blocks, groups, groups.indexOf(fromGroup), to > from ? 1 : -1)
  }

  // Un bloc de la question reste dans sa question — jamais au-dessus de son
  // en-tête, jamais au-delà de son dernier bloc, jamais dans la question
  // suivante.
  if (fromGroup.headerIndex !== null) {
    if (fromGroup !== toGroup || to === fromGroup.headerIndex) return null
    return splicePlan(blocks, from, to)
  }

  // Un bloc du dehors saute la question qu'il rencontrait, d'un seul geste. La
  // borne du bas est le DERNIER bloc du groupe, pas celui d'après : le bloc part
  // AVANT l'insertion, donc tout ce qui le suit remonte d'un rang — viser
  // « dernier + 1 » le poserait un cran trop bas dès que la question finit la
  // liste.
  if (toGroup.headerIndex !== null) {
    const landing = to > from ? toGroup.indexes[toGroup.indexes.length - 1] : toGroup.headerIndex
    const plan = splicePlan(blocks, from, landing)
    return { blocks: standaloneAt(plan.blocks, [landing]), order: plan.order }
  }

  return splicePlan(blocks, from, to)
}

/**
 * Le déplacement comme une liste neuve — ou LA MÊME liste quand rien ne bouge,
 * ce que l'appelant teste par identité.
 */
export function moveBlock(blocks: CardBlock[], from: number, to: number): CardBlock[] {
  return movePlan(blocks, from, to)?.blocks ?? blocks
}

/** Vrai quand « from » a quelque part où aller — l'état des flèches Monter/Descendre. */
export function canMoveBlock(blocks: CardBlock[], from: number, direction: 1 | -1): boolean {
  return movePlan(blocks, from, from + direction) !== null
}
