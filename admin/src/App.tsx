import { useEffect, useState } from 'react'
import { FilePlus2, FolderTree, GitCompareArrows, LogOut, ScrollText } from 'lucide-react'
import { Login } from './components/Login'
import { LibraryView } from './components/LibraryView'
import { NewMapView } from './components/NewMapView'
import { ConflictsView } from './components/ConflictsView'
import { LogsView } from './components/LogsView'
import { currentUser, logout, type AdminUser } from './lib/pb'
import { openConflictCount, useLibrary } from './state/useLibrary'
import { Badge } from './components/ui/primitives'

/**
 * La coque : qui est connecté, et quel onglet est ouvert.
 *
 * La navigation passe par le FRAGMENT de l'URL (`#/conflits`) et non par
 * l'historique. Ce n'est pas une économie de bibliothèque, c'est une propriété
 * de déploiement : le SPA est servi par PocketBase depuis `/pb_public`, et un
 * chemin réel (`/conflits`) dépendrait de la façon dont ce serveur traite une
 * URL inconnue. Un fragment n'atteint jamais le serveur — il marche partout, y
 * compris derrière un sous-chemin, et le bouton « retour » du téléphone
 * fonctionne quand même.
 */
const TABS = [
  { id: 'fichiers', label: 'Fichiers', icon: FolderTree },
  { id: 'nouvelle', label: 'Nouvelle', icon: FilePlus2 },
  { id: 'conflits', label: 'Conflits', icon: GitCompareArrows },
  { id: 'journal', label: 'Journal', icon: ScrollText },
] as const

type TabId = (typeof TABS)[number]['id']

function tabFromHash(): TabId {
  const raw = window.location.hash.replace(/^#\/?/, '')
  return TABS.some(tab => tab.id === raw) ? (raw as TabId) : 'fichiers'
}

export function App() {
  const [user, setUser] = useState<AdminUser | null>(currentUser)
  const [tab, setTab] = useState<TabId>(tabFromHash)
  const { conflicts, refreshAll } = useLibrary()

  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (user === null) return
    void refreshAll()
  }, [user, refreshAll])

  if (user === null) return <Login onSignedIn={setUser} />

  const openConflicts = openConflictCount(conflicts)

  return (
    <div className="flex h-dvh flex-col">
      <header className="safe-top flex items-center gap-3 border-b border-ink-850 px-4 pb-2">
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">
          Zachar’t Mentale <span className="font-normal text-ink-500">· espace professeur</span>
        </h1>
        <span className="truncate text-xs text-ink-500">{user.username}</span>
        <button
          type="button"
          onClick={() => {
            logout()
            setUser(null)
          }}
          aria-label="Se déconnecter"
          title="Se déconnecter"
          className="tap grid w-10 shrink-0 place-items-center rounded-xl text-ink-500 transition-colors hover:bg-ink-850 hover:text-ink-100"
        >
          <LogOut size={18} />
        </button>
      </header>

      {/* Chaque onglet garde son état monté : revenir aux fichiers depuis les
          conflits ne doit pas replier l'arbre ni reperdre une recherche en
          cours — c'est l'aller-retour le plus fréquent de tout l'outil. */}
      <main className="min-h-0 flex-1">
        <Pane active={tab === 'fichiers'}>
          <LibraryView user={user} />
        </Pane>
        <Pane active={tab === 'nouvelle'}>
          <NewMapView user={user} />
        </Pane>
        <Pane active={tab === 'conflits'}>
          <ConflictsView user={user} />
        </Pane>
        <Pane active={tab === 'journal'}>
          <LogsView />
        </Pane>
      </main>

      <nav className="safe-bottom flex border-t border-ink-850 bg-ink-950">
        {TABS.map(entry => {
          const Icon = entry.icon
          const active = tab === entry.id
          return (
            <a
              key={entry.id}
              href={`#/${entry.id}`}
              aria-current={active ? 'page' : undefined}
              className={`tap relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-2 text-[11px] transition-colors ${
                active ? 'text-accent' : 'text-ink-500'
              }`}
            >
              <Icon size={20} />
              {entry.label}
              {entry.id === 'conflits' && openConflicts > 0 && (
                <span className="absolute right-[22%] top-1">
                  <Badge tone="danger">{openConflicts}</Badge>
                </span>
              )}
            </a>
          )
        })}
      </nav>
    </div>
  )
}

/**
 * Un onglet monté en permanence, masqué quand il n'est pas actif.
 *
 * `hidden` plutôt que `display: none` en style : c'est l'attribut que le
 * lecteur d'écran comprend comme « pas là », alors qu'un panneau seulement
 * invisible resterait dans l'ordre de lecture et dans celui de la tabulation.
 */
function Pane({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div hidden={!active} className="h-full">
      {children}
    </div>
  )
}
