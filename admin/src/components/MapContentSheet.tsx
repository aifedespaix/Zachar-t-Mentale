import { useCallback, useEffect, useState } from 'react'
import { fetchMap, updateMapContent } from '@/lib/api'
import { describeApiError, type AdminUser } from '@/lib/pb'
import type { LibraryMap } from '@/lib/tree'
import { Button, ErrorBanner, Sheet, Spinner } from './ui/primitives'
import { MindMapTextEditor } from './MindMapTextEditor'
import type { QualityReport } from '@/lib/quality'
import { fullDate, relativeTime } from '@/lib/format'
import { useLibrary } from '@/state/useLibrary'

/**
 * Ouvrir une carte existante et en réécrire le contenu, en texte.
 *
 * Le contenu n'est chargé qu'ICI, jamais dans la liste : une bibliothèque
 * entière de `content` se compte en mégaoctets, et l'écran d'accueil doit
 * s'afficher sur une connexion de téléphone (voir `fetchMaps`).
 *
 * Le texte présenté est la liste de CARTES seule, pas l'enveloppe complète :
 * `meta` est de la mécanique de synchronisation — identité, auteur, date — que
 * personne ne devrait éditer à la main, et dont une retouche maladroite
 * casserait le suivi du fichier. `buildUpdatedMapContent` la reconstitue à
 * l'enregistrement, en conservant l'auteur d'origine.
 */
export function MapContentSheet({
  map,
  user,
  onClose,
}: {
  map: LibraryMap
  user: AdminUser
  onClose: () => void
}) {
  const refreshLibrary = useLibrary(state => state.refreshLibrary)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [original, setOriginal] = useState('')
  const [text, setText] = useState('')
  const [report, setReport] = useState<QualityReport | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const record = await fetchMap(map.id)
      setOriginal(record.content)
      setText(cardsTextOf(record.content))
    } catch (error) {
      setLoadError(describeApiError(error, 'Lecture de la carte'))
    } finally {
      setLoading(false)
    }
  }, [map.id])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = !loading && loadError === null && text !== cardsTextOf(original)

  async function save() {
    if (report?.cards == null) return
    setSaving(true)
    setSaveError(null)
    try {
      await updateMapContent(map.id, original, report.cards, user.username, user.role)
      // Relire plutôt que supposer : l'enregistrement vient de changer de
      // `updated`, et l'arborescence affiche cette date.
      const record = await fetchMap(map.id)
      setOriginal(record.content)
      setText(cardsTextOf(record.content))
      setSavedAt(new Date().toISOString())
      await refreshLibrary()
    } catch (error) {
      setSaveError(describeApiError(error, 'Enregistrement'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={map.path.split('/').pop() ?? map.path}
      footer={
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-ink-500">
            {saving
              ? 'Enregistrement…'
              : savedAt !== null && !dirty
                ? 'Enregistré.'
                : dirty
                  ? 'Modifications non enregistrées'
                  : ''}
          </span>
          <Button tone="ghost" onClick={onClose}>
            Fermer
          </Button>
          <Button
            tone="primary"
            onClick={() => void save()}
            disabled={!dirty || saving || report?.saveable !== true}
          >
            Enregistrer
          </Button>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
        <span>
          Auteur&nbsp;: <span className="text-ink-300">{map.author}</span>
        </span>
        <span title={fullDate(map.updated)}>Modifiée {relativeTime(map.updated)}</span>
      </div>

      {loading ? (
        <Spinner label="Chargement du contenu…" />
      ) : loadError !== null ? (
        <ErrorBanner message={loadError} onRetry={() => void load()} />
      ) : (
        <>
          {saveError !== null && (
            <div className="mb-3">
              <ErrorBanner message={saveError} />
            </div>
          )}
          {/* L'auteur ne change jamais, et c'est ce qui permet à l'élève de
              continuer à modifier son fichier après la correction. */}
          {map.author !== user.username && (
            <p className="mb-3 rounded-xl border border-ink-800 bg-ink-900/60 px-3.5 py-2.5 text-xs text-ink-300">
              Cette carte appartient à <strong>{map.author}</strong>. La corriger ne vous en rend pas propriétaire :
              l’élève pourra toujours la modifier ensuite.
            </p>
          )}
          <MindMapTextEditor value={text} onChange={setText} onReport={setReport} rows={14} />
        </>
      )}
    </Sheet>
  )
}

/**
 * Les CARTES d'un contenu enregistré, en texte indenté.
 *
 * Accepte les deux formes que l'application écrit — le tableau nu et
 * l'enveloppe `{ meta, cards }` — et rend le texte brut si elle ne reconnaît
 * ni l'une ni l'autre : mieux vaut laisser le prof voir (et réparer) un contenu
 * abîmé que lui présenter un champ vide qui effacerait tout à l'enregistrement.
 */
export function cardsTextOf(content: string): string {
  try {
    const parsed: unknown = JSON.parse(content)
    if (Array.isArray(parsed)) return JSON.stringify(parsed, null, 2)
    if (parsed !== null && typeof parsed === 'object') {
      const cards = (parsed as { cards?: unknown }).cards
      if (Array.isArray(cards)) return JSON.stringify(cards, null, 2)
    }
    return content
  } catch {
    return content
  }
}
