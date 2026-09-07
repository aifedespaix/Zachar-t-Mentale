// src/App.tsx
import { useEffect, useState } from 'react'
import { MindMapCanvas } from './components/MindMapCanvas'
import { LockToggle } from './components/LockToggle'
import { FileSidebar } from './components/sidebar/FileSidebar'
import { useCardsStore } from './state/useCardsStore'
import { useWorkspaceStore } from './state/useWorkspaceStore'
import { useAutosave } from './persistence/useAutosave'
import { loadMindMap } from './persistence/fileStore'
import { useUndoRedoShortcuts } from './hooks/useUndoRedoShortcuts'

function App() {
  const cards = useCardsStore(s => s.history.present)
  const loadCards = useCardsStore(s => s.loadCards)
  const currentFilePath = useWorkspaceStore(s => s.currentFilePath)
  const setCurrentFile = useWorkspaceStore(s => s.setCurrentFile)
  const [loaded, setLoaded] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  useUndoRedoShortcuts()
  useAutosave(currentFilePath ?? '', cards, 500, loaded && currentFilePath !== null, () => setSaveFailed(true))

  // Re-runs on every file switch (open a different file, or a rename that
  // moves the current file to a new path): each switch starts a fresh
  // load -> enable-autosave cycle, exactly like the original mount-only
  // effect did for the one hardcoded demo file.
  useEffect(() => {
    if (!currentFilePath) {
      setLoaded(false)
      return
    }
    setLoaded(false)
    setSaveFailed(false)
    loadMindMap(currentFilePath)
      .then(result => {
        if (result !== null) loadCards(result)
        setLoaded(true)
      })
      .catch(err => {
        console.error(
          'Échec du chargement de la carte mentale (le fichier existe mais est illisible ou corrompu) — autosave désactivée pour ne pas l’écraser :',
          err
        )
      })
  }, [currentFilePath, loadCards])

  const currentFileName = currentFilePath ? currentFilePath.split(/[\\/]/).pop() : null

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <FileSidebar onOpenFile={setCurrentFile} />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <header style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <LockToggle />
          <span title={currentFilePath ?? undefined} style={{ fontSize: 13, fontWeight: 500 }}>
            {currentFileName ?? 'Aucun fichier ouvert'}
          </span>
          {saveFailed && (
            <span role="status" style={{ color: '#b45309', fontSize: 13 }}>
              ⚠ Erreur de sauvegarde
            </span>
          )}
        </header>
        <main style={{ flex: 1 }}>
          {currentFilePath ? (
            <MindMapCanvas />
          ) : (
            <div style={{ padding: 24, color: 'var(--muted-foreground)' }}>
              Aucun fichier ouvert. Sélectionnez ou créez une carte mentale dans la barre latérale.
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
