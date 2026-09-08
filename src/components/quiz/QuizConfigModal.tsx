// src/components/quiz/QuizConfigModal.tsx
import { useState } from 'react'
import { Sprout, Zap, Flame, type LucideIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { useQuizStore } from '../../state/useQuizStore'
import { levelColor } from '../../colors/levelColors'
import { toCss, pickReadableTextColor } from '../../colors/contrast'
import type { CardLevel } from '../../types/card'
import type { QuizDifficulty } from '../../types/quiz'

const ALL_LEVELS: CardLevel[] = [1, 2, 3, 4]
const LEVEL_LABELS: Record<CardLevel, string> = {
  1: 'Titre',
  2: 'Sous-titre',
  3: 'Sous-partie',
  4: 'Info',
}

interface DifficultyOption {
  value: QuizDifficulty
  label: string
  icon: LucideIcon
  hidePercent: number
  color: string
}

const DIFFICULTIES: DifficultyOption[] = [
  { value: 'facile', label: 'Facile', icon: Sprout, hidePercent: 20, color: '#16a34a' },
  { value: 'moyen', label: 'Moyen', icon: Zap, hidePercent: 50, color: '#d97706' },
  { value: 'difficile', label: 'Difficile', icon: Flame, hidePercent: 75, color: '#dc2626' },
]

interface QuizConfigModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function QuizConfigModal({ open, onOpenChange }: QuizConfigModalProps) {
  const startQuiz = useQuizStore(s => s.startQuiz)
  const [levels, setLevels] = useState<CardLevel[]>(ALL_LEVELS)
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('moyen')
  const [qcmMode, setQcmMode] = useState(false)

  function toggleLevel(level: CardLevel) {
    setLevels(current => (current.includes(level) ? current.filter(l => l !== level) : [...current, level].sort()))
  }

  function handleLaunch() {
    startQuiz({ levels, difficulty, qcmMode })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configurer le quiz</DialogTitle>
        </DialogHeader>

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
            Niveaux inclus
          </legend>
          <div style={{ display: 'flex', gap: 8 }}>
            {ALL_LEVELS.map(level => {
              const checked = levels.includes(level)
              const bg = toCss(levelColor(level, 'light').border)
              const text = toCss(pickReadableTextColor(levelColor(level, 'light').border))
              return (
                <label
                  key={level}
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
                    cursor: 'pointer',
                    background: checked ? bg : '#eee',
                    color: checked ? text : '#aaa',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLevel(level)}
                    aria-label={LEVEL_LABELS[level]}
                    style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
                  />
                  {LEVEL_LABELS[level]}
                </label>
              )
            })}
          </div>
        </fieldset>

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
            Difficulté
          </legend>
          <div style={{ display: 'flex', gap: 8 }}>
            {DIFFICULTIES.map(({ value, label, icon: Icon, hidePercent, color }) => (
              <button
                key={value}
                type="button"
                aria-label={label}
                aria-pressed={difficulty === value}
                onClick={() => setDifficulty(value)}
                style={{
                  flex: 1,
                  borderRadius: 12,
                  padding: '12px 8px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  border: `${difficulty === value ? 3 : 2}px solid ${color}`,
                  background: 'var(--background)',
                  color: 'inherit',
                }}
              >
                <Icon style={{ color, width: 24, height: 24, margin: '0 auto 4px', display: 'block' }} />
                <div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>
                <div style={{ fontSize: 10.5, opacity: 0.75 }}>Cache {hidePercent}% des cartes</div>
              </button>
            ))}
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
            border: `2px solid ${toCss(levelColor(3, 'light').border)}`,
            background: qcmMode ? toCss(levelColor(3, 'light').bg) : 'var(--background)',
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
              background: qcmMode ? toCss(levelColor(3, 'light').border) : '#ccc',
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
                background: '#fff',
                transition: 'left 0.15s ease',
              }}
            />
          </span>
        </button>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button disabled={levels.length === 0} onClick={handleLaunch}>
            Lancer le quiz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
