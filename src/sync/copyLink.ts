/**
 * Le LIEN DE COPIE : deux fichiers qui sont deux versions d'une même carte, et
 * qui le restent.
 *
 * Il naît d'un conflit résolu par « Créer une copie » — la version du serveur
 * reprend le fichier d'origine, la version locale part dans une copie — et son
 * seul rôle est d'empêcher cette copie de devenir un orphelin anonyme au fond
 * d'un dossier trois semaines plus tard. Deux règles, et rien d'autre :
 *
 * - **même dossier, même nom** : la copie s'appelle « <original> (copie) », à
 *   côté de l'original ; renommer ou déplacer l'un entraîne l'autre (voir
 *   `persistence/copyLinkOps.ts`) ;
 * - **visible** : les deux lignes de l'arborescence portent le même badge, donc
 *   on voit le couple sans ouvrir quoi que ce soit.
 *
 * Le lien est porté par les DEUX fichiers, dans leur `meta`, et `groupId` (le
 * `meta.id` de l'original) est ce qui les rassemble. Le stocker des deux côtés
 * plutôt que sur la seule copie est ce qui permet à une ligne de l'arbre
 * d'afficher le badge sans lire ses voisins : le `meta` est déjà chargé.
 */

/** Le mot du suffixe, une seule fois dans le code : il est lu par l'utilisateur. */
export const COPY_WORD = 'copie'

export type CopyRole = 'source' | 'copy'

export interface CopyLink {
  /**
   * L'identité du COUPLE : le `meta.id` de l'original, porté à l'identique par
   * l'original et par chacune de ses copies. C'est lui, jamais le nom, qui dit
   * que deux fichiers vont ensemble — un nom se renomme, y compris hors de
   * l'app.
   */
  groupId: string
  role: CopyRole
  /**
   * Le nom de base COMMUN (sans extension, sans suffixe) : le nom de
   * l'original, et la racine dont le nom de chaque copie est dérivé. C'est la
   * règle de nommage elle-même, écrite dans le fichier.
   */
  baseName: string
  /** Le rang de la copie — 1 pour la première. Absent côté original. */
  index?: number
}

/** `« (copie) »`, `« (copie 2) »`, … — le suffixe seul, espace de tête compris. */
export function copySuffixFor(index: number): string {
  return index <= 1 ? ` (${COPY_WORD})` : ` (${COPY_WORD} ${index})`
}

/** Le nom de base que `link` IMPOSE à son fichier — la règle « même nom » en une ligne. */
export function linkedBaseNameOf(link: CopyLink): string {
  if (link.role === 'source') return link.baseName
  return `${link.baseName}${copySuffixFor(link.index ?? 1)}`
}

/**
 * Le nom de base d'un fichier, débarrassé d'un éventuel suffixe de copie.
 *
 * Ce que l'utilisateur tape quand il renomme une copie n'est pas fiable : il
 * peut garder « (copie) », le retirer, ou renommer « Chapitre 1 (copie) » en
 * « Chapitre 2 (copie) ». Dans tous les cas c'est la RACINE qui est renommée,
 * donc on la retrouve en retirant le suffixe s'il est là.
 */
export function stripCopySuffix(baseName: string): string {
  const match = new RegExp(`^(.*?)\\s*\\(${COPY_WORD}(?:\\s+\\d+)?\\)$`, 'i').exec(baseName)
  return match === null ? baseName : (match[1] ?? baseName)
}

/**
 * La racine que le groupe doit adopter après le renommage d'un de ses membres.
 * Renommer la copie renomme l'original, et réciproquement : c'est ce qui rend
 * la règle « même nom » tenable sans interdire le renommage d'un des deux.
 */
export function groupBaseNameAfterRename(typedBaseName: string): string {
  const stripped = stripCopySuffix(typedBaseName).trim()
  // Un nom qui n'était QUE « (copie) » laisserait un groupe sans racine : on
  // garde alors ce que l'utilisateur a tapé plutôt que de renommer en vide.
  return stripped === '' ? typedBaseName : stripped
}

/** Le lien que porte l'original d'un groupe. */
export function sourceLink(groupId: string, baseName: string): CopyLink {
  return { groupId, role: 'source', baseName }
}

/** Le lien que porte la n-ième copie d'un groupe. */
export function copyLink(groupId: string, baseName: string, index: number): CopyLink {
  return { groupId, role: 'copy', baseName, index }
}

/** Le même lien, sur une nouvelle racine — ce qu'un renommage écrit dans chaque membre. */
export function renamedLink(link: CopyLink, baseName: string): CopyLink {
  return { ...link, baseName }
}

/** Le premier rang libre, pour qu'une deuxième copie ne vienne pas écraser la première. */
export function nextCopyIndex(usedIndexes: readonly number[]): number {
  let index = 1
  while (usedIndexes.includes(index)) index += 1
  return index
}

export function isSameGroup(left: CopyLink | undefined, right: CopyLink | undefined): boolean {
  if (left === undefined || right === undefined) return false
  return left.groupId === right.groupId
}

/**
 * Ce que le badge de l'arborescence dit au survol. Un texte, pas un composant :
 * il sert aussi de `aria-label`, et une phrase est ce qu'un lecteur d'écran
 * peut lire d'un lien que rien d'autre ne rend audible.
 */
export function copyLinkLabel(link: CopyLink): string {
  if (link.role === 'source') {
    return `Carte liée à sa copie « ${link.baseName}${copySuffixFor(1)} » : même dossier, même nom.`
  }
  return `Copie liée de « ${link.baseName} » : même dossier, même nom.`
}

/** Le mot court de la pastille elle-même — « original » d'un côté, « copie » de l'autre. */
export function copyLinkBadgeText(link: CopyLink): string {
  return link.role === 'source' ? 'liée' : link.index !== undefined && link.index > 1 ? `${COPY_WORD} ${link.index}` : COPY_WORD
}
