import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { CloudSync, CloudUpload, Eraser, FileText, FolderOpen, LogIn, LogOut } from 'lucide-react'
import { useSyncStore } from '../../state/useSyncStore'
import { describeError } from '../../state/useWorkspaceStore'
import { syncResultLabel } from '../../sync/syncResultLabel'
import { formatRelativeTime } from '../../utils/relativeTime'
import { usePublishMindMap } from '../../hooks/usePublishMindMap'
import { clearSyncLog, openSyncLog, revealSyncLog } from '../../persistence/syncLog'
import { SettingsSection } from './SettingsSection'
import { SettingToggle } from './SettingToggle'
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
  const autoSyncOnLaunch = useSyncStore(s => s.autoSyncOnLaunch)
  const autoSyncIntervalMinutes = useSyncStore(s => s.autoSyncIntervalMinutes)
  const lastSuccessAt = useSyncStore(s => s.lastSuccessAt)
  const verboseLog = useSyncStore(s => s.verboseLog)
  const storedUsername = useSyncStore(s => s.username)
  const storedPassword = useSyncStore(s => s.password)
  const settingsProblem = useSyncStore(s => s.settingsProblem)
  const localOnlyCount = useSyncStore(s => s.localOnlyCount)
  const localOnlyPaths = useSyncStore(s => s.localOnlyPaths)
  const updateSettings = useSyncStore(s => s.updateSettings)
  const { publishAll } = usePublishMindMap()
  const setServerUrl = useSyncStore(s => s.setServerUrl)
  const setSyncFolderPath = useSyncStore(s => s.setSyncFolderPath)
  const login = useSyncStore(s => s.login)
  const logout = useSyncStore(s => s.logout)
  const syncNow = useSyncStore(s => s.syncNow)

  // Prefilled from what the last successful sign-in kept, so the common case —
  // reopening the app on the same machine — needs no typing at all.
  const [username, setUsername] = useState(storedUsername)
  const [password, setPassword] = useState(storedPassword)
  const [serverUrlDraft, setServerUrlDraft] = useState(serverUrl)
  const [logPath, setLogPath] = useState<string | null>(null)
  const [logError, setLogError] = useState<string | null>(null)
  const [logNotice, setLogNotice] = useState<string | null>(null)
  const [openingLogs, setOpeningLogs] = useState(false)
  const [clearingLog, setClearingLog] = useState(false)
  const [publishingLocal, setPublishingLocal] = useState(false)
  const [publishNotice, setPublishNotice] = useState<string | null>(null)
  useEffect(() => {
    setServerUrlDraft(serverUrl)
  }, [serverUrl])
  useEffect(() => {
    setUsername(storedUsername)
  }, [storedUsername])
  useEffect(() => {
    setPassword(storedPassword)
  }, [storedPassword])
  /**
   * Publishes every map of the sync folder that has no identity yet.
   *
   * This is the gesture behind the whole « 0 envoyé » mystery: a map with no
   * `meta` is invisible to the push loop, and nothing short of publishing it
   * will ever send it.
   */
  async function publishLocalMaps() {
    if (localOnlyPaths.length === 0) return
    setPublishingLocal(true)
    setPublishNotice(null)
    try {
      const { published, failed } = await publishAll(localOnlyPaths)
      setPublishNotice(
        failed === 0
          ? `${published} carte(s) publiée(s) : elles partiront à la prochaine synchronisation.`
          : `${published} carte(s) publiée(s), ${failed} en échec — voir le journal.`
      )
    } finally {
      setPublishingLocal(false)
    }
  }

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

  /** The file itself, for when the question is "what does it SAY". */
  async function openLogFile() {
    setLogError(null)
    setLogNotice(null)
    try {
      setLogPath(await openSyncLog())
    } catch (error) {
      setLogError(describeError(error))
    }
  }

  /**
   * Empties the log so the next attempt can be read on its own. The confirmation
   * is deliberately worded for both cases: clearing a file that does not exist
   * is not a failure.
   */
  async function clearLog() {
    setClearingLog(true)
    setLogError(null)
    setLogNotice(null)
    try {
      const cleared = await clearSyncLog()
      setLogNotice(cleared ? 'Journal vidé.' : 'Le journal était déjà vide.')
    } catch (error) {
      setLogError(`Impossible de vider le journal : ${describeError(error)}`)
    } finally {
      setClearingLog(false)
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
        {/*
          Said plainly rather than hidden: a password kept in clear text is the
          user's explicit choice here, and it must not be a surprise discovered
          by opening the config folder.
        */}
        <p style={{ fontSize: 11.5, color: 'var(--muted-foreground)', margin: '8px 0 0', lineHeight: 1.45 }}>
          L’adresse et les identifiants sont enregistrés en clair dans le dossier de configuration de
          l’application, pour que ce formulaire soit déjà rempli au prochain démarrage. Ils ne quittent
          jamais cet appareil, et jamais le dossier synchronisé.
        </p>
        {settingsProblem && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--warning-fg)', marginTop: 8 }}>
            ⚠ {settingsProblem}
          </p>
        )}
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

      <SettingsSection
        title="Automatique"
        description="Sans ces options, la synchronisation ne part que lorsque vous cliquez."
      >
        <SettingToggle
          label="Synchroniser au lancement"
          description="Une synchronisation dès que l’application s’ouvre, si vous êtes connecté."
          checked={autoSyncOnLaunch}
          onCheckedChange={checked => void updateSettings({ autoSyncOnLaunch: checked })}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <span style={{ flex: 1 }}>Synchroniser régulièrement</span>
          <select
            aria-label="Intervalle de synchronisation automatique"
            value={String(autoSyncIntervalMinutes)}
            onChange={event => void updateSettings({ autoSyncIntervalMinutes: Number(event.target.value) })}
            style={{ ...inputStyle, padding: '6px 8px' }}
          >
            <option value="0">jamais</option>
            <option value="5">toutes les 5 minutes</option>
            <option value="15">toutes les 15 minutes</option>
            <option value="30">toutes les 30 minutes</option>
            <option value="60">toutes les heures</option>
          </select>
        </label>
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
          {lastSuccessAt !== null && (
            <span style={{ fontSize: 12.5, color: 'var(--muted-foreground)' }}>
              dernière synchro {formatRelativeTime(lastSuccessAt) ?? 'inconnue'}
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
        {/*
          A sync that reports « 0 envoyé » while the folder is full of chapters
          needs an explanation, not a shrug: those maps have no sync identity, so
          the file loop skips them by design. One click gives them one.
        */}
        {localOnlyCount !== null && localOnlyCount > 0 && (
          <div
            style={{ marginTop: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10 }}
          >
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
              <strong>{localOnlyCount}</strong> carte{localOnlyCount > 1 ? 's' : ''} de ce dossier n’
              {localOnlyCount > 1 ? 'ont' : 'a'} pas encore d’identité de synchronisation : elle
              {localOnlyCount > 1 ? 's ne partent' : ' ne part'} jamais au serveur, même en cliquant
              « Synchroniser ».
            </p>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Button variant="outline" onClick={() => void publishLocalMaps()} disabled={publishingLocal}>
                <CloudUpload size={14} /> Publier ces {localOnlyCount} carte{localOnlyCount > 1 ? 's' : ''}
              </Button>
              {publishNotice && (
                <span role="status" style={{ fontSize: 12.5, color: 'var(--muted-foreground)' }}>
                  {publishNotice}
                </span>
              )}
            </div>
          </div>
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
          <Button variant="outline" onClick={() => void openLogFile()}>
            <FileText size={14} /> Ouvrir le journal
          </Button>
          <Button variant="outline" onClick={() => void clearLog()} disabled={clearingLog}>
            <Eraser size={14} /> Vider
          </Button>
          {logPath && (
            <span title={logPath} style={{ fontSize: 12, color: 'var(--muted-foreground)', wordBreak: 'break-all' }}>
              {logPath}
            </span>
          )}
        </div>
        {logNotice && (
          <p role="status" style={{ fontSize: 12.5, color: 'var(--muted-foreground)', marginTop: 8 }}>
            {logNotice}
          </p>
        )}
        {logError && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--warning-fg)', marginTop: 8 }}>
            ⚠ {logError}
          </p>
        )}
        <div style={{ marginTop: 10 }}>
          <SettingToggle
            label="Journal détaillé"
            description="Ajoute une ligne par fichier réellement envoyé ou reçu — utile quand les compteurs ne suffisent pas."
            checked={verboseLog}
            onCheckedChange={checked => void updateSettings({ verboseLog: checked })}
          />
        </div>
      </SettingsSection>
    </div>
  )
}
