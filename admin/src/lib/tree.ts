/**
 * L'arborescence de fichiers, telle qu'elle se DÉDUIT du serveur.
 *
 * Il n'y a pas de table « arborescence » : une carte porte un `path` relatif
 * (`Maths/Chapitre 1.zmap`), et c'est tout. Les dossiers sont donc des noms qui
 * apparaissent dans ces chemins — dérivés, jamais stockés. Ce module est la
 * seule chose qui effectue cette dérivation, et son inverse : ce qu'il faut
 * réécrire dans les `path` pour qu'un renommage ou un déplacement de dossier
 * ait lieu.
 *
 * Un dossier VIDE est la seule exception : il ne peut se déduire d'aucun
 * chemin, donc il existe comme enregistrement `dossiers` (voir
 * `infra/pocketbase-schema.mjs`). `explicit` distingue les deux — ce qui
 * importe au moment de supprimer : un dossier déduit disparaît tout seul quand
 * sa dernière carte s'en va, un dossier explicite demande une suppression.
 *
 * Tout est en chemins POSIX, à slashes. C'est la forme CANONIQUE décidée par
 * `relativeTo()` dans `src/sync/syncService.ts` : le serveur ne voit jamais un
 * antislash, quelle que soit la machine qui a poussé.
 */

/** Une carte mentale, réduite à ce dont l'arborescence a besoin. */
export interface LibraryMap {
  id: string
  file_id: string
  author: string
  path: string
  type: string
  updated: string
}

export interface LibraryFolder {
  id: string
  path: string
}

export interface MapNode {
  kind: 'map'
  name: string
  path: string
  map: LibraryMap
}

export interface FolderNode {
  kind: 'folder'
  name: string
  path: string
  children: TreeNode[]
  /**
   * Le dossier existe comme enregistrement, et pas seulement parce qu'une carte
   * le traverse. Un dossier explicite survit au départ de sa dernière carte.
   */
  explicit: boolean
  /** L'identifiant de l'enregistrement `dossiers`, quand il y en a un. */
  recordId?: string
}

export type TreeNode = FolderNode | MapNode

/** Les caractères qu'un nom de fichier ne peut pas porter — le même jeu que l'application de bureau. */
const ILLEGAL_SEGMENT_CHARS = /[\\/:*?"<>|]/

/**
 * Un nom de dossier ou de fichier utilisable.
 *
 * `.` et `..` sont refusés explicitement : ce sont des noms valides pour le
 * système de fichiers, et des chemins d'évasion pour `path`. La
 * synchronisation les rejette déjà à la lecture (`isSafeRelativePath`) — les
 * refuser ICI évite d'écrire un enregistrement que le client ignorera ensuite
 * en silence, ce qui est la pire des deux issues.
 */
export function isValidSegment(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed === '' || trimmed === '.' || trimmed === '..') return false
  return !ILLEGAL_SEGMENT_CHARS.test(trimmed)
}

/** Le dossier contenant `path`, ou `''` pour un élément à la racine. */
export function parentOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut)
}

export function nameOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? path : path.slice(cut + 1)
}

