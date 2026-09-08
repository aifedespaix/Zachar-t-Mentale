import { motion } from 'motion/react'
import { Trophy, Sparkles, Check, X, LifeBuoy, RotateCcw } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { useQuizStore } from '../../state/useQuizStore'
import { useCardsStore } from '../../state/useCardsStore'
import { computeScore } from '../../state/quizReducer'

const RING_SIZE = 132
const RING_STROKE = 11
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/**
 * What the score screen says, and how it says it.
 *
 * Every tier is written to send the user back to the cards, because that is
 * the only thing this app can do for them. A low score is where practice pays
 * off most, so it gets encouragement and a concrete next step — never a rebuke
 * for getting a revision round wrong.
 */
const TIERS = [
  { min: 100, title: 'Sans-faute !', message: 'Tout juste, d’un bout à l’autre. Ce chapitre est acquis.', color: '#16a34a' },
  { min: 80, title: 'Excellent !', message: 'Il ne reste presque rien à revoir. Encore un tour et c’est plié.', color: '#16a34a' },
  { min: 60, title: 'Bien joué !', message: 'La base est là. Reprends les cartes manquées, elles tomberont vite.', color: '#65a30d' },
  { min: 40, title: 'Ça progresse', message: 'La moitié du chemin est faite. Un deuxième tour maintenant vaut trois demain.', color: '#d97706' },
  { min: 0, title: 'On recommence !', message: 'C’est exactement à quoi sert un quiz : tu sais maintenant quoi revoir.', color: '#d97706' },
]

function tierFor(percentage: number) {
  return TIERS.find(tier => percentage >= tier.min) ?? TIERS[TIERS.length - 1]
}

interface StatProps {
  icon: typeof Check
  label: string
  value: number
  color: string
}

function Stat({ icon: Icon, label, value, color }: StatProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        padding: '10px 6px',
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: `color-mix(in oklch, ${color}, transparent 94%)`,
      }}
    >
      <Icon size={16} style={{ color }} aria-hidden />
      <span style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.1 }}>{value}</span>
      <span style={{ fontSize: 10.5, color: 'var(--muted-foreground)', textAlign: 'center' }}>{label}</span>
    </div>
  )
}

export function QuizSummaryModal() {
  const showSummary = useQuizStore(s => s.showSummary)
  const results = useQuizStore(s => s.results)
  const recallProgress = useQuizStore(s => s.recallProgress)
  const endQuiz = useQuizStore(s => s.endQuiz)
  const restartQuiz = useQuizStore(s => s.restartQuiz)
  const cards = useCardsStore(s => s.history.present)

  if (!showSummary) return null

  const score = computeScore(results, recallProgress)
  const tier = tierFor(score.percentage)
  const missed = Object.entries(results)
    .filter(([, result]) => result !== 'correct')
    .map(([cardId]) => cards.find(card => card.id === cardId)?.title)
    .filter((title): title is string => Boolean(title))

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) endQuiz()
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Trophy size={18} style={{ color: tier.color }} aria-hidden />
            Quiz terminé
          </DialogTitle>
        </DialogHeader>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ position: 'relative', width: RING_SIZE, height: RING_SIZE }}>
            <svg width={RING_SIZE} height={RING_SIZE} aria-hidden style={{ transform: 'rotate(-90deg)' }}>
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="var(--muted)"
                strokeWidth={RING_STROKE}
              />
              {/* Drawn by animating the dash offset, so the ring fills round to
                  the score instead of appearing at it — the small moment of
                  suspense that makes a result feel earned. */}
              <motion.circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke={tier.color}
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                initial={{ strokeDashoffset: RING_CIRCUMFERENCE }}
                animate={{ strokeDashoffset: RING_CIRCUMFERENCE * (1 - score.percentage / 100) }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
              />
            </svg>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{score.percentage}%</span>
              <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                {score.correct} / {score.total}
              </span>
            </div>
          </div>

          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.15 }}
            style={{ textAlign: 'center' }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
              <Sparkles size={16} style={{ color: tier.color }} aria-hidden />
              {tier.title}
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted-foreground)', margin: '4px 0 0', lineHeight: 1.5 }}>
              {tier.message}
            </p>
          </motion.div>
        </div>

        {/* "Du premier coup" and "avec de l'aide" are both successes, and the
            split is the useful one: it says which cards are actually known and
            which merely got there with letters handed over. */}
        <div style={{ display: 'flex', gap: 8 }}>
          <Stat icon={Check} label="du premier coup" value={score.perfect} color="#16a34a" />
          <Stat icon={LifeBuoy} label="avec de l’aide" value={score.assisted} color="#d97706" />
          <Stat icon={X} label="à revoir" value={score.incorrect + score.unanswered} color="#dc2626" />
        </div>

        {missed.length > 0 && (
          <div>
            <h3 style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted-foreground)', margin: '0 0 6px' }}>
              À revoir
            </h3>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {missed.map(title => (
                <li
                  key={title}
                  style={{
                    fontSize: 12,
                    padding: '4px 9px',
                    borderRadius: 999,
                    border: '1px solid var(--border)',
                    background: 'var(--muted)',
                  }}
                >
                  {title}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="outline" onClick={endQuiz}>
            Retour à la carte
          </Button>
          {/* Same settings, freshly drawn — the natural next move when the
              score screen has just told you what you do not know yet. */}
          <Button onClick={restartQuiz}>
            <RotateCcw />
            Recommencer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
