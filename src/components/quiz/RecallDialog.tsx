import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { PartyPopper, Lightbulb, CornerDownLeft, Eye, Network } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { BlankFillField } from './BlankFillField'
import { assembleAnswer, isFullyRevealed, remapTyped, revealedSet } from '../../quiz/blanks'
import { similarityColor } from '../../utils/textSimilarity'
import type { QuizDifficulty, RecallProgress } from '../../types/quiz'

/** How long the "correct!" state stays up before the dialog bows out. */
const SUCCESS_DISMISS_MS = 1100

type Phase = 'typing' | 'wrong' | 'correct' | 'revealed'

export interface RecallSubmitOutcome {
  correct: boolean
  similarity: number
}

interface RecallDialogProps {
  open: boolean
  /** The answer. Only ever shown through the mask, or once the user gives up. */
  title: string
  /** Where the card sits in the tree — the only clue a recall card can offer. */
  parentTitle?: string
  difficulty: QuizDifficulty
  progress: RecallProgress
  liveFeedback?: boolean
  onSubmit: (answer: string) => RecallSubmitOutcome
  onGiveUp: () => void
  onClose: () => void
}

/**
 * The window for a card whose title has to be written from memory.
 *
 * It is built around one refusal: a wrong answer never prints the solution.
 * It reports how close you were, hands over one more letter, and puts you back
 * in the field — so the card keeps asking the question it was drawn to ask.
 * The way out, for a card that genuinely will not come, is explicit and the
 * user's own choice ("Voir la réponse"), not something the app decides for
 * them after N tries.
 */
export function RecallDialog({
  open,
  title,
  parentTitle,
  difficulty,
  progress,
  liveFeedback = false,
  onSubmit,
  onGiveUp,
  onClose,
}: RecallDialogProps) {
  const [typed, setTyped] = useState<string[]>([])
  const [phase, setPhase] = useState<Phase>('typing')
  const [similarity, setSimilarity] = useState<number | null>(null)
  // The `typed` array exactly as it stood at the last submission — lets
  // BlankFillField keep colouring a box red/green only until THAT box is
  // edited, rather than clearing every colour the instant one letter changes.
  const [gradedSnapshot, setGradedSnapshot] = useState<string[] | null>(null)

  // "Voir la réponse" reveals everything regardless of the store; otherwise
  // the field follows `progress.extraReveals` directly — a miss no longer
  // waits on a "Réessayer" click to hand over the letter it just bought.
  const revealed =
    phase === 'revealed' ? revealedSet(title, difficulty, Number.MAX_SAFE_INTEGER) : revealedSet(title, difficulty, progress.extraReveals)

  // Every time the store grants a new letter, the box it occupied vanishes
  // from the field — so what was typed (and its graded snapshot) must be
  // re-anchored to the smaller set of boxes that remain, exactly what
  // `handleRetry` used to do by hand on a button click.
  const previousExtraReveals = useRef(progress.extraReveals)
  useEffect(() => {
    if (progress.extraReveals === previousExtraReveals.current) return
    const previousRevealed = revealedSet(title, difficulty, previousExtraReveals.current)
    const nextRevealed = revealedSet(title, difficulty, progress.extraReveals)
    setTyped(current => remapTyped(title, previousRevealed, current, nextRevealed))
    setGradedSnapshot(current => (current ? remapTyped(title, previousRevealed, current, nextRevealed) : null))
    previousExtraReveals.current = progress.extraReveals
  }, [progress.extraReveals, title, difficulty])

  useEffect(() => {
    if (phase !== 'correct') return
    const timer = setTimeout(onClose, SUCCESS_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [phase, onClose])

  const answer = assembleAnswer(title, revealed, typed)
  const complete = typed.filter(Boolean).length > 0
  const exhausted = isFullyRevealed(title, revealed)

  function handleSubmit() {
    if (phase !== 'typing' || !complete) return
    const outcome = onSubmit(answer)
    setSimilarity(outcome.similarity)
    setGradedSnapshot([...typed])
    setPhase(outcome.correct ? 'correct' : 'wrong')
  }

  /** Any edit after a miss resumes typing on its own — no button needed. */
  function handleTypedChange(next: string[]) {
    setTyped(next)
    if (phase === 'wrong') setPhase('typing')
  }

  function handleGiveUp() {
    onGiveUp()
    setTyped([])
    setGradedSnapshot(null)
    setPhase('revealed')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next && phase !== 'correct') onClose()
      }}
    >
      <DialogContent showCloseButton={false} style={{ maxWidth: 520, overflow: 'hidden' }}>
        <div
          style={{
            height: 5,
            margin: '-1rem -1rem 0',
            background: 'linear-gradient(90deg, oklch(0.62 0.17 105), oklch(0.6 0.19 70), oklch(0.55 0.14 235))',
          }}
        />
        <DialogHeader>
          <DialogTitle>Retrouve le titre de cette carte</DialogTitle>
        </DialogHeader>

        {parentTitle && (
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
            <Network size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              Cette carte est rattachée à <strong>{parentTitle}</strong>.
            </span>
          </div>
        )}

        <BlankFillField
          target={title}
          revealed={revealed}
          typed={typed}
          onTypedChange={handleTypedChange}
          liveFeedback={liveFeedback}
          gradedSnapshot={gradedSnapshot}
          disabled={phase === 'correct' || phase === 'revealed'}
          onSubmit={handleSubmit}
        />

        {phase === 'typing' && (
          <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <CornerDownLeft size={13} aria-hidden />
            Écris les lettres manquantes, puis valide. Une erreur ne coûte rien : elle t'offre une lettre.
          </p>
        )}

        {phase === 'wrong' && similarity !== null && (
          <div role="status" style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: similarityColor(similarity) }}>
              {similarity}% — pas encore ça.
            </div>
            <div
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '10px 12px',
                fontSize: 13,
              }}
            >
              <Lightbulb size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {exhausted
                  ? 'Toutes les lettres sont maintenant affichées — recopie-les pour valider.'
                  : 'Une lettre de plus t’est offerte. Regarde ce qui est en vert, corrige le reste.'}
              </span>
            </div>
          </div>
        )}

        {phase === 'correct' && (
          <motion.div
            role="status"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 18 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 15,
              fontWeight: 700,
              color: '#16a34a',
            }}
          >
            <PartyPopper size={20} aria-hidden />
            {progress.attempts === 0 ? 'Trouvé du premier coup !' : 'Trouvé — tu y es arrivé !'}
          </motion.div>
        )}

        {phase === 'revealed' && (
          <p role="status" style={{ fontSize: 13, margin: 0, color: 'var(--muted-foreground)' }}>
            La réponse était <strong style={{ color: 'inherit' }}>{title}</strong>. Elle reviendra au prochain quiz.
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          {(phase === 'typing' || phase === 'wrong') && (
            <Button variant="ghost" onClick={handleGiveUp}>
              <Eye />
              Voir la réponse
            </Button>
          )}
          {phase === 'typing' && (
            <Button onClick={handleSubmit} disabled={!complete}>
              Valider
            </Button>
          )}
          {phase === 'revealed' && (
            <Button variant="outline" onClick={onClose}>
              Fermer
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
