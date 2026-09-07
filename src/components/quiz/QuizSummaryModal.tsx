import { motion } from 'motion/react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog'
import { Button } from '../ui/button'
import { useQuizStore } from '../../state/useQuizStore'
import { computeScore } from '../../state/quizReducer'

export function QuizSummaryModal() {
  const showSummary = useQuizStore(s => s.showSummary)
  const results = useQuizStore(s => s.results)
  const endQuiz = useQuizStore(s => s.endQuiz)

  if (!showSummary) return null

  const { correct, total } = computeScore(results)

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) endQuiz()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Quiz terminé !</DialogTitle>
        </DialogHeader>
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          style={{ textAlign: 'center', fontSize: '1.5rem', padding: '1rem 0' }}
        >
          {correct} / {total} bonnes réponses
        </motion.div>
        <DialogFooter>
          <Button onClick={endQuiz}>Retour à la carte</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
