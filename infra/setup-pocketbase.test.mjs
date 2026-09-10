import { describe, it, expect, vi } from 'vitest'
import {
  assertComplete,
  generatePassword,
  normalizeUrl,
  parseArgs,
  parseEnv,
  parseUserSpec,
  resolveConfig,
  runSetup,
  SetupError,
} from './setup-pocketbase.mjs'
import {
  ASSETS_COLLECTION,
  MIND_MAPS_COLLECTION,
  USERS_COLLECTION,
  desiredCollections,
  fieldOptionDeltas,
  mergeFields,
  mergeIndexes,
  planCollection,
  sameIndexShape,
} from './pocketbase-schema.mjs'

const DEFAULT_USERS = {
  id: 'id-users',
  name: USERS_COLLECTION,
  type: 'auth',
  fields: [{ id: 'u1', name: 'email', type: 'email', required: true, system: true }],
  indexes: [],
  passwordAuth: { enabled: true, identityFields: ['email'] },
  createRule: '',
}

/**
 * The collections as `listCollections()` would report them, evolved by a fake
 * apply. PocketBase always ships `users`, so it is seeded by default and only
 * left out to exercise the "this is not a PocketBase" path.
 */
function fakeClient({ initial = [], withUsers = true } = {}) {
  const collections = structuredClone(withUsers ? [DEFAULT_USERS, ...initial] : initial)
  let users = new Map()
  return {
    collections,
    users,
    auth: vi.fn().mockResolvedValue({ email: 'admin@test.local' }),
    listCollections: vi.fn(async () => structuredClone(collections)),
    createCollection: vi.fn(async body => {
      const created = { id: `id-${body.name}`, ...structuredClone(body) }
      collections.push(created)
      return created
    }),
    updateCollection: vi.fn(async (id, body) => {
      const index = collections.findIndex(entry => entry.id === id)
      collections[index] = { ...collections[index], ...structuredClone(body) }
      return collections[index]
    }),
    ensureUser: vi.fn(async user => ({ outcome: 'created', password: user.password ?? 'généré' })),
    verify: vi.fn(async () => ({ contentLength: 9339 })),
  }
}

const config = { url: 'http://127.0.0.1:8090', email: 'admin@test.local', password: 'secret', users: [], verify: null, dryRun: false }
const silent = () => {}

describe('parseEnv', () => {
  it('reads KEY=VALUE pairs, ignoring comments and blank lines', () => {
    const parsed = parseEnv('# commentaire\n\nPB_URL=https://cartes.test\nPB_ADMIN_EMAIL=admin@test\n')
    expect(parsed).toEqual({ PB_URL: 'https://cartes.test', PB_ADMIN_EMAIL: 'admin@test' })
  })

  it('strips quotes, an export prefix and surrounding spaces', () => {
    const parsed = parseEnv("  export PB_ADMIN_PASSWORD = 'mot de passe'  \nPB_URL=\"http://127.0.0.1:8090\"")
    expect(parsed).toEqual({ PB_ADMIN_PASSWORD: 'mot de passe', PB_URL: 'http://127.0.0.1:8090' })
  })

  it('keeps a value containing = and # intact', () => {
    expect(parseEnv('PB_ADMIN_PASSWORD=a=b#c')).toEqual({ PB_ADMIN_PASSWORD: 'a=b#c' })
  })
})

describe('parseUserSpec', () => {
  it('reads pseudo, role and an optional password', () => {
    expect(parseUserSpec('eleve1:eleve')).toEqual({ username: 'eleve1', role: 'eleve' })
    expect(parseUserSpec('prof.1:prof:secret')).toEqual({ username: 'prof.1', role: 'prof', password: 'secret' })
  })

  it('names the accepted roles when the role is wrong', () => {
    expect(() => parseUserSpec('eleve1:student')).toThrow(/eleve/)
  })

  it('rejects a username the server-side pattern would refuse, without calling the API', () => {
    expect(() => parseUserSpec('élève 1:eleve')).toThrow(SetupError)
    expect(() => parseUserSpec('élève 1:eleve')).toThrow(/invalide/)
  })

  it('rejects a spec missing its role', () => {
    expect(() => parseUserSpec('eleve1')).toThrow(/pseudo:role/)
  })
})

describe('parseArgs', () => {
  it('collects repeated --add-user flags', () => {
    const parsed = parseArgs(['--url', 'https://a.test', '--add-user', 'e1:eleve', '--add-user', 'p1:prof'])
    expect(parsed.url).toBe('https://a.test')
    expect(parsed.users).toEqual([
      { username: 'e1', role: 'eleve' },
      { username: 'p1', role: 'prof' },
    ])
  })

  it('splits --verify on its first colon, so a password may contain one', () => {
    expect(parseArgs(['--verify', 'e1:a:b']).verify).toEqual({ username: 'e1', password: 'a:b' })
  })

  it('refuses an unknown option instead of ignoring it', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/inconnue/)
  })

  it('refuses a flag left without its value', () => {
    expect(() => parseArgs(['--url'])).toThrow(/valeur manquante/)
    expect(() => parseArgs(['--url', '--dry-run'])).toThrow(/valeur manquante/)
  })
})

