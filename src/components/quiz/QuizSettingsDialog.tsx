import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Slider } from '../ui/slider'
import { Switch } from '../ui/switch'
import { useQuizSettingsStore } from '../../state/useQuizSettingsStore'

interface QuizSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function QuizSettingsDialog({ open, onOpenChange }: QuizSettingsDialogProps) {
  const similarityThreshold = useQuizSettingsStore(s => s.similarityThreshold)
  const lengthGuideEnabled = useQuizSettingsStore(s => s.lengthGuideEnabled)
  const setSimilarityThreshold = useQuizSettingsStore(s => s.setSimilarityThreshold)
  const setLengthGuideEnabled = useQuizSettingsStore(s => s.setLengthGuideEnabled)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Paramètres du quiz</DialogTitle>
        </DialogHeader>

        <div>
          <label id="similarity-threshold-label" style={{ fontWeight: 700, fontSize: 13, display: 'block', marginBottom: 8 }}>
            Précision exigée pour "correct" : {similarityThreshold}%
          </label>
          <Slider
            aria-labelledby="similarity-threshold-label"
            min={50}
            max={100}
            step={5}
            value={[similarityThreshold]}
            onValueChange={([value]) => setSimilarityThreshold(value)}
          />
          <p style={{ fontSize: 11, opacity: 0.7, marginTop: 8 }}>
            100% = réponse exacte (recommandé pour les formules, où "+" et "−" changent tout).
          </p>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1, fontSize: 13 }}>
            Guide de longueur — affiche des tirets à la place des lettres cachées
          </span>
          <Switch checked={lengthGuideEnabled} onCheckedChange={setLengthGuideEnabled} />
        </label>
      </DialogContent>
    </Dialog>
  )
}
