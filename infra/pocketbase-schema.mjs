/**
 * The PocketBase half of the sync feature, as data.
 *
 * `setup-pocketbase.mjs` applies this to a server, its tests check the diffing
 * without one, and both read the SAME definition — so the documentation, the
 * script and the tests cannot drift apart.
 *
 * Targets the PocketBase >= 0.23 collections API (the app ships
 * `pocketbase@0.28`, which speaks the v0.40 endpoint set): fields live in
 * `fields` (not the old `schema`), and a text field has NO `unique` option —
 * uniqueness is a collection `indexes` entry. Getting that wrong is silent:
 * the collection still saves, the constraint just is not there.
 */

export const USERS_COLLECTION = 'users'
export const MIND_MAPS_COLLECTION = 'cartes_mentales'
export const ASSETS_COLLECTION = 'assets'

/**
 * The app's own ceiling for one image (`MAX_ASSET_BYTES` in
 * `src/persistence/assets.ts`). PocketBase's file field defaults to 5 MiB
 * (`DefaultFileFieldMaxSize` in `core/field_file.go`), so leaving it alone
 * would reject pictures the app stored locally without complaint.
 */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024

/**
 * The length a text field accepts when its `max` is left at 0 — PocketBase
 * substitutes 5000 ("If zero, a default limit of 5000 is applied",
 * `core/field_text.go`). A whole mind map serialized into `content` blows past
 * that as soon as a chapter carries a few cards, which is the single most
 * important option in this file: without it, every push eventually fails with
 * "Must be no more than 5000 character(s)".
 */
export const TEXT_MAX = 5_000_000

/**
 * PocketBase's own defaults are `cron: ""` — NO automatic backup at all — and
 * `cronMaxKeep: 3`. A self-hosted school server that nobody tends therefore has
 * nothing to restore from until someone thinks about it, which is exactly the
 * kind of thing a setup script should settle once.
 */
export const DEFAULT_BACKUP_CRON = '0 3 * * *'
export const DEFAULT_BACKUP_KEEP = 7

/**
 * What it would take to make the backup settings match. Everything not named
 * here (the S3 destination above all) is the operator's and is carried over.
 *
 * @returns {{ update?: object, changes: string[] }}
 */
export function planBackups(current, desired = {}) {
  const wanted = {
    cron: desired.cron ?? DEFAULT_BACKUP_CRON,
    cronMaxKeep: desired.cronMaxKeep ?? DEFAULT_BACKUP_KEEP,
  }
  const changes = []
  if ((current?.cron ?? '') !== wanted.cron) {
    changes.push(
      `planification « ${current?.cron || 'désactivées'} » → « ${wanted.cron} »`
    )
  }
  if ((current?.cronMaxKeep ?? 0) !== wanted.cronMaxKeep) {
    changes.push(`conservées : ${current?.cronMaxKeep ?? 0} → ${wanted.cronMaxKeep}`)
  }
  if (changes.length === 0) return { changes: [] }
  return { update: { backups: { ...current, ...wanted } }, changes }
}

/** The rules the app's traffic needs. Empty string = public, `null` = superusers only. */
export const MIND_MAP_RULES = {
  // Reading is public: the whole point is that every account on the server can
  // see the shared library, and the app never writes anything it did not author.
  listRule: '',
  viewRule: '',
  // Any signed-in account may publish a file…
  createRule: '@request.auth.id != ""',
  // …but only the author may touch it afterwards. This pair IS the fork model:
  // it is what makes a non-authored file read-only in every client.
  updateRule: '@request.auth.username = author',
  deleteRule: '@request.auth.username = author',
}

export const ASSET_RULES = {
  listRule: '',
  viewRule: '',
  createRule: '@request.auth.id != ""',
  // Content-addressed: an asset is written once and never updated or deleted.
  updateRule: null,
  deleteRule: null,
}

