/**
 * Les familles de signes que l'utilisateur a choisi de MASQUER dans le bandeau.
 *
 * Même contrat que les autres réglages d'interface (`booleanFlag`, `panelWidth`,
 * `sidebarWidth`) : `localStorage`, au mieux — jamais d'exception quand le
 * stockage est bloqué — et lecture SYNCHRONE pour que le premier rendu reflète
 * déjà le choix, sans un flash de bandeau complet avant le réglage.
 *
 * On enregistre les familles **masquées**, pas les familles visibles, et ce n'est
 * pas un détail : une famille ajoutée plus tard dans `symbolSets` apparaît donc
 * toute seule. L'inverse ferait qu'un nouveau signe resterait invisible pour
 * quiconque a déjà ouvert ce réglage une fois — ce qui est exactement le
 * contraire de ce qu'on veut d'un signe qu'on vient d'ajouter.
 */
export interface BandFamiliesStorage {
  load: () => string[]
  save: (names: string[]) => void
}

export function createBandFamiliesStorage(options: { key: string }): BandFamiliesStorage {
  const { key } = options

  return {
    load() {
      try {
        const raw = localStorage.getItem(key)
        if (raw === null) return []
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        // Un réglage écrit à la main peut contenir n'importe quoi : on ne garde
        // que des noms de famille, et un nom inconnu est simplement ignoré par
        // le bandeau — il ne casse rien et ne masque rien.
        return parsed.filter((entry): entry is string => typeof entry === 'string')
      } catch {
        return []
      }
    },
    save(names) {
      try {
        localStorage.setItem(key, JSON.stringify(names))
      } catch {
        // Best-effort : un stockage bloqué ne coûte que le réglage à la
        // prochaine ouverture.
      }
    },
  }
}

const storage = createBandFamiliesStorage({ key: 'zachart-mentale:band-hidden-families' })

/** Les familles masquées du dernier réglage. */
export function loadHiddenFamilies(): string[] {
  return storage.load()
}

/** Retient les familles masquées. */
export function saveHiddenFamilies(names: string[]): void {
  storage.save(names)
}
