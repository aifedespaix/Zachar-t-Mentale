import { describe, it, expect, vi } from 'vitest'
import {
  backupBasename,
  DEFAULT_BACKUP_DIR,
  formatSize,
  parseBackupArgs,
  runBackup,
  waitForBackup,
} from './backup-pocketbase.mjs'
import { SetupError } from './setup-pocketbase.mjs'

/** The narrow slice of the PocketBase client `runBackup` uses. */
function fakeClient({ backups = [{ key: 'zachart-2026-01-01.zip', size: 2048 }] } = {}) {
  let current = [...backups]
  return {
    current: () => current,
    auth: vi.fn(async () => ({ email: 'admin@test.local' })),
    listBackups: vi.fn(async () => current),
    createBackup: vi.fn(async basename => {
      // PocketBase answers with the very name it was given.
      current = [...current, { key: basename, size: 1024 }]
      return basename
    }),
    downloadBackup: vi.fn(async (key, out) => ({ path: `${out}/${key}`, size: 1024 })),
    restoreBackup: vi.fn(async () => undefined),
  }
}

const noPause = async () => {}

describe('parseBackupArgs', () => {
  it('defaults to creating a backup into infra/backups', () => {
    const parsed = parseBackupArgs([])
    expect(parsed).toMatchObject({ out: DEFAULT_BACKUP_DIR, list: false, restore: null, yes: false })
  })

  it('reads every flag it documents', () => {
    const parsed = parseBackupArgs(['--url', 'https://x.test', '--out', '/tmp/b', '--restore', 'a.zip', '--yes', '--insecure'])
    expect(parsed).toMatchObject({ url: 'https://x.test', out: '/tmp/b', restore: 'a.zip', yes: true, insecure: true })
  })

  it('refuses an unknown option and a flag left without a value', () => {
    expect(() => parseBackupArgs(['--nope'])).toThrow(/inconnue/)
    expect(() => parseBackupArgs(['--out'])).toThrow(/valeur manquante/)
  })
})

describe('backupBasename', () => {
  const AT = new Date('2026-09-10T20:31:15.123Z')

  it('is named after the moment, in the lowercase .zip shape PocketBase accepts', () => {
    const name = backupBasename(AT)
    expect(name).toBe('zachart-2026-09-10-203115123.zip')
    // The validation that taught us this: uppercase, spaces, colons and a
    // missing extension are all refused by the server.
    expect(name).toMatch(/^[a-z0-9._-]+\.zip$/)
  })

  it('is stable for the same instant, and different a second later', () => {
    expect(backupBasename(AT)).toBe(backupBasename(AT))
    expect(backupBasename(new Date(AT.getTime() + 1000))).not.toBe(backupBasename(AT))
  })
})

describe('formatSize', () => {
  it('speaks in octets, Kio and Mio', () => {
    expect(formatSize(512)).toBe('512 octets')
    expect(formatSize(2048)).toBe('2 Kio')
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 Mio')
  })
})

describe('waitForBackup', () => {
  it('answers as soon as the server lists the backup', async () => {
    const client = { listBackups: vi.fn().mockResolvedValue([{ key: 'a.zip', size: 1 }]) }
    expect(await waitForBackup(client, 'a.zip', { pause: noPause })).toEqual({ key: 'a.zip', size: 1 })
    expect(client.listBackups).toHaveBeenCalledTimes(1)
  })

  it('polls while the job is still running, then gives up with a coded error', async () => {
    let calls = 0
    const client = {
      listBackups: vi.fn(async () => {
        calls += 1
        return calls < 3 ? [] : [{ key: 'a.zip', size: 1 }]
      }),
    }
    expect(await waitForBackup(client, 'a.zip', { attempts: 5, pause: noPause })).toEqual({ key: 'a.zip', size: 1 })
    expect(client.listBackups).toHaveBeenCalledTimes(3)

    const never = { listBackups: vi.fn(async () => []) }
    await expect(waitForBackup(never, 'a.zip', { attempts: 2, pause: noPause })).rejects.toThrow(/délai dépassé/)
  })
})

describe('runBackup', () => {
  it('creates a backup, waits for it, then downloads it', async () => {
    const client = fakeClient()
    const lines = []

    const result = await runBackup(client, { out: '/tmp/backups', list: false, restore: null }, line => lines.push(line))

    expect(client.createBackup).toHaveBeenCalledWith(expect.stringMatching(/^zachart-.*\.zip$/))
    expect(client.downloadBackup).toHaveBeenCalledWith(result.key, '/tmp/backups')
    expect(result.path).toBe(`/tmp/backups/${result.key}`)
    expect(lines.join('\n')).toMatch(/sauvegarde .* en cours/)
    expect(lines.join('\n')).toMatch(/Superutilisateur connecté/)
  })

  it('--list only reads, and says so when the server has nothing', async () => {
    const client = fakeClient({ backups: [] })
    const lines = []

    const result = await runBackup(client, { list: true, restore: null, out: '/tmp' }, line => lines.push(line))

    expect(client.createBackup).not.toHaveBeenCalled()
    expect(client.downloadBackup).not.toHaveBeenCalled()
    expect(result.listed).toEqual([])
    expect(lines.join('\n')).toMatch(/Aucune sauvegarde/)
  })

  it('refuses to restore without --yes, and never touches the server', async () => {
    const client = fakeClient()

    await expect(runBackup(client, { list: false, restore: 'a.zip', yes: false, out: '/tmp' }, noPause)).rejects.toThrow(
      SetupError
    )
    await expect(runBackup(client, { list: false, restore: 'a.zip', yes: false, out: '/tmp' }, noPause)).rejects.toThrow(
      /TOUTES les données/
    )
    expect(client.restoreBackup).not.toHaveBeenCalled()
  })

  it('restores when the operator confirmed', async () => {
    const client = fakeClient()
    const result = await runBackup(client, { list: false, restore: 'a.zip', yes: true, out: '/tmp' }, noPause)

    expect(client.restoreBackup).toHaveBeenCalledWith('a.zip')
    expect(result.restored).toBe('a.zip')
  })
})
