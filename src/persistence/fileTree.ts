import { readDir } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { isMindMapPath } from './paths'
import type { FileTreeNode } from '../types/workspace'

export async function scanFolder(folderPath: string): Promise<FileTreeNode[]> {
  const entries = await readDir(folderPath)
  const nodes = await Promise.all(
    entries.map(async (entry): Promise<FileTreeNode> => {
      const path = await join(folderPath, entry.name)
      if (entry.isDirectory) {
        return { type: 'folder', name: entry.name, path, children: await scanFolder(path) }
      }
      if (isMindMapPath(entry.name)) {
        return { type: 'mindmap', name: entry.name, path }
      }
      return { type: 'other', name: entry.name, path }
    })
  )
  return sortTree(nodes)
}

function sortTree(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type === 'folder' && b.type !== 'folder') return -1
    if (a.type !== 'folder' && b.type === 'folder') return 1
    return a.name.localeCompare(b.name)
  })
}

export function countDescendants(node: FileTreeNode): number {
  if (node.type !== 'folder') return 0
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0)
}

/**
 * Every mind map path currently visible across the given trees. Used to weed
 * dead entries out of the "recently opened" list — a file moved or deleted
 * outside the app must not leave a row nobody can click.
 */
export function collectMindMapPaths(nodes: FileTreeNode[]): Set<string> {
  const paths = new Set<string>()
  const visit = (node: FileTreeNode) => {
    if (node.type === 'mindmap') paths.add(node.path)
    else if (node.type === 'folder') node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return paths
}
