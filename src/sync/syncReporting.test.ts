import { describe, expect, it, vi } from 'vitest'
import {
  MAX_DETAIL_ENTRIES,
  buildConflictPayload,
  buildDetail,
  buildSyncEvent,
  levelOf,
  reportSyncFailure,
  reportSyncRun,
  type ReportContext,
  type ReportingClient,
} from './syncReporting'
import type { SyncConflict, SyncResult } from './syncService'
import { emptyCardCounts } from './cardCounts'

function result(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    pushed: 0,
    pulled: 0,
    errors: [],
    cancelled: false,
    transferred: [],
    conflicts: [],
    ...overrides,
  }
}

/** Le `detail` que `sync()` renseigne toujours, réduit à ce que le rapport y lit. */
function detail(localContent: string | undefined): SyncConflict['detail'] {
  return {
    localPath: '/cours/Maths/Chapitre 1.zmap',
    remotePath: 'Maths/Chapitre 1.zmap',
    remoteContent: '[]',
    remoteContentHash: 'abc',
    localCounts: emptyCardCounts(),
    remoteCounts: emptyCardCounts(),
    ...(localContent === undefined ? {} : { localContent }),
  }
}

function conflict(overrides: Partial<SyncConflict> = {}): SyncConflict {
  return {
    fileId: 'file-1',
    path: 'Maths/Chapitre 1.zmap',
    localModified: '2026-09-10T10:00:00.000Z',
    remoteUpdated: '2026-09-10T11:00:00.000Z',
    detail: detail('{"meta":{},"cards":[]}'),
    ...overrides,
  }
}

const context: ReportContext = {
  username: 'eleve1',
  role: 'eleve',
  trigger: 'manual',
  summary: '2 envoyées, 1 reçue',
  device: 'Windows',
}

function fakeClient(overrides: Partial<ReportingClient> = {}): ReportingClient {
  return {
    createEvent: vi.fn(async () => ({})),
    listOpenConflicts: vi.fn(async () => []),
    createConflict: vi.fn(async () => ({})),
    updateConflict: vi.fn(async () => ({})),
    closeConflict: vi.fn(async () => ({})),
    ...overrides,
  }
}

describe('levelOf', () => {
  it('answers info for a run where nothing went wrong', () => {
    expect(levelOf(result({ pushed: 3, pulled: 2 }))).toBe('info')
  })

  it('answers error only for a real per-file failure', () => {
    expect(levelOf(result({ errors: [{ fileId: 'a', message: 'boum' }] }))).toBe('error')
  })

  it('keeps a conflict out of the red: a pending decision is not a breakdown', () => {
    expect(levelOf(result({ conflicts: [conflict()] }))).toBe('warning')
  })

  it('flags a cancelled run, which finished nothing it promised', () => {
    expect(levelOf(result({ cancelled: true }))).toBe('warning')
  })

  it('reports the failure when a run both failed and conflicted', () => {
    expect(levelOf(result({ errors: [{ fileId: 'a', message: 'boum' }], conflicts: [conflict()] }))).toBe('error')
  })
})

describe('buildDetail', () => {
  it('carries the optional counters through as zero rather than undefined', () => {
    const detail = buildDetail(result())
    expect(detail.relocated).toBe(0)
    expect(detail.reclassified).toBe(0)
    expect(detail.truncated).toBeUndefined()
  })

  it('caps a long list and says how much it dropped, instead of losing the whole line', () => {
    const transferred = Array.from({ length: MAX_DETAIL_ENTRIES + 7 }, (_, index) => ({
      fileId: `file-${index}`,
      path: `p-${index}.zmap`,
      direction: 'push' as const,
    }))
    const detail = buildDetail(result({ transferred }))
    expect(detail.transferred).toHaveLength(MAX_DETAIL_ENTRIES)
    expect(detail.truncated).toBe(7)
  })

  it('adds up what every capped list dropped', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ fileId: `f${index}`, message: 'x' }))
    const detail = buildDetail(
      result({
        errors: many(MAX_DETAIL_ENTRIES + 2),
        notices: many(MAX_DETAIL_ENTRIES + 3),
      })
    )
    expect(detail.truncated).toBe(5)
  })
})