describe('resolveConfig', () => {
  it('prefers the flag, then the environment, then infra/.env', () => {
    const resolved = resolveConfig(
      { url: 'https://flag.test', email: '', password: '' },
      { PB_ADMIN_EMAIL: 'env@test' },
      'PB_ADMIN_EMAIL=file@test\nPB_ADMIN_PASSWORD=depuis-fichier\nPB_URL=https://fichier.test'
    )
    expect(resolved.url).toBe('https://flag.test')
    expect(resolved.email).toBe('env@test')
    expect(resolved.password).toBe('depuis-fichier')
  })

  it('normalises a bare host: https in public, http on a LAN', () => {
    expect(normalizeUrl('cartes.mon-domaine.fr')).toBe('https://cartes.mon-domaine.fr')
    expect(normalizeUrl('127.0.0.1:8090')).toBe('http://127.0.0.1:8090')
    expect(normalizeUrl('localhost:8090')).toBe('http://localhost:8090')
    expect(normalizeUrl('192.168.1.10:8090')).toBe('http://192.168.1.10:8090')
    expect(normalizeUrl('http://127.0.0.1:8090/')).toBe('http://127.0.0.1:8090')
    expect(normalizeUrl('  https://cartes.test/  ')).toBe('https://cartes.test')
    expect(normalizeUrl('')).toBe('')
  })

  it('lists every missing piece at once', () => {
    expect(() => assertComplete({ url: '', email: 'a', password: 'b' })).toThrow(/PB_URL/)
    expect(() => assertComplete({ url: 'https://a', email: 'a', password: 'b' })).not.toThrow()
  })

  it('generates a distinct, non-trivial password', () => {
    const first = generatePassword()
    expect(first).toHaveLength(16)
    expect(first).not.toBe(generatePassword())
  })
})

describe('mergeFields', () => {
  const existing = [
    { id: 'f1', name: 'id', type: 'text', system: true },
    { id: 'f2', name: 'content', type: 'text', max: 0, help: '' },
    { id: 'f3', name: 'classe', type: 'text' },
  ]

  it('keeps every field the schema does not describe, in order', () => {
    const merged = mergeFields(existing, [{ name: 'content', type: 'text', max: 5000 }])
    expect(merged.map(field => field.name)).toEqual(['id', 'content', 'classe'])
    expect(merged[1]).toMatchObject({ max: 5000, id: 'f2' })
  })

  it('preserves the server-side id, which is what makes an update an update', () => {
    const merged = mergeFields(existing, [{ name: 'content', type: 'text', max: 5000 }])
    expect(merged[1].id).toBe('f2')
  })

  it('appends the fields the collection does not have yet, without inventing an id', () => {
    const merged = mergeFields(existing, [{ name: 'role', type: 'select', values: ['eleve', 'prof'] }])
    expect(merged.map(field => field.name)).toEqual(['id', 'content', 'classe', 'role'])
    expect(merged[3].id).toBeUndefined()
  })

  it('reports only the options it owns, so a dry-run stays readable', () => {
    // The "0" is worth showing: it is PocketBase's own 5000-character default,
    // and seeing it replaced is the whole point of this line.
    expect(fieldOptionDeltas({ max: 0, min: 0 }, { name: 'content', type: 'text', max: 5_000_000 })).toEqual([
      'max 0 → 5000000',
    ])
    expect(fieldOptionDeltas({ max: 5_000_000 }, { name: 'content', max: 5_000_000 })).toEqual([])
  })
})

describe('mergeIndexes', () => {
  it('does not add an index the collection already enforces, whatever its name', () => {
    const existing = ['CREATE UNIQUE INDEX "another_name" ON "cartes_mentales" (file_id)']
    const merged = mergeIndexes(existing, ['CREATE UNIQUE INDEX `idx_cartes_mentales_file_id` ON `cartes_mentales` (`file_id`)'])
    expect(merged).toEqual(existing)
  })

  it('compares partial indexes by their columns, not by their trailing WHERE clause', () => {
    const withWhere = "CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`) WHERE `username` != ''"
    expect(sameIndexShape(withWhere, 'CREATE UNIQUE INDEX x ON users (username)')).toBe(true)
    expect(sameIndexShape(withWhere, 'CREATE INDEX x ON users (email) WHERE email != \'\'')).toBe(false)
  })

  it('renames an index whose name is already taken, instead of failing the whole update', () => {
    const merged = mergeIndexes(
      ['CREATE INDEX `idx_assets_hash` ON `assets` (`author`)'],
      ['CREATE UNIQUE INDEX `idx_assets_hash` ON `assets` (`hash`)']
    )
    expect(merged).toHaveLength(2)
    expect(merged[1]).toContain('idx_assets_hash_2')
  })
})

