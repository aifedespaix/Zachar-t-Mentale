import { Folder, FolderOpen, FileJson, File, ChevronRight, ChevronDown } from 'lucide-react'
import type { FileTreeNode } from '../../types/workspace'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'

interface FileTreeRowProps {
  node: FileTreeNode
  depth: number
  onOpenFile: (path: string) => void
}

export function FileTreeRow({ node, depth, onOpenFile }: FileTreeRowProps) {
  const expandedPaths = useWorkspaceStore(s => s.expandedPaths)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const toggleExpanded = useWorkspaceStore(s => s.toggleExpanded)

  const indent = { paddingLeft: 8 + depth * 16 }

  if (node.type === 'folder') {
    const isExpanded = expandedPaths.has(node.path)
    return (
      <div>
        <button
          type="button"
          onClick={() => toggleExpanded(node.path)}
          aria-expanded={isExpanded}
          style={{
            ...indent,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            background: 'transparent',
            border: 'none',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          <span>{node.name}</span>
        </button>
        {isExpanded &&
          node.children.map(child => <FileTreeRow key={child.path} node={child} depth={depth + 1} onOpenFile={onOpenFile} />)}
      </div>
    )
  }

  if (node.type === 'mindmap') {
    const isActive = node.path === currentFilePath
    return (
      <button
        type="button"
        onClick={() => onOpenFile(node.path)}
        style={{
          ...indent,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          background: isActive ? 'var(--muted)' : 'transparent',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <FileJson size={16} />
        <span>{node.name}</span>
      </button>
    )
  }

  return (
    <div aria-disabled style={{ ...indent, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted-foreground)' }}>
      <File size={16} />
      <span>{node.name}</span>
    </div>
  )
}
