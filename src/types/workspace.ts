export type FileTreeNode =
  | { type: 'folder'; name: string; path: string; children: FileTreeNode[] }
  | { type: 'mindmap'; name: string; path: string }
  | { type: 'other'; name: string; path: string }

export interface RootFolder {
  path: string
  tree: FileTreeNode[]
}

export interface WorkspaceConfig {
  rootFolders: string[]
}
