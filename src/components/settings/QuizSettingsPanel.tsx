import { Slider } from '../ui/slider'
import type { QuizSettings } from '../../types/quizSettings'
import { slotsOf, revealedSet } from '../../quiz/blanks'
import { SettingsSection } from './SettingsSection'
import { SettingToggle } from './SettingToggle'

/** The word the difficulty preview is drawn from — long enough to show the spread. */
const PREVIEW_ANSWER = 'Photosynthèse'

const DIFFICULTY_PREVIEWS = [
  { label: 'Facile', difficulty: 'facile' as const },
  { label: 'Moyen', difficulty: 'moyen' as const },
  { label: 'Difficile', difficulty: 'difficile' as const },
]

function maskOf(answer: string, difficulty: 'facile' | 'moyen' | 'difficile'): string {
  const revealed = revealedSet(answer, difficulty)
  return slotsOf(answer)
    .map(slot => (slot.fillable && !revealed.has(slot.index) ? '_' : slot.char))
    .join(' ')
}

interface QuizSettingsPanelProps {
  settings: QuizSettings
  onChange: (next: QuizSettings) => void
}

export function QuizSettingsPanel({ settings, onChange }: QuizSettingsPanelProps) {
  return (
    <div>
      <SettingsSection
        title="Exigence de correction"
        description="À partir de quelle ressemblance une réponse écrite est acceptée. En dessous de 100%, une faute de frappe passe encore."
      >
        <label id="similarity-threshold-label" style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 10 }}>
          Précision exigée pour "correct" : {settings.similarityThreshold}%
        </label>
        <Slider
          aria-labelledby="similarity-threshold-label"
          min={50}
          max={100}
          step={5}
          value={[settings.similarityThreshold]}
          onValueChange={([value]) => onChange({ ...settings, similarityThreshold: value })}
        />
        <p style={{ fontSize: 11.5, color: 'var(--muted-foreground)', marginTop: 10, lineHeight: 1.5 }}>
          100% = réponse exacte (recommandé pour les formules, où « + » et « − » changent tout).
        </p>
      </SettingsSection>

      <SettingsSection
        title="Aide à la saisie"
        description="Comment les réponses à écrire sont présentées et corrigées."
      >
        <SettingToggle
          label="Montrer la forme de la réponse sur la carte"
          description="La carte affiche les tirets et la ponctuation du titre à trouver, sans ouvrir la fenêtre de réponse."
          checked={settings.lengthGuideEnabled}
          onCheckedChange={value => onChange({ ...settings, lengthGuideEnabled: value })}
        />
        <SettingToggle
          label="Corriger lettre par lettre pendant la saisie"
          description="Déconseillé : en colorant chaque lettre dès la frappe, la réponse se trouve à tâtons. Par défaut, la correction n'arrive qu'à la validation."
          checked={settings.liveLetterFeedback}
          onCheckedChange={value => onChange({ ...settings, liveLetterFeedback: value })}
        />
      </SettingsSection>

      <SettingsSection
        title="Aide selon la difficulté"
        description="La difficulté choisie au lancement décide du nombre de lettres offertes au départ. Chaque essai raté en offre une de plus, au lieu de donner la réponse."
      >
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {DIFFICULTY_PREVIEWS.map(({ label, difficulty }, index) => (
            <div
              key={difficulty}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '10px 14px',
                borderTop: index === 0 ? 'none' : '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, width: 68, flexShrink: 0 }}>{label}</span>
              <code
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 13,
                  letterSpacing: '0.05em',
                  color: 'var(--muted-foreground)',
                  overflowX: 'auto',
                  whiteSpace: 'nowrap',
                }}
              >
                {maskOf(PREVIEW_ANSWER, difficulty)}
              </code>
            </div>
          ))}
        </div>
      </SettingsSection>
    </div>
  )
}
