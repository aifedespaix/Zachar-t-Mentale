import type { ReactNode } from 'react'
import { useState } from 'react'
import { Check, X, Lightbulb, Network } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'

interface QcmDialogProps {
  open: boolean
  heading: string
  hint?: string
  noHintNote?: string
  correctOption: string
  distractors: string[]
  /**
   * How an option is displayed, when the plain string is a degraded view of it.
   *
   * The option string stays the IDENTITY — it is what dedupes the pool and what
   * grading compares — while this only changes presentation. That split is
   * deliberate: a `qcm-definition` option is a card's plain-text mirror, so two
   * cards whose formulas project alike must still collide as one option, but a
   * maths question should show a stacked fraction rather than `20/100`.
   */
  renderOption?: (option: string) => ReactNode
  onAnswer: (chosen: string) => void
  onCancel: () => void
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

const LETTERS = ['A', 'B', 'C', 'D']

export function QcmDialog({
  open,
  heading,
  hint,
  noHintNote,
  correctOption,
  distractors,
  renderOption,
  onAnswer,
  onCancel,
  random = Math.random,
}: QcmDialogProps) {
  const [options] = useState(() => shuffle([correctOption, ...distractors], random))
  const [chosen, setChosen] = useState<string | null>(null)

  function handleChoose(option: string) {
    if (chosen) return
    setChosen(option)
    setTimeout(() => onAnswer(option), 700)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        // Radix routes both Escape and outside-click through onOpenChange.
        // Only treat it as a dismissal (not a call) when no answer has been
        // chosen yet — once answered, the dialog also closes itself via the
        // timeout above, and that path must not also fire onCancel.
        if (!next && chosen === null) onCancel()
      }}
    >
      <DialogContent showCloseButton={false} style={{ maxWidth: 480, overflow: 'hidden' }}>
        <div
          style={{
            height: 5,
            margin: '-1rem -1rem 0',
            background:
              'linear-gradient(90deg, oklch(0.55 0.18 25), oklch(0.6 0.19 70), oklch(0.55 0.14 235), oklch(0.62 0.17 105))',
          }}
        />
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
        </DialogHeader>

        {(hint || noHintNote) && (
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              border: '1px dashed var(--border)',
              borderRadius: 10,
              padding: '10px 12px',
              fontSize: 13,
            }}
          >
            {hint ? (
              <Lightbulb size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            ) : (
              <Network size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            )}
            <span>{hint ?? noHintNote}</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {options.map((option, index) => {
            const isCorrectOption = option === correctOption
            const revealCorrect = chosen !== null && isCorrectOption
            const revealWrong = chosen === option && !isCorrectOption
            return (
              <button
                key={option}
                type="button"
                disabled={chosen !== null}
                onClick={() => handleChoose(option)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: `2px solid ${revealCorrect ? '#16a34a' : revealWrong ? '#dc2626' : 'var(--border)'}`,
                  background: 'var(--background)',
                  opacity: chosen !== null && !revealCorrect && !revealWrong ? 0.55 : 1,
                  cursor: chosen === null ? 'pointer' : 'default',
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    border: `2px solid ${revealCorrect ? '#16a34a' : 'var(--border)'}`,
                    background: revealCorrect ? '#16a34a' : 'var(--muted)',
                    color: revealCorrect ? '#fff' : 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {revealCorrect ? <Check size={16} /> : revealWrong ? <X size={16} /> : LETTERS[index]}
                </span>
                <span style={{ minWidth: 0, overflowX: 'auto' }}>{renderOption ? renderOption(option) : option}</span>
              </button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