describe('buildSyncEvent', () => {
  it('reuses the sentence the user already saw rather than inventing a second one', () => {
    const event = buildSyncEvent(result({ pushed: 2, pulled: 1 }), context)
    expect(event.summary).toBe('2 envoyées, 1 reçue')
    expect(event).toMatchObject({
      username: 'eleve1',
      role: 'eleve',
      trigger: 'manual',
      pushed: 2,
      pulled: 1,
      conflicts: 0,
      failures: 0,
      cancelled: false,
      device: 'Windows',
    })
  })

  it('counts conflicts and failures separately — they are not the same news', () => {
    const event = buildSyncEvent(
      result({ conflicts: [conflict(), conflict({ fileId: 'file-2' })], errors: [{ fileId: 'x', message: 'boum' }] }),
      context
    )
    expect(event.conflicts).toBe(2)
    expect(event.failures).toBe(1)
  })
})

describe('buildConflictPayload', () => {
  it('attaches the local version, which exists nowhere else', () => {
    expect(buildConflictPayload(conflict(), 'eleve1')).toEqual({
      file_id: 'file-1',
      path: 'Maths/Chapitre 1.zmap',
      username: 'eleve1',
      local_modified: '2026-09-10T10:00:00.000Z',
      remote_updated: '2026-09-10T11:00:00.000Z',
      local_content: '{"meta":{},"cards":[]}',
      status: 'open',
    })
  })

  it('still reports a conflict whose local file could not be read', () => {
    const payload = buildConflictPayload(conflict({ detail: detail(undefined) }), 'eleve1')
    expect(payload.local_content).toBe('')
    expect(payload.status).toBe('open')
  })

  it('still reports a conflict that carries no detail at all', () => {
    // `sync()` le renseigne toujours, mais le champ est optionnel dans le type :
    // un conflit sans détail ne doit pas faire exploser le rapport.
    const payload = buildConflictPayload(conflict({ detail: undefined }), 'eleve1')
    expect(payload.local_content).toBe('')
    expect(payload.file_id).toBe('file-1')
  })
})

