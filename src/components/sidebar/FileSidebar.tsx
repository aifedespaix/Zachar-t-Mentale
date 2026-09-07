import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderPlus, PanelLeftClose, PanelLeftOpen, RefreshCw, X } from 'lucide-react'
import { Button } from '../ui/button'
import { useWorkspaceStore, describeError } from '../../state/useWorkspaceStore'
import { FileTreeRow } from './FileTreeRow'
import type { FileTreeNode } from '../../types/workspace'

function folderDisplayName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? path
}

interface FileSidebarProps {
  onOpenFile: (path: string) => void
}

export function FileSidebar({ onOpenFile }: FileSidebarProps) {
  const rootFolders = useWorkspaceStore(s => s.rootFolders)
  const init = useWorkspaceStore(s => s.init)
  const addRootFolder = useWorkspaceStore(s => s.addRootFolder)
  const removeRootFolder = useWorkspaceStore(s => s.removeRootFolder)
  const refreshAll = useWorkspaceStore(s => s.refreshAll)
  const workspaceError = useWorkspaceStore(s => s.workspaceError)
  const setWorkspaceError = useWorkspaceStore(s => s.setWorkspaceError)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    // The store already reports its own failures; this catch covers anything
    // unexpected so a rejected init can never end as an unhandled rejection
    // with nothing on screen.
    init().catch(error => setWorkspaceError(`Impossible de charger la liste des dossiers : ${describeError(error)}`))
  }, [init, setWorkspaceError])

  async function handleAddFolder() {
    try {
      const selected = await open({ directory: true })
      if (typeof selected === 'string') await addRootFolder(selected)
    } catch (error) {
      setWorkspaceError(`Impossible d’ajouter le dossier : ${describeError(error)}`)
    }
  }

  async function handleRefreshAll() {
    try {
      await refreshAll()
    } catch (error) {
      setWorkspaceError(`Impossible de rafraîchir les dossiers : ${describeError(error)}`)
    }
  }

  function handleRemoveRoot(path: string) {
    removeRootFolder(path).catch(error =>
      setWorkspaceError(`Impossible de retirer le dossier : ${describeError(error)}`)
    )
  }

  if (collapsed) {
    return (
      <div style={{ width: 32, borderRight: '1px solid var(--border)', display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
        <Button variant="ghost" size="icon-sm" aria-label="Déplier la barre latérale" onClick={() => setCollapsed(false)}>
          <PanelLeftOpen size={16} />
        </Button>
      </div>
    )
  }

  return (
    <div style={{ width: 240, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Cartes mentales</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button variant="ghost" size="icon-sm" aria-label="Ajouter un dossier" onClick={handleAddFolder}>
            <FolderPlus size={16} />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Rafraîchir" onClick={handleRefreshAll}>
            <RefreshCw size={16} />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Replier la barre latérale" onClick={() => setCollapsed(true)}>
            <PanelLeftClose size={16} />
          </Button>
        </div>
      </div>
      {workspaceError && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 4,
            margin: '0 8px 8px',
            padding: 8,
            border: '1px solid #f59e0b',
            borderRadius: 4,
            background: '#fef3c7',
            color: '#92400e',
            fontSize: 12,
            lineHeight: 1.35,
          }}
        >
          <span style={{ flex: 1 }}>{workspaceError}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Masquer le message d’erreur"
            onClick={() => setWorkspaceError(null)}
          >
            <X size={14} />
          </Button>
        </div>
      )}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {rootFolders.length === 0 && (
          <p style={{ padding: 8, fontSize: 13, color: 'var(--muted-foreground)' }}>Aucun dossier configuré.</p>
        )}
        {rootFolders.map(root => {
          const rootNode: FileTreeNode = {
            type: 'folder',
            name: folderDisplayName(root.path),
            path: root.path,
            children: root.tree,
          }
          return (
            <FileTreeRow
              key={root.path}
              node={rootNode}
              depth={0}
              onOpenFile={onOpenFile}
              isRoot
              onRemoveRoot={handleRemoveRoot}
            />
          )
        })}
      </div>
    </div>
  )
}
