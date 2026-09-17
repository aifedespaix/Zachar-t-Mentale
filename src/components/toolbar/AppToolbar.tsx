import { useCallback, useState } from 'react'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import {
  ChevronDown,
  Command,
  Copy,
  Download,
  FileDown,
  FilePlus,
  FolderOpen,
  FolderSearch,
  CloudUpload,
  GraduationCap,
  Keyboard,
  Lock,
  LockOpen,
  Moon,
  PanelLeftClose,
  PanelRightClose,
  PenLine,
  PictureInPicture2,
  Redo2,
  RefreshCw,
  Save,
  Settings,
  Sun,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import type { Card, MindMapMeta } from '../../types/card'
import type { FileTreeNode } from '../../types/workspace'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '../ui/dropdown-menu'
import { CommandButton } from '../commands/CommandButton'
import { CommandDropdownItem } from '../commands/CommandMenuItem'
import { CommandPalette } from '../commands/CommandPalette'
import { NewMindMapDialog } from '../NewMindMapDialog'
import { NameDialog } from '../sidebar/NameDialog'
import { ExportDialog } from '../sidebar/ExportDialog'
import { QuizConfigModal } from '../quiz/QuizConfigModal'
import { SettingsDialog, type SettingsTab } from '../settings/SettingsDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { useCommand } from '../../hooks/useCommand'
import { useCardsStore } from '../../state/useCardsStore'
import { useCardDetailStore } from '../../state/useCardDetailStore'
import { useWorkspaceStore, describeError } from '../../state/useWorkspaceStore'
import { useAppearanceSettingsStore } from '../../state/useAppearanceSettingsStore'
import { usePublishMindMap } from '../../hooks/usePublishMindMap'
import { useDeleteMindMap, type DeletePlan } from '../../hooks/useDeleteMindMap'
import { DeletePlanSummary } from '../sidebar/DeletePlanSummary'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'
import { startCircularThemeTransition } from '../../theme/circularReveal'
import { duplicatePath, freeSiblingPath, renamePath } from '../../persistence/fileOps'
import { fileNameOf, mindMapBaseName, parentDirOf, separatorOf, withMindMapExtension } from '../../persistence/paths'
import { quickExport } from '../../export/quickExport'
import { describeExportError } from '../../export/describeExportError'
import type { UpdateCheckHandle } from '../../hooks/useAppUpdater'

interface AppToolbarProps {
  /** The map actually on screen — `null` when nothing is open. */
  filePath: string | null
  cards: Card[]
  /** The open map's sync metadata — `null` for a map that has never been synced. */
  meta: MindMapMeta | null
  /** The app's guarded file-switch, the only way a map is opened. */
  onOpenFile: (path: string) => void
  /**
   * Asked for instead of unlocking when the open map belongs to someone else:
   * App answers with the fork offer, the only way such a map becomes editable.
   */
  onRequestFork: () => void
  /** Writes a pending autosave immediately — what « Enregistrer » actually does. */
  flush: () => Promise<void>
  updateCheck: Partial<UpdateCheckHandle> & { status: UpdateCheckHandle['status']; checkNow: () => Promise<void> }
}

/** A dialog that needs a name typed into it before it can act. */
type PendingNaming = { kind: 'rename' | 'duplicate'; initialName: string }

/**
 * The header: the actions that act on the application and on the open FILE.
 *
 * Everything here is a command, which is what makes the three ways of reaching
 * an action agree — the button, the « Fichier » menu, and the keyboard. The
 * buttons on the bar are the handful worth permanent space (save, undo/redo,
 * new card, quiz, settings); the rest live one click away in the menu, with
 * their shortcut printed beside them.
 *
 * The dialogs those actions open are mounted here too, rather than inside each
 * button: a command triggered from the keyboard has no button to open its
 * dialog for it.
 */
export function AppToolbar({ filePath, cards, meta, onOpenFile, onRequestFork, flush, updateCheck }: AppToolbarProps) {
  const [newMapOpen, setNewMapOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [quizOpen, setQuizOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null)
  const [naming, setNaming] = useState<PendingNaming | null>(null)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deletePlan, setDeletePlan] = useState<DeletePlan | null>(null)
  const [busy, setBusy] = useState(false)

  const locked = useCardsStore(s => s.locked)
  // A map that is someone else's is shown locked like any other, but the lock is
  // not the user's to lift: reaching for it opens the fork offer instead.
  const readOnly = useCardsStore(s => s.readOnly)
  const editsBlocked = locked || readOnly
  const toggleLock = useCardsStore(s => s.toggleLock)
  const openFicheCount = useCardDetailStore(s => s.open.length)
  const setCurrentFile = useWorkspaceStore(s => s.setCurrentFile)
  const setWorkspaceError = useWorkspaceStore(s => s.setWorkspaceError)
  const refreshFolder = useWorkspaceStore(s => s.refreshFolder)
  const setThemeMode = useAppearanceSettingsStore(s => s.setThemeMode)
  const resolvedTheme = useResolvedTheme()
  const { canPublish, publish } = usePublishMindMap()
  const { planDelete, applyDelete } = useDeleteMindMap()

  const hasFile = filePath !== null
  const fileName = filePath === null ? null : fileNameOf(filePath)

  /**
   * Reports a failed file operation through the workspace's own error banner.
   *
   * The app's first principle is that nothing fails in silence — and these run
   * from a keystroke as often as from a button, where there is no dialog left
   * on screen to carry the message.
   */
  const fail = useCallback(
    (message: string) => setWorkspaceError(message),
    [setWorkspaceError]
  )

  // ── Fichier ───────────────────────────────────────────────────────────────

  useCommand('file.new', () => setNewMapOpen(true))

  useCommand(
    'file.save',
    () => {
      // The autosave already fires on a 500 ms debounce; this is the reflex
      // answer — it writes NOW and says so if the write fails.
      flush().catch(error => fail(`Impossible d’enregistrer : ${describeError(error)}`))
    },
    hasFile
  )

  useCommand('file.close', () => setCurrentFile(null), hasFile)

  useCommand(
    'file.rename',
    () => filePath && setNaming({ kind: 'rename', initialName: mindMapBaseName(filePath) }),
    hasFile
  )

  useCommand(
    'file.duplicate',
    () => {
      if (filePath === null) return
      void (async () => {
        const free = await freeSiblingPath(parentDirOf(filePath), mindMapBaseName(filePath), false)
        setNaming({ kind: 'duplicate', initialName: mindMapBaseName(free) })
      })()
    },
    hasFile
  )

  // Acts on the open file, and only when there is something to do: a local map
  // inside the sync folder. Its own handler reports a refusal or a failure.
  useCommand(
    'sync.publish',
    () => {
      if (filePath !== null) void publish(filePath)
    },
    canPublish(filePath, meta)
  )

  useCommand('file.delete', () => void openDeleteDialog(), hasFile)
  useCommand('file.export', () => setExportOpen(true), hasFile)

  useCommand(
    'file.exportPdf',
    () => {
      void quickExport('pdf', cards, filePath).catch(error =>
        fail(`Échec de l’export : ${describeExportError(error)}`)
      )
    },
    hasFile
  )

  useCommand(
    'file.reveal',
    () => {
      if (filePath === null) return
      void revealItemInDir(filePath).catch(error =>
        fail(`Impossible d’ouvrir le dossier du fichier : ${describeError(error)}`)
      )
    },
    hasFile
  )


  // ── Affichage et application ──────────────────────────────────────────────
  // (« Annuler »/« Rétablir » are registered by the canvas, which owns the card
  // history; the buttons below only reference them.)

  useCommand(
    'view.toggleLock',
    () => {
      // Someone else's map cannot simply be unlocked — that would let the next
      // pull overwrite the edits. The offer to fork it is the way in, and
      // declining it leaves the map read-only.
      if (readOnly) {
        onRequestFork()
        return
      }
      toggleLock()
    },
    true,
    editsBlocked ? 'Déverrouiller la carte' : 'Verrouiller la carte'
  )

  useCommand(
    'view.toggleTheme',
    () => void setThemeMode(resolvedTheme === 'dark' ? 'light' : 'dark'),
    true,
    resolvedTheme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'
  )

  useCommand(
    'card.closeFiches',
    () => useCardDetailStore.getState().closeAll(),
    openFicheCount > 0
  )

  useCommand('app.palette', () => setPaletteOpen(true))
  useCommand('app.settings', () => setSettingsTab('general'))
  useCommand('app.shortcuts', () => setSettingsTab('shortcuts'))
  useCommand('app.quiz', () => setQuizOpen(true), hasFile)

  // ── Actions asynchrones des dialogues ─────────────────────────────────────

  async function submitNaming(name: string) {
    if (filePath === null || naming === null) return
    const folder = parentDirOf(filePath)
    const target = `${folder}${separatorOf(filePath)}${withMindMapExtension(name)}`
    setNaming(null)
    setBusy(true)
    try {
      if (naming.kind === 'rename') {
        await renamePath(filePath, target)
        if (folder) await refreshFolder(folder)
        // The open map moved: point the app at its new path, or it would keep
        // autosaving to a file that no longer exists.
        setCurrentFile(target)
      } else {
        await duplicatePath(filePath, target, false)
        if (folder) await refreshFolder(folder)
        // The copy is opened, not just created — duplicating a map is almost
        // always the first step of working in the copy.
        onOpenFile(target)
      }
    } catch (error) {
      fail(
        naming.kind === 'rename'
          ? `Impossible de renommer « ${fileName} » : ${describeError(error)}`
          : `Impossible de dupliquer « ${fileName} » : ${describeError(error)}`
      )
    } finally {
      setBusy(false)
    }
  }

  /** Calcule le plan de suppression avant d'ouvrir la confirmation. */
  async function openDeleteDialog() {
    if (filePath === null) return
    const node: FileTreeNode = { type: 'mindmap', name: fileNameOf(filePath), path: filePath }
    try {
      setDeletePlan(await planDelete(node))
      setConfirmDeleteOpen(true)
    } catch (error) {
      fail(`Impossible de préparer la suppression de « ${fileName} » : ${describeError(error)}`)
    }
  }

  async function confirmDelete() {
    if (filePath === null || deletePlan === null) return
    setConfirmDeleteOpen(false)
    const plan = deletePlan
    setDeletePlan(null)
    setBusy(true)
    const folder = parentDirOf(filePath)
    try {
      const outcome = await applyDelete(plan)
      if (outcome.failed.length > 0) {
        fail(`Impossible de supprimer « ${fileName} » : ${describeError(outcome.failed[0].error)}`)
        return
      }
      // Rien n'a disparu (la carte appartient à quelqu'un d'autre) : on laisse
      // le canevas tel quel.
      if (outcome.deletedFiles === 0) return
      // Closed BEFORE the tree is re-scanned: leaving the canvas on a file that
      // is gone would let autosave recreate it a keystroke later.
      setCurrentFile(null)
      if (folder) await refreshFolder(folder)
    } catch (error) {
      fail(`Impossible de supprimer « ${fileName} » : ${describeError(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <TooltipProvider>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/*
          The « Fichier » menu holds everything that acts on the file itself.
          A menu rather than eight more icons: these are deliberate, occasional
          actions, and each one reads better with its name and its shortcut than
          as a glyph you have to hover to identify.
        */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Fichier
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <CommandDropdownItem command="file.new" icon={FilePlus} />
            <CommandDropdownItem command="file.newFolder" icon={FolderOpen} />
            <CommandDropdownItem command="file.addRootFolder" icon={FolderSearch} />
            <DropdownMenuSeparator />
            <CommandDropdownItem command="file.save" icon={Save} />
            <CommandDropdownItem command="file.rename" icon={PenLine} />
            <CommandDropdownItem command="file.duplicate" icon={Copy} />
            <CommandDropdownItem command="sync.publish" icon={CloudUpload} />
            <DropdownMenuSeparator />
            <CommandDropdownItem command="file.export" icon={Download} />
            <CommandDropdownItem command="file.exportPdf" icon={FileDown} />
            <CommandDropdownItem command="file.reveal" icon={FolderSearch} />
            <CommandDropdownItem command="file.refresh" icon={RefreshCw} />
            <DropdownMenuSeparator />
            <CommandDropdownItem command="file.close" icon={X} />
            <CommandDropdownItem command="file.delete" icon={Trash2} />
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="toolbar-separator" aria-hidden />

        <CommandButton command="file.close" icon={X} />
        <CommandButton
          command="file.new"
          icon={FilePlus}
          variant={hasFile ? 'outline' : 'default'}
          className={hasFile ? undefined : 'toolbar-new--invite'}
        />
        <CommandButton command="edit.undo" icon={Undo2} />
        <CommandButton command="edit.redo" icon={Redo2} />

        <span className="toolbar-separator" aria-hidden />

        <CommandButton command="card.addFloating" icon={PictureInPicture2} />
        <CommandButton command="file.export" icon={Download} />
        <CommandButton command="file.reveal" icon={FolderSearch} />
        <CommandButton command="app.quiz" icon={GraduationCap} className="toolbar-quiz--rainbow" />

        <span className="toolbar-separator" aria-hidden />

        {/* Locked or not, the same outline button: what changes is the colour,
            and it is the SAME orange as the locked rows of the tree — the two
            are one state, and the colour is what says so. */}
        <CommandButton
          command="view.toggleLock"
          icon={editsBlocked ? Lock : LockOpen}
          variant="outline"
          className={editsBlocked ? 'toolbar-lock--active' : undefined}
        />
        <CommandButton command="app.palette" icon={Command} />

        {/* The theme button keeps its own handler rather than going through the
            command: the circular reveal animates out of the CLICK's coordinates,
            which a keyboard shortcut does not have. Both end on the same
            `setThemeMode`. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label={resolvedTheme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
              onClick={event => {
                const target = resolvedTheme === 'dark' ? 'light' : 'dark'
                startCircularThemeTransition({
                  x: event.clientX,
                  y: event.clientY,
                  apply: () => void setThemeMode(target),
                })
              }}
            >
              {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {resolvedTheme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Paramètres et raccourcis">
                  <Settings />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Paramètres et raccourcis</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Application</DropdownMenuLabel>
            <CommandDropdownItem command="app.settings" icon={Settings} />
            <CommandDropdownItem command="app.shortcuts" icon={Keyboard} />
            <DropdownMenuSeparator />
            <CommandDropdownItem command="view.toggleSidebar" icon={PanelRightClose} />
            <CommandDropdownItem command="view.toggleDetailPanel" icon={PanelLeftClose} />
            <CommandDropdownItem command="view.toggleTheme" icon={resolvedTheme === 'dark' ? Sun : Moon} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mounted only while open, so each run starts from a clean field. */}
      {newMapOpen && <NewMindMapDialog onClose={() => setNewMapOpen(false)} onCreated={onOpenFile} />}

      {naming !== null && (
        <NameDialog
          title={naming.kind === 'rename' ? 'Renommer la carte mentale' : 'Dupliquer la carte mentale'}
          inputLabel="Nom de la carte mentale"
          initialName={naming.initialName}
          confirmLabel={naming.kind === 'rename' ? 'Renommer' : 'Dupliquer'}
          onCancel={() => setNaming(null)}
          onConfirm={name => void submitNaming(name)}
        />
      )}

      {confirmDeleteOpen && deletePlan !== null && (
        <Dialog open onOpenChange={open => !open && setConfirmDeleteOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Supprimer « {fileName} » ?</DialogTitle>
            </DialogHeader>
            <DeletePlanSummary plan={deletePlan} />
            <p style={{ margin: 0, fontSize: 14 }}>
              Le fichier et ses images sont supprimés du disque. Cette action ne peut pas être annulée
              depuis l’application.
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setConfirmDeleteOpen(false)
                  setDeletePlan(null)
                }}
              >
                Annuler
              </Button>
              {/* Focused on open, visibly — not just Radix's default focus on
                  the first tabbable button (« Annuler ») — so the ring shows
                  which action Entrée will trigger, and Entrée actually
                  triggers it. */}
              <Button
                variant="destructive"
                autoFocus
                disabled={busy || deletePlan.files.length === 0}
                onClick={() => void confirmDelete()}
              >
                Supprimer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {exportOpen && filePath !== null && (
        <ExportDialog
          open
          fileName={fileNameOf(filePath)}
          filePath={filePath}
          cards={cards}
          onClose={() => setExportOpen(false)}
          onError={fail}
        />
      )}

      <QuizConfigModal open={quizOpen} onOpenChange={setQuizOpen} />

      <SettingsDialog
        open={settingsTab !== null}
        initialTab={settingsTab ?? 'general'}
        onOpenChange={open => setSettingsTab(open ? (settingsTab ?? 'general') : null)}
        updateCheck={updateCheck}
      />

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </TooltipProvider>
  )
}
