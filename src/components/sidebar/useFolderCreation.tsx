import { useState, type ReactNode } from 'react'
import { FilePlus, FileUp, FolderPlus } from 'lucide-react'
import { ContextMenuItem } from '../ui/context-menu'
import { NameDialog } from './NameDialog'
import { useWorkspaceStore, describeError } from '../../state/useWorkspaceStore'
import { createMindMapFile, createSubfolder, freeMindMapPath, freeSiblingPath } from '../../persistence/fileOps'
import { saveMindMap, mindMapExists } from '../../persistence/fileStore'
import { pickXmindFile, readBinaryFile } from '../../persistence/exportIO'
import { readXmindFile } from '../../xmind/importXmind'
import { fileNameOf, mindMapBaseName, separatorOf, withMindMapExtension } from '../../persistence/paths'

/** A dialog that needs a name typed into it before it can act. */
interface NamingAction {
  title: string
  initialName: string
  confirmLabel: string
  onConfirm: (name: string) => void
  inputLabel?: string
}

/**
 * The three « create something in this folder » actions, shared by every place
 * a folder can be right-clicked: a folder row in the tree, and — since the
 * first configured folder is the implicit target — the empty space of the file
 * sidebar itself.
 *
 * The menu ITEMS and the naming DIALOG are returned separately because they
 * cannot live in the same DOM subtree: the items belong inside the context
 * menu's content, which Radix unmounts the moment an item is selected, while
 * the dialog must survive that close to be visible at all.
 *
 * `folderPath` is read on every call rather than captured once, so a folder
 * that is renamed or a first root that changes keeps targeting the right place.
 */
export function useFolderCreation(
  folderPath: string,
  onOpenFile: (path: string) => void
): { menuItems: ReactNode; dialog: ReactNode } {
  const refreshFolder = useWorkspaceStore(s => s.refreshFolder)
  const setWorkspaceError = useWorkspaceStore(s => s.setWorkspaceError)
  const [namingAction, setNamingAction] = useState<NamingAction | null>(null)

  async function openCreateMindMapDialog() {
    const fullPath = await freeSiblingPath(folderPath, 'Nouvelle carte mentale', false)
    const name = mindMapBaseName(fileNameOf(fullPath))
    setNamingAction({
      title: 'Nouvelle carte mentale',
      initialName: name,
      confirmLabel: 'Créer',
      onConfirm: submitCreateMindMap,
      inputLabel: 'Nom de la nouvelle carte mentale',
    })
  }

  async function submitCreateMindMap(name: string) {
    setNamingAction(null)
    const destPath = `${folderPath}${separatorOf(folderPath)}${withMindMapExtension(name)}`
    if (await mindMapExists(destPath)) {
      setWorkspaceError(
        `Impossible de créer la carte mentale « ${name} » : un fichier « ${withMindMapExtension(name)} » existe déjà.`
      )
      return
    }
    try {
      const path = await createMindMapFile(folderPath, name)
      await refreshFolder(folderPath)
      onOpenFile(path)
    } catch (error) {
      setWorkspaceError(`Impossible de créer la carte mentale « ${name} » : ${describeError(error)}`)
    }
  }

  async function openCreateFolderDialog() {
    const fullPath = await freeSiblingPath(folderPath, 'Nouveau dossier', true)
    const name = fileNameOf(fullPath)
    setNamingAction({
      title: 'Nouveau sous-dossier',
      initialName: name,
      confirmLabel: 'Créer',
      onConfirm: submitCreateFolder,
      inputLabel: 'Nom du nouveau dossier',
    })
  }

  async function submitCreateFolder(name: string) {
    setNamingAction(null)
    try {
      await createSubfolder(folderPath, name)
      await refreshFolder(folderPath)
    } catch (error) {
      setWorkspaceError(`Impossible de créer le dossier « ${name} » : ${describeError(error)}`)
    }
  }

  async function handleImportXmind() {
    let path: string | null = null
    let sheetsWritten = 0
    try {
      path = await pickXmindFile()
      if (!path) return
      const bytes = await readBinaryFile(path)
      const sheets = await readXmindFile(bytes)
      for (const sheet of sheets) {
        const target = await freeMindMapPath(folderPath, sheet.sheetTitle)
        await saveMindMap(target, sheet.cards)
        sheetsWritten += 1
      }
      await refreshFolder(folderPath)
    } catch (error) {
      if (sheetsWritten > 0) await refreshFolder(folderPath)
      const partial = sheetsWritten > 0 ? ` (${sheetsWritten} carte(s) mentale(s) déjà importée(s) avant l’échec)` : ''
      setWorkspaceError(
        `Impossible d’importer « ${path ? fileNameOf(path) : 'le fichier XMind'} » : ${describeError(error)}${partial}`
      )
    }
  }

  // A fragment rather than three separate values: both call sites render the
  // exact same trio, which is the point of sharing the hook at all.
  const menuItems = (
    <>
      <ContextMenuItem onSelect={openCreateMindMapDialog}>
        <FilePlus size={14} /> Nouvelle carte mentale
      </ContextMenuItem>
      <ContextMenuItem onSelect={openCreateFolderDialog}>
        <FolderPlus size={14} /> Nouveau sous-dossier
      </ContextMenuItem>
      <ContextMenuItem onSelect={handleImportXmind}>
        <FileUp size={14} /> Importer XMind
      </ContextMenuItem>
    </>
  )

  const dialog =
    namingAction !== null && (
      <NameDialog
        title={namingAction.title}
        initialName={namingAction.initialName}
        confirmLabel={namingAction.confirmLabel}
        onConfirm={namingAction.onConfirm}
        onCancel={() => setNamingAction(null)}
        inputLabel={namingAction.inputLabel}
      />
    )

  return { menuItems, dialog }
}
