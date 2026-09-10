#!/usr/bin/env node
/**
 * Configures a PocketBase server for Zachar't Mentale's sync feature.
 *
 * One command, run from any machine that can reach the server: everything it
 * does goes through the REST API with a superuser session, so the same script
 * covers a local instance (a `pocketbase serve`, or the Docker container's
 * published port) and the public HTTPS URL behind the tunnel.
 *
 *   bun run infra/setup-pocketbase.mjs --url https://cartes.mon-domaine.fr \
 *     --email admin@mon-domaine.fr --password '…'
 *
 * With an `infra/.env` (copy `infra/.env.example`) every flag can be omitted —
 * it is the same file the compose stack reads its superuser from.
 *
 * Idempotent by construction: it plans each collection against what the server
 * already has, and only writes when something differs. `--dry-run` prints that
 * plan and writes nothing.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID, randomBytes } from 'node:crypto'
import {
  USERS_COLLECTION,
  MIND_MAPS_COLLECTION,
  USERNAME_FIELD,
  desiredCollections,
  planCollection,
} from './pocketbase-schema.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENV_FILE = join(HERE, '.env')

export const HELP = `Configuration PocketBase pour la synchronisation des cartes mentales.

Usage :
  bun run infra/setup-pocketbase.mjs [options]

Options :
  --url <url>              URL du serveur (ex. https://cartes.mon-domaine.fr).
                           Sans http(s)://, une adresse locale (localhost, 127.0.0.1,
                           192.168.x…) est supposée en http, tout le reste en https.
  --email <email>          Email du superutilisateur PocketBase
  --password <motdepasse>  Mot de passe du superutilisateur
  --add-user <pseudo:role[:motdepasse]>
                           Crée (ou met à jour) un compte eleve/prof. Sans mot
                           de passe, un mot de passe solide est généré et affiché.
  --verify <pseudo:motdepasse>
                           Après configuration, se connecte avec ce compte et fait
                           un aller-retour réel sur cartes_mentales (écriture d'un
                           contenu long, relecture, suppression) pour prouver que
                           les champs et les règles acceptent le trafic de l'app.
  --dry-run                Montre ce qui serait changé, sans rien écrire.
  --insecure               Accepte un certificat TLS auto-signé (serveur local).
  --help                   Affiche cette aide.

Les valeurs absentes des options sont lues dans l'environnement, puis dans
infra/.env (PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD — les mêmes noms que
ceux lus par le conteneur Docker).
`

/** Raised for anything the operator can fix: bad arguments, bad credentials, an unreachable server. */
export class SetupError extends Error {}

/**
 * `KEY=VALUE` lines, `#` comments, optional surrounding quotes, optional
 * `export` prefix — the subset of dotenv syntax a `.env` written by hand
 * actually uses.
 */
export function parseEnv(text) {
  const values = {}
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).replace(/^export\s+/, '').trim()
    let value = line.slice(separator + 1).trim()
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
    if (quoted) value = value.slice(1, -1)
    values[key] = value
  }
  return values
}

/**
 * `pseudo:role[:motdepasse]`, the shape `--add-user` documents.
 *
 * The username is checked against the very pattern the schema puts on the
 * server field, so a typo is reported here in French instead of coming back as
 * an English PocketBase validation error halfway through the run.
 */
export function parseUserSpec(spec) {
  const [username, role, password] = String(spec).split(':')
  if (!username || !role) {
    throw new SetupError(`« ${spec} » n'est pas au format pseudo:role[:motdepasse] (ex. eleve1:eleve).`)
  }
  if (role !== 'eleve' && role !== 'prof') {
    throw new SetupError(`Rôle inconnu « ${role} » : attendu « eleve » ou « prof ».`)
  }
  if (!new RegExp(USERNAME_FIELD.pattern).test(username)) {
    throw new SetupError(
      `Pseudo « ${username} » invalide : lettres, chiffres, point, tiret et underscore uniquement.`
    )
  }
  return { username, role, ...(password ? { password } : {}) }
}

