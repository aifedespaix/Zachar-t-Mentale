import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CircleCheck, CircleX, ClipboardPaste, Sparkles, Wand2 } from 'lucide-react'
import { analyzeMindMapText, repairMindMapText, type QualityReport } from '@/lib/quality'
import { Badge, Button, Spinner } from './ui/primitives'
import { humanSize, plural } from '@/lib/format'

/**
 * Coller une carte mentale, et savoir tout de suite ce qu'elle vaut.
 *
 * L'analyse est débattue à chaque frappe mais DIFFÉRÉE : `analyzeMindMapText`
 * parcourt l'arbre entier, et le relancer à chaque caractère sur une carte de
 * deux cents cartes ferait ramer la saisie sur un téléphone. 250 ms est assez
 * court pour que le verdict paraisse immédiat après un collage — le geste réel
 * ici — et assez long pour ne jamais gêner une correction au clavier.
 */
const ANALYSIS_DELAY_MS = 250

export function MindMapTextEditor({
  value,
  onChange,
  onReport,
  rows = 12,
}: {
  value: string
  onChange: (next: string) => void
  onReport?: (report: QualityReport) => void
  rows?: number
}) {
  const [debounced, setDebounced] = useState(value)
  const [pasteError, setPasteError] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ANALYSIS_DELAY_MS)
    return () => clearTimeout(timer)
  }, [value])

  const report = useMemo(() => analyzeMindMapText(debounced), [debounced])
  const analysing = debounced !== value

  useEffect(() => {
    onReport?.(report)
  }, [report, onReport])

  /**
   * Le collage explicite, pour le téléphone.
   *
   * Un `<textarea>` se colle très bien tout seul — au clavier. Au doigt, il
   * faut viser le champ, maintenir, attendre le menu, viser « Coller ». Un
   * bouton fait la même chose en un appui, et c'est LE geste de ce écran.
   * L'API peut être refusée (permission, contexte non sécurisé) : on le dit
   * plutôt que de ne rien faire.
   */
  async function pasteFromClipboard() {
    setPasteError(null)
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim() === '') {
        setPasteError('Le presse-papiers est vide.')
        return
      }
      onChange(text)
    } catch {
      setPasteError('Le navigateur a refusé l’accès au presse-papiers. Collez à la main dans le champ.')
    }
  }

  function repair() {
    const repaired = repairMindMapText(value)
    if (repaired === null) return
    onChange(JSON.stringify(repaired, null, 2))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button tone="neutral" onClick={pasteFromClipboard} type="button">
          <ClipboardPaste size={16} />
          Coller
        </Button>
        {value !== '' && (
          <Button tone="ghost" onClick={() => onChange('')} type="button">
            Vider
          </Button>
        )}
        <span className="ml-auto text-xs text-ink-500">
          {value === '' ? '' : humanSize(new Blob([value]).size)}
        </span>
      </div>

      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        rows={rows}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={'Collez ici le JSON de la carte mentale.\n\nSoit une liste de cartes : [ { "id": "...", "level": 1, ... } ]\nSoit le fichier complet : { "meta": { ... }, "cards": [ ... ] }'}
        className="w-full resize-y rounded-xl border border-ink-800 bg-ink-950 p-3 font-mono text-[13px] leading-relaxed text-ink-100 placeholder:text-ink-700 focus:border-accent focus:outline-none"
      />

      {pasteError !== null && <p className="text-sm text-warn">{pasteError}</p>}

      {value.trim() === '' ? (
        <p className="text-sm text-ink-500">
          Le validateur vérifiera la structure (une racine, quatre niveaux au plus, aucune carte orpheline) puis la
          qualité (titres, définitions, doublons) avant d’autoriser l’enregistrement.
        </p>
      ) : analysing ? (
        <Spinner label="Analyse…" />
      ) : (
        <QualityPanel report={report} onRepair={report.repairable ? repair : undefined} />
      )}
    </div>
  )
}

/**
 * Le verdict.
 *
 * Trois états, jamais deux : refusé, accepté avec réserves, accepté. La nuance
 * du milieu est celle qui compte — c'est elle qui laisse enregistrer un
 * squelette délibérément incomplet, qu'un validateur binaire interdirait.
 */