/**
 * `help` is written to the server so the dashboard explains each field to
 * whoever opens the collections later — the documentation travels with the
 * schema instead of living only in this repository.
 */
export const MIND_MAP_FIELDS = [
  {
    name: 'file_id',
    type: 'text',
    required: true,
    min: 1,
    max: 255,
    help: 'Identifiant de synchronisation du fichier (meta.id du .zmap). Unique.',
  },
  {
    name: 'author',
    type: 'text',
    required: true,
    min: 1,
    max: 255,
    help: 'Nom d’utilisateur de l’auteur : lui seul peut modifier cet enregistrement.',
  },
  { name: 'path', type: 'text', required: true, min: 1, max: 1024, help: 'Chemin relatif depuis la racine du dossier synchronisé.' },
  { name: 'content', type: 'text', required: true, min: 0, max: TEXT_MAX, help: 'Le .zmap entier, sérialisé (JSON). Un max à 0 le plafonnerait à 5000 caractères : ne pas y toucher.' },
]

export const ASSET_FIELDS = [
  {
    name: 'hash',
    type: 'text',
    required: true,
    min: 1,
    max: 255,
    help: 'Empreinte du contenu de l’image : c’est le nom sous lequel le fichier est adressé.',
  },
  { name: 'extension', type: 'text', required: true, min: 1, max: 16, help: 'Extension du fichier (png, jpg, …).' },
  {
    name: 'file',
    type: 'file',
    required: true,
    maxSelect: 1,
    maxSize: MAX_ASSET_BYTES,
    mimeTypes: [],
    thumbs: [],
    help: 'L’image elle-même. Jamais modifiée après création.',
  },
]

/**
 * The login identifier the app asks for — and which PocketBase >= 0.23 does NOT
 * ship: its built-in `users` collection authenticates by EMAIL by default
 * (fields: id, password, tokenKey, email, emailVisibility, verified, name,
 * avatar, …). Configuring `passwordAuth.identityFields = ['username']` without
 * adding this field first fails with "Invalid or missing field username", which
 * is exactly what the old manual instructions asked an operator to do.
 *
 * The pattern keeps usernames to characters that are safe in an API filter and
 * in a filename: the whole fork model compares `@request.auth.username = author`.
 */
export const USERNAME_FIELD = {
  name: 'username',
  type: 'text',
  required: true,
  min: 1,
  max: 255,
  pattern: '^[a-zA-Z0-9_.-]+$',
  autogeneratePattern: '[a-z0-9]{10}',
  help: 'Identifiant de connexion (celui que l’app demande). Créé par le script d’installation.',
}

/**
 * The built-in email is made optional: the app authenticates by username, and
 * PocketBase would otherwise refuse an account created without one.
 */
export const EMAIL_FIELD_OVERRIDE = {
  name: 'email',
  type: 'email',
  required: false,
  help: 'Facultatif : l’application se connecte avec le pseudo, pas l’email.',
}

/** The `role` added to PocketBase's built-in auth collection — a display label, never a permission. */
export const ROLE_FIELD = {
  name: 'role',
  type: 'select',
  required: true,
  maxSelect: 1,
  values: ['eleve', 'prof'],
}

export const MIND_MAP_INDEXES = [
  'CREATE UNIQUE INDEX `idx_cartes_mentales_file_id` ON `cartes_mentales` (`file_id`)',
]

export const ASSET_INDEXES = ['CREATE UNIQUE INDEX `idx_assets_hash` ON `assets` (`hash`)']

/** Partial, like PocketBase's own unique email index, so legacy empty values cannot collide. */
export const USERNAME_INDEX = [
  "CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`) WHERE `username` != ''",
]

const utf8 = { type: 'text' }

/**
 * What the server should end up looking like. `kind: 'auth'` entries only ever
 * ADD to PocketBase's built-in collection (its system fields are the server's,
 * not ours) and set the auth options the app logs in with.
 */
