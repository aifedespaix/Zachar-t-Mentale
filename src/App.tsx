// src/App.tsx
import { useEffect, useRef, useState } from 'react'
import { MindMapCanvas } from './components/MindMapCanvas'
import { LockToggle } from './components/LockToggle'
import { FileSidebar } from './components/sidebar/FileSidebar'
import { QuizButton } from './components/quiz/QuizButton'
import { QuizHud } from './components/quiz/QuizHud'
import { QuizSummaryModal } from './components/quiz/QuizSummaryModal'
import { useCardsStore } from './state/useCardsStore'
import { useWorkspaceStore } from './state/useWorkspaceStore'
import { useQuizStore } from './state/useQuizStore'
import { useAutosave } from './persistence/useAutosave'
import { loadMindMap } from './persistence/fileStore'
import { useUndoRedoShortcuts } from './hooks/useUndoRedoShortcuts'

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function App() {
  const cards = useCardsStore(s => s.history.present)
  const loadCards = useCardsStore(s => s.loadCards)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const setCurrentFile = useWorkspaceStore(s => s.setCurrentFile)
  const quizActive = useQuizStore(s => s.active)
  const [loaded, setLoaded] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The path whose cards are actually in the canvas right now. `currentFilePath`
  // is only an INTENT until the load succeeds; this is the fact. It is what a
  // failed switch reverts to, so the header name and the tree highlight keep
  // agreeing with what is on screen.
  const loadedPathRef = useRef<string | null>(null)
  useUndoRedoShortcuts()
  useAutosave(currentFilePath ?? '', cards, 500, loaded && currentFilePath !== null, () => setSaveFailed(true))

  // Re-runs on every file switch (open a different file, or a rename that
  // moves the current file to a new path): each switch starts a fresh
  // load -> enable-autosave cycle, exactly like the original mount-only
  // effect did for the one hardcoded demo file.
  useEffect(() => {
    if (!currentFilePath) {
      loadedPathRef.current = null
      setLoaded(false)
      return
    }
    // Already the file on screen — this run is the revert below landing, not a
    // new switch. Re-loading would be pointless and would wipe the error
    // message that explains why the switch did not happen.
    if (currentFilePath === loadedPathRef.current) {
      setLoaded(true)
      return
    }

    let cancelled = false
    const previousPath = loadedPathRef.current
    const attemptedName = fileNameOf(currentFilePath)
    setLoaded(false)
    setSaveFailed(false)
    setLoadError(null)

    // A failed switch must never leave the app lying about what it is editing:
    // the canvas still holds the previous file, so `currentFilePath` goes back
    // to it too (or to null if nothing was open), and autosave stays disarmed
    // for the path that failed.
    function failSwitch(message: string) {
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
        loadCards(result)
        loadedPathRef.current = currentFilePath
        setLoaded(true)
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
  }, [currentFilePath, loadCards, setCurrentFile])

  const currentFileName = currentFilePath ? fileNameOf(currentFilePath) : null

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <FileSidebar onOpenFile={setCurrentFile} />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <header style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          {!quizActive && <LockToggle />}
          {!quizActive && <QuizButton />}
          <span title={currentFilePath ?? undefined} style={{ fontSize: 13, fontWeight: 500 }}>
            {currentFileName ?? 'Aucun fichier ouvert'}
          </span>
          {saveFailed && (
            <span role="status" style={{ color: '#b45309', fontSize: 13 }}>
              ⚠ Erreur de sauvegarde
            </span>
          )}
        </header>
        {loadError && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              margin: '0 8px 8px',
              padding: '6px 8px',
              border: '1px solid #f59e0b',
              borderRadius: 4,
              background: '#fef3c7',
              color: '#92400e',
              fontSize: 13,
            }}
          >
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
        <main style={{ flex: 1 }}>
          {currentFilePath ? (
            <MindMapCanvas />
          ) : (
            <div style={{ padding: 24, color: 'var(--muted-foreground)' }}>
              Aucun fichier ouvert. Sélectionnez ou créez une carte mentale dans la barre latérale.
            </div>
          )}
          <QuizHud />
          <QuizSummaryModal />
        </main>
      </div>
    </div>
  )
}

export default App
