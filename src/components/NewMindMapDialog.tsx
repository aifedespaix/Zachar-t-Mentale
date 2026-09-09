import { useState } from 'react'
import type { FileTreeNode, RootFolder } from '../types/workspace'
import { useWorkspaceStore, describeError } from '../state/useWorkspaceStore'
import { createMindMapFile } from '../persistence/fileOps'
import { mindMapExists } from '../persistence/fileStore'
import { sanitizeFileName, separatorOf, parentDirOf, withMindMapExtension } from '../persistence/paths'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Button } from './ui/button'

export interface FolderOption {
  path: string
  name: string
  /** Nesting level, only used to indent the option's label. */
  depth: number
  /** Every folder from the root down to this one — what has to be expanded for it to be visible. */
  trail: string[]
}

/** Non-breaking spaces: a `<option>` collapses ordinary leading whitespace away. */
const INDENT = '\u00a0\u00a0'

function folderDisplayName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? path
}

/**
 * Every folder of the workspace, flattened depth-first so a `<select>` can
 * offer them in tree order. The header has no folder under the cursor the way
 * a sidebar row does, so the destination has to be an explicit choice.
 */
export function folderOptions(rootFolders: RootFolder[]): FolderOption[] {
  const options: FolderOption[] = []

  function walk(nodes: FileTreeNode[], depth: number, trail: string[]): void {
    for (const node of nodes) {
      if (node.type !== 'folder') continue
      const nodeTrail = [...trail, node.path]
      options.push({ path: node.path, name: node.name, depth, trail: nodeTrail })
      walk(node.children, depth + 1, nodeTrail)
    }
  }

  for (const root of rootFolders) {
    options.push({ path: root.path, name: folderDisplayName(root.path), depth: 0, trail: [root.path] })
    walk(root.tree, 1, [root.path])
  }
  return options
}

interface NewMindMapDialogProps {
  onClose: () => void
  /** Opened through the app's normal file-switch path, so the guard still runs. */
  onCreated: (path: string) => void
}

/**
 * "Nouvelle carte mentale" from the header: pick a folder, name the map, get it
 * created and opened. The sidebar offers the same thing per folder row; this is
 * the version reachable when the sidebar is collapsed, or when the folder you
 * want is buried a few levels down.
 */
export function NewMindMapDialog({ onClose, onCreated }: NewMindMapDialogProps) {
  const rootFolders = useWorkspaceStore(s => s.rootFolders)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const refreshFolder = useWorkspaceStore(s => s.refreshFolder)
  const expandPaths = useWorkspaceStore(s => s.expandPaths)

  // Computed once, on mount: the dialog is mounted fresh each time it opens,
  // and recomputing on every keystroke would fight the user's own selection.
  const [options] = useState(() => folderOptions(rootFolders))
  const [folder, setFolder] = useState(() => {
    const beside = currentFilePath === null ? null : parentDirOf(currentFilePath)
    // The folder of the open map is where the next one most likely belongs —
    // but only if it is actually one of the workspace's folders.
    if (beside !== null && options.some(option => option.path === beside)) return beside
    return options[0]?.path ?? ''
  })
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = name.trim()
  const canCreate = trimmed !== '' && folder !== '' && !creating

  async function handleCreate() {
    if (!canCreate) return
    const safeName = sanitizeFileName(trimmed)
    const fileName = withMindMapExtension(safeName)
    setCreating(true)
    setError(null)
    try {
      // `createMindMapFile` writes unconditionally, so an existing map of the
      // same name would be replaced by an empty one. Refused here instead: the
      // header offers no undo, and a chapter overwritten by « Nouveau chapitre »
      // is not something the user could get back.
      if (await mindMapExists(`${folder}${separatorOf(folder)}${fileName}`)) {
        setError(`« ${fileName} » existe déjà dans ce dossier. Choisissez un autre nom.`)
        return
      }
      const path = await createMindMapFile(folder, safeName)
      await refreshFolder(folder)
      // So the new map is visible in the tree, not just on the canvas: it may
      // well have landed inside folders the user has never expanded.
      expandPaths(options.find(option => option.path === folder)?.trail ?? [folder])
      onCreated(path)
      onClose()
    } catch (caught) {
      // Kept open on failure: a read-only folder or an illegal name is
      // something the user can still fix from this same dialog.
      setError(`Impossible de créer la carte mentale « ${safeName} » : ${describeError(caught)}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle carte mentale</DialogTitle>
          {options.length === 0 && (
            <DialogDescription>
              Aucun dossier configuré. Ajoutez d’abord un dossier depuis la barre latérale.
            </DialogDescription>
          )}
        </DialogHeader>

        {options.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontWeight: 500 }}>Dossier</span>
              <select
                aria-label="Dossier de destination"
                value={folder}
                onChange={event => setFolder(event.target.value)}
                style={{
                  padding: '6px 8px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--background)',
                  color: 'inherit',
                  font: 'inherit',
                }}
              >
                {options.map(option => (
                  <option key={option.path} value={option.path}>
                    {`${INDENT.repeat(option.depth)}${option.name}`}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontWeight: 500 }}>Nom</span>
              <input
                autoFocus
                aria-label="Nom de la nouvelle carte mentale"
                value={name}
                onChange={event => setName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') void handleCreate()
                }}
                placeholder="Chapitre 1"
                style={{
                  padding: '6px 8px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--background)',
                  color: 'inherit',
                  font: 'inherit',
                }}
              />
            </label>

            {error && (
              <p role="alert" style={{ margin: 0, color: 'var(--warning-fg)' }}>
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={creating}>
            Annuler
          </Button>
          {options.length > 0 && (
            <Button onClick={handleCreate} disabled={!canCreate}>
              {creating ? 'Création…' : 'Créer'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