/** `dir` et `name` assemblés, en tolérant la racine (`dir === ''`). */
export function joinPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`
}

/**
 * Si `path` est DANS `dir` (strictement : un dossier n'est pas son propre
 * descendant).
 *
 * Le test du séparateur final est ce qui empêche `Maths2/x.zmap` de passer pour
 * un descendant de `Maths` — une comparaison de préfixe seule répond oui à
 * exactement ce cas, et déplacerait des fichiers qui n'ont rien à y faire.
 */
export function isDescendantPath(path: string, dir: string): boolean {
  if (dir === '') return path !== ''
  return path.startsWith(`${dir}/`)
}

/** `path` avec son dernier segment remplacé — un renommage sur place. */
export function renamedTo(path: string, newName: string): string {
  return joinPath(parentOf(path), newName)
}

/**
 * `path` réimplanté sous `targetDir`, en conservant son nom.
 *
 * Utilisé pour une carte ; pour un dossier, c'est `rebasedUnder` qu'il faut,
 * parce qu'un dossier emmène tout ce qu'il contient.
 */
export function movedTo(path: string, targetDir: string): string {
  return joinPath(targetDir, nameOf(path))
}

/**
 * `path`, qui vit sous `fromPrefix`, réécrit pour vivre sous `toPrefix`.
 *
 * C'est l'opération qui rend un renommage ou un déplacement de DOSSIER
 * possible : le dossier n'existe nulle part comme entité, donc le déplacer
 * consiste exactement à réécrire le préfixe de chaque chemin qui le traverse.
 */
export function rebasedUnder(path: string, fromPrefix: string, toPrefix: string): string {
  if (fromPrefix === '') return joinPath(toPrefix, path)
  if (path === fromPrefix) return toPrefix
  if (!isDescendantPath(path, fromPrefix)) return path
  return joinPath(toPrefix, path.slice(fromPrefix.length + 1))
}

/**
 * L'ordre d'affichage : dossiers d'abord, puis par nom.
 *
 * `numeric` compte, et beaucoup : sans lui « Chapitre 10 » se range entre
 * « Chapitre 1 » et « Chapitre 2 », ce qui est exactement l'endroit où un prof
 * cherche ses chapitres.
 */
const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' })

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
  return collator.compare(a.name, b.name)
}

/**
 * L'arborescence complète, à partir des cartes et des dossiers explicites.
 *
 * Un chemin traversant un dossier jamais déclaré le CRÉE implicitement — c'est
 * le cas courant, puisque personne ne déclare un dossier avant d'y ranger
 * quelque chose. Une carte dont le chemin est vide ou absolu est ignorée
 * plutôt que placée n'importe où : c'est une donnée que la synchronisation
 * refuse déjà de son côté, et l'afficher à la racine la ferait passer pour
 * saine.
 */
export function buildTree(maps: readonly LibraryMap[], folders: readonly LibraryFolder[] = []): TreeNode[] {
  const root: FolderNode = { kind: 'folder', name: '', path: '', children: [], explicit: false }
  const folderByPath = new Map<string, FolderNode>([['', root]])

  function ensureFolder(path: string): FolderNode {
    const existing = folderByPath.get(path)
    if (existing !== undefined) return existing
    const parent = ensureFolder(parentOf(path))
    const node: FolderNode = { kind: 'folder', name: nameOf(path), path, children: [], explicit: false }
    folderByPath.set(path, node)
    parent.children.push(node)
    return node
  }

  for (const folder of folders) {
    const path = normalizePath(folder.path)
    if (path === '') continue
    const node = ensureFolder(path)
    node.explicit = true
    node.recordId = folder.id
  }

  for (const map of maps) {
    const path = normalizePath(map.path)
    if (path === '') continue
    ensureFolder(parentOf(path)).children.push({ kind: 'map', name: nameOf(path), path, map })
  }

  sortInPlace(root)
  return root.children
}

/**
 * Un `path` venu du serveur, ramené à la forme canonique.
 *
 * Le serveur est alimenté par des clients : un antislash, un slash doublé ou un
 * slash final y sont possibles, et chacun ferait apparaître un dossier fantôme
 * au nom vide. On refuse en revanche tout ce qui s'évade (`..`, chemin absolu,
 * lettre de lecteur) en répondant `''`, que l'appelant écarte.
 */
export function normalizePath(raw: string): string {
  const unified = String(raw ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
  if (unified === '') return ''
  if (/^[a-zA-Z]:/.test(unified)) return ''
  if (unified.split('/').some(segment => segment === '.' || segment === '..')) return ''
  return unified
}

function sortInPlace(folder: FolderNode): void {
  folder.children.sort(compareNodes)
  for (const child of folder.children) if (child.kind === 'folder') sortInPlace(child)
}

/** Toutes les cartes vivant sous `dir`, à n'importe quelle profondeur. */
export function mapsUnder(maps: readonly LibraryMap[], dir: string): LibraryMap[] {
  return maps.filter(map => isDescendantPath(normalizePath(map.path), dir))
}

/** Tous les dossiers explicites vivant sous `dir`, `dir` lui-même inclus. */
export function foldersUnder(folders: readonly LibraryFolder[], dir: string): LibraryFolder[] {
  return folders.filter(folder => {
    const path = normalizePath(folder.path)
    return path === dir || isDescendantPath(path, dir)
  })
}

/** Combien de cartes un nœud contient, lui compris s'il en est une. */
export function countMaps(node: TreeNode): number {
  if (node.kind === 'map') return 1
  return node.children.reduce((total, child) => total + countMaps(child), 0)
}

/** Tous les chemins de dossiers de l'arbre, pour alimenter un sélecteur de destination. */
export function allFolderPaths(nodes: readonly TreeNode[]): string[] {
  const paths: string[] = []
  const visit = (node: TreeNode) => {
    if (node.kind !== 'folder') return
    paths.push(node.path)
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return paths
}

/**
 * Pourquoi ce déplacement est impossible, ou `null` s'il est permis.
 *
 * Le cas qui compte est le troisième : déplacer un dossier DANS lui-même. Il
 * est facile à déclencher au doigt sur un téléphone, et il détruirait
 * réellement des données — chaque chemin se verrait réécrit sous une
 * destination qui est en train de disparaître, et l'arborescence perdrait la
 * branche entière. Un refus explicite vaut mieux qu'un `rebasedUnder` appliqué
 * de bonne foi.
 */
export function moveObjection(sourcePath: string, targetDir: string, kind: TreeNode['kind']): string | null {
  if (sourcePath === '') return 'La racine ne se déplace pas.'
  if (parentOf(sourcePath) === targetDir) return 'Le fichier est déjà dans ce dossier.'
  if (kind !== 'folder') return null
  if (sourcePath === targetDir) return 'Un dossier ne peut pas être déplacé dans lui-même.'
  if (isDescendantPath(targetDir, sourcePath)) {
    return 'Un dossier ne peut pas être déplacé dans un de ses propres sous-dossiers.'
  }
  return null
}

/**
 * L'arbre réduit à ce qui correspond à `query`.
 *
 * Un dossier est conservé si SON NOM correspond — auquel cas il garde tout son
 * contenu, parce que « montre-moi Maths » veut dire « montre-moi ce qu'il y a
 * dedans » — ou s'il contient encore quelque chose après filtrage. Un dossier
 * vidé par le filtre disparaît : le garder afficherait une arborescence de
 * dossiers vides dans laquelle plus rien n'est trouvable.
 *
 * La comparaison ignore la casse ET les accents : personne ne tape « algèbre »
 * avec son accent sur un clavier de téléphone quand il cherche vite.
 */
export function filterTree(nodes: readonly TreeNode[], query: string): TreeNode[] {
  const needle = foldForSearch(query)
  if (needle === '') return [...nodes]

  const keep = (node: TreeNode): TreeNode | null => {
    const matches = foldForSearch(node.name).includes(needle)
    if (node.kind === 'map') return matches ? node : null
    if (matches) return node
    const children = node.children.map(keep).filter((child): child is TreeNode => child !== null)
    return children.length === 0 ? null : { ...node, children }
  }

  return nodes.map(keep).filter((node): node is TreeNode => node !== null)
}

/** Minuscules, sans accents — la forme dans laquelle deux mots « se ressemblent ». */
export function foldForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}
