// src/App.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { MindMapCanvas } from './components/MindMapCanvas'
import { CanvasErrorBoundary } from './components/CanvasErrorBoundary'
import { CorruptedMapDialog } from './components/CorruptedMapDialog'
import { SaveFailedDialog } from './components/SaveFailedDialog'
import { FileSidebar } from './components/sidebar/FileSidebar'
import { QuizFrame } from './components/quiz/QuizFrame'
import { QuizSummaryModal } from './components/quiz/QuizSummaryModal'
import { useQuizSettingsStore } from './state/useQuizSettingsStore'
import { useCardsStore } from './state/useCardsStore'
import { useWorkspaceStore, describeError } from './state/useWorkspaceStore'
import { useQuizStore } from './state/useQuizStore'
import { useCardDetailStore } from './state/useCardDetailStore'
import { useCardHoverStore } from './state/useCardHoverStore'
import { useAutosave } from './persistence/useAutosave'
import { loadMindMap, saveMindMap, mindMapExists, loadMindMapMeta } from './persistence/fileStore'
import { duplicateMap } from './persistence/fileOps'
import { useSyncStore } from './state/useSyncStore'
import { ReadOnlyMapDialog } from './components/ReadOnlyMapDialog'
import { fileNameOf, parentDirOf, repairedCopyPath } from './persistence/paths'
import { repairCards, validateCards, type CardIssue } from './validation/cardsValidation'
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts'
import { useWindowTitle } from './hooks/useWindowTitle'
import { useUnsavedChangesGuard } from './hooks/useUnsavedChangesGuard'
import { useFileDropZone } from './hooks/useFileDropZone'
import { useLaunchFile } from './hooks/useLaunchFile'
import { imageBlockFrom } from './content/imageBlock'
import { mimeForPath } from './content/pickImage'
import { contentOf } from './content/blocks'
import { readFile } from '@tauri-apps/plugin-fs'
import { AppToolbar } from './components/toolbar/AppToolbar'
import { useAppearanceSettingsStore } from './state/useAppearanceSettingsStore'
import { useShortcutSettingsStore } from './state/useShortcutSettingsStore'
import { useCardSelectionStore } from './state/useCardSelectionStore'
import { useThemeDomSync } from './hooks/useResolvedTheme'
import { useAppliedFontFamily } from './hooks/useAppliedFontFamily'
import { useAppUpdater } from './hooks/useAppUpdater'
import { useAutoSync } from './hooks/useAutoSync'
import type { SyncResult } from './sync/syncService'
import { UpdateReadyBanner } from './components/update/UpdateReadyBanner'
import { CardDetailPanel } from './components/detail/CardDetailPanel'
import type { Card, MindMapMeta } from './types/card'

/** A map that failed validation, held until the user decides what to do with it. */
interface PendingRepair {
  path: string
  fileName: string
  /** The raw cards as read from disk — the repair works on a copy of these. */
  cards: Card[]
  issues: CardIssue[]
}

/** How many « (Réparée n) » names to try before giving up on finding a free one. */
const MAX_REPAIR_ATTEMPTS = 100

/**
 * The first « [Nom] (Réparée).zmap » that does not exist yet. A repair must
 * never overwrite anything — neither the corrupt original nor an earlier
 * repaired copy the user may have already worked in.
 */
async function freeRepairedPath(path: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    const candidate = repairedCopyPath(path, attempt)
    if (!(await mindMapExists(candidate))) return candidate
  }
  throw new Error(`trop de copies réparées de ${fileNameOf(path)} existent déjà`)
}

