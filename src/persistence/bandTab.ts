import { DEFAULT_TAB, SYMBOL_TABS } from '../content/symbolTabs'
import type { BandTabId } from '../types/symbolBand'

/**
 * L'onglet du bandeau resté ouvert.
 *
 * Même contrat que les autres réglages d'interface (`booleanFlag`, `bandFamilies`) :
 * `localStorage`, au mieux — jamais d'exception quand le stockage est bloqué — et
 * lecture SYNCHRONE pour que le premier rendu montre déjà le bon onglet.
 *
 * `null` a un sens propre, et c'est pour ça que ce n'est pas une simple chaîne :
 * il veut dire « aucun onglet ouvert », le bandeau ne montrant alors que sa
 * première ligne. Un onglet FERMÉ est un choix, pas une absence de réglage — sans
 * quoi rouvrir la modale le rouvrirait tout seul.
 */
export interface BandTabStorage {
  load: () => BandTabId | null
  save: (tab: BandTabId | null) => void
}

export function createBandTabStorage(options: { key: string }): BandTabStorage {
  const { key } = options
  const known = new Set(SYMBOL_TABS.map(tab => tab.id))

  return {
    load() {
      try {
        const raw = localStorage.getItem(key)
        // Rien d'enregistré : c'est le premier lancement, donc l'onglet par
        // défaut — pas « fermé », qui est un choix que l'utilisateur n'a pas
        // encore fait.
        if (raw === null) return DEFAULT_TAB
        const parsed: unknown = JSON.parse(raw)
        if (parsed === null) return null
        // Un onglet qui n'existe plus (renommé, retiré) retombe sur le défaut
        // plutôt que de laisser le bandeau vide sans explication.
        return typeof parsed === 'string' && known.has(parsed as BandTabId) ? (parsed as BandTabId) : DEFAULT_TAB
      } catch {
        return DEFAULT_TAB
      }
    },
    save(tab) {
      try {
        localStorage.setItem(key, JSON.stringify(tab))
      } catch {
        // Best-effort : un stockage bloqué ne coûte que le réglage.
      }
    },
  }
}

const storage = createBandTabStorage({ key: 'zachart-mentale:band-tab' })

/** L'onglet à rouvrir : un identifiant, ou `null` pour « rien d'ouvert ». */
export function loadBandTab(): BandTabId | null {
  return storage.load()
}

/** Retient l'onglet ouvert — ou son absence. */
export function saveBandTab(tab: BandTabId | null): void {
  storage.save(tab)
}
