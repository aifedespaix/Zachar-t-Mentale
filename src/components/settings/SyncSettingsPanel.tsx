import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { CloudSync, FolderOpen, LogIn, LogOut } from 'lucide-react'
import { useSyncStore } from '../../state/useSyncStore'
import { describeError } from '../../state/useWorkspaceStore'
import { syncResultLabel } from '../../sync/syncResultLabel'
import { revealSyncLog } from '../../persistence/syncLog'
import { SettingsSection } from './SettingsSection'
import { Button } from '../ui/button'

/**
 * A date a human can compare two of. PocketBase writes its own `updated` as
 * `2026-09-10 19:00:00.000Z` — a space instead of the `T` some engines refuse
 * to parse — so it is normalised before being handed to `Date`.
 */
function formatMoment(value: string): string {
  const parsed = new Date(value.replace(' ', 'T'))
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('fr-FR')
}

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
  const progress = useSyncStore(s => s.progress)
  const cancelSync = useSyncStore(s => s.cancelSync)
  const setServerUrl = useSyncStore(s => s.setServerUrl)
  const setSyncFolderPath = useSyncStore(s => s.setSyncFolderPath)
  const login = useSyncStore(s => s.login)
  const logout = useSyncStore(s => s.logout)
  const syncNow = useSyncStore(s => s.syncNow)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [serverUrlDraft, setServerUrlDraft] = useState(serverUrl)
  const [logPath, setLogPath] = useState<string | null>(null)
  const [logError, setLogError] = useState<string | null>(null)
  const [openingLogs, setOpeningLogs] = useState(false)
  useEffect(() => {
    setServerUrlDraft(serverUrl)
  }, [serverUrl])
  async function pickSyncFolder() {
    const selected = await open({ directory: true })
    if (typeof selected === 'string') await setSyncFolderPath(selected)
  }

  /**
   * Opens the log for the user — the file itself, or the folder that holds it
   * when nothing has been logged yet — and prints the path it revealed, so it
   * can be copied into a bug report.
   *
   * A failure is REPORTED, unlike the silent logging path: this one was asked
   * for by a click, and a button that does nothing is worse than an error.
   */
  async function openLogs() {
    setOpeningLogs(true)
    setLogError(null)
    try {
      setLogPath(await revealSyncLog())
    } catch (error) {
      setLogError(`Impossible d’ouvrir le dossier des logs : ${describeError(error)}`)
    } finally {
      setOpeningLogs(false)
    }
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
            <CloudSync size={14} />{' '}
            {status === 'syncing'
              ? progress === null
                ? 'Synchronisation…'
                : `Synchronisation ${progress.done}/${progress.total}…`
              : 'Synchroniser'}
          </Button>
          {status === 'syncing' && (
            <Button variant="outline" onClick={cancelSync}>
              Annuler
            </Button>
          )}
          {lastResult && (
            <span style={{ fontSize: 12.5, color: 'var(--muted-foreground)' }}>
              {syncResultLabel(lastResult)}
            </span>
          )}
        </div>
        {lastResult && lastResult.conflicts.length > 0 && (
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--warning-fg)' }}>
            {lastResult.conflicts.map(conflict => (
              <li key={conflict.fileId}>
                {conflict.path} : modifié ici le {formatMoment(conflict.localModified)} et sur le serveur le{' '}
                {formatMoment(conflict.remoteUpdated)} — rien n’a été écrasé, choisissez la version à garder.
              </li>
            ))}
          </ul>
        )}
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

      {/*
        « Ça ne marche pas » is answered by the log, so the screen that
        configures sync is the one that opens it — with the exact path printed
        beside the button, for a bug report written from another machine.
      */}
      <SettingsSection
        title="Journal"
        description="Chaque connexion et chaque synchronisation y laisse une ligne, réussie ou non."
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Button variant="outline" onClick={() => void openLogs()} disabled={openingLogs}>
            <FolderOpen size={14} /> Ouvrir le dossier des logs
          </Button>
          {logPath && (
            <span title={logPath} style={{ fontSize: 12, color: 'var(--muted-foreground)', wordBreak: 'break-all' }}>
              {logPath}
            </span>
          )}
        </div>
        {logError && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--warning-fg)', marginTop: 8 }}>
            ⚠ {logError}
          </p>
        )}
      </SettingsSection>
    </div>
  )
}