describe('reportSyncRun', () => {
  it('writes one event and opens each conflict', async () => {
    const client = fakeClient()
    const outcome = await reportSyncRun(
      client,
      result({ conflicts: [conflict(), conflict({ fileId: 'file-2' })] }),
      context
    )

    expect(client.createEvent).toHaveBeenCalledTimes(1)
    expect(client.createConflict).toHaveBeenCalledTimes(2)
    expect(outcome).toMatchObject({ event: true, opened: 2, refreshed: 0, failures: [] })
  })

  it('refreshes a conflict already open instead of stacking a row per run', async () => {
    const client = fakeClient({
      listOpenConflicts: vi.fn(async () => [{ id: 'rec-1', file_id: 'file-1' }]),
    })
    const outcome = await reportSyncRun(client, result({ conflicts: [conflict()] }), context)

    expect(client.createConflict).not.toHaveBeenCalled()
    expect(client.updateConflict).toHaveBeenCalledWith('rec-1', expect.objectContaining({ file_id: 'file-1' }))
    expect(outcome).toMatchObject({ opened: 0, refreshed: 1 })
  })

  it('never throws when the server has no such collection: the sync still succeeded', async () => {
    const client = fakeClient({
      createEvent: vi.fn(async () => {
        throw new Error('404 Not Found')
      }),
    })
    const outcome = await reportSyncRun(client, result({ pushed: 1 }), context)

    expect(outcome.event).toBe(false)
    expect(outcome.failures).toEqual(['journal : 404 Not Found'])
  })

  it('still signals a conflict when it could not read the ones already open', async () => {
    const client = fakeClient({
      listOpenConflicts: vi.fn(async () => {
        throw new Error('injoignable')
      }),
    })
    const outcome = await reportSyncRun(client, result({ conflicts: [conflict()] }), context)

    // Un doublon possible vaut mieux qu'un conflit passé sous silence.
    expect(client.createConflict).toHaveBeenCalledTimes(1)
    expect(outcome.opened).toBe(1)
    expect(outcome.failures).toEqual(['conflits déjà ouverts : injoignable'])
  })

  it('keeps reporting the other conflicts when one of them fails', async () => {
    const createConflict = vi
      .fn()
      .mockRejectedValueOnce(new Error('refusé'))
      .mockResolvedValueOnce({})
    const client = fakeClient({ createConflict })
    const outcome = await reportSyncRun(
      client,
      result({ conflicts: [conflict(), conflict({ fileId: 'file-2', path: 'b.zmap' })] }),
      context
    )

    expect(createConflict).toHaveBeenCalledTimes(2)
    expect(outcome.opened).toBe(1)
    expect(outcome.failures).toEqual(['conflit « Maths/Chapitre 1.zmap » : refusé'])
  })

  it('looks at the open conflicts even on a run that reports none — that is when there is something to close', async () => {
    const client = fakeClient()
    await reportSyncRun(client, result({ pushed: 4 }), context)
    expect(client.listOpenConflicts).toHaveBeenCalledWith('eleve1')
  })

  it('closes a conflict this run no longer sees — someone settled it on the device', async () => {
    // La boîte de dialogue de l'application sait résoudre un conflit toute
    // seule. Sans cette passe, son enregistrement resterait « à trancher » pour
    // toujours, et la liste du prof accumulerait des fantômes.
    const client = fakeClient({
      listOpenConflicts: vi.fn(async () => [{ id: 'rec-1', file_id: 'file-1' }]),
    })
    const outcome = await reportSyncRun(client, result({ pushed: 1 }), context)

    expect(client.closeConflict).toHaveBeenCalledWith('rec-1', 'resolved-elsewhere', 'eleve1')
    expect(outcome.closed).toBe(1)
  })

  it('leaves a conflict this run still reports wide open', async () => {
    const client = fakeClient({
      listOpenConflicts: vi.fn(async () => [{ id: 'rec-1', file_id: 'file-1' }]),
    })
    const outcome = await reportSyncRun(client, result({ conflicts: [conflict()] }), context)

    expect(client.closeConflict).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ refreshed: 1, closed: 0 })
  })

  it('closes nothing on an interrupted run, which never finished looking', async () => {
    // « Ce fichier n'est plus en conflit » y voudrait seulement dire « je ne
    // suis pas allé voir ».
    const client = fakeClient({
      listOpenConflicts: vi.fn(async () => [{ id: 'rec-1', file_id: 'file-1' }]),
    })
    const outcome = await reportSyncRun(client, result({ cancelled: true }), context)

    expect(client.closeConflict).not.toHaveBeenCalled()
    expect(outcome.closed).toBe(0)
  })

  it('keeps closing the others when one refuses', async () => {
    const closeConflict = vi.fn().mockRejectedValueOnce(new Error('refusé')).mockResolvedValueOnce({})
    const client = fakeClient({
      listOpenConflicts: vi.fn(async () => [
        { id: 'rec-1', file_id: 'file-1' },
        { id: 'rec-2', file_id: 'file-2' },
      ]),
      closeConflict,
    })
    const outcome = await reportSyncRun(client, result({ pushed: 1 }), context)

    expect(closeConflict).toHaveBeenCalledTimes(2)
    expect(outcome.closed).toBe(1)
    expect(outcome.failures).toEqual(['classement du conflit « file-1 » : refusé'])
  })
})

describe('reportSyncFailure', () => {
  it('envoie une ligne error pour un échec qui n’a produit aucun résultat', async () => {
    const client = fakeClient()
    const landed = await reportSyncFailure(client, {
      username: 'eleve1',
      role: 'eleve',
      trigger: 'auto',
      message: 'Serveur injoignable.',
      detail: Object.assign(new Error('fetch failed'), { status: 0 }),
      device: 'Windows',
    })

    expect(landed).toBe(true)
    expect(client.createEvent).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(client.createEvent).mock.calls[0][0]
    expect(payload).toMatchObject({
      level: 'error',
      trigger: 'auto',
      summary: 'Serveur injoignable.',
      failures: 1,
    })
    // L'erreur BRUTE dans `detail` : c'est la matière que le prof lit depuis
    // l'app admin, texte SDK anglais et statut compris.
    expect(payload.detail.errors).toEqual([{ fileId: '', message: 'Error: fetch failed (status 0)' }])
  })

  it('ne lève jamais, même quand le serveur refuse la ligne', async () => {
    const client = fakeClient({ createEvent: vi.fn().mockRejectedValue(new Error('404')) })

    await expect(
      reportSyncFailure(client, {
        username: 'eleve1',
        role: 'eleve',
        trigger: 'auto',
        message: 'Serveur injoignable.',
        detail: new Error('boum'),
        device: 'Windows',
      })
    ).resolves.toBe(false)
  })
})
