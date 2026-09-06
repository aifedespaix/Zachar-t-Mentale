import { readDir } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import type { FileTreeNode } from '../types/workspace'

export async function scanFolder(folderPath: string): Promise<FileTreeNode[]> {
  const entries = await readDir(folderPath)
  const nodes = await Promise.all(
    entries.map(async (entry): Promise<FileTreeNode> => {
      const path = await join(folderPath, entry.name)
      if (entry.isDirectory) {
        return { type: 'folder', name: entry.name, path, children: await scanFolder(path) }
      }
      if (entry.name.toLowerCase().endsWith('.json')) {
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
