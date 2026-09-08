// src/App.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { MindMapCanvas } from './components/MindMapCanvas'
import { CanvasErrorBoundary } from './components/CanvasErrorBoundary'
import { CorruptedMapDialog } from './components/CorruptedMapDialog'
import { SaveFailedDialog } from './components/SaveFailedDialog'
import { LockToggle } from './components/LockToggle'
import { FileSidebar } from './components/sidebar/FileSidebar'
import { QuizButton } from './components/quiz/QuizButton'
import { QuizSettingsButton } from './components/quiz/QuizSettingsButton'
import { QuizHud } from './components/quiz/QuizHud'
import { QuizSummaryModal } from './components/quiz/QuizSummaryModal'
import { useQuizSettingsStore } from './state/useQuizSettingsStore'
import { useCardsStore } from './state/useCardsStore'
import { useWorkspaceStore, describeError } from './state/useWorkspaceStore'
import { useQuizStore } from './state/useQuizStore'
import { useAutosave } from './persistence/useAutosave'
import { loadMindMap, saveMindMap, mindMapExists } from './persistence/fileStore'
import { fileNameOf, parentDirOf, repairedCopyPath } from './persistence/paths'
import { repairCards, validateCards, type CardIssue } from './validation/cardsValidation'
import { useUndoRedoShortcuts } from './hooks/useUndoRedoShortcuts'
import { useWindowTitle } from './hooks/useWindowTitle'
import { useUnsavedChangesGuard } from './hooks/useUnsavedChangesGuard'
import { useFileDropZone } from './hooks/useFileDropZone'
import { imageBlockFrom } from './content/imageBlock'
import { mimeForPath } from './content/pickImage'
import { contentOf } from './content/blocks'
import { readFile } from '@tauri-apps/plugin-fs'
import { ThemeToggleButton } from './components/ThemeToggleButton'
import { AppearanceSettingsButton } from './components/appearance/AppearanceSettingsButton'
import { useAppearanceSettingsStore } from './state/useAppearanceSettingsStore'
import { useThemeDomSync } from './hooks/useResolvedTheme'
import { useAppliedFontFamily } from './hooks/useAppliedFontFamily'
import type { Card } from './types/card'

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
 * The first « [Nom] (Réparée).json » that does not exist yet. A repair must
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
  const [repairing, setRepairing] = useState(false)
  const [repairError, setRepairError] = useState<string | null>(null)
  // The path whose cards are actually in the canvas right now. `currentFilePath`
  // is only an INTENT until the load succeeds AND the structure validates; this
  // is the fact. It is what a failed switch reverts to, what the canvas is keyed
  // and gated on, and what autosave writes to — so nothing can ever render, or
  // be written, for a file the app has not fully loaded.
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const mainRef = useRef<HTMLElement | null>(null)
  useUndoRedoShortcuts()
  useWindowTitle(currentFilePath)
  useThemeDomSync()
  useAppliedFontFamily()
  const { flush } = useAutosave(
    loadedPath ?? '',
    cards,
    500,
    loadedPath !== null && loadedPath === currentFilePath,
    () => setSaveFailed(true)
  )
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

  useEffect(() => {
    useQuizSettingsStore.getState().init()
    useAppearanceSettingsStore.getState().init()
  }, [])

  // Re-runs on every file switch (open a different file, or a rename that
  // moves the current file to a new path): each switch starts a fresh
  // load -> validate -> enable-autosave cycle.
  useEffect(() => {
    if (!currentFilePath) {
      setLoadedPath(null)
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

    loadMindMap(currentFilePath)
      .then(result => {
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

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <FileSidebar onOpenFile={requestOpenFile} />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <header style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          {!quizActive && <LockToggle />}
          {!quizActive && <QuizButton />}
          {!quizActive && <QuizSettingsButton />}
          {!quizActive && <AppearanceSettingsButton />}
          {!quizActive && <ThemeToggleButton />}
          <span title={currentFilePath ?? undefined} style={{ fontSize: 13, fontWeight: 500 }}>
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
            <CanvasErrorBoundary key={loadedPath} onClose={() => setCurrentFile(null)}>
              <MindMapCanvas />
            </CanvasErrorBoundary>
          ) : currentFilePath ? (
            <div style={{ padding: 24, color: 'var(--muted-foreground)' }}>
              Ouverture de {currentFileName}…
            </div>
          ) : (
            <div style={{ padding: 24, color: 'var(--muted-foreground)' }}>
              Aucun fichier ouvert. Sélectionnez ou créez une carte mentale dans la barre latérale.
            </div>
          )}
          <QuizHud />
          <QuizSummaryModal />
        </main>
      </div>

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
          continueLabel={prompt.continueLabel}
          onCancel={dismissPrompt}
          onContinue={prompt.onContinue}
        />
      )}
    </div>
  )
}

export default App