export function desiredCollections() {
  return [
    {
      name: MIND_MAPS_COLLECTION,
      kind: 'base',
      fields: MIND_MAP_FIELDS,
      indexes: MIND_MAP_INDEXES,
      rules: MIND_MAP_RULES,
    },
    {
      name: ASSETS_COLLECTION,
      kind: 'base',
      fields: ASSET_FIELDS,
      indexes: ASSET_INDEXES,
      rules: ASSET_RULES,
    },
    {
      name: USERS_COLLECTION,
      kind: 'auth',
      fields: [USERNAME_FIELD, EMAIL_FIELD_OVERRIDE, ROLE_FIELD],
      indexes: USERNAME_INDEX,
      // The app signs in with the username, never an email address.
      auth: { passwordAuth: { enabled: true, identityFields: ['username'] } },
      // PocketBase ships this rule as "" — i.e. ANYONE may create an account
      // over the API. The app has no sign-up screen, so the script closes it:
      // accounts come from here, or from the dashboard.
      rules: { createRule: null },
    },
  ]
}

/** The options the script owns on a field it manages — the only ones it reports and rewrites. */
const OWNED_OPTIONS = [
  'required',
  'presentable',
  'min',
  'max',
  'pattern',
  'maxSelect',
  'maxSize',
  'mimeTypes',
  'thumbs',
  'values',
  'help',
  'autogeneratePattern',
]

