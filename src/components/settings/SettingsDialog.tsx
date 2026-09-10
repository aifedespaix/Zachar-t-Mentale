import { useCallback, useEffect, useRef, useState } from 'react'
import { SlidersHorizontal, Palette, GraduationCap, RefreshCw, type LucideIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { useAppearanceSettingsStore } from '../../state/useAppearanceSettingsStore'
import { useQuizSettingsStore } from '../../state/useQuizSettingsStore'
import type { AppearanceSettings } from '../../types/appearanceSettings'
import type { QuizSettings } from '../../types/quizSettings'
import type { UpdateCheckStatus } from '../../hooks/useAppUpdater'
import { GeneralSettingsPanel } from './GeneralSettingsPanel'
import { AppearanceSettingsPanel } from './AppearanceSettingsPanel'
import { QuizSettingsPanel } from './QuizSettingsPanel'
import { SyncSettingsPanel } from './SyncSettingsPanel'

type SettingsTab = 'general' | 'appearance' | 'quiz' | 'sync'

const TABS: { id: SettingsTab; label: string; icon: LucideIcon; hint: string }[] = [
  { id: 'general', label: 'Général', icon: SlidersHorizontal, hint: 'Thème et police' },
  { id: 'appearance', label: 'Apparence', icon: Palette, hint: 'Couleurs des niveaux' },
  { id: 'quiz', label: 'Quiz', icon: GraduationCap, hint: 'Correction et aides' },
  { id: 'sync', label: 'Synchronisation', icon: RefreshCw, hint: 'Compte et serveur' },
]

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  updateCheck: { status: UpdateCheckStatus; checkNow: () => Promise<void> }
}

/**
 * The single settings window: one button in the header, three tabs inside.
 *
 * Edits are LIVE but not SAVED. Every change goes straight into the stores
 * through `applyDraft`, so the mind map behind the window repaints as you drag
 * a colour slider — you are choosing against the real thing, not a swatch —
 * while nothing reaches disk until "Enregistrer". "Annuler" replays the
 * snapshot taken when the window opened, which puts the app back exactly as it
 * was, preview included.
 */
