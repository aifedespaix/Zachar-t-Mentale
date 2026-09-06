import { useEffect } from 'react'
import { MindMapCanvas } from './components/MindMapCanvas'
import { LockToggle } from './components/LockToggle'
import { useCardsStore } from './state/useCardsStore'
import { useAutosave } from './persistence/useAutosave'
import { loadMindMap } from './persistence/fileStore'
import { useUndoRedoShortcuts } from './hooks/useUndoRedoShortcuts'

const DEMO_FILE_PATH = 'demo-chapitre.mmap.json'

function App() {
  const cards = useCardsStore(s => s.history.present)
  const loadCards = useCardsStore(s => s.loadCards)
  useUndoRedoShortcuts()
  useAutosave(DEMO_FILE_PATH, cards)

  useEffect(() => {
    loadMindMap(DEMO_FILE_PATH)
      .then(loadCards)
      .catch(() => {
        // No existing file yet — keep the default single-root card from the store.
      })
  }, [loadCards])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ padding: 8 }}>
        <LockToggle />
      </header>
      <main style={{ flex: 1 }}>
        <MindMapCanvas />
      </main>
    </div>
  )
}

export default App
