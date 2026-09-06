import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'

interface QcmDialogProps {
  open: boolean
  title: string
  correctDefinition: string
  distractors: string[]
  onAnswer: (chosenDefinition: string) => void
  random?: () => number
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function QcmDialog({
  open,
  title,
  correctDefinition,
  distractors,
  onAnswer,
  random = Math.random,
}: QcmDialogProps) {
  const [options] = useState(() => shuffle([correctDefinition, ...distractors], random))
  const [chosen, setChosen] = useState<string | null>(null)

  function handleChoose(option: string) {
    if (chosen) return
    setChosen(option)
    setTimeout(() => onAnswer(option), 700)
  }

  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map(option => {
            const isCorrectOption = option === correctDefinition
            const revealCorrect = chosen !== null && isCorrectOption
            const revealWrong = chosen === option && !isCorrectOption
            return (
              <button
                key={option}
                type="button"
                disabled={chosen !== null}
                onClick={() => handleChoose(option)}
                style={{
                  position: 'relative',
                  textAlign: 'left',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 6,
                  border: `2px solid ${revealCorrect ? '#16a34a' : revealWrong ? '#dc2626' : 'var(--border)'}`,
                  background: 'var(--background)',
                  cursor: chosen === null ? 'pointer' : 'default',
                }}
              >
                {option}
                {revealCorrect && (
                  <Check color="#16a34a" size={16} style={{ position: 'absolute', top: -8, right: -8 }} />
                )}
                {revealWrong && <X color="#dc2626" size={16} style={{ position: 'absolute', top: -8, left: -8 }} />}
              </button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