function sameJson(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** `max 0 → 5000000`, for the dry-run report. */
function optionLabel(value) {
  if (Array.isArray(value)) return `[${value.join(', ')}]`
  if (value === null || value === undefined || value === '') return '(vide)'
  return String(value)
}

/** Every option where `desired` differs from `current`, as human-readable strings. */
export function fieldOptionDeltas(current, desired) {
  const deltas = []
  for (const option of OWNED_OPTIONS) {
    if (!(option in desired)) continue
    if (sameJson(current?.[option], desired[option])) continue
    deltas.push(`${option} ${optionLabel(current?.[option])} → ${optionLabel(desired[option])}`)
  }
  return deltas
}

/**
 * `current` with the options WE own replaced by the desired ones, and the
 * desired fields we do not find appended.
 *
 * Existing fields keep their `id`: the collections API matches fields by id, so
 * re-sending one without it would ADD a second field with the same name instead
 * of updating the first. Fields we do not describe (the auth collection's
 * system fields, anything the operator added) are passed through untouched.
 */
export function mergeFields(currentFields, desiredFields) {
  const current = currentFields ?? []
  const desired = desiredFields ?? []
  const desiredByName = new Map(desired.map(field => [field.name, field]))
  const merged = current.map(field => {
    const wanted = desiredByName.get(field.name)
    return wanted === undefined ? field : { ...field, ...wanted, id: field.id }
  })
  const present = new Set(merged.map(field => field.name))
  for (const field of desired) if (!present.has(field.name)) merged.push(field)
  return merged
}

function indexColumns(sql) {
  // The column list, not "the last parentheses in the statement": PocketBase's
  // own indexes end with a `WHERE ...` clause (its users' email index is
  // `... (email) WHERE email != ''`), and reading those as "no columns" would
  // make every partial index look like every other one.
  const match = /\son\s+[`"]?[^`"\s(]+[`"]?\s*\(([^)]*)\)/i.exec(String(sql).trim())
  if (match === null) return ''
  return match[1]
    .split(',')
    .map(part => part.replace(/[`"\s]/g, '').toLowerCase())
    .sort()
    .join(',')
}

/** Two index statements that enforce the same thing, whatever they are named. */
export function sameIndexShape(a, b) {
  return indexColumns(a) === indexColumns(b) && /unique/i.test(a) === /unique/i.test(b)
}

function indexName(sql) {
  const match = /index\s+[`"]?([^`"\s(]+)/i.exec(sql)
  return match?.[1] ?? ''
}

/** Keeps PB from rejecting our index because an unrelated one already carries its name. */
function freeIndexName(sql, taken) {
  if (!taken.has(indexName(sql))) return sql
  for (let attempt = 2; attempt < 50; attempt += 1) {
    const candidate = sql.replace(/index\s+([`"]?)([^`"\s(]+)\1/i, (whole, quote, name) =>
      whole.replace(name, `${name}_${attempt}`)
    )
    if (!taken.has(indexName(candidate))) return candidate
  }
  return sql
}

/** The desired indexes, minus the ones the collection already enforces. */
export function mergeIndexes(currentIndexes, desiredIndexes) {
  const merged = [...(currentIndexes ?? [])]
  for (const sql of desiredIndexes ?? []) {
    if (merged.some(existing => sameIndexShape(existing, sql))) continue
    const candidate = freeIndexName(sql, new Set(merged.map(indexName)))
    merged.push(candidate)
  }
  return merged
}

function rulesEqual(current, rules) {
  return Object.entries(rules ?? {}).every(([key, value]) => sameJson(current?.[key], value))
}

function authEqual(current, auth) {
  return Object.entries(auth ?? {}).every(([key, value]) => sameJson(current?.[key], value))
}

/**
 * An EMPTY rule is public, and a NULL one is superusers-only — the pair is easy
 * to read backwards, and the report is the only place an operator sees which of
 * the two a collection ended up with.
 */
function ruleLabel(value) {
  if (value === null || value === undefined) return 'superutilisateurs uniquement'
  if (value === '') return 'publique'
  return `« ${value} »`
}

/**
 * What it would take to make `current` match `desired` — the whole decision
 * logic, pure, so `--dry-run` and the real run share it and the tests can check
 * it without a server.
 *
 * @returns {{ create?: object, update?: object, changes: string[] }}
 *   `create`/`update` are the request bodies to send; both absent means the
 *   collection is already exactly what it should be (the idempotent no-op).
 */
export function planCollection(current, desired) {
  const fields = mergeFields(current?.fields, desired.fields)
  const indexes = mergeIndexes(current?.indexes, desired.indexes)
  const wanted = { ...(desired.rules ?? {}), ...(desired.auth ?? {}) }

  if (current === undefined || current === null) {
    const body =
      desired.kind === 'auth'
        ? { name: desired.name, type: 'auth', fields: desired.fields ?? [], ...wanted }
        : {
            name: desired.name,
            type: 'base',
            fields: desired.fields ?? [],
            indexes: desired.indexes ?? [],
            ...wanted,
          }
    return { create: body, changes: [`collection « ${desired.name} » créée`] }
  }

  const changes = []
  for (const field of desired.fields ?? []) {
    const before = (current.fields ?? []).find(entry => entry.name === field.name)
    if (before === undefined) {
      changes.push(`champ « ${field.name} » ajouté (${field.type})`)
      continue
    }
    const deltas = fieldOptionDeltas(before, field)
    if (deltas.length > 0) changes.push(`champ « ${field.name} » : ${deltas.join(', ')}`)
  }
  for (const sql of desired.indexes ?? []) {
    if (!(current.indexes ?? []).some(existing => sameIndexShape(existing, sql))) {
      changes.push(`index unique ajouté sur ${indexColumns(sql)}`)
    } else if (!(current.indexes ?? []).includes(sql)) {
      // Same shape, different statement: nothing to do, and nothing to report.
      continue
    }
  }
  for (const [key, value] of Object.entries(desired.rules ?? {})) {
    if (!sameJson(current[key], value)) changes.push(`règle ${key} → ${ruleLabel(value)}`)
  }
  for (const [key, value] of Object.entries(desired.auth ?? {})) {
    if (!authEqual(current[key], value)) changes.push(`${key} → ${JSON.stringify(value)}`)
  }

  if (changes.length === 0) return { changes: [] }
  return { update: { fields, indexes, ...wanted }, changes }
}