function App() {
  const cards = useCardsStore(s => s.history.present)
  const loadCards = useCardsStore(s => s.loadCards)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const setCurrentFile = useWorkspaceStore(s => s.setCurrentFile)
  const refreshFolder = useWorkspaceStore(s => s.refreshFolder)
  const quizActive = useQuizStore(s => s.active)
  const [saveFailed, setSaveFailed] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pendingRepair, setPendingRepair] = useState<PendingRepair | null>(null)
  // The read-only fork offer is opened on demand — when the user reaches for a
  // locked map's lock — rather than blocking the map the moment it is opened.
  const [forkPromptOpen, setForkPromptOpen] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [repairError, setRepairError] = useState<string | null>(null)
  // The path whose cards are actually in the canvas right now. `currentFilePath`
  // is only an INTENT until the load succeeds AND the structure validates; this
  // is the fact. It is what a failed switch reverts to, what the canvas is keyed
  // and gated on, and what autosave writes to — so nothing can ever render, or
  // be written, for a file the app has not fully loaded.
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const [loadedMeta, setLoadedMeta] = useState<MindMapMeta | null>(null)
  const currentUser = useSyncStore(s => s.currentUser)
  const mainRef = useRef<HTMLElement | null>(null)
  useGlobalShortcuts()
  // Only does anything when the user turned automatic sync on.
  useAutoSync()
  useWindowTitle(currentFilePath)
  useThemeDomSync()
  useAppliedFontFamily()
  const { updateReady, dismissed, applyUpdate, dismissUpdate, status: updateStatus, checkNow: checkForUpdates } =
    useAppUpdater()
  const { flush } = useAutosave(
    loadedPath ?? '',
    cards,
    500,
    loadedPath !== null && loadedPath === currentFilePath,
    () => setSaveFailed(true)
  )
  const syncResult = useSyncStore(s => s.lastResult)
  /**
   * The ONE follow-up a sync's relocations get.
   *
   * It lives here rather than in the sidebar because a sync has three triggers
   * — the button, the background timer, the settings panel — and a run that
   * relocated the open file automatically otherwise left `currentFilePath` on
   * the old path: `useAutosave`, still armed for that path, recreated the old
   * file holding the user's newest edits while the synced copy at the new path
   * went stale. The map was silently split in two, and the tree row left behind
   * opened as « ce fichier n'existe plus ».
   *
   * The order is not cosmetic: `flush` first, because the `loadedPath` change
   * that follows cancels the debounce — a pending save has to be on disk before
   * that. Then the pointer. Then the tree, which a pull and a relocation both
   * leave behind the disk.
   */
  const handledSyncResult = useRef<SyncResult | null>(null)
  useEffect(() => {
    if (syncResult === null || syncResult === handledSyncResult.current) return
    handledSyncResult.current = syncResult
    // Neither a pull, a relocation nor a type adoption: nothing moved on
    // disk, so the tree is current and there is nobody to follow. `?? 0`: the
    // counters are optional in `SyncResult`, and its readers take them that way.
    if (syncResult.pulled === 0 && (syncResult.relocated ?? 0) === 0 && (syncResult.reclassified ?? 0) === 0) return

    // The path open when the result came in: THAT file's move is the one that
    // matters here, not another file's in the same folder.
    const openPath = useWorkspaceStore.getState().currentFilePath
    const moved =
      openPath === null ? undefined : (syncResult.moved ?? []).find(entry => entry.from === openPath)

    void (async () => {
      try {
        await flush()
      } catch {
        // Already surfaced through `useAutosave`'s own error callback — the
        // « Erreur de sauvegarde » banner. The open file stays the one edited.
      }
      // Re-read as we act: `flush` may have waited, and the user may have
      // opened something else in the meantime. Dragging them back to the moved
      // file would be a second surprise.
      if (moved !== undefined && useWorkspaceStore.getState().currentFilePath === moved.from) {
        setCurrentFile(moved.to)
      }
      // Une adoption de type a réécrit le `meta` sur le disque sans changer le
      // chemin : forcer la révision fait relire chaque ligne par
      // `useMindMapAuthor`, sinon la pilule garde l’ancien type.
      useWorkspaceStore.getState().bumpFileMetaRevision()
      const folder = useSyncStore.getState().syncFolderPath
      if (folder !== null) await refreshFolder(folder)
    })()
  }, [syncResult, flush, setCurrentFile, refreshFolder])
  const { requestOpenFile, prompt, dismissPrompt } = useUnsavedChangesGuard(flush, setCurrentFile)
  /**
   * An image dropped on a card is appended to that card's definition.
   *
   * Reads the card fresh from the store rather than closing over a snapshot:
   * a drop can land long after this callback was created, and appending to a
   * stale block list would silently discard edits made in between.
   */
  const handleDropImageOnCard = useCallback(
    async (cardId: string, path: string) => {
      const mapPath = useWorkspaceStore.getState().currentFilePath
      if (mapPath === null) return
      const meta = await loadMindMapMeta(mapPath).catch(() => null)
      if (meta !== null && meta.author !== useSyncStore.getState().currentUser?.username) return
      try {
        const source = { bytes: await readFile(path), mime: mimeForPath(path), name: fileNameOf(path) }
        // Re-checked AFTER the read: a large file takes long enough for the
        // user to switch maps, and writing into the old map's sidecar would
        // leave an orphan file and drop the image on the floor in silence.
        if (useWorkspaceStore.getState().currentFilePath !== mapPath) return
        const block = await imageBlockFrom(mapPath, source)
        if (useWorkspaceStore.getState().currentFilePath !== mapPath) return
        const cards = useCardsStore.getState().history.present
        const card = cards.find(entry => entry.id === cardId)
        if (card === undefined) return
        useCardsStore.getState().updateContent(cardId, [...contentOf(card), block])
      } catch (error) {
        // The app-wide channel the file operations already use, rather than
        // this component's own load-error state: a failed drop is a workspace
        // failure, not a failure to open the map.
        useWorkspaceStore
          .getState()
          .setWorkspaceError(
            error instanceof Error ? error.message : 'Impossible d’ajouter cette image à la carte.'
          )
      }
    },
    []
  )

  const { isDragActive, dropError } = useFileDropZone(mainRef, requestOpenFile, handleDropImageOnCard)
  // Same entry point as the sidebar and drag & drop, so a map opened from the
  // Explorer goes through the unsaved-changes guard like any other switch.
  useLaunchFile(requestOpenFile)

  useEffect(() => {
    useQuizSettingsStore.getState().init()
    useAppearanceSettingsStore.getState().init()
    useShortcutSettingsStore.getState().init()
    useSyncStore.getState().init()
  }, [])

  /**
   * Open fiches belong to the map that is open, not to the application.
   *
   * Carrying them across a file switch would leave the panel showing cards
   * that no longer exist — or, worse, cards from the previous map whose ids
   * happen to collide with the new one's.
   */
  useEffect(() => {
    useCardDetailStore.getState().closeAll()
    // Selection belongs to the map too: a card id carried across a switch would
    // aim every card shortcut at a card that is no longer on screen — or, worse,
    // at whatever card of the new map happens to share its id.
    useCardSelectionStore.getState().reset()
    // The hover that links a card to its fiche belongs to the previous map too:
    // a hovered id left over on reload would light up the wrong card's fiche.
    useCardHoverStore.getState().reset()
    // The fork offer belongs to the map that raised it: a copy that just opened
    // must not land with the previous file's offer still on screen.
    setForkPromptOpen(false)
  }, [loadedPath])

  /**
   * A quiz closes every fiche, and this is correctness rather than tidiness:
   * `qcm-definition` asks the user to recognise a definition, and a fiche left
   * open beside the question hands them the answer. Same reasoning as the file
   * sidebar, which a quiz also hides.
   */
  useEffect(() => {
    if (quizActive) {
      useCardDetailStore.getState().closeAll()
      useCardSelectionStore.getState().reset()
      useCardHoverStore.getState().reset()
    }
  }, [quizActive])

  /** A deleted card's fiche goes with it; undo brings both back. */
  useEffect(() => {
    useCardDetailStore.getState().retain(new Set(cards.map(card => card.id)))
  }, [cards])

  // Re-runs on every file switch (open a different file, or a rename that
  // moves the current file to a new path): each switch starts a fresh
  // load -> validate -> enable-autosave cycle.
  useEffect(() => {
    if (!currentFilePath) {
      setLoadedPath(null)
      setLoadedMeta(null)
      return
    }
    // Already the file on screen — this run is a revert below landing, or the
    // state update that recorded the load. Re-loading would be pointless and
    // would wipe the error message that explains why a switch did not happen.
    if (currentFilePath === loadedPath) return

    let cancelled = false
    const previousPath = loadedPath
    const attemptedName = fileNameOf(currentFilePath)
    setSaveFailed(false)
    setLoadError(null)

    // A failed switch must never leave the app lying about what it is editing:
    // the canvas still holds the previous file, so `currentFilePath` goes back
    // to it too (or to null if nothing was open), and autosave stays disarmed
    // for the path that failed. `message` is null when the reason is already
    // being shown elsewhere — the repair dialog says its own piece.
    function failSwitch(message: string | null) {
      setLoadError(message)
      setCurrentFile(previousPath)
    }

    Promise.all([loadMindMap(currentFilePath), loadMindMapMeta(currentFilePath)])
      .then(([result, meta]) => {
        if (cancelled) return
        if (result === null) {
          // With file switching, `null` no longer means "first run, nothing on
          // disk yet" — every mind map is created on disk before it can be
          // clicked. It means the file vanished since the last scan (there is
          // no live file-watching). Adopting the previous file's cards into
          // this path and arming autosave would silently recreate a file the
          // user deleted, with the wrong content.
          failSwitch(`Impossible d’ouvrir ${attemptedName} : ce fichier n’existe plus.`)
          return
        }
        // The guard rail: a structurally broken map is never handed to the
        // canvas. Rendering one throws mid-render (no position for a card
        // caught in a parent cycle, no palette for a level past 4), React tears
        // the tree down, and the map the user just clicked disappears a frame
        // after appearing. Blocked here, it becomes a question instead.
        const report = validateCards(result)
        if (!report.valid) {
          setRepairError(null)
          setPendingRepair({ path: currentFilePath, fileName: attemptedName, cards: result, issues: report.issues })
          failSwitch(null)
          return
        }
        loadCards(result)
        setLoadedMeta(meta)
        setLoadedPath(currentFilePath)
      })
      .catch(err => {
        if (cancelled) return
        console.error(
          'Échec du chargement de la carte mentale (le fichier existe mais est illisible ou corrompu) — autosave désactivée pour ne pas l’écraser :',
          err
        )
        failSwitch(`Impossible d’ouvrir ${attemptedName} : fichier illisible ou corrompu.`)
      })
    return () => {
      cancelled = true
    }
  }, [currentFilePath, loadedPath, loadCards, setCurrentFile])

  /**
   * "Créer une copie réparée": repair a DUPLICATE of the raw data, save it
   * beside the original under a free « (Réparée) » name, and open it — through
   * the normal load path, so the copy is validated like any other file before
   * it reaches the canvas. The broken original is never written to.
   */
  const handleRepair = useCallback(async () => {
    if (!pendingRepair) return
    setRepairing(true)
    setRepairError(null)
    try {
      const repaired = repairCards(structuredClone(pendingRepair.cards))
      const targetPath = await freeRepairedPath(pendingRepair.path)
      await saveMindMap(targetPath, repaired)
      // So the copy shows up in the tree next to the file it came from. A bare
      // filename has no folder to re-scan (nothing the sidebar could be showing
      // it in), and asking to scan '' would only raise a workspace error.
      const folder = parentDirOf(pendingRepair.path)
      if (folder) await refreshFolder(folder)
      setPendingRepair(null)
      setCurrentFile(targetPath)
    } catch (error) {
      // Kept open on failure: closing would drop the only offer of a fix.
      setRepairError(`La réparation a échoué : ${describeError(error)}`)
    } finally {
      setRepairing(false)
    }
  }, [pendingRepair, refreshFolder, setCurrentFile])

  const currentFileName = currentFilePath ? fileNameOf(currentFilePath) : null
  const isReadOnly = loadedMeta !== null && loadedMeta.author !== currentUser?.username

  /**
   * Publishes "this map is someone else's" to the store every editing
   * affordance already consults.
   *
   * The canvas overlay only blocks the POINTER. The header's buttons sit above
   * it, and a keyboard shortcut never touches it at all — so without this, a
   * `Suppr` or a `Ctrl+V` would happily edit a file the user was just told is
   * read-only, and autosave would write the result to disk.
   */
  useEffect(() => {
    useCardsStore.getState().setReadOnly(isReadOnly)
  }, [isReadOnly])


  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/*
        The file tree is gone for the duration of a quiz. Leaving it there let
        the user switch mind maps mid-quiz — which silently answers nothing,
        loses the round, and is never what clicking a file during a quiz was
        meant to do. "Terminer le quiz", in the frame's header, is the way back
        to the editor and to the rest of the workspace.
      */}
      {!quizActive && <FileSidebar onOpenFile={requestOpenFile} />}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <header style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          {/*
            The whole toolbar is gone for the duration of a quiz, like the file
            tree beside it: every action on it edits the map, and no card may
            change under a quiz in progress. The commands it registers go with
            it, so their shortcuts stop firing too.

            The cards handed to it are the ones in memory, not the file on disk:
            those are what the user is looking at, and they are already
            validated (nothing reaches the canvas otherwise).
          */}
          {!quizActive && (
            <AppToolbar
              filePath={loadedPath}
              cards={cards}
              meta={loadedMeta}
              onOpenFile={requestOpenFile}
              onRequestFork={() => setForkPromptOpen(true)}
              flush={flush}
              updateCheck={{ status: updateStatus, checkNow: checkForUpdates }}
            />
          )}
          <span
            title={currentFilePath ?? undefined}
            style={{
              fontSize: 13,
              fontWeight: 500,
              // The name yields before the toolbar does. Without `minWidth: 0`
              // its floor is the whole string, which pushes the header past the
              // window edge and turns into a horizontal scrollbar instead of an
              // ellipsis; with it, the name absorbs the squeeze and ends in "…".
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {currentFileName ?? 'Aucun fichier ouvert'}
          </span>
          {saveFailed && (
            <span role="status" style={{ color: 'var(--warning-fg)', fontSize: 13 }}>
              ⚠ Erreur de sauvegarde
            </span>
          )}
        </header>
        {loadError && (
          <div role="alert" className="status-banner">
            <span style={{ flex: 1 }}>⚠ {loadError}</span>
            <button
              type="button"
              aria-label="Masquer le message d’erreur"
              onClick={() => setLoadError(null)}
              style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 15 }}
            >
              ×
            </button>
          </div>
        )}
        {dropError && (
          <div role="alert" className="status-banner">
            <span style={{ flex: 1 }}>⚠ {dropError}</span>
          </div>
        )}
        {!loadError && !dropError && updateReady && !dismissed && (
          <UpdateReadyBanner onApply={applyUpdate} onDismiss={dismissUpdate} />
        )}
        <main ref={mainRef} style={{ flex: 1, position: 'relative' }}>
          {isDragActive && (
            <div
              style={{
                position: 'absolute',
                inset: 8,
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px dashed var(--primary)',
                borderRadius: 8,
                background: 'color-mix(in oklch, var(--primary), transparent 90%)',
                color: 'var(--primary)',
                fontSize: 16,
                fontWeight: 500,
                pointerEvents: 'none',
              }}
            >
              Déposez la carte mentale ici pour l’ouvrir
            </div>
          )}
          {loadedPath ? (
            // Keyed by the loaded file: switching maps REMOUNTS the canvas
            // instead of feeding a new card set to the previous one. React Flow
            // seeds its node array and runs `fitView` once, on mount — reusing
            // the instance left the viewport framing the file that was open
            // before (often nowhere near the new cards), which is what made a
            // map look like it opened and then vanished.
            <QuizFrame>
              <CanvasErrorBoundary key={loadedPath} onClose={() => setCurrentFile(null)}>
                <MindMapCanvas />
              </CanvasErrorBoundary>
            </QuizFrame>
          ) : currentFilePath ? (
            <div style={{ padding: 24, color: 'var(--muted-foreground)' }}>
              Ouverture de {currentFileName}…
            </div>
          ) : (
            <div style={{ padding: 24, color: 'var(--muted-foreground)' }}>
              Aucun fichier ouvert. Sélectionnez ou créez une carte mentale dans la barre latérale.
            </div>
          )}
          {forkPromptOpen && isReadOnly && loadedPath && loadedMeta && (
            <ReadOnlyMapDialog
              author={loadedMeta.author}
              onContinue={() => setForkPromptOpen(false)}
              onDuplicate={
                currentUser === null
                  ? null
                  : async () => {
                      const newPath = await duplicateMap(loadedPath, currentUser.username, currentUser.role)
                      await refreshFolder(parentDirOf(loadedPath))
                      setForkPromptOpen(false)
                      setCurrentFile(newPath)
                    }
              }
            />
          )}
          <QuizSummaryModal />
        </main>
      </div>

      {/* Outside the canvas column, so it spans the full height and takes its
          width out of the canvas rather than covering it — nothing is hidden,
          and the tree stays readable beside the fiche it explains.
          Hidden outright during a quiz, per the effect above. */}
      {!quizActive && <CardDetailPanel />}

      {pendingRepair && (
        <CorruptedMapDialog
          fileName={pendingRepair.fileName}
          repairedFileName={fileNameOf(repairedCopyPath(pendingRepair.path))}
          issues={pendingRepair.issues}
          repairing={repairing}
          error={repairError}
          onCancel={() => setPendingRepair(null)}
          onRepair={handleRepair}
        />
      )}

      {prompt && (
        <SaveFailedDialog
          message={prompt.message}
          detail={prompt.detail}
          continueLabel={prompt.continueLabel}
          onCancel={dismissPrompt}
          onContinue={prompt.onContinue}
        />
      )}
    </div>
  )
}

export default App
