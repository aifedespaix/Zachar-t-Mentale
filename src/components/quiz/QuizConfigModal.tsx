// src/components/quiz/QuizConfigModal.tsx
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Sprout, Zap, Flame, Check, type LucideIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { Hint } from '../ui/hint'
import { TooltipProvider } from '../ui/tooltip'
import { useQuizStore } from '../../state/useQuizStore'
import { useCardsStore } from '../../state/useCardsStore'
import { useAppearanceSettingsStore } from '../../state/useAppearanceSettingsStore'
import { useQuizSettingsStore } from '../../state/useQuizSettingsStore'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'
import { toCss, pickReadableTextColor } from '../../colors/contrast'
import { presentLevels } from '../../quiz/levels'
import { ALL_CARD_LEVELS, type CardLevel } from '../../types/card'
import type { QuizDifficulty } from '../../types/quiz'

interface DifficultyOption {
  value: QuizDifficulty
  label: string
  icon: LucideIcon
  hidePercent: number
  color: string
  /** What this level actually changes about a written answer. */
  help: string
}

const DIFFICULTIES: DifficultyOption[] = [
  { value: 'facile', label: 'Facile', icon: Sprout, hidePercent: 20, color: '#16a34a', help: 'La moitié des lettres offertes' },
  { value: 'moyen', label: 'Moyen', icon: Zap, hidePercent: 50, color: '#d97706', help: 'Un quart des lettres offertes' },
  { value: 'difficile', label: 'Difficile', icon: Flame, hidePercent: 75, color: '#dc2626', help: 'La première lettre seulement' },
]

const ABSENT_LEVEL_HINT = 'Aucune carte à ce niveau dans la carte mentale'

interface QuizConfigModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function QuizConfigModal({ open, onOpenChange }: QuizConfigModalProps) {
  const startQuiz = useQuizStore(s => s.startQuiz)
  const theme = useResolvedTheme()
  const levelAppearance = useAppearanceSettingsStore(s => s.levels)
  const lastQuizConfig = useQuizSettingsStore(s => s.lastQuizConfig)
  const setLastQuizConfig = useQuizSettingsStore(s => s.setLastQuizConfig)
  // The levels the map actually holds — a level with no card cannot be asked
  // about, so its box is greyed out and refuses to be ticked. Shallow-compared
  // so an edit that does not add or remove a level (typing a title) does not
  // re-render the toolbar's always-mounted modal.
  const present = useCardsStore(useShallow(s => presentLevels(s.history.present)))

  // enabledLevels is the MANUAL selection, not the effective one: it keeps
  // levels that are absent right now, so greying a level out never erases the
  // choice the user made while it still had cards.
  const [enabledLevels, setEnabledLevels] = useState<CardLevel[]>(lastQuizConfig.levels)
  const [difficulty, setDifficulty] = useState<QuizDifficulty>(lastQuizConfig.difficulty)
  const [qcmMode, setQcmMode] = useState(lastQuizConfig.qcmMode)

  // Re-seed on every open: the toolbar mounts this modal once, so state left
  // from the previous launch would otherwise survive a close and a reopen.
  useEffect(() => {
    if (!open) return
    setEnabledLevels(lastQuizConfig.levels)
    setDifficulty(lastQuizConfig.difficulty)
    setQcmMode(lastQuizConfig.qcmMode)
  }, [open, lastQuizConfig])

  const includedLevels = useMemo(
    () => enabledLevels.filter(level => present.includes(level)),
    [enabledLevels, present]
  )

  function toggleLevel(level: CardLevel) {
    if (!present.includes(level)) return
    setEnabledLevels(current =>
      current.includes(level) ? current.filter(l => l !== level) : [...current, level].sort((a, b) => a - b)
    )
  }

