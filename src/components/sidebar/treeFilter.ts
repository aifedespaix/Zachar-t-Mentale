import { isAssetsSidecarName } from '../../persistence/assets'
import { normalizeForComparison } from '../../utils/textSimilarity'
import type { FileTreeNode, RootFolder } from '../../types/workspace'

/**
 * Whether a row is shown at all, before any search.
 *
 * The sidebar's eye button is what decides for unreadable files — and an asset
 * sidecar counts as one, since it is an implementation detail of the map beside
 * it. Exported so the tree only ever asks the question in ONE place: the row's
 * own recursion and the search below must agree, or a filtered branch could
 * reappear through a row that still rendered it.
 */
export function isRowVisible(node: FileTreeNode, showUnreadable: boolean): boolean {
  if (isAssetsSidecarName(node.name)) return showUnreadable
  return showUnreadable || node.type !== 'other'
}

/** One folder of the workspace, flattened for the « Déplacer vers… » menu. */
export interface FolderOption {
  path: string
  name: string
  /** Nesting depth, so the menu can indent a subfolder under its parent. */
  depth: number
}

/** The last segment of a path — a folder's display name, whatever separator it uses. */
export function lastSegment(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

/**
 * Every folder of the workspace as one indented list: the configured roots,
 * then every subfolder of each, depth-first. This is what « Déplacer vers… »
 * offers as destinations.
 */
export function flattenFolders(rootFolders: RootFolder[]): FolderOption[] {
  const options: FolderOption[] = []
  const walk = (nodes: FileTreeNode[], depth: number) => {
    for (const node of nodes) {
      if (node.type !== 'folder') continue
      options.push({ path: node.path, name: node.name, depth })
      walk(node.children, depth + 1)
    }
  }
  for (const root of rootFolders) {
    options.push({ path: root.path, name: lastSegment(root.path), depth: 0 })
    walk(root.tree, 1)
  }
  return options
}

export interface TreeFilterResult {
  /** What to render: matching nodes, plus the ancestor folders that lead to them. */
  nodes: FileTreeNode[]
  /** Folders the filter opens by itself — never written to `expandedPaths`. */
  expanded: Set<string>
  /** How many rows matched by name (ancestors shown for context are not counted). */
  count: number
}

/**
 * Narrows a tree to what matches `query`, accent- and case-insensitively
 * (`normalizeForComparison`), the way a French course tree needs: « evaluation »
 * must find « Évaluation », and « td » must find « TD ».
 *
 * Two rules, both chosen by the user:
 * - a FILE matches on its own name and is kept alone;
 * - a FOLDER that matches keeps its WHOLE subtree — searching a chapter by name
 *   means wanting to see what is inside it — while a folder that merely
 *   CONTAINS a match is kept as an ancestor, with only the matching branches.
 *
 * The `expanded` set is returned rather than applied: the search is a view, and
 * clearing the field has to restore exactly the tree the user had before, which
 * only holds if the persisted `expandedPaths` was never touched.
 */
export function filterTree(nodes: FileTreeNode[], query: string, showUnreadable: boolean): TreeFilterResult {
  const needle = normalizeForComparison(query)
  const expanded = new Set<string>()
  let count = 0
  if (needle === '') return { nodes, expanded, count }

  /** The whole subtree, minus what the eye button hides. */
  const visibleChildren = (children: FileTreeNode[]): FileTreeNode[] =>
    children
      .filter(child => isRowVisible(child, showUnreadable))
      .map(child => (child.type === 'folder' ? { ...child, children: visibleChildren(child.children) } : child))

  const walk = (node: FileTreeNode): FileTreeNode | null => {
    if (!isRowVisible(node, showUnreadable)) return null

    if (node.type !== 'folder') {
      if (!normalizeForComparison(node.name).includes(needle)) return null
      count += 1
      return node
    }

    if (normalizeForComparison(node.name).includes(needle)) {
      count += 1
      expanded.add(node.path)
      return { ...node, children: visibleChildren(node.children) }
    }

    const children = node.children.map(walk).filter((child): child is FileTreeNode => child !== null)
    if (children.length === 0) return null
    // An ancestor of a match: shown for context, and opened so the match is
    // actually reachable rather than hidden behind a collapsed chevron.
    expanded.add(node.path)
    return { ...node, children }
  }

  return {
    nodes: nodes.map(walk).filter((node): node is FileTreeNode => node !== null),
    expanded,
    count,
  }
}
