import { useMemo, useState } from 'react'
import { CircleCheck } from 'lucide-react'
import { Button, ErrorBanner, Field, inputClass } from './ui/primitives'
import { FormatHelp, MindMapTextEditor } from './MindMapTextEditor'
import { useLibrary } from '@/state/useLibrary'
import { allFolderPaths, isValidSegment, joinPath, normalizePath } from '@/lib/tree'
import { MAP_TYPES, MAP_TYPE_LABELS } from '@app/types/mapType'
import { withMindMapExtension } from '@app/persistence/paths'
import type { QualityReport } from '@/lib/quality'
import { describeApiError, type AdminUser } from '@/lib/pb'
import { plural } from '@/lib/format'

/**
 * Créer une carte mentale à partir d'un texte collé.
 *
 * C'est le geste central de l'outil : le prof génère la carte ailleurs (un
 * LLM, le plus souvent), la colle ici, et la range directement chez l'élève.
 * Tout ce qui s'ajoute autour du champ de texte doit donc servir ce geste-là et
 * pas un autre — d'où trois champs seulement, tous pré-remplis de façon
 * utilisable.
 */
export function NewMapView({ user }: { user: AdminUser }) {
  const { tree, maps, addMap } = useLibrary()
  const [text, setText] = useState('')
  const [report, setReport] = useState<QualityReport | null>(null)
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [type, setType] = useState<string>('cours')
  const [author, setAuthor] = useState(user.username)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)

  const folderPaths = useMemo(() => allFolderPaths(tree), [tree])

  /**
   * Le nom proposé : le titre de la carte racine.
   *
   * L'utilisateur peut le changer, mais il ne devrait jamais avoir à le taper :
   * la racine d'une carte mentale EST le nom du chapitre, et le retaper à la
   * main est exactement le genre de frottement qui rend un outil pénible quand
   * on est debout avec un téléphone.
   */
  const suggested = useMemo(() => {
    const root = report?.cards?.find(card => card.parentId === null && card.detached !== true)
    return root?.title.trim() ?? ''
  }, [report])

  const effectiveName = name.trim() === '' ? suggested : name.trim()
  const targetPath = effectiveName === '' ? '' : joinPath(normalizePath(folder), withMindMapExtension(effectiveName))

  const nameProblem =
    effectiveName === ''
      ? null
      : !isValidSegment(effectiveName)
        ? 'Nom invalide : évitez / \\ : * ? " < > | et les noms « . » ou « .. ».'
        : maps.some(entry => normalizePath(entry.path) === targetPath)
          ? 'Une carte porte déjà ce nom dans ce dossier.'
          : null

  const authorName = author.trim()
  // Le même jeu de caractères que `USERNAME_FIELD` côté serveur : un pseudo
  // refusé produirait un 400 illisible au moment de l'enregistrement.
  const authorProblem =
    authorName === ''
      ? 'Indiquez un auteur.'
      : /^[a-zA-Z0-9_.-]+$/.test(authorName)
        ? null
        : 'Pseudo invalide : lettres, chiffres, « . », « _ » et « - » uniquement.'

  const canSave =
    report?.saveable === true && effectiveName !== '' && nameProblem === null && authorProblem === null && !saving

  async function save() {
    if (report?.cards == null || !canSave) return
    setSaving(true)
    setError(null)
    try {
      await addMap({
        path: targetPath,
        cards: report.cards,
        author: authorName,
        // Le rôle enregistré dans `meta` est celui de l'AUTEUR déclaré, pas
        // celui de la personne qui tape : attribuer la carte à un élève et
        // l'estampiller « prof » serait une contradiction dans le fichier.
        role: authorName === user.username ? user.role : 'eleve',
        type,
      })
      setCreated(targetPath)
      setText('')
      setName('')
    } catch (caught) {
      setError(describeApiError(caught, 'Création de la carte'))
    } finally {
      setSaving(false)
    }
  }

  if (created !== null) {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <CircleCheck size={44} className="text-ok" />
        <div>
          <p className="font-medium">Carte créée</p>
          <p className="mt-1 text-sm text-ink-500">
            « {created} » est sur le serveur. Elle descendra chez l’élève à sa prochaine synchronisation.
          </p>
        </div>
        <Button tone="primary" onClick={() => setCreated(null)}>
          Créer une autre carte
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-col gap-5 p-4 pb-8">
        <FormatHelp />

        <MindMapTextEditor value={text} onChange={setText} onReport={setReport} />

        {/* Les champs de rangement n'apparaissent qu'une fois le contenu
            valide : les montrer d'emblée demanderait de décider où ranger une
            carte dont on ne sait pas encore si elle tient debout. */}
        {report?.saveable === true && (
          <div className="flex flex-col gap-4 rounded-2xl border border-ink-800 bg-ink-900/60 p-4">
            <h3 className="text-sm font-semibold text-ink-300">Où la ranger</h3>

            <Field label="Nom du fichier" error={nameProblem} hint="L’extension .zmap est ajoutée automatiquement.">
              <input
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder={suggested === '' ? 'Chapitre 1' : suggested}
                className={inputClass}
              />
            </Field>

            <Field label="Dossier">
              <select value={folder} onChange={event => setFolder(event.target.value)} className={inputClass}>
                <option value="">Racine</option>
                {folderPaths.map(path => (
                  <option key={path} value={path}>
                    {path}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Type">
              <select value={type} onChange={event => setType(event.target.value)} className={inputClass}>
                <option value="default">{MAP_TYPE_LABELS.default}</option>
                {MAP_TYPES.map(entry => (
                  <option key={entry} value={entry}>
                    {MAP_TYPE_LABELS[entry]}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Auteur"
              error={authorProblem}
              hint={
                authorName === user.username
                  ? 'Vous en serez propriétaire : l’élève pourra la réviser, mais pas la modifier. C’est ce qu’on veut pour un cours de référence.'
                  : `« ${authorName} » en sera propriétaire et pourra donc la compléter depuis son application. C’est ce qu’on veut pour un exercice à remplir.`
              }
            >
              <input
                value={author}
                onChange={event => setAuthor(event.target.value)}
                placeholder={user.username}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={inputClass}
              />
            </Field>

            {targetPath !== '' && nameProblem === null && (
              <p className="text-xs text-ink-500">
                Sera enregistrée sous <span className="font-mono text-ink-300">{targetPath}</span>
                {report.stats !== null ? ` · ${plural(report.stats.total, 'carte')}` : ''}
              </p>
            )}

            {error !== null && <ErrorBanner message={error} />}

            <Button tone="primary" onClick={() => void save()} disabled={!canSave}>
              {saving ? 'Création…' : 'Créer la carte'}
            </Button>

            <p className="text-xs text-ink-500">
              Un professeur peut de toute façon modifier n’importe quelle carte ensuite : le choix de l’auteur décide
              seulement si l’ÉLÈVE pourra la modifier de son côté.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
