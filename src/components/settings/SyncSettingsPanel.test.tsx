import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SyncSettingsPanel } from './SyncSettingsPanel'
import { useSyncStore } from '../../state/useSyncStore'
import { clearSyncLog, openSyncLog, revealSyncLog } from '../../persistence/syncLog'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('../../persistence/syncLog', () => ({
  revealSyncLog: vi.fn(),
  openSyncLog: vi.fn(),
  clearSyncLog: vi.fn(),
}))

function resetSyncStore() {
  useSyncStore.setState({
    serverUrl: '',
    syncFolderPath: null,
    currentUser: null,
    status: 'idle',
    error: null,
    lastResult: null,
  })
}

describe('SyncSettingsPanel', () => {
  beforeEach(() => {
    resetSyncStore()
    vi.mocked(revealSyncLog).mockReset().mockResolvedValue('/config/sync-debug.log')
  })

  it('shows the login form when nobody is connected', () => {
    render(<SyncSettingsPanel />)
    expect(screen.getByLabelText("Nom d'utilisateur")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /connexion/i })).toBeInTheDocument()
  })

  it('shows the connected username and role, with a logout button, once logged in', () => {
    useSyncStore.setState({ currentUser: { username: 'aife', role: 'prof' } })
    render(<SyncSettingsPanel />)
    expect(screen.getByText(/aife/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /déconnexion/i })).toBeInTheDocument()
  })

  it('calls login with the typed credentials', async () => {
    const user = userEvent.setup()
    const login = vi.fn().mockResolvedValue(undefined)
    useSyncStore.setState({ serverUrl: 'https://pi.local', login })
    render(<SyncSettingsPanel />)

    await user.type(screen.getByLabelText("Nom d'utilisateur"), 'aife')
    await user.type(screen.getByLabelText('Mot de passe'), 'secret')
    await user.click(screen.getByRole('button', { name: /connexion/i }))

    expect(login).toHaveBeenCalledWith('aife', 'secret')
  })

  it('shows the run’s progress and lets it be cancelled from here too', async () => {
    const user = userEvent.setup()
    const cancelSync = vi.fn()
    useSyncStore.setState({ status: 'syncing', progress: { done: 3, total: 5 }, cancelSync })
    render(<SyncSettingsPanel />)

    expect(screen.getByRole('button', { name: /synchronisation 3\/5/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Annuler' }))

    expect(cancelSync).toHaveBeenCalled()
  })

  it('disables Synchroniser until logged in with a folder chosen', () => {
    render(<SyncSettingsPanel />)
    expect(screen.getByRole('button', { name: /synchroniser/i })).toBeDisabled()
  })

  it('turns automatic sync on, and remembers the interval', async () => {
    const user = userEvent.setup()
    const updateSettings = vi.fn().mockResolvedValue(undefined)
    useSyncStore.setState({ updateSettings })
    render(<SyncSettingsPanel />)

    await user.click(await screen.findByRole('switch', { name: /synchroniser au lancement/i }))
    expect(updateSettings).toHaveBeenCalledWith({ autoSyncOnLaunch: true })

    await user.selectOptions(screen.getByLabelText('Intervalle de synchronisation automatique'), '15')
    expect(updateSettings).toHaveBeenCalledWith({ autoSyncIntervalMinutes: 15 })
  })

  it('says when the last sync succeeded, without having to click anything', () => {
    useSyncStore.setState({ lastSuccessAt: new Date(Date.now() - 12 * 60 * 1000).toISOString() })
    render(<SyncSettingsPanel />)

    expect(screen.getByText(/dernière synchro il y a 12 min/)).toBeInTheDocument()
  })

  it('shows the last sync result summary', () => {
    useSyncStore.setState({
      currentUser: { username: 'aife', role: 'prof' },
      syncFolderPath: '/cours',
      lastResult: { pushed: 2, pulled: 1, errors: [], cancelled: false, conflicts: [], transferred: [] },
    })
    render(<SyncSettingsPanel />)
    expect(screen.getByText(/2 envoyé\(s\), 1 reçu\(s\)/)).toBeInTheDocument()
  })

  it('lists the files the two sides disagree on, and says nothing was overwritten', () => {
    useSyncStore.setState({
      currentUser: { username: 'aife', role: 'prof' },
      syncFolderPath: '/cours',
      lastResult: {
        pushed: 0,
        pulled: 0,
        errors: [],
        cancelled: false,
        conflicts: [
          {
            fileId: 'f1',
            path: 'chapitre1.zmap',
            localModified: '2026-02-01T10:00:00.000Z',
            remoteUpdated: '2026-02-01 09:00:00.000Z',
          },
        ],
        transferred: [],
      },
    })
    render(<SyncSettingsPanel />)

    expect(screen.getByText(/chapitre1.zmap/)).toBeInTheDocument()
    // The whole point: nothing was overwritten, so the user is told so.
    expect(screen.getByText(/rien n’a été écrasé/)).toBeInTheDocument()
  })

  it('lists per-file sync errors under the summary, so the safety guards are visible', () => {
    useSyncStore.setState({
      currentUser: { username: 'aife', role: 'prof' },
      syncFolderPath: '/cours',
      lastResult: { pushed: 0, pulled: 0, errors: [{ fileId: 'f1', message: 'un message de test' }], cancelled: false, conflicts: [], transferred: [] },
    })
    render(<SyncSettingsPanel />)
    expect(screen.getByText(/f1/)).toBeInTheDocument()
    expect(screen.getByText(/un message de test/)).toBeInTheDocument()
  })
})

describe('SyncSettingsPanel — journal de débogage', () => {
  beforeEach(() => {
    resetSyncStore()
    vi.mocked(revealSyncLog).mockReset().mockResolvedValue('/config/sync-debug.log')
    vi.mocked(openSyncLog).mockReset().mockResolvedValue('/config/sync-debug.log')
    vi.mocked(clearSyncLog).mockReset().mockResolvedValue(true)
  })

  it('opens the log file itself, and says why when there is nothing to open yet', async () => {
    const user = userEvent.setup()
    render(<SyncSettingsPanel />)

    await user.click(screen.getByRole('button', { name: /ouvrir le journal/i }))
    expect(openSyncLog).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('/config/sync-debug.log')).toBeInTheDocument()

    vi.mocked(openSyncLog).mockRejectedValue(new Error('Le journal est encore vide'))
    await user.click(screen.getByRole('button', { name: /ouvrir le journal/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/encore vide/)
  })

  it('empties the log, and treats "already empty" as the non-event it is', async () => {
    const user = userEvent.setup()
    render(<SyncSettingsPanel />)

    await user.click(screen.getByRole('button', { name: /vider/i }))
    expect(clearSyncLog).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Journal vidé.')).toBeInTheDocument()

    vi.mocked(clearSyncLog).mockResolvedValue(false)
    await user.click(screen.getByRole('button', { name: /vider/i }))
    expect(await screen.findByText('Le journal était déjà vide.')).toBeInTheDocument()
  })

  it('reports a failed wipe instead of pretending it worked', async () => {
    const user = userEvent.setup()
    vi.mocked(clearSyncLog).mockRejectedValue(new Error('disque en lecture seule'))
    render(<SyncSettingsPanel />)

    await user.click(screen.getByRole('button', { name: /vider/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/disque en lecture seule/)
  })

  it('turns the detailed journal on', async () => {
    const user = userEvent.setup()
    const updateSettings = vi.fn().mockResolvedValue(undefined)
    useSyncStore.setState({ updateSettings })
    render(<SyncSettingsPanel />)

    await user.click(screen.getByRole('switch', { name: /journal détaillé/i }))

    expect(updateSettings).toHaveBeenCalledWith({ verboseLog: true })
  })

  it('opens the log from its button, and prints where it is', async () => {
    const user = userEvent.setup()
    render(<SyncSettingsPanel />)

    await user.click(screen.getByRole('button', { name: /ouvrir le dossier des logs/i }))

    expect(revealSyncLog).toHaveBeenCalledTimes(1)
    // The path, so it can be copied into a bug report written elsewhere.
    expect(await screen.findByText('/config/sync-debug.log')).toBeInTheDocument()
  })

  it('says so when the log cannot be opened, instead of looking like it worked', async () => {
    const user = userEvent.setup()
    vi.mocked(revealSyncLog).mockRejectedValue(new Error('explorateur indisponible'))
    render(<SyncSettingsPanel />)

    await user.click(screen.getByRole('button', { name: /ouvrir le dossier des logs/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/explorateur indisponible/)
  })
})

describe('SyncSettingsPanel — champ URL du serveur', () => {
  beforeEach(() => {
    resetSyncStore()
  })

  it('does not commit the server URL until the field loses focus', async () => {
    const user = userEvent.setup()
    const setServerUrl = vi.fn().mockResolvedValue(undefined)
    useSyncStore.setState({ setServerUrl })
    render(<SyncSettingsPanel />)

    const input = screen.getByLabelText('URL du serveur')
    await user.type(input, 'https://pi.local')

    expect(setServerUrl).not.toHaveBeenCalled()

    await user.tab()

    expect(setServerUrl).toHaveBeenCalledWith('https://pi.local')
  })
})
