import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SyncSettingsPanel } from './SyncSettingsPanel'
import { useSyncStore } from '../../state/useSyncStore'
import { revealSyncLog } from '../../persistence/syncLog'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('../../persistence/syncLog', () => ({ revealSyncLog: vi.fn() }))

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

  it('disables Synchroniser until logged in with a folder chosen', () => {
    render(<SyncSettingsPanel />)
    expect(screen.getByRole('button', { name: /synchroniser/i })).toBeDisabled()
  })

  it('shows the last sync result summary', () => {
    useSyncStore.setState({
      currentUser: { username: 'aife', role: 'prof' },
      syncFolderPath: '/cours',
      lastResult: { pushed: 2, pulled: 1, errors: [] },
    })
    render(<SyncSettingsPanel />)
    expect(screen.getByText(/2 envoyé\(s\), 1 reçu\(s\)/)).toBeInTheDocument()
  })

  it('lists per-file sync errors under the summary, so the safety guards are visible', () => {
    useSyncStore.setState({
      currentUser: { username: 'aife', role: 'prof' },
      syncFolderPath: '/cours',
      lastResult: { pushed: 0, pulled: 0, errors: [{ fileId: 'f1', message: 'un message de test' }] },
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