export function SettingsDialog({ open, onOpenChange, updateCheck }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>('general')
  const [dirty, setDirty] = useState(false)
  // Refs, not state: the snapshot is never rendered, and re-rendering on it
  // would be a re-render per open with nothing to show for it.
  const appearanceSnapshot = useRef<AppearanceSettings | null>(null)
  const quizSnapshot = useRef<QuizSettings | null>(null)

  // One subscription per field, assembled below. Selecting an OBJECT here
  // would build a new one on every store read, and zustand v5 compares
  // snapshots by identity — that is an infinite render loop, not a slow path.
  const levels = useAppearanceSettingsStore(s => s.levels)
  const fontFamily = useAppearanceSettingsStore(s => s.fontFamily)
  const themeMode = useAppearanceSettingsStore(s => s.themeMode)
  const similarityThreshold = useQuizSettingsStore(s => s.similarityThreshold)
  const lengthGuideEnabled = useQuizSettingsStore(s => s.lengthGuideEnabled)
  const liveLetterFeedback = useQuizSettingsStore(s => s.liveLetterFeedback)
  const appearance: AppearanceSettings = { levels, fontFamily, themeMode }
  const quiz: QuizSettings = { similarityThreshold, lengthGuideEnabled, liveLetterFeedback }

  // Re-snapshot on every OPEN, not once on mount: the window is reopened many
  // times per session, and a snapshot from the first open would revert edits
  // saved in between — silently undoing work the user had already committed.
  useEffect(() => {
    if (!open) return
    appearanceSnapshot.current = useAppearanceSettingsStore.getState().snapshot()
    quizSnapshot.current = useQuizSettingsStore.getState().snapshot()
    setDirty(false)
  }, [open])

  function editAppearance(next: AppearanceSettings) {
    useAppearanceSettingsStore.getState().applyDraft(next)
    setDirty(true)
  }

  function editQuiz(next: QuizSettings) {
    useQuizSettingsStore.getState().applyDraft(next)
    setDirty(true)
  }

  const discard = useCallback(() => {
    if (appearanceSnapshot.current) useAppearanceSettingsStore.getState().applyDraft(appearanceSnapshot.current)
    if (quizSnapshot.current) useQuizSettingsStore.getState().applyDraft(quizSnapshot.current)
    setDirty(false)
    onOpenChange(false)
  }, [onOpenChange])

  async function save() {
    await Promise.all([
      useAppearanceSettingsStore.getState().commit(),
      useQuizSettingsStore.getState().commit(),
    ])
    setDirty(false)
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        // Closing by any route other than "Enregistrer" is a cancel, and must
        // undo the live preview — leaving a half-dragged colour applied but
        // unsaved would show one thing now and another after a restart.
        if (!next) discard()
      }}
    >
      <DialogContent
        className="sm:max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] max-h-[85vh] overflow-hidden"
        // A stray click on the backdrop must not throw away a page of colour
        // tweaks. Escape and "Annuler" still discard — both are deliberate.
        onPointerDownOutside={event => {
          if (dirty) event.preventDefault()
        }}
        onInteractOutside={event => {
          if (dirty) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>Paramètres</DialogTitle>
          <DialogDescription>
            Les changements s'affichent tout de suite. Ils ne sont conservés qu'après « Enregistrer ».
          </DialogDescription>
        </DialogHeader>

        <div style={{ display: 'flex', gap: 20, minHeight: 0 }}>
          <nav
            role="tablist"
            aria-label="Sections des paramètres"
            aria-orientation="vertical"
            style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 176, flexShrink: 0 }}
          >
            {TABS.map(({ id, label, icon: Icon, hint }) => {
              const selected = tab === id
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`settings-tab-${id}`}
                  aria-selected={selected}
                  aria-controls={`settings-panel-${id}`}
                  onClick={() => setTab(id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    textAlign: 'left',
                    padding: '9px 11px',
                    borderRadius: 10,
                    border: '1px solid transparent',
                    background: selected ? 'var(--muted)' : 'transparent',
                    borderColor: selected ? 'var(--border)' : 'transparent',
                    color: selected ? 'inherit' : 'var(--muted-foreground)',
                    fontWeight: selected ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'background 0.12s ease, color 0.12s ease',
                  }}
                >
                  <Icon size={16} aria-hidden style={{ flexShrink: 0 }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13 }}>{label}</span>
                    <span style={{ display: 'block', fontSize: 10.5, opacity: 0.7, fontWeight: 500 }}>{hint}</span>
                  </span>
                </button>
              )
            })}
          </nav>

          <div
            role="tabpanel"
            id={`settings-panel-${tab}`}
            aria-labelledby={`settings-tab-${tab}`}
            tabIndex={0}
            style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingRight: 6 }}
          >
            {tab === 'general' && (
              <GeneralSettingsPanel settings={appearance} onChange={editAppearance} updateCheck={updateCheck} />
            )}
            {tab === 'appearance' && <AppearanceSettingsPanel settings={appearance} onChange={editAppearance} />}
            {tab === 'quiz' && <QuizSettingsPanel settings={quiz} onChange={editQuiz} />}
            {tab === 'sync' && <SyncSettingsPanel />}
          </div>
        </div>

        <DialogFooter className="sm:items-center sm:justify-between">
          <span
            role="status"
            style={{ fontSize: 12, color: 'var(--muted-foreground)', textAlign: 'left' }}
          >
            {dirty ? 'Modifications non enregistrées' : 'Tout est enregistré'}
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" onClick={discard}>
              Annuler
            </Button>
            <Button onClick={save} disabled={!dirty}>
              Enregistrer
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