describe('planCollection', () => {
  it('creates a collection that does not exist, fields and rules included', () => {
    const desired = desiredCollections().find(entry => entry.name === MIND_MAPS_COLLECTION)
    const plan = planCollection(undefined, desired)
    expect(plan.create).toMatchObject({ name: MIND_MAPS_COLLECTION, type: 'base' })
    expect(plan.create.fields.map(field => field.name)).toEqual(['file_id', 'author', 'path', 'content'])
    expect(plan.create.updateRule).toBe('@request.auth.username = author')
    expect(plan.changes).toEqual(['collection « cartes_mentales » créée'])
  })

  it('is a no-op against a collection it already configured — the idempotence the script promises', () => {
    const client = fakeClient()
    let desired = desiredCollections().find(entry => entry.name === MIND_MAPS_COLLECTION)
    const created = planCollection(undefined, desired).create
    const applied = { id: 'id-1', ...created, fields: created.fields.map((field, index) => ({ id: `f${index}`, ...field })) }
    expect(planCollection(applied, desired).changes).toEqual([])
    expect(planCollection(applied, desired).update).toBeUndefined()
    void client
  })

  it('upgrades a text field the old manual setup left capped at 5000 characters', () => {
    const desired = desiredCollections().find(entry => entry.name === MIND_MAPS_COLLECTION)
    const current = {
      id: 'id-1',
      name: MIND_MAPS_COLLECTION,
      fields: [{ id: 'f9', name: 'content', type: 'text', required: true, max: 0 }],
      indexes: [],
      listRule: '',
      viewRule: '',
      createRule: '@request.auth.id != ""',
    }
    const plan = planCollection(current, desired)
    expect(plan.changes.join(' ')).toMatch(/content.*max/)
    expect(plan.update.fields.find(field => field.name === 'content')).toMatchObject({ id: 'f9', max: 5_000_000 })
  })

  it('says a rule the operator loosened is about to be put back', () => {
    const desired = desiredCollections().find(entry => entry.name === ASSETS_COLLECTION)
    const current = { id: 'id-2', name: ASSETS_COLLECTION, fields: [], indexes: [], listRule: 'id = @request.auth.id' }
    expect(planCollection(current, desired).changes).toContain('règle listRule → publique')
  })

  it('describes closing a public sign-up rule as superusers-only, not the other way round', () => {
    const desired = desiredCollections().find(entry => entry.name === USERS_COLLECTION)
    const current = { id: 'id-3', name: USERS_COLLECTION, fields: [], indexes: [], createRule: '' }
    expect(planCollection(current, desired).changes).toContain('règle createRule → superutilisateurs uniquement')
  })
})

describe('runSetup', () => {
  it('creates every collection, then reports what it did', async () => {
    const client = fakeClient()
    const report = await runSetup(client, config, silent)

    expect(client.auth).toHaveBeenCalled()
    expect(client.createCollection).toHaveBeenCalledTimes(2)
    expect(client.updateCollection).toHaveBeenCalledTimes(1) // users only
    expect(report.collections.map(entry => [entry.name, entry.status])).toEqual([
      [MIND_MAPS_COLLECTION, 'created'],
      [ASSETS_COLLECTION, 'created'],
      [USERS_COLLECTION, 'updated'],
    ])
  })

  it('writes nothing at all in --dry-run, and still reports the plan', async () => {
    const client = fakeClient()
    const report = await runSetup(client, { ...config, dryRun: true }, silent)

    expect(client.createCollection).not.toHaveBeenCalled()
    expect(client.updateCollection).not.toHaveBeenCalled()
    expect(report.dryRun).toBe(true)
    expect(report.collections.every(entry => entry.changes.length > 0)).toBe(true)
  })

  it('creates the accounts it was asked for, and hands back their passwords', async () => {
    const client = fakeClient()
    const report = await runSetup(
      client,
      { ...config, users: [{ username: 'eleve1', role: 'eleve', password: 'secret' }] },
      silent
    )

    expect(client.ensureUser).toHaveBeenCalledWith({ username: 'eleve1', role: 'eleve', password: 'secret' })
    expect(report.users).toEqual([{ username: 'eleve1', role: 'eleve', password: 'secret', outcome: 'created' }])
  })

  it('runs the live check only when asked, and only outside a dry-run', async () => {
    const checking = fakeClient()
    await runSetup(checking, { ...config, verify: { username: 'e1', password: 'p' } }, silent)
    expect(checking.verify).toHaveBeenCalledWith({ username: 'e1', password: 'p' })

    const dry = fakeClient()
    await runSetup(dry, { ...config, dryRun: true, verify: { username: 'e1', password: 'p' } }, silent)
    expect(dry.verify).not.toHaveBeenCalled()
  })

  it('stops with a clear message when the server is not a PocketBase instance', async () => {
    await expect(runSetup(fakeClient({ withUsers: false }), config, silent)).rejects.toThrow(
      /collection « users »/
    )
  })

  it('prints one line per collection, so a failure is attributable', async () => {
    const lines = []
    await runSetup(fakeClient(), config, line => lines.push(line))
    expect(lines[0]).toMatch(/Superutilisateur connecté/)
    expect(lines.some(line => line.includes(MIND_MAPS_COLLECTION))).toBe(true)
    expect(lines.some(line => line.includes(USERS_COLLECTION))).toBe(true)
  })
})