/** localhost, the loopback addresses and the private ranges — where a bare `host:port` means http. */
const LOCAL_ADDRESS =
  /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[::1\]|::1|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2})(?::\d+)?(?:\/|$)/i

/** Whether a host (with or without scheme) is one a school would reach on its own LAN. */
export function isLocalAddress(hostAndPath) {
  return LOCAL_ADDRESS.test(String(hostAndPath).replace(/^https?:\/\//i, ''))
}

/**
 * The URL as the PocketBase client needs it: a scheme (a bare
 * `cartes.mon-domaine.fr` typed into a shell is the commonest mistake) and no
 * trailing slash, which would otherwise produce `//api/...`.
 *
 * A bare LOCAL address gets `http://` — `--url 127.0.0.1:8090` is how one tests
 * against a container or a `pocketbase serve`, which have no certificate.
 * Everything else gets `https://`, since the public path goes through the
 * Cloudflare tunnel.
 */
export function normalizeUrl(url) {
  const trimmed = String(url).trim().replace(/\/+$/, '')
  if (trimmed === '') return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `${isLocalAddress(trimmed) ? 'http' : 'https'}://${trimmed}`
}

/**
 * A password for an account the operator did not want to choose one for: 16
 * base64url characters of CSPRNG output, printable and easy to dictate.
 */
export function generatePassword() {
  return randomBytes(12).toString('base64url')
}

export function parseArgs(argv) {
  const options = {
    url: '',
    email: '',
    password: '',
    users: [],
    verify: null,
    dryRun: false,
    insecure: false,
    help: false,
  }
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
      case '--add-user':
        options.users.push(parseUserSpec(value(index)))
        index += 1
        break
      case '--verify': {
        const spec = value(index)
        const separator = spec.indexOf(':')
        if (separator <= 0) throw new SetupError('--verify attend pseudo:motdepasse.')
        options.verify = { username: spec.slice(0, separator), password: spec.slice(separator + 1) }
        index += 1
        break
      }
      case '--dry-run':
        options.dryRun = true
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

/** CLI flags, then the environment, then `infra/.env` — the first value found wins. */
export function resolveConfig(options, environment = {}, envFileContents = null) {
  const file = envFileContents === null ? {} : parseEnv(envFileContents)
  const pick = (...keys) => {
    for (const key of keys) {
      const fromEnvironment = environment[key]
      if (typeof fromEnvironment === 'string' && fromEnvironment !== '') return fromEnvironment
      const fromFile = file[key]
      if (typeof fromFile === 'string' && fromFile !== '') return fromFile
    }
    return ''
  }
  return {
    ...options,
    url: normalizeUrl(options.url || pick('PB_URL', 'POCKETBASE_URL')),
    email: options.email || pick('PB_ADMIN_EMAIL', 'PB_EMAIL'),
    password: options.password || pick('PB_ADMIN_PASSWORD', 'PB_PASSWORD'),
  }
}

export function assertComplete(config) {
  const missing = []
  if (!config.url) missing.push('--url (ou PB_URL)')
  if (!config.email) missing.push('--email (ou PB_ADMIN_EMAIL)')
  if (!config.password) missing.push('--password (ou PB_ADMIN_PASSWORD)')
  if (missing.length > 0) {
    throw new SetupError(`Il manque : ${missing.join(', ')}.\n\n${HELP}`)
  }
}

/**
 * Applies every desired collection to the server behind `client`, then the
 * requested accounts, then the optional live check.
 *
 * The client is injected — that is what lets the whole orchestration be tested
 * against a fake, and what keeps this file free of PocketBase specifics.
 */
export async function runSetup(client, config, log = console.log) {
  const report = { dryRun: config.dryRun, collections: [], users: [], verification: null }
  const prefix = config.dryRun ? '[simulation] ' : ''

  const session = await client.auth()
  log(`${prefix}✓ Superutilisateur connecté : ${session.email}`)

  const existing = await client.listCollections()
  const byName = new Map(existing.map(collection => [collection.name, collection]))
  if (!byName.has(USERS_COLLECTION)) {
    throw new SetupError(
      `Ce serveur n'a pas de collection « ${USERS_COLLECTION} » : ce n'est pas une instance PocketBase.`
    )
  }

  for (const desired of desiredCollections()) {
    const current = byName.get(desired.name)
    const plan = planCollection(current, desired)
    report.collections.push({
      name: desired.name,
      status: current === undefined ? 'created' : plan.changes.length > 0 ? 'updated' : 'unchanged',
      changes: plan.changes,
    })
    if (plan.changes.length > 0) {
      log(`${prefix}~ ${desired.name} : ${plan.changes.join(' ; ')}`)
    } else {
      log(`${prefix}= ${desired.name} : déjà à jour`)
    }
    if (config.dryRun) continue
    if (plan.create !== undefined) await client.createCollection(plan.create)
    else if (plan.update !== undefined) await client.updateCollection(current.id, plan.update)
  }

  for (const user of config.users) {
    if (config.dryRun) {
      log(`${prefix}~ compte « ${user.username} » (${user.role}) créé ou mis à jour`)
      report.users.push({ ...user, outcome: 'planned' })
      continue
    }
    const result = await client.ensureUser(user)
    const pastTense = result.outcome === 'created' ? 'créé' : 'mis à jour'
    log(`${prefix}✓ compte « ${user.username} » (${user.role}) ${pastTense} — mot de passe : ${result.password}`)
    report.users.push({ ...user, outcome: result.outcome, password: result.password })
  }

  if (config.verify !== null && !config.dryRun) {
    const result = await client.verify(config.verify)
    report.verification = result
    log(
      `✓ vérification : ${result.contentLength} caractères écrits, relus puis supprimés par « ${config.verify.username} »`
    )
  }

  return report
}

function describeAuthError(error, url) {
  const status = error && typeof error === 'object' ? error.status : undefined
  if (status === 0) {
    // The one misconfiguration worth naming: a LAN address reached over https.
    const hint =
      /^https:\/\//i.test(url) && isLocalAddress(url)
        ? ' Un serveur local se joint en http:// (ou avec --insecure s’il a un certificat auto-signé).'
        : ''
    return `Serveur injoignable à l'adresse ${url}. Vérifiez l'URL et la connexion.${hint}`
  }
  if (status === 404) {
    return `Pas d'API superutilisateur sur ${url} : ce serveur est plus ancien que PocketBase 0.23, ou l'URL ne pointe pas sur PocketBase.`
  }
  if (status === 400) return `Email ou mot de passe superutilisateur refusé par ${url}.`
  return `Connexion à ${url} impossible (${error && error.message ? error.message : 'erreur inconnue'}).`
}

function describeApiError(error, action) {
  const status = error && typeof error === 'object' ? error.status : undefined
  const response = error && typeof error === 'object' ? error.response : undefined
  const details = response && typeof response === 'object' && response.data ? JSON.stringify(response.data) : ''
  const message = error && error.message ? error.message : 'erreur inconnue'
  return `${action} a échoué${status ? ` (${status})` : ''} : ${message}${details ? ` — ${details}` : ''}`
}

/**
 * The real thing: one superuser session, plus a second one when `--verify`
 * needs to speak as an ordinary account.
 */
export async function createPocketBaseSetupClient({ url, email, password, insecure = false }) {
  // Documented escape hatch for a LAN server with a self-signed certificate:
  // Node and Bun both honour this env var, and it is only set when the operator
  // asked for it explicitly.
  if (insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  const { default: PocketBase } = await import('pocketbase')

  const pb = new PocketBase(url)

  return {
    async auth() {
      try {
        await pb.collection('_superusers').authWithPassword(email, password)
      } catch (error) {
        throw new SetupError(describeAuthError(error, url))
      }
      if (pb.authStore.isSuperuser !== true) {
        throw new SetupError(`La session ouverte sur ${url} n'est pas une session superutilisateur.`)
      }
      return { email }
    },

    async listCollections() {
      try {
        return await pb.collections.getFullList()
      } catch (error) {
        throw new SetupError(describeApiError(error, 'La lecture des collections'))
      }
    },

    async createCollection(body) {
      try {
        return await pb.collections.create(body)
      } catch (error) {
        throw new SetupError(describeApiError(error, `La création de « ${body.name} »`))
      }
    },

    async updateCollection(id, body) {
      try {
        return await pb.collections.update(id, body)
      } catch (error) {
        throw new SetupError(describeApiError(error, 'La mise à jour de la collection'))
      }
    },

    async ensureUser({ username, role, password: wanted }) {
      const secret = wanted ?? generatePassword()
      const users = pb.collection(USERS_COLLECTION)
      let existingUser = null
      try {
        existingUser = await users.getFirstListItem(`username = ${JSON.stringify(username)}`)
      } catch {
        existingUser = null // 404: no such account yet, which is the normal first run.
      }
      const data = { password: secret, passwordConfirm: secret, role, verified: true }
      try {
        if (existingUser === null) {
          await users.create({ username, ...data })
          return { outcome: 'created', password: secret }
        }
        await users.update(existingUser.id, data)
        return { outcome: 'updated', password: secret }
      } catch (error) {
        throw new SetupError(describeApiError(error, `La création du compte « ${username} »`))
      }
    },

    /**
     * A real round-trip as an ordinary account, on a payload shaped like the
     * app's: writing more than 5000 characters into `content` is exactly what
     * proves the field's `max` survived, and doing it as a student is what
     * proves `createRule` lets a signed-in account publish. The record is
     * deleted as its author, through the same rule the app relies on.
     */
    async verify({ username, password: secret }) {
      const asUser = new PocketBase(url)
      try {
        await asUser.collection(USERS_COLLECTION).authWithPassword(username, secret)
      } catch (error) {
        throw new SetupError(describeAuthError(error, url))
      }
      const fileId = `verification-${randomUUID()}`
      const longText = 'vérification '.repeat(700)
      const content = JSON.stringify({
        meta: { id: fileId, author: username, role: 'eleve', lastModified: new Date().toISOString() },
        cards: [{ id: 'c1', level: 1, title: 'Vérification', definition: longText, parentId: null, order: 0 }],
      })
      const collection = asUser.collection(MIND_MAPS_COLLECTION)
      let created = null
      try {
        created = await collection.create({
          file_id: fileId,
          author: username,
          path: 'verification.zmap',
          content,
        })
        const read = await collection.getOne(created.id)
        if (read.content !== content) throw new SetupError('Le contenu relu diffère de celui écrit.')
      } catch (error) {
        if (error instanceof SetupError) throw error
        throw new SetupError(describeApiError(error, 'La vérification en compte utilisateur'))
      } finally {
        if (created !== null) await collection.delete(created.id).catch(() => {})
      }
      return { contentLength: content.length }
    },
  }
}

export function readEnvFile(path = ENV_FILE) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null // No infra/.env: the flags and the environment must carry everything.
  }
}

export async function main(argv) {
  const parsed = parseArgs(argv)
  if (parsed.help) {
    console.log(HELP)
    return 0
  }
  const config = resolveConfig(parsed, process.env, readEnvFile())
  assertComplete(config)
  const client = await createPocketBaseSetupClient(config)
  const report = await runSetup(client, config)
  const nothingToDo =
    report.users.length === 0 && report.collections.every(entry => entry.status === 'unchanged')
  if (config.dryRun) console.log('\nSimulation terminée : rien n’a été écrit (relancez sans --dry-run).')
  else if (nothingToDo) console.log('\nRien à faire : ce serveur est déjà configuré.')
  else console.log('\nConfiguration terminée. Dans l’application : Réglages → Synchronisation.')
  return 0
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    if (error instanceof SetupError) console.error(`\n✗ ${error.message}`)
    else console.error('\n✗ Échec inattendu :', error)
    process.exitCode = 1
  }
}
