import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { useQuizStore } from '../../state/useQuizStore'
import type { CardLevel } from '../../types/card'
import type { QuizDifficulty } from '../../types/quiz'

const ALL_LEVELS: CardLevel[] = [1, 2, 3, 4]
const LEVEL_LABELS: Record<CardLevel, string> = {
  1: 'Rouge (Titre)',
  2: 'Orange (Sous-titre)',
  3: 'Bleu (Sous-partie)',
  4: 'Jaune (Info)',
}
const DIFFICULTIES: { value: QuizDifficulty; label: string }[] = [
  { value: 'facile', label: 'Facile' },
  { value: 'moyen', label: 'Moyen' },
  { value: 'difficile', label: 'Difficile' },
]

interface QuizConfigModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function QuizConfigModal({ open, onOpenChange }: QuizConfigModalProps) {
  const startQuiz = useQuizStore(s => s.startQuiz)
  const [levels, setLevels] = useState<CardLevel[]>(ALL_LEVELS)
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('moyen')

  function toggleLevel(level: CardLevel) {
    setLevels(current => (current.includes(level) ? current.filter(l => l !== level) : [...current, level].sort()))
  }

  function handleLaunch() {
    startQuiz({ levels, difficulty })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configurer le quiz</DialogTitle>
        </DialogHeader>
        <fieldset style={{ display: 'flex', flexDirection: 'column', gap: 8, border: 'none', padding: 0 }}>
          <legend>Niveaux</legend>
          {ALL_LEVELS.map(level => (
            <label key={level} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={levels.includes(level)} onChange={() => toggleLevel(level)} />
              {LEVEL_LABELS[level]}
            </label>
          ))}
        </fieldset>
        <fieldset style={{ display: 'flex', gap: 8, border: 'none', padding: 0 }}>
          <legend>Difficulté</legend>
          {DIFFICULTIES.map(({ value, label }) => (
            <Button
              key={value}
              type="button"
              variant={difficulty === value ? 'default' : 'outline'}
              onClick={() => setDifficulty(value)}
            >
              {label}
            </Button>
          ))}
        </fieldset>
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