export function QualityPanel({ report, onRepair }: { report: QualityReport; onRepair?: () => void }) {
  const errors = report.findings.filter(entry => entry.severity === 'error')
  const warnings = report.findings.filter(entry => entry.severity === 'warning')

  return (
    <div className="flex flex-col gap-3">
      {report.saveable ? (
        warnings.length === 0 ? (
          <Verdict tone="ok" icon={<CircleCheck size={18} />} title="Carte valide, rien à signaler." />
        ) : (
          <Verdict
            tone="warn"
            icon={<AlertTriangle size={18} />}
            title={`Enregistrable, mais ${plural(warnings.length, 'remarque')}.`}
          />
        )
      ) : (
        <Verdict tone="danger" icon={<CircleX size={18} />} title="Cette carte ne peut pas être enregistrée." />
      )}

      {report.stats !== null && (
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="accent">{plural(report.stats.total, 'carte')}</Badge>
          <Badge>{report.stats.depth} niveaux</Badge>
          <Badge>
            {report.stats.withDefinition}/{report.stats.total} définies
          </Badge>
          {report.stats.detached > 0 && <Badge tone="warn">{plural(report.stats.detached, 'volante')}</Badge>}
        </div>
      )}

      {errors.length > 0 && (
        <FindingList
          title="À corriger"
          tone="danger"
          findings={errors}
          action={
            onRepair !== undefined ? (
              <Button tone="neutral" onClick={onRepair} type="button">
                <Wand2 size={16} />
                Réparer automatiquement
              </Button>
            ) : undefined
          }
          note={
            onRepair !== undefined
              ? 'La réparation conserve tout le contenu lisible : les cartes mal placées sont détachées et parquées en zone volante, jamais supprimées.'
              : undefined
          }
        />
      )}

      {warnings.length > 0 && <FindingList title="Remarques" tone="warn" findings={warnings} />}
    </div>
  )
}

function Verdict({ tone, icon, title }: { tone: 'ok' | 'warn' | 'danger'; icon: React.ReactNode; title: string }) {
  const tones = {
    ok: 'border-ok/30 bg-ok/10 text-ok',
    warn: 'border-warn/30 bg-warn/10 text-warn',
    danger: 'border-danger/30 bg-danger/10 text-danger',
  }
  return (
    <div className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium ${tones[tone]}`}>
      {icon}
      <span>{title}</span>
    </div>
  )
}

function FindingList({
  title,
  tone,
  findings,
  action,
  note,
}: {
  title: string
  tone: 'danger' | 'warn'
  findings: { message: string; count?: number; samples?: string[] }[]
  action?: React.ReactNode
  note?: string
}) {
  return (
    <section className="rounded-xl border border-ink-800 bg-ink-900/60 p-3.5">
      <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${tone === 'danger' ? 'text-danger' : 'text-warn'}`}>
        {title}
      </h3>
      <ul className="flex flex-col gap-2.5">
        {findings.map((entry, index) => (
          <li key={index} className="text-sm text-ink-100">
            <p>{entry.message}</p>
            {entry.samples !== undefined && entry.samples.length > 0 && (
              <p className="mt-0.5 text-xs text-ink-500">
                {entry.samples.join(' · ')}
                {entry.count !== undefined && entry.count > entry.samples.length
                  ? ` … et ${entry.count - entry.samples.length} de plus`
                  : ''}
              </p>
            )}
          </li>
        ))}
      </ul>
      {note !== undefined && <p className="mt-3 text-xs text-ink-500">{note}</p>}
      {action !== undefined && <div className="mt-3">{action}</div>}
    </section>
  )
}

/** Le pense-bête du format, replié — utile une fois, encombrant ensuite. */
export function FormatHelp() {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/60">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="tap flex w-full items-center gap-2 px-3.5 text-left text-sm text-ink-300"
      >
        <Sparkles size={16} className="text-accent" />
        <span className="flex-1">Format attendu (à donner au LLM)</span>
        <span className="text-ink-500">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="border-t border-ink-850 px-3.5 py-3 text-xs text-ink-300">
          <p className="mb-2">
            Une liste de cartes. <code className="text-accent">level</code> doit correspondre à la profondeur réelle
            (racine = 1, maximum 4), <code className="text-accent">parentId</code> pointe sur l’
            <code className="text-accent">id</code> du parent, et la racine seule a{' '}
            <code className="text-accent">parentId: null</code>.
          </p>
          <pre className="overflow-x-auto rounded-lg bg-ink-950 p-3 font-mono leading-relaxed text-ink-300">{`[
  { "id": "r",  "level": 1, "title": "Les fonctions affines",
    "parentId": null, "order": 0 },
  { "id": "a",  "level": 2, "title": "Coefficient directeur",
    "definition": "Le a de ax + b : la pente.",
    "parentId": "r", "order": 0 },
  { "id": "a1", "level": 3, "title": "Signe de a",
    "definition": "Croissante si a > 0, décroissante si a < 0.",
    "parentId": "a", "order": 0 }
]`}</pre>
        </div>
      )}
    </div>
  )
}
