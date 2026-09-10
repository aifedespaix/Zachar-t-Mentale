#!/usr/bin/env node
/**
 * PocketBase backups, on demand.
 *
 * The setup script turns PocketBase's own automatic backups on (its `cron` is
 * empty by default, i.e. none at all), which covers the everyday case. This one
 * is for the moment BEFORE an image upgrade: take a backup now, keep it on your
 * machine, and restore it if the new version turns out badly.
 *
 *   bun run infra/backup-pocketbase.mjs                  # crée et télécharge
 *   bun run infra/backup-pocketbase.mjs --list           # ce que le serveur garde
 *   bun run infra/backup-pocketbase.mjs --restore <clé> --yes
 *
 * Same settings as the setup script (flags, environment, then `infra/.env`).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  assertComplete,
  normalizeUrl,
  readEnvFile,
  resolveConfig,
  setupErrorForAuth,
  SetupError,
} from './setup-pocketbase.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

export const DEFAULT_BACKUP_DIR = join(HERE, 'backups')

export const HELP = `Sauvegardes PocketBase.

Usage : bun run infra/backup-pocketbase.mjs [options]

Options :
  --url <url>              URL du serveur (sinon PB_URL, puis infra/.env)
  --email <email>          Email du superutilisateur (sinon PB_ADMIN_EMAIL)
  --password <motdepasse>  Mot de passe du superutilisateur (sinon PB_ADMIN_PASSWORD)
  --out <dossier>          Où écrire la sauvegarde (défaut : infra/backups)
  --list                   Liste les sauvegardes du serveur, sans rien créer
  --restore <clé>          RESTAURE une sauvegarde : remplace toutes les données
                           du serveur. Exige --yes.
  --yes                    Confirme l'opération destructive de --restore
  --insecure               Accepte un certificat TLS auto-signé (serveur local)
  --help                   Affiche cette aide
`

export function parseBackupArgs(argv) {
  const options = { url: '', email: '', password: '', out: DEFAULT_BACKUP_DIR, list: false, restore: null, yes: false, insecure: false, help: false }
  const value = index => {
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      throw new SetupError(`Option ${argv[index]} : valeur manquante.`)
    }
    return next
  }
  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case '--url':
        options.url = value(index)
        index += 1
        break
      case '--email':
        options.email = value(index)
        index += 1
        break
      case '--password':
        options.password = value(index)
        index += 1
        break
      case '--out':
        options.out = value(index)
        index += 1
        break
      case '--restore':
        options.restore = value(index)
        index += 1
        break
      case '--list':
        options.list = true
        break
      case '--yes':
        options.yes = true
        break
      case '--insecure':
        options.insecure = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        throw new SetupError(`Option inconnue : ${argv[index]} (essayez --help).`)
    }
  }
  return options
}

/**
 * What to call the backup we are about to ask for.
 *
 * Learned the hard way: PocketBase validates the name itself, insists on a
 * LOWERCASE one and on the `.zip` extension being part of it — an ISO
 * timestamp with its `T` and `Z`, or a name without the extension, is refused
 * with "Must be in a valid format". So the timestamp is compacted to digits and
 * dashes, and the extension is spelled out here.
 */
export function backupBasename(at = new Date()) {
  const compact = at.toISOString().replace(/[:.]/g, '').replace('T', '-').replace('Z', '')
  return `zachart-${compact}.zip`
}

export function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mio`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} Kio`
  return `${bytes} octets`
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Waits for a freshly requested backup to show up in the list: `create()`
 * returns as soon as the job is queued, not when the file exists.
 */
export async function waitForBackup(client, key, { attempts = 30, delayMs = 1000, pause = sleep } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const entry = (await client.listBackups()).find(candidate => candidate.key === key)
    if (entry !== undefined) return entry
    await pause(delayMs)
  }
  throw new SetupError(`La sauvegarde ${key} n'est pas apparue sur le serveur (délai dépassé).`, 2)
}

/** The whole operation, with the PocketBase client injected so it can be tested. */
export async function runBackup(client, options, log = console.log) {
  const session = await client.auth()
  log(`✓ Superutilisateur connecté : ${session.email}`)

  if (options.list) {
    const entries = await client.listBackups()
    if (entries.length === 0) log('Aucune sauvegarde sur le serveur.')
    for (const entry of entries) log(`  ${entry.key}  ${formatSize(entry.size)}`)
    return { listed: entries }
  }

  if (options.restore !== null) {
    if (!options.yes) {
      throw new SetupError(
        'La restauration remplace TOUTES les données du serveur (cartes, comptes, réglages). Relancez avec --yes si c’est bien ce que vous voulez.'
      )
    }
    await client.restoreBackup(options.restore)
    log(`✓ Restauration demandée depuis ${options.restore} : PocketBase s’arrête, remplace ses données, puis redémarre.`)
    return { restored: options.restore }
  }

  const basename = backupBasename()
  const key = await client.createBackup(basename)
  log(`… sauvegarde ${key} en cours`)
  const entry = await waitForBackup(client, key)
  const written = await client.downloadBackup(key, options.out)
  log(`✓ ${written.path} (${formatSize(written.size)})`)
  return { key, ...written }
}

export async function main(argv) {
  const parsed = parseBackupArgs(argv)
  if (parsed.help) {
    console.log(HELP)
    return 0
  }
  const config = resolveConfig(parsed, process.env, readEnvFile())
  assertComplete(config)
  const client = await createBackupClient(config)
  await runBackup(client, config)
  return 0
}

/** A PocketBase client narrowed to the backup API, with French, coded failures. */
export async function createBackupClient({ url, email, password, insecure = false }) {
  if (insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  const { default: PocketBase } = await import('pocketbase')
  const pb = new PocketBase(normalizeUrl(url))

  const guard = (action, error) => {
    if (error instanceof SetupError) throw error
    const status = error && typeof error === 'object' ? error.status : undefined
    throw new SetupError(`${action} a échoué${status ? ` (${status})` : ''} : ${error?.message ?? 'erreur inconnue'}`, 2)
  }

  return {
    async auth() {
      try {
        await pb.collection('_superusers').authWithPassword(email, password)
      } catch (error) {
        throw setupErrorForAuth(error, pb.baseURL)
      }
      return { email }
    },
    async listBackups() {
      try {
        return (await pb.backups.getFullList()).map(entry => ({ key: entry.key, size: entry.size, modified: entry.modified }))
      } catch (error) {
        return guard('La liste des sauvegardes', error)
      }
    },
    async createBackup(basename) {
      try {
        // The name IS the key PocketBase answers with, extension included.
        await pb.backups.create(basename)
        return basename
      } catch (error) {
        return guard('La création de la sauvegarde', error)
      }
    },
    async downloadBackup(key, out) {
      try {
        const token = await pb.files.getToken()
        const response = await fetch(pb.backups.getDownloadURL(token, key))
        if (!response.ok) throw new SetupError(`Téléchargement refusé par le serveur (${response.status}).`, 2)
        const bytes = new Uint8Array(await response.arrayBuffer())
        await mkdir(out, { recursive: true })
        const path = join(out, key)
        await writeFile(path, bytes)
        return { path, size: bytes.length }
      } catch (error) {
        return guard('Le téléchargement de la sauvegarde', error)
      }
    },
    async restoreBackup(key) {
      try {
        await pb.backups.restore(key)
      } catch (error) {
        return guard('La restauration', error)
      }
    },
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    if (error instanceof SetupError) {
      console.error(`\n✗ ${error.message}`)
      process.exitCode = error.code
    } else {
      console.error('\n✗ Échec inattendu :', error)
      process.exitCode = 1
    }
  }
}
