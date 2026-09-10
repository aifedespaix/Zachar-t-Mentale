import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { RefreshCw, LogIn, LogOut } from 'lucide-react'
import { useSyncStore } from '../../state/useSyncStore'
import { SettingsSection } from './SettingsSection'
import { Button } from '../ui/button'

const inputStyle = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'inherit',
  fontSize: 13,
} as const

/**
 * Unlike the dialog's other tabs, nothing here goes through the draft/commit
 * flow: connecting, choosing a folder, and syncing are immediate actions with
 * real side effects (network calls), not a live preview to confirm or discard.
 */
export function SyncSettingsPanel() {
  const serverUrl = useSyncStore(s => s.serverUrl)
  const syncFolderPath = useSyncStore(s => s.syncFolderPath)
  const currentUser = useSyncStore(s => s.currentUser)
  const status = useSyncStore(s => s.status)
  const error = useSyncStore(s => s.error)
  const lastResult = useSyncStore(s => s.lastResult)
  const setServerUrl = useSyncStore(s => s.setServerUrl)
  const setSyncFolderPath = useSyncStore(s => s.setSyncFolderPath)
  const login = useSyncStore(s => s.login)
  const logout = useSyncStore(s => s.logout)
  const syncNow = useSyncStore(s => s.syncNow)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [serverUrlDraft, setServerUrlDraft] = useState(serverUrl)
  useEffect(() => {
    setServerUrlDraft(serverUrl)
  }, [serverUrl])

  async function pickSyncFolder() {
    const selected = await open({ directory: true })
    if (typeof selected === 'string') await setSyncFolderPath(selected)
  }

  return (
    <div>
      <SettingsSection title="Serveur" description="L’adresse de votre serveur PocketBase auto-hébergé.">
        <input
          aria-label="URL du serveur"
          value={serverUrlDraft}
          onChange={e => setServerUrlDraft(e.target.value)}
          onBlur={() => {
            if (serverUrlDraft !== serverUrl) void setServerUrl(serverUrlDraft)
          }}
          placeholder="https://cartes.mon-domaine.fr"
          style={{ ...inputStyle, width: '100%' }}
        />
      </SettingsSection>

      <SettingsSection title="Compte" description="Identifiant et mot de passe créés sur ce serveur.">
        {currentUser ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13 }}>
              Connecté en tant que <strong>{currentUser.username}</strong> (
              {currentUser.role === 'prof' ? 'prof' : 'élève'})
            </span>
            <Button variant="outline" onClick={logout}>
              <LogOut size={14} /> Déconnexion
            </Button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 280 }}>
            <label>
              <span className="sr-only">Nom d'utilisateur</span>
              <input
                aria-label="Nom d'utilisateur"
                value={username}
                onChange={e => setUsername(e.target.value)}
                style={{ ...inputStyle, width: '100%' }}
              />
            </label>
            <label>
              <span className="sr-only">Mot de passe</span>
              <input
                aria-label="Mot de passe"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ ...inputStyle, width: '100%' }}
              />
            </label>
            <Button
              onClick={() => void login(username, password)}
              disabled={status === 'connecting' || !serverUrl || !username || !password}
            >
              <LogIn size={14} /> Connexion
            </Button>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Dossier de synchronisation" description="Le dossier local dont le contenu est envoyé/reçu.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: syncFolderPath ? 'inherit' : 'var(--muted-foreground)' }}>
            {syncFolderPath ?? 'Aucun dossier choisi'}
          </span>
          <Button variant="outline" onClick={() => void pickSyncFolder()}>
            Choisir…
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title="Synchronisation">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button onClick={() => void syncNow()} disabled={status === 'syncing' || !currentUser || !syncFolderPath}>
            <RefreshCw size={14} /> {status === 'syncing' ? 'Synchronisation…' : 'Synchroniser'}
          </Button>
          {lastResult && (
            <span style={{ fontSize: 12.5, color: 'var(--muted-foreground)' }}>
              {lastResult.pushed} envoyé(s), {lastResult.pulled} reçu(s)
              {lastResult.errors.length > 0 ? `, ${lastResult.errors.length} erreur(s)` : ''}
            </span>
          )}
        </div>
        {lastResult && lastResult.errors.length > 0 && (
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--warning-fg)' }}>
            {lastResult.errors.map(err => (
              <li key={err.fileId}>{err.fileId} : {err.message}</li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--warning-fg)', marginTop: 8 }}>
            ⚠ {error}
          </p>
        )}
      </SettingsSection>
    </div>
  )
}