  function handleLaunch() {
    // Remember the MANUAL selection even for levels that are absent right now;
    // the quiz itself only ever draws from the levels that are present.
    void setLastQuizConfig({
      levels: [...enabledLevels].sort((a, b) => a - b),
      difficulty,
      qcmMode,
    })
    startQuiz({ levels: includedLevels, difficulty, qcmMode })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* One provider for the whole modal: a provider per level tile would give
            each one its own skip-delay state, which is what makes a row of
            instant tooltips flicker as the pointer crosses it. */}
        <TooltipProvider>
        <DialogHeader>
          <DialogTitle>Configurer le quiz</DialogTitle>
        </DialogHeader>

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
            Niveaux inclus
          </legend>
          <div style={{ display: 'flex', gap: 8 }}>
            {ALL_CARD_LEVELS.map(level => {
              const available = present.includes(level)
              const checked = available && enabledLevels.includes(level)
              const bg = toCss(levelAppearance[level].color[theme].border)
              const text = toCss(pickReadableTextColor(levelAppearance[level].color[theme].border))
              const tile = (
                <label
                  style={{
                    flex: 1,
                    aspectRatio: '1 / 1',
                    borderRadius: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: available ? 'pointer' : 'not-allowed',
                    opacity: available ? 1 : 0.4,
                    background: checked ? bg : 'var(--muted)',
                    color: checked ? text : 'var(--muted-foreground)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!available}
                    onChange={() => toggleLevel(level)}
                    aria-label={levelAppearance[level].label}
                    style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
                  />
                  {levelAppearance[level].label}
                </label>
              )
              // The checkbox is disabled when the level is absent, and a disabled
              // control shows no tooltip: the hint rides the non-disabled label
              // that wraps it, while `aria-label` keeps doing the naming.
              return available ? (
                <Fragment key={level}>{tile}</Fragment>
              ) : (
                <Hint key={level} label={ABSENT_LEVEL_HINT}>
                  {tile}
                </Hint>
              )
            })}
          </div>
        </fieldset>

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
            Difficulté
          </legend>
          {/*
            The old selector said "selected" with a 3px border against a 2px
            one — a difference nobody could see, so nobody could tell which
            difficulty was active. Now the choice is filled with its own colour
            and check-marked, and the two it is not are visibly stood down:
            drained of colour, dimmed, and flat. Which one is on is now the
            first thing you see, not something you measure.
          */}
          <div role="radiogroup" aria-label="Difficulté" style={{ display: 'flex', gap: 8 }}>
            {DIFFICULTIES.map(({ value, label, icon: Icon, hidePercent, color, help }) => {
              const selected = difficulty === value
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-label={label}
                  aria-checked={selected}
                  onClick={() => setDifficulty(value)}
                  style={{
                    flex: 1,
                    position: 'relative',
                    borderRadius: 12,
                    padding: '14px 8px 12px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    border: `2px solid ${selected ? color : 'var(--border)'}`,
                    background: selected ? `color-mix(in oklch, ${color}, transparent 88%)` : 'var(--muted)',
                    color: selected ? 'inherit' : 'var(--muted-foreground)',
                    opacity: selected ? 1 : 0.6,
                    filter: selected ? 'none' : 'grayscale(1)',
                    boxShadow: selected ? `0 0 0 3px color-mix(in oklch, ${color}, transparent 85%)` : 'none',
                    transition: 'opacity 0.15s ease, border-color 0.15s ease, background 0.15s ease',
                  }}
                >
                  {selected && (
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        top: -8,
                        right: -8,
                        width: 20,
                        height: 20,
                        borderRadius: '9999px',
                        background: color,
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Check size={13} strokeWidth={3} />
                    </span>
                  )}
                  <Icon style={{ color: selected ? color : 'inherit', width: 24, height: 24, margin: '0 auto 4px', display: 'block' }} />
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>
                  <div style={{ fontSize: 10.5, opacity: 0.8, marginTop: 2 }}>Cache {hidePercent}% des cartes</div>
                  <div style={{ fontSize: 10.5, opacity: 0.8 }}>{help}</div>
                </button>
              )
            })}
          </div>
        </fieldset>

        <button
          type="button"
          role="switch"
          aria-checked={qcmMode}
          aria-label="Mode QCM"
          onClick={() => setQcmMode(v => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 14,
            borderRadius: 12,
            border: `2px solid ${toCss(levelAppearance[3].color[theme].border)}`,
            background: qcmMode ? toCss(levelAppearance[3].color[theme].bg) : 'var(--background)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Mode QCM</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>
              Propose aussi des choix pour deviner les titres (sinon, tu les écris)
            </div>
          </div>
          <span
            aria-hidden
            style={{
              width: 36,
              height: 21,
              borderRadius: 11,
              flexShrink: 0,
              position: 'relative',
              background: qcmMode ? toCss(levelAppearance[3].color[theme].border) : 'var(--input)',
              transition: 'background 0.15s ease',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 2,
                left: qcmMode ? 17 : 2,
                width: 17,
                height: 17,
                borderRadius: '50%',
                background: 'var(--background)',
                transition: 'left 0.15s ease',
              }}
            />
          </span>
        </button>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button disabled={includedLevels.length === 0} onClick={handleLaunch}>
            Lancer le quiz
          </Button>
        </DialogFooter>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  )
}
