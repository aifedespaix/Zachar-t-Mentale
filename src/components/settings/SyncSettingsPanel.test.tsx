import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SyncSettingsPanel } from './SyncSettingsPanel'
import { useSyncStore } from '../../state/useSyncStore'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

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
})
