import { useEffect, useState } from 'react'
import { MindMapCanvas } from './components/MindMapCanvas'
import { LockToggle } from './components/LockToggle'
import { QuizButton } from './components/quiz/QuizButton'
import { QuizHud } from './components/quiz/QuizHud'
import { QuizSummaryModal } from './components/quiz/QuizSummaryModal'
import { useCardsStore } from './state/useCardsStore'
import { useQuizStore } from './state/useQuizStore'
import { useAutosave } from './persistence/useAutosave'
import { loadMindMap } from './persistence/fileStore'
import { useUndoRedoShortcuts } from './hooks/useUndoRedoShortcuts'

const DEMO_FILE_PATH = 'demo-chapitre.mmap.json'

function App() {
  const cards = useCardsStore(s => s.history.present)
  const loadCards = useCardsStore(s => s.loadCards)
  // Autosave stays disarmed until the initial load has proved it is safe to
  // write — otherwise the debounce could overwrite a real chapter with the
  // store's transient default root card (slow load, or a load that failed).
  const [loaded, setLoaded] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const quizActive = useQuizStore(s => s.active)
  useUndoRedoShortcuts()
  useAutosave(DEMO_FILE_PATH, cards, 500, loaded, () => setSaveFailed(true))

  useEffect(() => {
    loadMindMap(DEMO_FILE_PATH)
      .then(result => {
        // `null` = no file yet: keep the store's default root and start saving.
        if (result !== null) loadCards(result)
        setLoaded(true)
      })
      .catch(err => {
        console.error(
          'Échec du chargement de la carte mentale (le fichier existe mais est illisible ou corrompu) — autosave désactivée pour ne pas l’écraser :',
          err
        )
        // `loaded` stays false: autosave stays disabled until this is resolved.
      })
  }, [loadCards])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
        {!quizActive && <LockToggle />}
        {!quizActive && <QuizButton />}
        {saveFailed && (
          <span role="status" style={{ color: '#b45309', fontSize: 13 }}>
            ⚠ Erreur de sauvegarde
          </span>
        )}
      </header>
      <main style={{ flex: 1 }}>
        <MindMapCanvas />
        <QuizHud />
        <QuizSummaryModal />
      </main>
    </div>
  )
}

export default App
